import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALTERNATIVE_COMPARISON_LOCAL_SHARES_STORAGE_KEY,
  BUDGET_LADDER_LOCAL_SHARES_STORAGE_KEY,
  SAVED_BUILD_VERSION_LOCAL_SHARES_STORAGE_KEY,
  SAVED_WATCHLIST_OWNER_TOKENS_STORAGE_KEY,
  collectStoredOwnerCredentials,
  hasOwnerSessionResource,
  initializeOwnerSession,
  migrateStoredOwnerCredentials,
  ownerSessionCreateOptions,
  ownerSessionCookieIsVerified,
  SAVED_WATCHLIST_LINK_STORAGE_KEY
} from "./owner-session";
import { SAVED_BUILD_IDS_STORAGE_KEY, SAVED_BUILD_OWNER_TOKENS_STORAGE_KEY } from "./saved-build-storage";
import { GENERATOR_VARIANTS_LOCAL_SHARES_STORAGE_KEY } from "../shared/generator-variants-local-share";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  readonly clear = vi.fn(() => this.values.clear());
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(String(key)) ?? null; }
  setItem(key: string, value: string) { this.values.set(String(key), String(value)); }
  removeItem(key: string) { this.values.delete(String(key)); }
}

function secureWindow(localStorage: Storage, dispatchEvent = vi.fn()) {
  vi.stubEnv("VITE_API_BASE_URL", "");
  vi.stubGlobal("window", {
    location: { protocol: "https:", hostname: "pc.example.com", port: "", origin: "https://pc.example.com" },
    localStorage,
    dispatchEvent
  });
  vi.stubGlobal("StorageEvent", class {
    readonly type: string;
    readonly key: string | null;
    readonly newValue: string | null;
    constructor(type: string, init: { key?: string | null; newValue?: string | null }) {
      this.type = type;
      this.key = init.key ?? null;
      this.newValue = init.newValue ?? null;
    }
  });
  return dispatchEvent;
}

function jsonItem(storage: Storage, key: string) {
  return JSON.parse(storage.getItem(key) ?? "null") as unknown;
}

