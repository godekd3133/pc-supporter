import { describe, expect, it } from "vitest";
import { budgetLadderLocalShareExpired, budgetLadderLocalShareRemember, budgetLadderLocalShareRemove, budgetLadderLocalSharesFromJson, budgetLadderLocalSharesToJson } from "./budget-ladder-local-history";

const entry = (id: string, overrides: Record<string, unknown> = {}) => ({ id, url: `http://127.0.0.1:5173/budget-ladder/${id}`, name: `예산 ${id}`, createdAt: "2026-09-01T00:00:00.000Z", versionNumber: 1, ownerToken: `token-${id}-${"x".repeat(40)}`, ...overrides });

describe("budget ladder local share history", () => {
  it("normalizes valid entries, deduplicates IDs, and drops malformed values", () => {
    const parsed = budgetLadderLocalSharesFromJson(JSON.stringify([entry("one"), entry("one", { name: "최신 one" }), { id: "bad", url: "javascript:alert(1)", name: "bad", createdAt: "not-a-date" }]));

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ id: "one", name: "예산 one", url: "http://127.0.0.1:5173/budget-ladder/one" });
    expect(budgetLadderLocalSharesFromJson("not-json")).toEqual([]);
  });

  it("keeps the newest entry first and removes one link without affecting others", () => {
    const first = entry("one");
    const second = entry("two");
    const remembered = budgetLadderLocalShareRemember([first], second);

    expect(remembered.map((item) => item.id)).toEqual(["two", "one"]);
    expect(budgetLadderLocalShareRemove(remembered, "one").map((item) => item.id)).toEqual(["two"]);
    expect(JSON.parse(budgetLadderLocalSharesToJson(remembered))).toHaveLength(2);
    expect(JSON.parse(budgetLadderLocalSharesToJson([first, entry("one", { name: "중복 one" })]))[0].name).toBe("예산 one");
  });

  it("classifies expiring links at the exact boundary", () => {
    const expiresAt = "2026-09-02T00:00:00.000Z";

    expect(budgetLadderLocalShareExpired({ expiresAt }, Date.parse("2026-09-01T23:59:59.000Z"))).toBe(false);
    expect(budgetLadderLocalShareExpired({ expiresAt }, Date.parse(expiresAt))).toBe(true);
    expect(budgetLadderLocalShareExpired({}, Date.parse(expiresAt))).toBe(false);
  });
});
