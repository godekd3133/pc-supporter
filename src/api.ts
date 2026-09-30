import { safeLocalStorage } from "./safe-storage";
export type ApiRequestInit = RequestInit & {
  retry?: number;
  retryDelayMs?: number;
  /**
   * Allows a POST-based read/calculation endpoint to retry a short 429 wait.
   * Keep this false for mutations because replaying a write can duplicate it.
   */
  retryOnRateLimit?: boolean;
  /**
   * Per-attempt fetch timeout in milliseconds. A stalled request would otherwise
   * leave the UI waiting forever on mobile networks.
   */
  timeoutMs?: number;
  /**
   * Legacy owner-token calls must stay unversioned because session-v1 is
   * cookie-only and intentionally does not fall back to this header.
   */
  ownerSessionMode?: "session-v1" | "legacy";
};

export type ApiStatus = "unknown" | "online" | "offline" | "degraded";
export type ApiStatusDetails = { status: ApiStatus; lastSuccessAt?: string; fallbackAt?: string; fallbackPath?: string; fallbackCachedAt?: string };

import { ownerSessionModeSupported } from "./owner-session-mode";

const API_PUBLIC_READ_CACHE_PREFIX = "pc-supporter-api-cache:v2:";
const API_PUBLIC_READ_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const API_PUBLIC_READ_CACHE_MAX_ENTRY_BYTES = 512_000;
const API_PUBLIC_READ_CACHE_MAX_TOTAL_BYTES = 750 * 1024;
const MAX_RATE_LIMIT_AUTO_RETRY_COUNT = 1;
const MAX_RATE_LIMIT_AUTO_RETRY_WAIT_MS = 3_000;
const MAX_RETRY_AFTER_SECONDS = 24 * 60 * 60;
const API_REQUEST_TIMEOUT_MS = 20_000;
const configuredApiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").trim().replace(/\/+$/, "");

export function apiRequestUrl(path: string) {
  if (!configuredApiBaseUrl || /^https?:\/\//i.test(path)) return path;
  return new URL(path, `${configuredApiBaseUrl}/`).toString();
}
const apiCacheRequestVersions = new Map<string, number>();
const inFlightReadRequests = new Map<string, Promise<unknown>>();
let latestApiRequestVersion = 0;

export function apiRequestHeaders(init?: ApiRequestInit) {
  const headers = new Headers({ "Content-Type": "application/json" });
  new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
  if (init?.ownerSessionMode === "session-v1" && ownerSessionModeSupported()) {
    headers.set("X-PC-Owner-Mode", "session-v1");
  } else {
    headers.delete("X-PC-Owner-Mode");
  }
  return headers;
}

// StrictMode can replay effect-driven build-detail reads; keep context-sensitive refreshes on their independent request seam.
function inFlightReadRequestKey(path: string, init?: ApiRequestInit) {
  const method = (init?.method ?? "GET").toUpperCase();
  if ((method !== "GET" && method !== "HEAD") || init?.signal || init?.body || init?.mode || init?.cache || init?.redirect || init?.integrity || init?.referrer || init?.referrerPolicy) return undefined;
  if (!/^\/api\/builds\/[^/?]+(?:\/check-causes)?(?:\?|$)/.test(path)) return undefined;
  const headers = [...apiRequestHeaders(init).entries()].sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify([method, apiRequestUrl(path), headers, init?.credentials ?? "include", init?.retry ?? null, init?.retryDelayMs ?? 250, init?.retryOnRateLimit ?? null]);
}

let currentApiStatusDetails: ApiStatusDetails = { status: "unknown" };
const apiStatusListeners = new Set<(details: ApiStatusDetails) => void>();

export function apiStatusSnapshot() {
  return currentApiStatusDetails.status;
}

export function apiStatusDetailsSnapshot() {
  return { ...currentApiStatusDetails };
}

export function subscribeApiStatus(listener: (details: ApiStatusDetails) => void) {
  apiStatusListeners.add(listener);
  listener(apiStatusDetailsSnapshot());
  return () => {
    apiStatusListeners.delete(listener);
  };
}

function publishApiStatus(status: ApiStatus, patch: Partial<ApiStatusDetails> = {}) {
  const next = { ...currentApiStatusDetails, ...patch, status };
  if (next.status === currentApiStatusDetails.status && next.lastSuccessAt === currentApiStatusDetails.lastSuccessAt && next.fallbackAt === currentApiStatusDetails.fallbackAt && next.fallbackPath === currentApiStatusDetails.fallbackPath && next.fallbackCachedAt === currentApiStatusDetails.fallbackCachedAt) return;
  currentApiStatusDetails = next;
  apiStatusListeners.forEach((listener) => listener(apiStatusDetailsSnapshot()));
}

export class ApiError extends Error {
  readonly status: number;
  readonly details: unknown;
  readonly retryAfterSeconds?: number;

  constructor(message: string, status: number, details?: unknown, retryAfterSeconds?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function wait(milliseconds: number, signal?: AbortSignal | null) {
  if (!signal) return new Promise<void>((resolve) => globalThis.setTimeout(resolve, milliseconds));
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
    const onAbort = () => {
      if (timer !== undefined) globalThis.clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason ?? new DOMException("요청이 취소되었습니다.", "AbortError"));
    };
    timer = globalThis.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}

function isRetryableStatus(status: number) {
  return status === 502 || status === 503 || status === 504;
}

function isServerError(status: number) {
  return status >= 500 && status <= 599;
}

function normalizeRetryAfterSeconds(value: unknown) {
  const raw = typeof value === "number"
    ? Number.isFinite(value) ? Math.ceil(value) : NaN
    : typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
  if (!Number.isFinite(raw)) return undefined;
  return Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(0, raw));
}

function retryAfterSecondsFromHeader(value: string | null | undefined) {
  if (!value) return undefined;
  const seconds = normalizeRetryAfterSeconds(value);
  if (seconds !== undefined) return seconds;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(0, Math.ceil((timestamp - Date.now()) / 1000)));
}

function retryAfterSecondsFromPayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  return normalizeRetryAfterSeconds((payload as { retryAfterSeconds?: unknown }).retryAfterSeconds);
}

function rateLimitMessage(message: string, retryAfterSeconds?: number) {
  if (retryAfterSeconds === undefined) return message;
  if (/\d+\s*초\s*후/.test(message)) return message;
  const waitMessage = retryAfterSeconds > 0 ? `${retryAfterSeconds}초 후 다시 시도해 주세요.` : "잠시 후 다시 시도해 주세요.";
  if (/잠시 후 다시 시도해 주세요\.?$/.test(message)) {
    return message.replace(/잠시 후 다시 시도해 주세요\.?$/, waitMessage);
  }
  return `${message.replace(/[.!?。]+$/, "")} ${waitMessage}`;
}

type ApiPublicReadCacheEntry = { cachedAt: number; lastAccessedAt?: number; payload: unknown; etag?: string };
type ApiPublicReadCacheLocation = { key: string; pathname: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function apiPublicReadCacheLocation(path: string, method: string): ApiPublicReadCacheLocation | undefined {
  if ((method !== "GET" && method !== "HEAD") || typeof window === "undefined") return undefined;
  try {
    const url = new URL(apiRequestUrl(path), window.location.origin);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return undefined;
    if (url.pathname !== "/api/parts" && url.pathname !== "/api/accessories" && url.pathname !== "/api/meta") return undefined;
    const requestIdentity = `${method}\u0000${url.origin}\u0000${url.pathname}${url.search}`;
    return { key: API_PUBLIC_READ_CACHE_PREFIX + encodeURIComponent(requestIdentity), pathname: url.pathname };
  } catch {
    return undefined;
  }
}

function parseApiPublicReadCache(raw: string | null): ApiPublicReadCacheEntry | undefined {
  if (!raw || utf8ByteLength(raw) > API_PUBLIC_READ_CACHE_MAX_ENTRY_BYTES) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return undefined;
    const cachedAt = parsed.cachedAt;
    const lastAccessedAt = parsed.lastAccessedAt;
    if (typeof cachedAt !== "number" || !Number.isFinite(cachedAt) || cachedAt > Date.now() + 5 * 60_000 || Date.now() - cachedAt > API_PUBLIC_READ_CACHE_TTL_MS || !Object.prototype.hasOwnProperty.call(parsed, "payload")) return undefined;
    return {
      cachedAt,
      ...(typeof lastAccessedAt === "number" && Number.isFinite(lastAccessedAt) ? { lastAccessedAt } : {}),
      payload: parsed.payload,
      ...(typeof parsed.etag === "string" ? { etag: parsed.etag } : {})
    };
  } catch {
    return undefined;
  }
}

