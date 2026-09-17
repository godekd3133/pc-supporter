import { describe, expect, it } from "vitest";
import { GENERATOR_VARIANTS_LOCAL_HISTORY_LIMIT, generatorVariantsLocalHistoryFromJson, generatorVariantsLocalHistoryRemember, generatorVariantsLocalHistoryRemove, generatorVariantsLocalHistoryToJson, type GeneratorVariantsLocalHistoryEntry } from "./generator-variants-local-history";

function entry(id: string): GeneratorVariantsLocalHistoryEntry {
  return { id, name: `비교 ${id}`, createdAt: "2026-09-17T00:00:00.000Z", payload: JSON.stringify({ type: "pc-supporter-generator-variants", version: 1, exportedAt: "2026-09-17T00:00:00.000Z", items: [{ priority: "balanced", label: `균형형 ${id}`, status: "호환 가능" }] }) };
}

describe("generator variants local history", () => {
  it("normalizes valid entries and removes malformed or duplicate rows", () => {
    const parsed = generatorVariantsLocalHistoryFromJson(JSON.stringify([entry("a"), entry("a"), { id: "bad", name: "bad", createdAt: "not-a-date", payload: "{}" }]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("a");
    expect(JSON.parse(generatorVariantsLocalHistoryToJson(parsed))).toHaveLength(1);
  });

  it("keeps the newest entry first and caps history length", () => {
    const rows = Array.from({ length: GENERATOR_VARIANTS_LOCAL_HISTORY_LIMIT + 2 }, (_, index) => entry(String(index)));
    const remembered = rows.reduce((current, item) => generatorVariantsLocalHistoryRemember(current, item), [] as GeneratorVariantsLocalHistoryEntry[]);
    expect(remembered).toHaveLength(GENERATOR_VARIANTS_LOCAL_HISTORY_LIMIT);
    expect(remembered[0].id).toBe(String(rows.length - 1));
    expect(generatorVariantsLocalHistoryRemove(remembered, remembered[0].id)).toHaveLength(GENERATOR_VARIANTS_LOCAL_HISTORY_LIMIT - 1);
  });

  it("dedupes entries that hold the same comparison payload", () => {
    const first = entry("a");
    const resave = { ...entry("b"), payload: JSON.stringify({ ...JSON.parse(first.payload), exportedAt: "2026-09-18T00:00:00.000Z" }) };
    const remembered = generatorVariantsLocalHistoryRemember([first], resave);
    expect(remembered).toHaveLength(1);
    expect(remembered[0].id).toBe("b");
    expect(generatorVariantsLocalHistoryRemember([first], entry("c"))).toHaveLength(2);
  });

  it("rejects malformed envelopes before storing them", () => {
    expect(generatorVariantsLocalHistoryFromJson(JSON.stringify([{ ...entry("wrong-type"), payload: JSON.stringify({ type: "wrong", version: 1, items: [] }) }]))) .toEqual([]);
    expect(generatorVariantsLocalHistoryFromJson(JSON.stringify([{ ...entry("too-many"), payload: JSON.stringify({ type: "pc-supporter-generator-variants", version: 1, items: [1, 2, 3, 4] }) }]))) .toEqual([]);
    expect(generatorVariantsLocalHistoryFromJson(JSON.stringify([{ ...entry("invalid-json"), payload: "not-json" }]))) .toEqual([]);
  });
});
