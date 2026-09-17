import { describe, expect, it } from "vitest";
import { generatorVariantsLocalShareExpired, generatorVariantsLocalShareRemember, generatorVariantsLocalShareRemove, generatorVariantsLocalSharesFromJson, generatorVariantsLocalSharesToJson, type GeneratorVariantsLocalShareEntry } from "./generator-variants-local-share";

function entry(id: string, extra: Partial<GeneratorVariantsLocalShareEntry> = {}): GeneratorVariantsLocalShareEntry {
  return { id, url: `https://example.com/generator-variants/${id}`, name: `공유 ${id}`, createdAt: "2026-09-17T00:00:00.000Z", ownerToken: `token-${id}`, ...extra };
}

describe("generator variants local shares", () => {
  it("normalizes valid entries and drops malformed or duplicate rows", () => {
    const parsed = generatorVariantsLocalSharesFromJson(JSON.stringify([entry("a"), entry("a"), { id: "bad", url: "javascript:alert(1)", name: "bad", createdAt: "2026-09-17T00:00:00.000Z" }, { id: "bad-date", url: "https://example.com/generator-variants/x", name: "bad", createdAt: "not-a-date" }]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("a");
    expect(JSON.parse(generatorVariantsLocalSharesToJson(parsed))).toHaveLength(1);
  });

  it("keeps the newest share first and caps the list", () => {
    const rows = Array.from({ length: 22 }, (_, index) => entry(String(index)));
    const remembered = rows.reduce((current, item) => generatorVariantsLocalShareRemember(current, item), [] as GeneratorVariantsLocalShareEntry[]);
    expect(remembered).toHaveLength(20);
    expect(remembered[0].id).toBe(String(rows.length - 1));
    expect(generatorVariantsLocalShareRemove(remembered, remembered[0].id)).toHaveLength(19);
  });

  it("keeps owner tokens only when they are non-empty strings", () => {
    expect(generatorVariantsLocalSharesFromJson(JSON.stringify([{ ...entry("no-token"), ownerToken: "" }]))).toEqual([]);
    expect(generatorVariantsLocalSharesFromJson(JSON.stringify([entry("ok")]))[0].ownerToken).toBe("token-ok");
  });

  it("detects expired links", () => {
    expect(generatorVariantsLocalShareExpired(entry("live", { expiresAt: "2026-09-18T00:00:00.000Z" }), Date.parse("2026-09-17T00:00:00.000Z"))).toBe(false);
    expect(generatorVariantsLocalShareExpired(entry("dead", { expiresAt: "2026-09-18T00:00:00.000Z" }), Date.parse("2026-09-18T00:00:00.000Z"))).toBe(true);
    expect(generatorVariantsLocalShareExpired(entry("never"))).toBe(false);
  });
});
