import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./api";

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
});