function cacheApiPublicPayload(pathname: string, payload: unknown) {
  if (pathname !== "/api/meta" || !isRecord(payload)) return payload;
  // Cached metadata is display-only. It must never claim that an old admin
  // session or a previously disabled admin gate is still valid.
  return { ...payload, adminAuthEnabled: true, adminSessionAuthenticated: false };
}

function localApiPublicReadCacheEntries() {
  const keys: string[] = [];
  try {
    for (let index = 0; index < safeLocalStorage.length; index += 1) {
      const key = safeLocalStorage.key(index);
      if (key?.startsWith(API_PUBLIC_READ_CACHE_PREFIX)) keys.push(key);
    }
  } catch {
    return [];
  }

  const entries: Array<{ key: string; entry: ApiPublicReadCacheEntry; bytes: number }> = [];
  for (const key of keys) {
    const raw = safeLocalStorage.getItem(key);
    const entry = parseApiPublicReadCache(raw);
    if (!raw || !entry) {
      safeLocalStorage.removeItem(key);
      continue;
    }
    const bytes = utf8ByteLength(key) + utf8ByteLength(raw);
    if (bytes > API_PUBLIC_READ_CACHE_MAX_ENTRY_BYTES) {
      safeLocalStorage.removeItem(key);
      continue;
    }
    entries.push({ key, entry, bytes });
  }
  return entries;
}

function enforceApiPublicReadCacheBudget(protectedKey?: string) {
  const entries = localApiPublicReadCacheEntries();
  let totalBytes = entries.reduce((total, entry) => total + entry.bytes, 0);
  if (totalBytes <= API_PUBLIC_READ_CACHE_MAX_TOTAL_BYTES) return;

  const oldestFirst = entries
    .filter((entry) => entry.key !== protectedKey)
    .sort((left, right) => (left.entry.lastAccessedAt ?? left.entry.cachedAt) - (right.entry.lastAccessedAt ?? right.entry.cachedAt));
  for (const entry of oldestFirst) {
    if (totalBytes <= API_PUBLIC_READ_CACHE_MAX_TOTAL_BYTES) break;
    safeLocalStorage.removeItem(entry.key);
    totalBytes -= entry.bytes;
  }
  if (totalBytes > API_PUBLIC_READ_CACHE_MAX_TOTAL_BYTES && protectedKey) safeLocalStorage.removeItem(protectedKey);
}

function readApiPublicReadCacheFrom(storage: Storage, key: string) {
  const raw = storage.getItem(key);
  const entry = parseApiPublicReadCache(raw);
  if (raw && !entry) storage.removeItem(key);
  return entry;
}

function readApiPublicReadCache(key: string | undefined) {
  if (!key || typeof window === "undefined") return undefined;
  const entry = readApiPublicReadCacheFrom(safeLocalStorage, key);
  if (!entry) return undefined;

  const lastAccessed = Date.now();
  const touched = { ...entry, lastAccessedAt: lastAccessed };
  const raw = JSON.stringify(touched);
  safeLocalStorage.setItem(key, raw);
  enforceApiPublicReadCacheBudget(key);
  return touched;
}

function writeApiPublicReadCache(location: ApiPublicReadCacheLocation | undefined, payload: unknown, etag: string | undefined, requestVersion?: number) {
  const key = location?.key;
  if (!key || typeof window === "undefined") return;
  if (requestVersion !== undefined && apiCacheRequestVersions.get(key) !== requestVersion) return;
  try {
    const now = Date.now();
    const entry: ApiPublicReadCacheEntry = {
      cachedAt: now,
      lastAccessedAt: now,
      payload: cacheApiPublicPayload(location.pathname, payload),
      // /api/meta contains request-specific admin authentication state. A 304
      // must not make cached authorization metadata look current.
      ...(etag && location.pathname !== "/api/meta" ? { etag } : {})
    };
    const raw = JSON.stringify(entry);
    const byteLength = utf8ByteLength(key) + utf8ByteLength(raw);
    if (byteLength > API_PUBLIC_READ_CACHE_MAX_ENTRY_BYTES) return;
    safeLocalStorage.setItem(key, raw);
    enforceApiPublicReadCacheBudget(key);
  } catch {
    // Cache storage is best-effort and must never block a live API response.
  }
}

