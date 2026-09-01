import { describe, expect, it } from "vitest";
import type { CatalogChangeRecord } from "./types";
import { catalogChangeCsvFor, catalogChangeJsonFor } from "./catalog-change-export";

const record = (overrides: Partial<CatalogChangeRecord> = {}): CatalogChangeRecord => ({
  id: "change-1",
  kind: "part",
  itemId: "part-1",
  itemName: "부품, 이름",
  category: "cpu",
  sourceProductCode: "123",
  changedAt: "2026-08-28T00:00:00.000Z",
  changedFields: ["원문 스펙", "누락 필드"],
  previousDataQuality: "incomplete",
  nextDataQuality: "live",
  previousMissingFields: ["socket", "tdp"],
  nextMissingFields: ["tdp"],
  previousPriceWon: 100000,
  nextPriceWon: 110000,
  priceDeltaWon: 10000,
  ...overrides
});

describe("catalog change export", () => {
  it("serializes comma-containing records as spreadsheet-safe CSV with all change dimensions", () => {
    const csv = catalogChangeCsvFor([record()]);

    expect(csv.startsWith("\uFEFF변경 시각,구분")).toBe(true);
    expect(csv).toContain('"부품, 이름"');
    expect(csv).toContain("100000,110000,10000");
    expect(csv).toContain("원문 스펙 | 누락 필드");
  });

  it("exports a versioned JSON envelope with filters and source records intact", () => {
    const payload = JSON.parse(catalogChangeJsonFor([record()], { kind: "accessory", change: "spec", from: "2026-08-28", limit: 24 })) as { type: string; version: number; filters: { kind: string; change: string; from: string; limit: number }; items: CatalogChangeRecord[] };

    expect(payload.type).toBe("pc-supporter-catalog-change-log");
    expect(payload.version).toBe(1);
    expect(payload.filters).toMatchObject({ kind: "accessory", change: "spec", from: "2026-08-28", limit: 24 });
    expect(payload.items[0]).toMatchObject({ itemName: "부품, 이름", priceDeltaWon: 10000 });
  });
});
