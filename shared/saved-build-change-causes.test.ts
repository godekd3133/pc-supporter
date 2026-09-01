import { describe, expect, it } from "vitest";
import type { BuildSelection, CatalogChangeRecord } from "./types";
import { savedBuildCatalogChangeCausesFor, savedBuildCatalogChangeValueDiffsFor } from "./saved-build-change-causes";

const build: BuildSelection = {
  cpu: { partId: "cpu-1", quantity: 1 },
  memory: [{ partId: "memory-1", quantity: 2 }],
  ssd: [],
  hdd: [],
  accessories: [{ accessoryId: "fan-1", quantity: 1 }],
  useIntegratedGraphics: true
};

function record(overrides: Partial<CatalogChangeRecord> = {}): CatalogChangeRecord {
  return {
    id: "change-1",
    kind: "part",
    itemId: "cpu-1",
    itemName: "테스트 CPU",
    category: "cpu",
    changedAt: "2026-08-31T01:00:00.000Z",
    changedFields: ["가격"],
    previousDataQuality: "live",
    nextDataQuality: "live",
    previousMissingFields: [],
    nextMissingFields: [],
    previousPriceWon: 100000,
    nextPriceWon: 110000,
    priceDeltaWon: 10000,
    ...overrides
  };
}

describe("saved build catalog change causes", () => {
  it("matches only selected parts and changes after the baseline and through the comparison time", () => {
    const records = [
      record({ id: "baseline", changedAt: "2026-08-31T00:00:00.000Z" }),
      record({ id: "cpu-change", changedAt: "2026-08-31T01:00:00.000Z" }),
      record({ id: "memory-change", itemId: "memory-1", itemName: "테스트 RAM", category: "memory", changedAt: "2026-08-31T02:00:00.000Z" }),
      record({ id: "accessory-change", kind: "accessory", itemId: "fan-1", itemName: "테스트 팬", category: "cooling_fan", changedAt: "2026-08-31T03:00:00.000Z" }),
      record({ id: "unselected-change", itemId: "gpu-1", itemName: "미선택 GPU", category: "gpu", changedAt: "2026-08-31T02:00:00.000Z" }),
      record({ id: "after-window", changedAt: "2026-08-31T04:00:00.000Z" })
    ];

    expect(savedBuildCatalogChangeCausesFor(build, records, "2026-08-31T00:00:00.000Z", "2026-08-31T03:00:00.000Z").map((item) => item.id)).toEqual(["cpu-change", "memory-change", "accessory-change"]);
  });

  it("normalizes a reversed time range and caps the public result", () => {
    const records = Array.from({ length: 8 }, (_, index) => record({ id: `change-${index}`, changedAt: `2026-08-31T00:0${index}:00.000Z` }));
    expect(savedBuildCatalogChangeCausesFor(build, records, "2026-08-31T01:00:00.000Z", "2026-08-31T00:00:00.000Z", 3)).toHaveLength(3);
    expect(savedBuildCatalogChangeCausesFor(build, records, "not-a-date", "2026-08-31T00:00:00.000Z")).toEqual([]);
  });

  it("uses persisted before/after values and provides a bounded fallback for legacy records", () => {
    const persisted = record({ valueDiffs: [{ field: "정규화 스펙", previous: "DDR5-5600", next: "DDR5-6000" }] });
    expect(savedBuildCatalogChangeValueDiffsFor(persisted)).toEqual([{ field: "정규화 스펙", previous: "DDR5-5600", next: "DDR5-6000" }]);
    const legacy = record({ changedFields: ["가격", "데이터 품질", "누락 필드"], previousDataQuality: "incomplete", nextDataQuality: "live", previousMissingFields: ["socket"], nextMissingFields: [], previousPriceWon: undefined, nextPriceWon: 110000, priceDeltaWon: undefined });
    expect(savedBuildCatalogChangeValueDiffsFor(legacy)).toEqual([
      { field: "가격", previous: "확인 정보 없음", next: "110,000원" },
      { field: "데이터 품질", previous: "incomplete", next: "live" },
      { field: "누락 필드", previous: "socket", next: "없음" }
    ]);
  });
});