function notifyAdminAuthRequired(path: string, status: number, payload: unknown) {
  if (status !== 401 || !path.startsWith("/api/admin/") || path === "/api/admin/login" || typeof window === "undefined" || typeof window.dispatchEvent !== "function" || typeof CustomEvent !== "function") return;
  const code = payload && typeof payload === "object" && !Array.isArray(payload) && typeof (payload as { code?: unknown }).code === "string"
    ? (payload as { code: string }).code
    : undefined;
  window.dispatchEvent(new CustomEvent("pc-supporter:admin-auth-required", { detail: { path, code } }));
}

function notifyAdminAuthMisconfigured(path: string, status: number, payload: unknown) {
  if (status !== 503 || !path.startsWith("/api/admin/") || path === "/api/admin/login" || typeof window === "undefined" || typeof window.dispatchEvent !== "function" || typeof CustomEvent !== "function") return;
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || (payload as { code?: unknown }).code !== "ADMIN_AUTH_MISCONFIGURED") return;
  const security = (payload as { security?: unknown }).security;
  window.dispatchEvent(new CustomEvent("pc-supporter:admin-auth-misconfigured", {
    detail: {
      path,
      code: "ADMIN_AUTH_MISCONFIGURED",
      ...(security && typeof security === "object" && !Array.isArray(security) ? { security } : {})
    }
  }));
}

