import { describe, expect, it } from "vitest";
import type { CatalogSeedMappingReview } from "./catalog-seed-mapping";
import { catalogSeedCollectionQueueFor } from "./catalog-seed-collection-queue";
import type { Part } from "./types";

function part(overrides: Partial<Part>): Part {
  return {
    id: "starter-cpu",
    category: "cpu",
    name: "AMD Ryzen 5 9600X",
    brand: "AMD",
    model: "9600X",
    source: "seed",
    specs: { socket: "AM5", memoryType: "DDR5" },
    dataQuality: "seed",
    missingFields: [],
    updatedAt: "2026-09-03T00:00:00.000Z",
    ...overrides
  };
}

describe("catalog seed collection queue", () => {
  it("separates collection, search, and stale-mapping work while excluding actionable candidates", () => {
    const starter = [
      part({ id: "starter-cpu", category: "cpu", name: "AMD Ryzen 5 9600X", model: "9600X" }),
      part({ id: "starter-gpu", category: "gpu", name: "NVIDIA GeForce RTX 5090", model: "RTX 5090", brand: "NVIDIA", specs: { gpuVendor: "nvidia", vramGb: 32 } }),
      part({ id: "starter-case", category: "case", name: "ITX Airflow Case", model: "ITX-AIR" }),
      part({ id: "starter-ssd", category: "ssd", name: "P41 1TB", model: "P41 1TB", specs: { interface: "NVMe", formFactor: "M.2 2280" } })
    ];
    const active = [
      part({ id: "live-unrelated-cpu", category: "cpu", name: "Intel Core i5-12400F", model: "i5-12400F", brand: "Intel", source: "danawa", sourceProductCode: "cpu-12400f", dataQuality: "live" }),
      part({ id: "live-ssd", category: "ssd", name: "SK hynix P41 1TB", model: "P41 1TB", brand: "SK hynix", source: "danawa", sourceProductCode: "ssd-p41-1tb", dataQuality: "live", specs: { interface: "NVMe", formFactor: "M.2 2280" } })
    ];
    const staleReview: CatalogSeedMappingReview = {
      starterPartId: "starter-case",
      category: "case",
      activePartId: "removed-case",
      activeSourceProductCode: "removed-code",
      status: "approved",
      reviewedAt: "2026-09-02T00:00:00.000Z"
    };

    const queue = catalogSeedCollectionQueueFor(starter, active, {
      generatedAt: "2026-09-03T00:00:00.000Z",
      reviews: { "starter-case": staleReview }
    });

    expect(queue).toMatchObject({
      schemaVersion: 1,
      kind: "catalog-seed-collection-queue",
      readOnly: true,
      activeCatalogCount: 2,
      mappingMissingCount: 4,
      summary: {
        queueCount: 3,
        highPriorityCount: 2,
        mediumPriorityCount: 0,
        lowPriorityCount: 1,
        collectCategoryCount: 1,
        searchAndCollectCount: 1,
        recheckMappingCount: 1
      }
    });
    expect(queue.items.map((item) => [item.starter.id, item.action])).toEqual([
      ["starter-gpu", "collect_category"],
      ["starter-cpu", "search_and_collect"],
      ["starter-case", "recheck_mapping"]
    ]);
    expect(queue.items[0]).toMatchObject({ categoryActiveCount: 0, categoryLiveCount: 0, priority: "high", suggestedQueries: ["RTX 5090", "NVIDIA GeForce RTX 5090"] });
    expect(queue.items[1]).toMatchObject({ categoryActiveCount: 1, categoryLiveCount: 1, priority: "high", searchUrl: "https://search.danawa.com/dsearch.php?query=9600X" });
    expect(queue.categoryRows).toEqual([
      { category: "cpu", categoryActiveCount: 1, categoryLiveCount: 1, queueCount: 1, collectCategoryCount: 0, searchAndCollectCount: 1, recheckMappingCount: 0 },
      { category: "gpu", categoryActiveCount: 0, categoryLiveCount: 0, queueCount: 1, collectCategoryCount: 1, searchAndCollectCount: 0, recheckMappingCount: 0 },
      { category: "case", categoryActiveCount: 0, categoryLiveCount: 0, queueCount: 1, collectCategoryCount: 0, searchAndCollectCount: 0, recheckMappingCount: 1 }
    ]);
  });

  it("produces a stable fingerprint for the same queue and changes it when catalog state changes", () => {
    const starter = [part({ id: "starter-cpu" })];
    const options = { generatedAt: "2026-09-03T00:00:00.000Z" };
    const first = catalogSeedCollectionQueueFor(starter, [], options);
    const second = catalogSeedCollectionQueueFor(starter, [], { generatedAt: "2026-09-03T00:01:00.000Z" });
    const changed = catalogSeedCollectionQueueFor(starter, [part({ id: "live-cpu", source: "danawa", sourceProductCode: "cpu-live", dataQuality: "live", name: "Intel Core i5-12400F", model: "i5-12400F", brand: "Intel" })], options);
    expect(first.queueFingerprint).toBe(second.queueFingerprint);
    expect(changed.queueFingerprint).not.toBe(first.queueFingerprint);
    expect(first.items[0].action).toBe("collect_category");
    expect(changed.items[0].action).toBe("search_and_collect");
  });
});
