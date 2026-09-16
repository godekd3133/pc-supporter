import { describe, expect, it } from "vitest";
import type { AlternativeComparisonScenarioCheck } from "./alternative-comparison-scenario";
import { alternativeComparisonChecklistCheckedIdsFromJson, alternativeComparisonChecklistCheckedIdsToJson, alternativeComparisonChecklistEntriesFor, alternativeComparisonChecklistJsonFor, alternativeComparisonChecklistKey, alternativeComparisonChecklistProgressFor, alternativeComparisonChecklistToggle, alternativeComparisonChecklistTransferDiffFor, alternativeComparisonChecklistTransferMatchesCurrentFor, parseAlternativeComparisonChecklistJson } from "./alternative-comparison-checklist";

const check = (id: string, status: AlternativeComparisonScenarioCheck["status"] = "ready"): AlternativeComparisonScenarioCheck => ({ id, kind: "compatibility", status, label: id, detail: `${id} 확인` });

describe("alternative comparison checklist", () => {
  it("creates stable candidate-scoped keys and entries", () => {
    expect(alternativeComparisonChecklistKey(1, "price")).toBe("1:price");
    const entries = alternativeComparisonChecklistEntriesFor([{ name: "부품 A", checks: [check("price")] }, { name: "부품 B", checks: [check("price"), check("physical", "review")] }]);
    expect(entries.map((entry) => entry.key)).toEqual(["0:price", "1:price", "1:physical"]);
    expect(entries[2]).toMatchObject({ candidateIndex: 1, candidateName: "부품 B", status: "review" });
  });

  it("normalizes stored checked IDs and keeps JSON round-trips bounded", () => {
    const parsed = alternativeComparisonChecklistCheckedIdsFromJson(JSON.stringify(["0:price", "0:price", "", 3, "1:physical", "x".repeat(241)]));
    expect(parsed).toEqual(["0:price", "1:physical"]);
    expect(JSON.parse(alternativeComparisonChecklistCheckedIdsToJson(parsed))).toEqual(parsed);
    expect(alternativeComparisonChecklistCheckedIdsFromJson("bad-json")).toEqual([]);
    expect(alternativeComparisonChecklistCheckedIdsFromJson(JSON.stringify(Array.from({ length: 201 }, (_, index) => `0:check-${index}`)))).toEqual([]);
  });

  it("counts review and blocked checks without allowing blocked checks to complete", () => {
    const entries = alternativeComparisonChecklistEntriesFor([{ name: "부품 A", checks: [check("compatibility"), check("price", "review"), check("physical", "blocked")] }]);
    const blockedAttempt = alternativeComparisonChecklistToggle([], entries[2], true);
    const checked = alternativeComparisonChecklistToggle(blockedAttempt, entries[0], true);
    const progress = alternativeComparisonChecklistProgressFor(entries, new Set(checked));
    expect(blockedAttempt).toEqual([]);
    expect(progress).toMatchObject({ total: 3, checked: 1, remaining: 2, blocked: 1, review: 1, ready: 1, percent: 33 });
  });

  it("unchecks only the selected candidate check", () => {
    const entries = alternativeComparisonChecklistEntriesFor([{ name: "부품 A", checks: [check("price"), check("data")] }]);
    const checked = alternativeComparisonChecklistToggle([entries[0].key, entries[1].key], entries[0], false);
    expect(checked).toEqual([entries[1].key]);
  });

  it("exports and imports progress only for the same comparison and exposes a transfer diff", () => {
    const entries = alternativeComparisonChecklistEntriesFor([{ name: "부품 A", checks: [check("price"), check("data", "review")] }]);
    const json = alternativeComparisonChecklistJsonFor("comparison-1", entries, new Set([entries[0].key]), "2026-09-02T00:00:00.000Z");
    const parsed = parseAlternativeComparisonChecklistJson(json, "comparison-1", entries);
    expect(parsed.errors).toEqual([]);
    expect(parsed.checkedIds).toEqual([entries[0].key]);
    expect(parsed.itemKeys).toEqual(entries.map((entry) => entry.key));
    expect(parseAlternativeComparisonChecklistJson(json, "comparison-2", entries).errors[0]).toContain("다른 체크리스트");
    expect(alternativeComparisonChecklistTransferMatchesCurrentFor(entries.map((entry) => entry.key), parsed.itemKeys)).toBe(true);
    expect(alternativeComparisonChecklistTransferDiffFor([entries[1].key], parsed.checkedIds)).toMatchObject({ currentCheckedCount: 1, incomingCheckedCount: 1, addedCount: 1, removedCount: 1, unchangedCount: 0 });

    const blockedEntries = alternativeComparisonChecklistEntriesFor([{ name: "부품 B", checks: [check("physical", "blocked")] }]);
    const blockedEnvelope = JSON.parse(alternativeComparisonChecklistJsonFor("comparison-1", blockedEntries, new Set([blockedEntries[0].key]), "2026-09-02T00:00:00.000Z")) as { checkedIds: string[] };
    blockedEnvelope.checkedIds = [blockedEntries[0].key];
    const blockedParsed = parseAlternativeComparisonChecklistJson(JSON.stringify(blockedEnvelope), "comparison-1", blockedEntries);
    expect(blockedParsed.checkedIds).toEqual([]);
    expect(blockedParsed.ignoredIds).toEqual([blockedEntries[0].key]);
  });

  it("rejects oversized checklist transfer arrays before filtering current entries", () => {
    const itemKeys = Array.from({ length: 201 }, (_, index) => `0:check-${index}`);
    const parsed = parseAlternativeComparisonChecklistJson(JSON.stringify({
      type: "pc-supporter-alternative-comparison-checklist",
      schemaVersion: 1,
      comparisonId: "comparison-1",
      exportedAt: "2026-09-02T00:00:00.000Z",
      itemKeys,
      checkedIds: itemKeys
    }), "comparison-1", []);

    expect(parsed.itemKeys).toEqual([]);
    expect(parsed.checkedIds).toEqual([]);
    expect(parsed.errors).toEqual(["부품 비교 체크리스트 JSON은 최대 200개 항목만 가져올 수 있습니다."]);
  });
});