async function requestApi<T>(path: string, init?: ApiRequestInit): Promise<T> {
  const { retry: requestedRetries, retryDelayMs = 250, retryOnRateLimit, timeoutMs: requestedTimeoutMs, ownerSessionMode: _ownerSessionMode, ...requestInit } = init ?? {};
  const apiRequestVersion = ++latestApiRequestVersion;
  const isCurrentApiRequest = () => latestApiRequestVersion === apiRequestVersion;
  const method = (requestInit.method ?? "GET").toUpperCase();
  const retries = Math.max(0, Math.min(3, requestedRetries ?? (method === "GET" || method === "HEAD" ? 2 : 0)));
  const canRetryRateLimit = retryOnRateLimit ?? (method === "GET" || method === "HEAD");
  const timeoutMs = Math.max(1_000, Math.min(120_000, requestedTimeoutMs ?? API_REQUEST_TIMEOUT_MS));
  const apiCacheLocation = apiPublicReadCacheLocation(path, method);
  const apiCacheKey = apiCacheLocation?.key;
  const apiCacheRequestVersion = apiCacheKey
    ? (apiCacheRequestVersions.get(apiCacheKey) ?? 0) + 1
    : undefined;
  if (apiCacheKey && apiCacheRequestVersion !== undefined) apiCacheRequestVersions.set(apiCacheKey, apiCacheRequestVersion);
  let lastNetworkError: unknown;
  let rateLimitRetryCount = 0;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let response: Response;
    const cachedForRequest = readApiPublicReadCache(apiCacheKey);
    const attemptController = new AbortController();
    let attemptTimedOut = false;
    const onCallerAbort = () => attemptController.abort(requestInit.signal?.reason);
    if (requestInit.signal) {
      if (requestInit.signal.aborted) onCallerAbort();
      else requestInit.signal.addEventListener("abort", onCallerAbort, { once: true });
    }
    const timeoutTimer = globalThis.setTimeout(() => {
      attemptTimedOut = true;
      attemptController.abort(new DOMException("요청 시간이 초과되었습니다.", "TimeoutError"));
    }, timeoutMs);
    try {
      response = await fetch(apiRequestUrl(path), {
        ...requestInit,
        signal: attemptController.signal,
        credentials: requestInit.credentials ?? "include",
        headers: (() => {
          const headers = apiRequestHeaders(init);
          if (cachedForRequest?.etag && apiCacheLocation?.pathname !== "/api/meta") headers.set("If-None-Match", cachedForRequest.etag);
          return headers;
        })()
      });
    } catch (error) {
      lastNetworkError = error;
      const callerAborted = Boolean(requestInit.signal?.aborted);
      const isNetworkFailure = error instanceof TypeError && /fetch|network|connect/i.test(error.message);
      const isTimeout = !callerAborted && (attemptTimedOut || (error instanceof DOMException && error.name === "TimeoutError"));
      if (callerAborted || (!(isNetworkFailure || isTimeout)) || attempt >= retries) {
        if (callerAborted) throw error;
        if (isNetworkFailure || isTimeout) {
          if (isCurrentApiRequest()) publishApiStatus("offline", { fallbackAt: undefined, fallbackPath: undefined, fallbackCachedAt: undefined });
          const cachedPayload = readApiPublicReadCache(apiCacheKey);
          if (cachedPayload !== undefined) {
            if (isCurrentApiRequest()) publishApiStatus("offline", {
              fallbackAt: new Date().toISOString(),
              fallbackPath: path,
              fallbackCachedAt: new Date(cachedPayload.cachedAt).toISOString()
            });
            return cachedPayload.payload as T;
          }
          throw new Error(isTimeout
            ? "API 서버 응답 시간이 초과되었습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요."
            : "API 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
        }
        throw error;
      }
      await wait(retryDelayMs * (attempt + 1), requestInit.signal);
      continue;
    } finally {
      globalThis.clearTimeout(timeoutTimer);
      requestInit.signal?.removeEventListener("abort", onCallerAbort);
    }

    const responseLiveAt = new Date().toISOString();
    const etag = typeof response.headers?.get === "function" ? response.headers.get("ETag") ?? undefined : undefined;
    if (isCurrentApiRequest()) publishApiStatus(isServerError(response.status) ? "degraded" : "online", { ...(response.ok || response.status === 304 ? { lastSuccessAt: responseLiveAt } : {}), fallbackAt: undefined, fallbackPath: undefined, fallbackCachedAt: undefined });
    if (response.status === 304) {
      const cachedResponse = cachedForRequest ?? readApiPublicReadCache(apiCacheKey);
      if (cachedResponse !== undefined) {
        writeApiPublicReadCache(apiCacheLocation, cachedResponse.payload, etag ?? cachedResponse.etag, apiCacheRequestVersion);
        return cachedResponse.payload as T;
      }
      throw new ApiError("조건부 응답을 복원할 원본 캐시가 없습니다.", 304);
    }
    const payload = (await response.json().catch(() => ({}))) as T & { error?: string; retryAfterSeconds?: unknown };
    if (response.ok) {
      writeApiPublicReadCache(apiCacheLocation, payload, etag, apiCacheRequestVersion);
      return payload;
    }
    if (isCurrentApiRequest()) {
      notifyAdminAuthRequired(path, response.status, payload);
      notifyAdminAuthMisconfigured(path, response.status, payload);
    }
    const retryAfterSeconds = response.status === 429
      ? retryAfterSecondsFromHeader(response.headers?.get?.("Retry-After")) ?? retryAfterSecondsFromPayload(payload)
      : undefined;
    if (response.status === 429 && canRetryRateLimit && rateLimitRetryCount < MAX_RATE_LIMIT_AUTO_RETRY_COUNT && attempt < retries && retryAfterSeconds !== undefined && retryAfterSeconds * 1000 <= MAX_RATE_LIMIT_AUTO_RETRY_WAIT_MS) {
      rateLimitRetryCount += 1;
      await wait(retryAfterSeconds * 1000, requestInit.signal);
      continue;
    }
    if (isRetryableStatus(response.status) && attempt < retries) {
      await wait(retryDelayMs * (attempt + 1), requestInit.signal);
      continue;
    }
    throw new ApiError(
      rateLimitMessage(payload.error ?? `요청에 실패했습니다. (${response.status})`, retryAfterSeconds),
      response.status,
      payload,
      retryAfterSeconds
    );
  }

  throw new Error(lastNetworkError instanceof Error ? lastNetworkError.message : "요청에 실패했습니다.");
}

export function api<T>(path: string, init?: ApiRequestInit): Promise<T> {
  const key = inFlightReadRequestKey(path, init);
  if (!key) return requestApi<T>(path, init);
  const existing = inFlightReadRequests.get(key);
  if (existing) return existing as Promise<T>;
  const pending = requestApi<T>(path, init).finally(() => {
    if (inFlightReadRequests.get(key) === pending) inFlightReadRequests.delete(key);
  });
  inFlightReadRequests.set(key, pending);
  return pending;
}
