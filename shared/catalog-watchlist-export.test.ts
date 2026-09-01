import { describe, expect, it } from "vitest";
import type { CatalogWatchSnapshot } from "./catalog-watchlist-export";
import { catalogWatchlistCsvFor, catalogWatchlistJsonFor } from "./catalog-watchlist-export";

const snapshot = (overrides: Partial<CatalogWatchSnapshot> = {}): CatalogWatchSnapshot => ({
  entry: { itemId: "part-1", itemName: "테스트, CPU", category: "cpu", kind: "part", addedAt: "2026-08-28T00:00:00.000Z" },
  currentDataStatus: "available",
  targetPriceWon: 85000,
  sampleCount: 3,
  latestPriceWon: 90000,
  minPriceWon: 80000,
  maxPriceWon: 100000,
  fromHighDeltaWon: -10000,
  fromHighPercent: -10,
  currentPositionPercent: 50,
  signals: ["최저가 근접", "최고가 대비 하락"],
  ...overrides
});

describe("catalog watchlist export", () => {
  it("exports comma-containing names and all current price signal fields as safe CSV", () => {
    const csv = catalogWatchlistCsvFor([snapshot()]);

    expect(csv.startsWith("\uFEFF구분,분류,부품명")).toBe(true);
    expect(csv).toContain('"테스트, CPU"');
    expect(csv).toContain("85000,3,90000,80000,100000,-10000,-10,50");
    expect(csv).toContain("최저가 근접 | 최고가 대비 하락");
    expect(catalogWatchlistCsvFor([snapshot({ currentDataStatus: "price_unavailable", latestPriceWon: undefined })])).toContain("현재 조회 범위에 가격 미확인");
  });

  it("preserves missing current data and the selected threshold in versioned JSON", () => {
    const payload = JSON.parse(catalogWatchlistJsonFor([snapshot({ currentDataStatus: "price_unavailable", latestPriceWon: undefined, signals: [] })], { nearLowThresholdPercent: 20 })) as { type: string; version: number; filters: { nearLowThresholdPercent: number }; items: CatalogWatchSnapshot[] };

    expect(payload).toMatchObject({ type: "pc-supporter-catalog-watchlist", version: 1, filters: { nearLowThresholdPercent: 20 } });
    expect(payload.items[0]).toMatchObject({ currentDataStatus: "price_unavailable", targetPriceWon: 85000, signals: [] });
    expect(Object.hasOwn(payload.items[0], "latestPriceWon")).toBe(false);
  });
});
