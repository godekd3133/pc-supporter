import { describe, expect, it } from "vitest";
import type { CatalogWatchEntry } from "./catalog-watchlist";
import { catalogWatchlistCsvFor, catalogWatchlistJsonFor } from "./catalog-watchlist-export";
import type { CatalogWatchSnapshot } from "./catalog-watchlist-export";
import { catalogWatchlistEntriesFromCsv, catalogWatchlistEntriesFromJson } from "./catalog-watchlist-import";

const entry = (overrides: Partial<CatalogWatchEntry> = {}): CatalogWatchEntry => ({ itemId: "part-1", itemName: "테스트, CPU", category: "cpu", kind: "part", addedAt: "2026-08-28T00:00:00.000Z", targetPriceWon: 85000, ...overrides });
const snapshot = (overrides: Partial<CatalogWatchSnapshot> = {}): CatalogWatchSnapshot => ({ entry: entry(), currentDataStatus: "available", targetPriceWon: 85000, sampleCount: 2, latestPriceWon: 80000, minPriceWon: 80000, maxPriceWon: 90000, fromHighDeltaWon: -10000, fromHighPercent: -11.1, currentPositionPercent: 0, signals: ["목표가 도달"], ...overrides });

describe("catalog watchlist import", () => {
  it("restores JSON export entries, targets, and the saved near-low threshold", () => {
    const result = catalogWatchlistEntriesFromJson(catalogWatchlistJsonFor([snapshot()], { nearLowThresholdPercent: 20 }));

    expect(result.errors).toEqual([]);
    expect(result.entries).toEqual([entry()]);
    expect(result.nearLowThresholdPercent).toBe(20);
  });

  it("restores quoted CSV names and target prices while deduplicating rows", () => {
    const csv = catalogWatchlistCsvFor([snapshot(), snapshot({ entry: entry({ itemName: "다른 라벨" }) })]);
    const result = catalogWatchlistEntriesFromCsv(csv);

    expect(result.errors).toEqual([]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ itemName: "테스트, CPU", targetPriceWon: 85000 });
  });

  it("rejects invalid JSON/CSV atomically instead of returning partial entries", () => {
    const invalidJson = catalogWatchlistEntriesFromJson(JSON.stringify({ type: "pc-supporter-catalog-watchlist", version: 1, items: [{ entry: entry() }, { entry: entry({ targetPriceWon: 0 }) }] }));
    const invalidCsv = catalogWatchlistEntriesFromCsv(["구분,분류,부품명,부품 ID,추가 시각,목표가(원)", "핵심 부품,cpu,오류 CPU,id,2026-08-28,0"].join("\n"));
    const missingHeaders = catalogWatchlistEntriesFromCsv(["부품명,부품 ID", "CPU,id"].join("\n"));

    expect(invalidJson.entries).toEqual([]);
    expect(invalidJson.errors).toHaveLength(1);
    expect(invalidCsv.entries).toEqual([]);
    expect(invalidCsv.errors).toEqual(["2행: 목표가는 0보다 큰 숫자여야 합니다."]);
    expect(missingHeaders.entries).toEqual([]);
    expect(missingHeaders.errors[0]).toContain("필수 CSV 열이 없습니다");
  });
});
