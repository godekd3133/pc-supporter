export type ApiRequestInit = RequestInit & {
  retry?: number;
  retryDelayMs?: number;
  /**
   * Allows a POST-based read/calculation endpoint to retry a short 429 wait.
   * Keep this false for mutations because replaying a write can duplicate it.
   */
  retryOnRateLimit?: boolean;
};

export type ApiStatus = "unknown" | "online" | "offline" | "degraded";
export type ApiStatusDetails = { status: ApiStatus; lastSuccessAt?: string; fallbackAt?: string; fallbackPath?: string };

const API_SESSION_CACHE_PREFIX = "pc-supporter-api-cache:v1:";
const API_SESSION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const API_SESSION_CACHE_MAX_BYTES = 512_000;
const MAX_RATE_LIMIT_AUTO_RETRY_COUNT = 1;
const MAX_RATE_LIMIT_AUTO_RETRY_WAIT_MS = 3_000;
const MAX_RETRY_AFTER_SECONDS = 24 * 60 * 60;
const configuredApiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").trim().replace(/\/+$/, "");

export function apiRequestUrl(path: string) {
  if (!configuredApiBaseUrl || /^https?:\/\//i.test(path)) return path;
  return new URL(path, `${configuredApiBaseUrl}/`).toString();
}
const sessionCacheRequestVersions = new Map<string, number>();
const inFlightReadRequests = new Map<string, Promise<unknown>>();
let latestApiRequestVersion = 0;

// StrictMode can replay effect-driven build-detail reads; keep context-sensitive refreshes on their independent request seam.
function inFlightReadRequestKey(path: string, init?: ApiRequestInit) {
  const method = (init?.method ?? "GET").toUpperCase();
  if ((method !== "GET" && method !== "HEAD") || init?.signal || init?.body || init?.mode || init?.cache || init?.redirect || init?.integrity || init?.referrer || init?.referrerPolicy) return undefined;
  if (!/^\/api\/builds\/[^/?]+(?:\/check-causes)?(?:\?|$)/.test(path)) return undefined;
  const headers = [...new Headers(init?.headers).entries()].sort(([left], [right]) => left.localeCompare(right));
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
  if (next.status === currentApiStatusDetails.status && next.lastSuccessAt === currentApiStatusDetails.lastSuccessAt && next.fallbackAt === currentApiStatusDetails.fallbackAt && next.fallbackPath === currentApiStatusDetails.fallbackPath) return;
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

function apiSessionCacheKey(path: string, method: string) {
  if (method !== "GET" && method !== "HEAD" || typeof window === "undefined") return undefined;
  try {
    const url = new URL(path, window.location.origin);
    if (url.pathname !== "/api/parts" && url.pathname !== "/api/accessories" && url.pathname !== "/api/meta") return undefined;
    return API_SESSION_CACHE_PREFIX + url.pathname + url.search;
  } catch {
    return undefined;
  }
}

function readApiSessionCache(key: string | undefined) {
  if (!key || typeof window === "undefined") return undefined;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const record = parsed as { cachedAt?: unknown; payload?: unknown; etag?: unknown };
    if (typeof record.cachedAt !== "number" || !Number.isFinite(record.cachedAt) || Date.now() - record.cachedAt > API_SESSION_CACHE_TTL_MS || !Object.prototype.hasOwnProperty.call(record, "payload")) {
      window.sessionStorage.removeItem(key);
      return undefined;
    }
    return { payload: record.payload, cachedAt: record.cachedAt, etag: typeof record.etag === "string" ? record.etag : undefined };
  } catch {
    return undefined;
  }
}

function writeApiSessionCache(key: string | undefined, payload: unknown, etag: string | undefined, requestVersion?: number) {
  if (!key || typeof window === "undefined") return;
  if (requestVersion !== undefined && sessionCacheRequestVersions.get(key) !== requestVersion) return;
  try {
    const raw = JSON.stringify({ cachedAt: Date.now(), payload, ...(etag ? { etag } : {}) });
    if (raw.length > API_SESSION_CACHE_MAX_BYTES) return;
    window.sessionStorage.setItem(key, raw);
  } catch {
    // Session cache is a best-effort fallback and must never block a live response.
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
  const { retry: requestedRetries, retryDelayMs = 250, retryOnRateLimit, ...requestInit } = init ?? {};
  const apiRequestVersion = ++latestApiRequestVersion;
  const isCurrentApiRequest = () => latestApiRequestVersion === apiRequestVersion;
  const method = (requestInit.method ?? "GET").toUpperCase();
  const retries = Math.max(0, Math.min(3, requestedRetries ?? (method === "GET" || method === "HEAD" ? 2 : 0)));
  const canRetryRateLimit = retryOnRateLimit ?? (method === "GET" || method === "HEAD");
  const sessionCacheKey = apiSessionCacheKey(path, method);
  const sessionCacheRequestVersion = sessionCacheKey
    ? (sessionCacheRequestVersions.get(sessionCacheKey) ?? 0) + 1
    : undefined;
  if (sessionCacheKey && sessionCacheRequestVersion !== undefined) sessionCacheRequestVersions.set(sessionCacheKey, sessionCacheRequestVersion);
  let lastNetworkError: unknown;
  let rateLimitRetryCount = 0;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let response: Response;
    const cachedForRequest = readApiSessionCache(sessionCacheKey);
    try {
      response = await fetch(apiRequestUrl(path), {
        ...requestInit,
        credentials: requestInit.credentials ?? "include",
        headers: {
          "Content-Type": "application/json",
          ...(requestInit.headers ?? {}),
          ...(cachedForRequest?.etag ? { "If-None-Match": cachedForRequest.etag } : {})
        }
      });
    } catch (error) {
      lastNetworkError = error;
      if (!(error instanceof TypeError && /fetch|network|connect/i.test(error.message)) || attempt >= retries) {
        if (error instanceof TypeError && /fetch|network|connect/i.test(error.message)) {
          if (isCurrentApiRequest()) publishApiStatus("offline", { fallbackAt: undefined, fallbackPath: undefined });
          const cachedPayload = readApiSessionCache(sessionCacheKey);
          if (cachedPayload !== undefined) {
            if (isCurrentApiRequest()) publishApiStatus("offline", { fallbackAt: new Date().toISOString(), fallbackPath: path });
            return cachedPayload.payload as T;
          }
          throw new Error("API 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
        }
        throw error;
      }
      await wait(retryDelayMs * (attempt + 1), requestInit.signal);
      continue;
    }

    const responseLiveAt = new Date().toISOString();
    const etag = typeof response.headers?.get === "function" ? response.headers.get("ETag") ?? undefined : undefined;
    if (isCurrentApiRequest()) publishApiStatus(isServerError(response.status) ? "degraded" : "online", { ...(response.ok || response.status === 304 ? { lastSuccessAt: responseLiveAt } : {}), fallbackAt: undefined, fallbackPath: undefined });
    if (response.status === 304) {
      const cachedResponse = cachedForRequest ?? readApiSessionCache(sessionCacheKey);
      if (cachedResponse !== undefined) {
        writeApiSessionCache(sessionCacheKey, cachedResponse.payload, etag ?? cachedResponse.etag, sessionCacheRequestVersion);
        return cachedResponse.payload as T;
      }
      throw new ApiError("조건부 응답을 복원할 원본 캐시가 없습니다.", 304);
    }
    const payload = (await response.json().catch(() => ({}))) as T & { error?: string; retryAfterSeconds?: unknown };
    if (response.ok) {
      writeApiSessionCache(sessionCacheKey, payload, etag, sessionCacheRequestVersion);
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