describe("owner session migration", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("dedupes exact credentials, preserves rejected tokens and unrelated data, and scrubs every confirmed token variant", async () => {
    const storage = new MemoryStorage();
    const dispatchEvent = secureWindow(storage);
    const accepted = "a".repeat(43);
    const stale = "s".repeat(43);
    storage.setItem(SAVED_BUILD_IDS_STORAGE_KEY, JSON.stringify(["build-current", "build-stale"]));
    storage.setItem(SAVED_BUILD_OWNER_TOKENS_STORAGE_KEY, JSON.stringify({ "build-current": accepted, "build-stale": stale }));
    storage.setItem(SAVED_WATCHLIST_LINK_STORAGE_KEY, JSON.stringify({ id: "watch-current", name: "가격 목록 이름" }));
    storage.setItem(SAVED_WATCHLIST_OWNER_TOKENS_STORAGE_KEY, JSON.stringify({ "watch-current": accepted }));
    storage.setItem(BUDGET_LADDER_LOCAL_SHARES_STORAGE_KEY, JSON.stringify([{ id: "ladder-current", ownerToken: accepted, url: "https://pc.example.com/budget-ladder/ladder-current", name: "예산 구간", createdAt: "2026-09-01T00:00:00.000Z", versionNumber: 2 }]));
    storage.setItem(ALTERNATIVE_COMPARISON_LOCAL_SHARES_STORAGE_KEY, JSON.stringify([
      { id: "comparison-current", ownerToken: accepted, url: "https://pc.example.com/compare/comparison-current", name: "비교 A", createdAt: "2026-09-01T00:00:00.000Z", currentPartName: "현재 CPU" },
      { id: "comparison-current", ownerToken: accepted, url: "https://pc.example.com/compare/comparison-current", name: "비교 A 복제", createdAt: "2026-09-01T00:00:00.000Z", currentPartName: "현재 CPU" },
      { id: "comparison-current", ownerToken: stale, url: "https://pc.example.com/compare/comparison-current", name: "비교 B", createdAt: "2026-09-02T00:00:00.000Z", currentPartName: "다른 CPU" },
      { id: "comparison-stale", ownerToken: stale, url: "https://pc.example.com/compare/comparison-stale", name: "실패 비교", createdAt: "2026-09-03T00:00:00.000Z" }
    ]));
    storage.setItem(SAVED_BUILD_VERSION_LOCAL_SHARES_STORAGE_KEY, JSON.stringify([{ id: "version-current", ownerToken: accepted, url: "https://pc.example.com/version-comparison/version-current", name: "버전 비교", createdAt: "2026-09-01T00:00:00.000Z", beforeLabel: "v1", beforeName: "이전", afterLabel: "v2", afterName: "현재", afterBuildId: "build-current" }]));
    storage.setItem(GENERATOR_VARIANTS_LOCAL_SHARES_STORAGE_KEY, JSON.stringify([{ id: "variants-current", ownerToken: accepted, url: "https://pc.example.com/generator-variants/variants-current", name: "자동 구성 비교", createdAt: "2026-09-01T00:00:00.000Z" }]));

    const initialCandidates = collectStoredOwnerCredentials(storage);
    expect(initialCandidates.filter((candidate) => candidate.item.resourceType === "comparison" && candidate.item.resourceId === "comparison-current")).toHaveLength(2);
    const migrate = vi.fn(async (items: Array<{ resourceType: string; resourceId: string; ownerToken: string }>) => ({
      migratedCount: items.filter((item) => item.ownerToken === accepted).length,
      rejectedCount: items.filter((item) => item.ownerToken === stale).length,
      items: items.map((item, index) => ({ index, status: item.ownerToken === accepted ? "migrated" as const : "rejected" as const, ...(item.ownerToken === stale ? { code: "OWNER_TOKEN_MISMATCH" } : {}) }))
    }));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ resources: [
      { id: "build-current", kind: "build" },
      { id: "watch-current", kind: "watchlist" },
      { id: "ladder-current", kind: "budget-ladder" },
      { id: "comparison-current", kind: "comparison" },
      { id: "version-current", kind: "version-comparison" },
      { id: "variants-current", kind: "generator-variants" }
    ] }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await migrateStoredOwnerCredentials({ storage, sessionModeSupported: true, migrate });

    expect(result).toMatchObject({ attempted: initialCandidates.length, migrated: 6, rejected: 3 });
    expect(migrate).toHaveBeenCalledTimes(1);
    const map = jsonItem(storage, SAVED_BUILD_OWNER_TOKENS_STORAGE_KEY) as Record<string, string>;
    expect(map).toEqual({ "build-stale": stale });
    expect(jsonItem(storage, SAVED_BUILD_IDS_STORAGE_KEY)).toEqual(["build-current", "build-stale"]);
    expect(jsonItem(storage, SAVED_WATCHLIST_LINK_STORAGE_KEY)).toEqual({ id: "watch-current", name: "가격 목록 이름" });
    expect(jsonItem(storage, SAVED_WATCHLIST_OWNER_TOKENS_STORAGE_KEY)).toEqual({});

    const comparisons = jsonItem(storage, ALTERNATIVE_COMPARISON_LOCAL_SHARES_STORAGE_KEY) as Array<Record<string, unknown>>;
    expect(comparisons).toMatchObject([
      { id: "comparison-current", owned: true, name: "비교 A", currentPartName: "현재 CPU" },
      { id: "comparison-current", owned: true, name: "비교 A 복제", currentPartName: "현재 CPU" },
      { id: "comparison-current", owned: true, name: "비교 B", currentPartName: "다른 CPU" },
      { id: "comparison-stale", ownerToken: stale, name: "실패 비교" }
    ]);
    for (const key of [BUDGET_LADDER_LOCAL_SHARES_STORAGE_KEY, SAVED_BUILD_VERSION_LOCAL_SHARES_STORAGE_KEY, GENERATOR_VARIANTS_LOCAL_SHARES_STORAGE_KEY]) {
      const rows = jsonItem(storage, key) as Array<Record<string, unknown>>;
      expect(rows[0]).toHaveProperty("owned", true);
      expect(rows[0]).not.toHaveProperty("ownerToken");
    }
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: "include" });
    expect(new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).get("X-PC-Owner-Mode")).toBe("session-v1");
    expect(storage.clear).not.toHaveBeenCalled();
    expect(dispatchEvent).toHaveBeenCalled();
    expect(ownerSessionCookieIsVerified()).toBe(true);
    expect(hasOwnerSessionResource("comparison", "comparison-current")).toBe(true);
  });

  it("retains all local bearer credentials when migration reports success but the browser has no session cookie", async () => {
    const storage = new MemoryStorage();
    secureWindow(storage);
    const token = "m".repeat(43);
    storage.setItem(SAVED_BUILD_OWNER_TOKENS_STORAGE_KEY, JSON.stringify({ "build-cookie-dropped": token }));
    const migrate = vi.fn(async () => ({ migratedCount: 1, rejectedCount: 0, items: [{ index: 0, status: "migrated" as const }] }));
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, headers: { get: () => null }, json: vi.fn().mockResolvedValue({ code: "OWNER_SESSION_REQUIRED", error: "session missing" }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await migrateStoredOwnerCredentials({ storage, sessionModeSupported: true, migrate });

    expect(result.migrated).toBe(1);
    expect(jsonItem(storage, SAVED_BUILD_OWNER_TOKENS_STORAGE_KEY)).toEqual({ "build-cookie-dropped": token });
    expect(ownerSessionCookieIsVerified()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).credentials).toBe("include");
  });

  it("dedupes concurrent initialization and reconciles resources after cookie verification", async () => {
    const storage = new MemoryStorage();
    secureWindow(storage);
    const token = "i".repeat(43);
    storage.setItem(SAVED_BUILD_OWNER_TOKENS_STORAGE_KEY, JSON.stringify({ "build-idempotent": token }));
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as { items: Array<{ resourceId: string }> } : undefined;
      const payload = body
        ? { migratedCount: 1, rejectedCount: 0, items: body.items.map((_item, index) => ({ index, status: "migrated" as const })) }
        : { resources: [{ id: "build-idempotent", kind: "build" }] };
      await Promise.resolve();
      return { ok: true, status: 200, headers: { get: () => null }, json: vi.fn().mockResolvedValue(payload) };
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(ownerSessionCreateOptions()).toEqual({ ownerSessionMode: "legacy" });
    const first = initializeOwnerSession();
    const second = initializeOwnerSession();
    await expect(Promise.all([first, second])).resolves.toMatchObject([{ migrated: 1 }, { migrated: 1 }]);

    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/migrate"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/resources"))).toHaveLength(1);
    for (const [url, init] of fetchMock.mock.calls) {
      if (!String(url).includes("/migrate") && !String(url).includes("/resources")) continue;
      expect((init as RequestInit).credentials).toBe("include");
      expect(new Headers((init as RequestInit).headers).get("X-PC-Owner-Mode")).toBe("session-v1");
    }
    expect(jsonItem(storage, SAVED_BUILD_OWNER_TOKENS_STORAGE_KEY)).toEqual({});
    expect(ownerSessionCreateOptions()).toEqual({ ownerSessionMode: "session-v1" });
    expect(hasOwnerSessionResource("build", "build-idempotent")).toBe(true);
  });

  it("never calls the owner-session API or removes local tokens on unsupported HTTP origins", async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal("window", { location: { protocol: "http:", hostname: "localhost", port: "4173", origin: "http://localhost:4173" }, localStorage: storage, dispatchEvent: vi.fn() });
    const token = "l".repeat(43);
    storage.setItem(SAVED_BUILD_OWNER_TOKENS_STORAGE_KEY, JSON.stringify({ "build-legacy": token }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await migrateStoredOwnerCredentials();

    expect(result).toMatchObject({ attempted: 0, migrated: 0, rejected: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(jsonItem(storage, SAVED_BUILD_OWNER_TOKENS_STORAGE_KEY)).toEqual({ "build-legacy": token });
  });
});
