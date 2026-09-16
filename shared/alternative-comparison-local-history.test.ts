import { describe, expect, it } from "vitest";
import { alternativeComparisonLocalShareExpired, alternativeComparisonLocalShareRemember, alternativeComparisonLocalShareRemove, alternativeComparisonLocalSharesFromJson, alternativeComparisonLocalSharesToJson } from "./alternative-comparison-local-history";

const entry = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  url: `http://127.0.0.1:5173/compare/${id}`,
  name: `부품 비교 ${id}`,
  createdAt: "2026-09-01T00:00:00.000Z",
  category: "CPU",
  currentPartName: "현재 CPU",
  currentPartSummary: "AM5 · 8코어",
  currentPartPrice: "420,000원",
  expiresAt: "2026-10-01T00:00:00.000Z",
  ownerToken: `token-${id}-${"x".repeat(40)}`,
  ...overrides
});

describe("alternative comparison local share history", () => {
  it("normalizes valid entries, keeps metadata, deduplicates IDs, and drops malformed values", () => {
    const parsed = alternativeComparisonLocalSharesFromJson(JSON.stringify([
      entry("one"),
      entry("one", { name: "최신 one" }),
      { id: "bad", url: "javascript:alert(1)", name: "bad", createdAt: "not-a-date" }
    ]));

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      id: "one",
      name: "부품 비교 one",
      category: "CPU",
      currentPartName: "현재 CPU",
      currentPartSummary: "AM5 · 8코어",
      currentPartPrice: "420,000원",
      url: "http://127.0.0.1:5173/compare/one"
    });
    expect(alternativeComparisonLocalSharesFromJson("not-json")).toEqual([]);
  });

  it("keeps the newest entry first and removes one link without affecting others", () => {
    const first = entry("one");
    const second = entry("two");
    const remembered = alternativeComparisonLocalShareRemember([first], second);

    expect(remembered.map((item) => item.id)).toEqual(["two", "one"]);
    expect(alternativeComparisonLocalShareRemove(remembered, "one").map((item) => item.id)).toEqual(["two"]);
    expect(JSON.parse(alternativeComparisonLocalSharesToJson(remembered))).toHaveLength(2);
    expect(JSON.parse(alternativeComparisonLocalSharesToJson([first, entry("one", { name: "중복 one" })]))[0].name).toBe("부품 비교 one");
  });

  it("classifies expiring links at the exact boundary", () => {
    const expiresAt = "2026-09-02T00:00:00.000Z";

    expect(alternativeComparisonLocalShareExpired({ expiresAt }, Date.parse("2026-09-01T23:59:59.000Z"))).toBe(false);
    expect(alternativeComparisonLocalShareExpired({ expiresAt }, Date.parse(expiresAt))).toBe(true);
    expect(alternativeComparisonLocalShareExpired({}, Date.parse(expiresAt))).toBe(false);
  });

  it("rejects empty optional metadata when the field is present and accepts legacy entries without it", () => {
    expect(alternativeComparisonLocalSharesFromJson(JSON.stringify([entry("empty-category", { category: "" })]))).toEqual([]);
    expect(alternativeComparisonLocalSharesFromJson(JSON.stringify([entry("legacy", { category: undefined, currentPartName: undefined, currentPartSummary: undefined, currentPartPrice: undefined, expiresAt: undefined, ownerToken: undefined })]))[0]).toMatchObject({ id: "legacy", name: "부품 비교 legacy" });
  });

  it("rejects an oversized raw local history before normalizing every entry", () => {
    const oversized = Array.from({ length: 21 }, (_, index) => entry(`share-${index}`));
    expect(alternativeComparisonLocalSharesFromJson(JSON.stringify(oversized))).toEqual([]);
  });
});
