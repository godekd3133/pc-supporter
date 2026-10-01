import { afterEach, describe, expect, it, vi } from "vitest";

function stubBrowser() {
  vi.stubGlobal("window", {
    location: { pathname: "/start" },
    addEventListener: () => undefined
  });
  vi.stubGlobal("fetch", vi.fn(async () => ({ status: 204 })));
}

function postedBatches() {
  const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
  return calls.map(([, options]) => JSON.parse(String((options as { body: string }).body)) as { visitorId?: string; sessionId?: string; events: { name: string; path?: string; props?: Record<string, unknown> }[] });
}

describe("usage-events client beacon", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("flushes an immediate app_open batch with anonymous visitor/session ids", async () => {
    stubBrowser();
    const { trackUsageEvent } = await import("./usage-events");

    trackUsageEvent("app_open");
    await vi.waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0));

    const [url, options] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(url)).toContain("/api/events");
    expect((options as { method: string }).method).toBe("POST");
    expect((options as { keepalive: boolean }).keepalive).toBe(true);

    const [payload] = postedBatches();
    expect(payload!.visitorId).toMatch(/^[A-Za-z0-9_-]{8,72}$/);
    expect(payload!.sessionId).toMatch(/^[A-Za-z0-9_-]{8,72}$/);
    expect(payload!.events).toHaveLength(1);
    expect(payload!.events[0]).toMatchObject({ name: "app_open", path: "/start" });
  });

  it("deduplicates app_open within a session and batches queued events", async () => {
    stubBrowser();
    const { trackUsageEvent } = await import("./usage-events");

    trackUsageEvent("app_open");
    trackUsageEvent("app_open");
    // app_open 즉시 flush가 끝날 때까지 한 틱 기다린다 (in-flight 가드).
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (const step of ["intent", "mode", "usecase", "budget"]) {
      trackUsageEvent("onboarding_step", { step });
    }
    trackUsageEvent("onboarding_complete", {});
    await vi.waitFor(() => expect(postedBatches().flatMap((batch) => batch.events).length).toBe(6));

    const events = postedBatches().flatMap((batch) => batch.events);
    expect(events.filter((event) => event.name === "app_open")).toHaveLength(1);
    expect(events.map((event) => event.name)).toEqual(["app_open", "onboarding_step", "onboarding_step", "onboarding_step", "onboarding_step", "onboarding_complete"]);
    expect(events[1].props).toEqual({ step: "intent" });
  });

  it("keeps working when fetch rejects", async () => {
    stubBrowser();
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));
    const { trackUsageEvent } = await import("./usage-events");

    expect(() => trackUsageEvent("view", { view: "home" })).not.toThrow();
    for (let index = 0; index < 10; index += 1) trackUsageEvent("view", { view: "editor" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });
});
