import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, apiStatusDetailsSnapshot, apiStatusSnapshot, subscribeApiStatus } from "./api";
import type { ApiStatus } from "./api";
import { retryAfterSecondsFromMessage } from "./retry-after";

describe("api client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("turns a browser network failure into an actionable local-server message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(api("/api/parts?category=cpu", { retry: 0 })).rejects.toThrow(
      "API 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요."
    );
  });

  it("retries a transient network failure when the request explicitly allows it", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(api<{ ok: boolean }>("/api/health", { retry: 1, retryDelayMs: 0 })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("coalesces identical concurrent idempotent reads", async () => {
    let release: ((response: unknown) => void) | undefined;
    const fetchMock = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    vi.stubGlobal("fetch", fetchMock);

    const first = api<{ ok: boolean }>("/api/builds/coalesced", { retry: 0 });
    const second = api<{ ok: boolean }>("/api/builds/coalesced", { retry: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const response = { ok: true, status: 200, json: vi.fn().mockResolvedValue({ ok: true }) };
    release?.(response);
    await expect(Promise.all([first, second])).resolves.toEqual([{ ok: true }, { ok: true }]);
  });

  it("does not coalesce reads with different owner credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(Promise.all([
      api("/api/builds/owner-scoped", { headers: { "X-Share-Owner-Token": "owner-a" }, retry: 0 }),
      api("/api/builds/owner-scoped", { headers: { "X-Share-Owner-Token": "owner-b" }, retry: 0 })
    ])).resolves.toEqual([{ ok: true }, { ok: true }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps saved-build list refreshes independent", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ items: [] }) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(Promise.all([
      api("/api/builds?ids=refresh", { retry: 0 }),
      api("/api/builds?ids=refresh", { retry: 0 })
    ])).resolves.toEqual([{ items: [] }, { items: [] }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps owner monitor context refreshes independent", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ subscription: { alerts: [] } }) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(Promise.all([
      api("/api/builds/owner-scoped/monitor", { headers: { "X-Share-Owner-Token": "owner" }, retry: 0 }),
      api("/api/builds/owner-scoped/monitor", { headers: { "X-Share-Owner-Token": "owner" }, retry: 0 })
    ])).resolves.toEqual([{ subscription: { alerts: [] } }, { subscription: { alerts: [] } }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries transient 503 responses but does not retry write requests by default", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: vi.fn().mockResolvedValue({ error: "busy" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(api<{ ok: boolean }>("/api/health", { retryDelayMs: 0 })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockReset().mockResolvedValue({ ok: false, status: 503, json: vi.fn().mockResolvedValue({ error: "busy" }) });
    await expect(api("/api/builds", { method: "POST", body: "{}", retryDelayMs: 0 })).rejects.toThrow("busy");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves HTTP status on non-retryable API errors", async () => {
    const details = { error: "없음", recoveryOptions: [{ id: "retry", label: "다시 찾기", summary: "조건을 조정합니다.", changedFields: ["조건"], request: {}, preview: {} }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, json: vi.fn().mockResolvedValue(details) }));

    await expect(api("/api/missing", { retry: 0 })).rejects.toMatchObject({ name: "ApiError", status: 404, message: "없음", details } satisfies Partial<ApiError>);
  });

  it("notifies the admin screen when a protected request loses its session", async () => {
    const dispatched: CustomEvent[] = [];
    vi.stubGlobal("window", { dispatchEvent: (event: Event) => dispatched.push(event as CustomEvent) });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue({ error: "관리자 로그인이 필요합니다.", code: "ADMIN_AUTH_REQUIRED" })
    }));

    await expect(api("/api/admin/build-versions/status", { retry: 0 })).rejects.toMatchObject({ name: "ApiError", status: 401 } satisfies Partial<ApiError>);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]?.type).toBe("pc-supporter:admin-auth-required");
    expect(dispatched[0]?.detail).toEqual({ path: "/api/admin/build-versions/status", code: "ADMIN_AUTH_REQUIRED" });
  });

  it("notifies the admin screen when production auth configuration is invalid", async () => {
    const dispatched: CustomEvent[] = [];
    vi.stubGlobal("window", { dispatchEvent: (event: Event) => dispatched.push(event as CustomEvent) });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: vi.fn().mockResolvedValue({
        error: "운영 관리자 인증 설정이 필요합니다.",
        code: "ADMIN_AUTH_MISCONFIGURED",
        security: { environment: "production", passwordConfigured: true, sessionSecretConfigured: false, productionReady: false }
      })
    }));

    await expect(api("/api/admin/build-versions/status", { retry: 0 })).rejects.toMatchObject({ name: "ApiError", status: 503 } satisfies Partial<ApiError>);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]?.type).toBe("pc-supporter:admin-auth-misconfigured");
    expect(dispatched[0]?.detail).toMatchObject({ path: "/api/admin/build-versions/status", code: "ADMIN_AUTH_MISCONFIGURED", security: { productionReady: false } });
  });

  it("does not treat an invalid admin password as an expired session", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue({ error: "관리자 비밀번호가 올바르지 않습니다." })
    }));

    await expect(api("/api/admin/login", { method: "POST", body: JSON.stringify({ password: "wrong" }), retry: 0 })).rejects.toMatchObject({ name: "ApiError", status: 401 } satisfies Partial<ApiError>);
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it("surfaces Retry-After and limits automatic 429 retries to read requests", async () => {
    expect(retryAfterSecondsFromMessage("요청이 너무 많습니다. 7초 후 다시 시도해 주세요.")).toBe(7);
    expect(retryAfterSecondsFromMessage("일반 네트워크 오류")).toBeUndefined();
    const readFetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: { get: (name: string) => name === "Retry-After" ? "0" : null },
        json: vi.fn().mockResolvedValue({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", code: "RATE_LIMITED" })
      })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, json: vi.fn().mockResolvedValue({ ok: true }) });
    vi.stubGlobal("fetch", readFetchMock);

    await expect(api<{ ok: boolean }>("/api/parts?category=cpu", { retry: 1, retryDelayMs: 0 })).resolves.toEqual({ ok: true });
    expect(readFetchMock).toHaveBeenCalledTimes(2);

    const writeFetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: (name: string) => name === "Retry-After" ? "7" : null },
      json: vi.fn().mockResolvedValue({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", retryAfterSeconds: 7 })
    });
    vi.stubGlobal("fetch", writeFetchMock);

    await expect(api("/api/builds", { method: "POST", body: "{}", retry: 1, retryDelayMs: 0 })).rejects.toMatchObject({
      name: "ApiError",
      status: 429,
      retryAfterSeconds: 7,
      message: "요청이 너무 많습니다. 7초 후 다시 시도해 주세요."
    } satisfies Partial<ApiError>);
    expect(writeFetchMock).toHaveBeenCalledTimes(1);

    const readPostFetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: { get: (name: string) => name === "Retry-After" ? "0" : null },
        json: vi.fn().mockResolvedValue({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." })
      })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, json: vi.fn().mockResolvedValue({ ok: true }) });
    vi.stubGlobal("fetch", readPostFetchMock);

    await expect(api<{ ok: boolean }>("/api/compatibility/check", { method: "POST", body: "{}", retry: 1, retryDelayMs: 0, retryOnRateLimit: true })).resolves.toEqual({ ok: true });
    expect(readPostFetchMock).toHaveBeenCalledTimes(2);

    const dateFetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: (name: string) => name === "Retry-After" ? new Date(Date.now() - 1_000).toUTCString() : null },
      json: vi.fn().mockResolvedValue({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." })
    });
    vi.stubGlobal("fetch", dateFetchMock);

    await expect(api("/api/parts?retry-after-date", { retry: 0 })).rejects.toMatchObject({ status: 429, retryAfterSeconds: 0 } satisfies Partial<ApiError>);

    const controller = new AbortController();
    const abortFetchMock = vi.fn((_path: string, init?: RequestInit) => new Promise<never>((_resolve, reject) => {
      const error = new Error("요청이 취소되었습니다.");
      error.name = "AbortError";
      init?.signal?.addEventListener("abort", () => reject(error), { once: true });
    }));
    vi.stubGlobal("fetch", abortFetchMock);
    const pending = api("/api/parts?abort", { retry: 2, retryDelayMs: 100, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(abortFetchMock).toHaveBeenCalledTimes(1);
  });

  it("turns a stalled request into a timeout error instead of hanging forever", async () => {
    const fetchMock = vi.fn((_path: string, init?: RequestInit) => new Promise<never>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api("/api/parts?category=cpu&timeout-test=hang", { retry: 0, timeoutMs: 20 })).rejects.toThrow(
      "API 서버 응답 시간이 초과되었습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요."
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(apiStatusSnapshot()).toBe("offline");
  });

  it("retries a timed-out read request and succeeds on the next attempt", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce((_path: string, init?: RequestInit) => new Promise<never>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
      }))
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(api<{ ok: boolean }>("/api/health?timeout-retry", { retry: 1, retryDelayMs: 0, timeoutMs: 20 })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("lets a caller abort win over the request timeout", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_path: string, init?: RequestInit) => new Promise<never>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = api("/api/parts?timeout-abort", { retry: 2, retryDelayMs: 0, timeoutMs: 60_000, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("serves the catalog session cache when a request times out", async () => {
    const path = "/api/parts?category=cpu&cache-test=timeout-fallback";
    const payload = { items: [{ id: "cached-on-timeout" }] };
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {
      location: { origin: "http://localhost" },
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key)
      }
    });
    const headers = { get: () => null };
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, headers, json: vi.fn().mockResolvedValue(payload) });
    vi.stubGlobal("fetch", fetchMock);
    await expect(api<typeof payload>(path, { retry: 0 })).resolves.toEqual(payload);

    fetchMock.mockImplementation((_p: string, init?: RequestInit) => new Promise<never>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
    }));
    await expect(api<typeof payload>(path, { retry: 0, timeoutMs: 20 })).resolves.toEqual(payload);
  });

  it("publishes offline and online transitions for the global API status", async () => {
    const events: ApiStatus[] = [];
    const unsubscribe = subscribeApiStatus((details) => events.push(details.status));
    events.length = 0;
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api("/api/health", { retry: 0 })).rejects.toThrow("API 서버에 연결할 수 없습니다.");
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ ok: true }) });
    await expect(api<{ ok: boolean }>("/api/health", { retry: 0 })).resolves.toEqual({ ok: true });
    unsubscribe();

    expect(events).toEqual(["offline", "online"]);
    expect(apiStatusSnapshot()).toBe("online");
    expect(apiStatusDetailsSnapshot().lastSuccessAt).toEqual(expect.any(String));
    expect(apiStatusDetailsSnapshot().fallbackAt).toBeUndefined();
  });

  it("uses an exact recent catalog GET response as a stale offline fallback", async () => {
    const path = "/api/parts?category=cpu&cache-test=unique";
    const payload = { items: [{ id: "cached-cpu" }] };
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {
      location: { origin: "http://localhost" },
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key)
      }
    });
    const headers = { get: (name: string) => name.toLowerCase() === "etag" ? '"cache-etag"' : null };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, headers, json: vi.fn().mockResolvedValue(payload) });
    vi.stubGlobal("fetch", fetchMock);
    await expect(api<typeof payload>(path, { retry: 0 })).resolves.toEqual(payload);

    fetchMock.mockResolvedValueOnce({ ok: false, status: 304, headers, json: vi.fn().mockResolvedValue({}) });
    await expect(api<typeof payload>(path, { retry: 0 })).resolves.toEqual(payload);
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).headers).toMatchObject({ "If-None-Match": '"cache-etag"' });
    expect(apiStatusDetailsSnapshot().fallbackAt).toBeUndefined();

    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(api<typeof payload>(path, { retry: 0 })).resolves.toEqual(payload);
    expect(apiStatusSnapshot()).toBe("offline");
    expect(apiStatusDetailsSnapshot().fallbackAt).toEqual(expect.any(String));
    expect(apiStatusDetailsSnapshot().fallbackPath).toBe(path);

    await expect(api("/api/health", { retry: 0 })).rejects.toThrow("API 서버에 연결할 수 없습니다.");
    expect(apiStatusDetailsSnapshot().fallbackAt).toBeUndefined();
    expect(apiStatusDetailsSnapshot().fallbackPath).toBeUndefined();
  });

  it("does not let an older catalog response roll the session cache back", async () => {
    const path = "/api/parts?category=cpu&cache-test=concurrent-ordering";
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {
      location: { origin: "http://localhost" },
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key)
      }
    });
    const oldPayload = { items: [{ id: "old-cpu" }] };
    const latestPayload = { items: [{ id: "latest-cpu" }] };
    let releaseOld: ((response: unknown) => void) | undefined;
    let releaseLatest: ((response: unknown) => void) | undefined;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { releaseOld = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { releaseLatest = resolve; }));
    vi.stubGlobal("fetch", fetchMock);

    const oldRequest = api<typeof oldPayload>(path, { retry: 0 });
    const latestRequest = api<typeof latestPayload>(path, { retry: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    releaseLatest?.({ ok: true, status: 200, json: vi.fn().mockResolvedValue(latestPayload) });
    await expect(latestRequest).resolves.toEqual(latestPayload);
    releaseOld?.({ ok: true, status: 200, json: vi.fn().mockResolvedValue(oldPayload) });
    await expect(oldRequest).resolves.toEqual(oldPayload);

    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(api<typeof latestPayload>(path, { retry: 0 })).resolves.toEqual(latestPayload);
  });

  it("keeps global API status and admin auth events owned by the latest request", async () => {
    const events: ApiStatus[] = [];
    const dispatched: CustomEvent[] = [];
    const unsubscribe = subscribeApiStatus((details) => events.push(details.status));
    events.length = 0;
    vi.stubGlobal("window", { dispatchEvent: (event: Event) => dispatched.push(event as CustomEvent) });
    let releaseOld: ((error: unknown) => void) | undefined;
    let releaseAuth: ((response: unknown) => void) | undefined;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { releaseOld = reject; }))
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ ok: true }) })
      .mockImplementationOnce(() => new Promise((resolve) => { releaseAuth = resolve; }))
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);

    const oldRequest = api("/api/health?status-stale", { retry: 0 });
    const latestRequest = api<{ ok: boolean }>("/api/health?status-latest", { retry: 0 });
    await expect(latestRequest).resolves.toEqual({ ok: true });
    const staleNetworkError = new TypeError("Failed to fetch");
    releaseOld?.(staleNetworkError);
    await expect(oldRequest).rejects.toThrow("API 서버에 연결할 수 없습니다.");
    expect(apiStatusSnapshot()).toBe("online");

    const staleAuthRequest = api("/api/admin/build-versions/status", { retry: 0 });
    const newerHealthRequest = api<{ ok: boolean }>("/api/health?auth-latest", { retry: 0 });
    await expect(newerHealthRequest).resolves.toEqual({ ok: true });
    releaseAuth?.({ ok: false, status: 401, json: vi.fn().mockResolvedValue({ error: "세션 만료", code: "ADMIN_AUTH_REQUIRED" }) });
    await expect(staleAuthRequest).rejects.toMatchObject({ status: 401 } satisfies Partial<ApiError>);
    expect(dispatched).toHaveLength(0);
    unsubscribe();
    expect(events.at(-1)).toBe("online");
  });

  it("never uses the session fallback for write requests", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(api("/api/parts?category=cpu&cache-test=write", { method: "POST", body: "{}", retry: 0 })).rejects.toThrow("API 서버에 연결할 수 없습니다.");
  });
});
