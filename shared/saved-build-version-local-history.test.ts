import { describe, expect, it } from "vitest";
import { savedBuildVersionLocalShareExpired, savedBuildVersionLocalShareRemember, savedBuildVersionLocalShareRemove, savedBuildVersionLocalSharesFromJson, savedBuildVersionLocalSharesToJson } from "./saved-build-version-local-history";

function entry(id: string, overrides: Partial<ReturnType<typeof baseEntry>> = {}) {
  return { ...baseEntry(id), ...overrides };
}

function baseEntry(id: string) {
  return { id, url: `https://example.com/version-comparison/${id}`, name: `버전 비교 ${id}`, createdAt: "2026-09-01T00:00:00.000Z", beforeLabel: "v1", beforeName: "원본", beforeBuildId: `${id}-before`, afterLabel: "v2", afterName: "수정", afterBuildId: `${id}-after` };
}

describe("saved build version local history", () => {
  it("normalizes, deduplicates, remembers, removes, and serializes safe entries", () => {
    const parsed = savedBuildVersionLocalSharesFromJson(JSON.stringify([entry("one"), entry("one", { name: "최신 one" }), { id: "bad", url: "javascript:alert(1)", name: "bad" }]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("버전 비교 one");
    expect(parsed[0].afterBuildId).toBe("one-after");
    const remembered = savedBuildVersionLocalShareRemember(parsed, entry("two"));
    expect(remembered.map((item) => item.id)).toEqual(["two", "one"]);
    expect(savedBuildVersionLocalShareRemove(remembered, "one").map((item) => item.id)).toEqual(["two"]);
    expect(JSON.parse(savedBuildVersionLocalSharesToJson(remembered))).toHaveLength(2);
  });

  it("detects expiry without treating an absent expiry as expired", () => {
    const expiresAt = "2026-09-02T00:00:00.000Z";
    expect(savedBuildVersionLocalShareExpired({ expiresAt }, Date.parse("2026-09-01T23:59:59.000Z"))).toBe(false);
    expect(savedBuildVersionLocalShareExpired({ expiresAt }, Date.parse(expiresAt))).toBe(true);
    expect(savedBuildVersionLocalShareExpired({})).toBe(false);
  });

  it("rejects an oversized raw local history before normalizing every entry", () => {
    const oversized = Array.from({ length: 21 }, (_, index) => entry(`share-${index}`));
    expect(savedBuildVersionLocalSharesFromJson(JSON.stringify(oversized))).toEqual([]);
  });
});
