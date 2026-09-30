import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessoryItem, Part } from "../shared/types";

const fake = vi.hoisted(() => ({
  databaseCatalog: [] as unknown[],
  accessories: [] as unknown[],
  catalogReads: 0,
  accessoryReads: 0,
  accessoryMetaSnapshots: [] as unknown[][],
  accessoryCoverageSnapshots: [] as unknown[][],
  fileUpdatedAt: "2026-09-29T00:00:00.000Z",
  accessoryUpdatedAt: "2026-09-28T00:00:00.000Z"
}));

vi.mock("./repository", () => ({
  readAccessoryCoverageRecord: async () => ({ updatedAt: fake.accessoryUpdatedAt, categories: [] }),
  readBenchmarkOverrideRecords: async () => ({}),
  readCatalogOverrideMapUpdatedAtRecords: async () => ({ catalogSpecUpdatedAt: "", m2SlotUpdatedAt: "" }),
  readCatalogRecords: async () => {
    fake.catalogReads += 1;
    return fake.databaseCatalog;
  },
  patchCatalogPriceRecords: async () => undefined,
  writeCatalogRecords: async () => undefined
}));

vi.mock("./storage", () => ({
  CASE_RGB_LOAD_OVERRIDES_PATH: "/fixture/case-rgb-load-overrides.json",
  GPU_PHYSICAL_OVERRIDES_PATH: "/fixture/gpu-physical-overrides.json",
  fileUpdatedAt: async () => fake.fileUpdatedAt,
  readJson: async (_path: string, fallback: unknown) => fallback,
  writeJson: async () => undefined,
  withSerializedFileMutation: async (_path: string, operation: () => Promise<unknown>) => operation()
}));

vi.mock("./accessories", () => {
  const loadAccessories = async () => {
    fake.accessoryReads += 1;
    return fake.accessories;
  };
  const accessoryMeta = async (snapshotItems?: unknown[], snapshotUpdatedAt?: string) => {
    const items = snapshotItems ?? await loadAccessories();
    fake.accessoryMetaSnapshots.push(items);
    const rows = items as Array<{ category: string; dataQuality?: string; priceWon?: number }>;
    const priced = rows.filter((item) => typeof item.priceWon === "number" && item.priceWon > 0).length;
    return {
      accessoryCount: rows.length,
      accessoryCategoryCounts: { cooling_fan: rows.filter((item) => item.category === "cooling_fan").length },
      accessoryBrandCounts: {},
      accessoryCategoryQualityCounts: {},
      accessoryQualityCounts: {},
      accessoryPriceCoverage: { priced, unpriced: rows.length - priced },
      accessoryUpdatedAt: snapshotUpdatedAt ?? fake.accessoryUpdatedAt
    };
  };
  const readAccessoryCoverage = async (snapshotItems?: unknown[]) => {
    const items = snapshotItems ?? await loadAccessories();
    fake.accessoryCoverageSnapshots.push(items);
    return {
      updatedAt: fake.accessoryUpdatedAt,
      categories: [{ category: "cooling_fan", storedProductCount: items.length }]
    };
  };
  return {
    loadAccessories,
    currentAccessoryUpdatedAt: () => fake.accessoryUpdatedAt,
    accessoryMeta,
    readAccessoryCoverage
  };
});

vi.mock("./danawa", () => ({ reparseDanawaPart: (part: Part) => part }));
vi.mock("./m2-overrides", () => ({
  applyM2SlotOverrides: (parts: Part[]) => parts,
  readM2SlotOverrides: async () => ({}),
  stripM2SlotOverride: (part: Part) => part
}));
vi.mock("./benchmark-overrides", () => ({
  applyBenchmarkOverrides: (parts: Part[]) => parts,
  readBenchmarkOverrides: async () => ({}),
  stripBenchmarkOverride: (part: Part) => part
}));
vi.mock("./gpu-physical-overrides", () => ({
  applyGpuPhysicalOverrides: (parts: Part[]) => parts,
  readGpuPhysicalOverrides: async () => ({}),
  stripGpuPhysicalOverrides: (part: Part) => part
}));
vi.mock("./case-rgb-load-overrides", () => ({
  applyCaseRgbLoadOverrides: (parts: Part[]) => parts,
  readCaseRgbLoadOverrides: async () => ({}),
  stripCaseRgbLoadOverride: (part: Part) => part
}));
vi.mock("./catalog-spec-overrides", () => ({
  applyCatalogSpecOverrides: (parts: Part[]) => parts,
  readCatalogSpecOverrides: async () => ({}),
  stripCatalogSpecOverride: (part: Part) => part
}));

const syntheticPart: Part = {
  id: "catalog-meta-fixture-part",
  category: "cpu",
  name: "Synthetic CPU",
  source: "manual",
  specs: { socket: "AM5" },
  dataQuality: "manual",
  missingFields: [],
  updatedAt: "2026-09-27T00:00:00.000Z"
};

const syntheticAccessory: AccessoryItem = {
  id: "catalog-meta-fixture-accessory",
  category: "cooling_fan",
  name: "Synthetic fan",
  source: "manual",
  listingType: "accessory",
  specs: {},
  dataQuality: "manual",
  missingFields: [],
  updatedAt: "2026-09-27T00:00:00.000Z"
};

describe("catalog metadata uses one request-local snapshot", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-29T12:00:00.000Z"));
    fake.databaseCatalog = [syntheticPart];
    fake.accessories = [syntheticAccessory];
    fake.catalogReads = 0;
    fake.accessoryReads = 0;
    fake.accessoryMetaSnapshots = [];
    fake.accessoryCoverageSnapshots = [];
  });

  it("reads once and returns metadata tied to the request-local snapshot", async () => {
    const [{ loadCatalogSnapshot }, { catalogMeta }] = await Promise.all([
      import("./catalog-snapshot"),
      import("./catalog")
    ]);

    const snapshot = await loadCatalogSnapshot();
    const meta = await catalogMeta(snapshot);
    expect(fake.catalogReads).toBe(1);
    expect(fake.accessoryReads).toBe(1);
    expect(fake.accessoryMetaSnapshots).toHaveLength(1);
    expect(fake.accessoryCoverageSnapshots).toHaveLength(1);
    expect(fake.accessoryMetaSnapshots[0]).toBe(fake.accessories);
    expect(fake.accessoryCoverageSnapshots[0]).toBe(fake.accessories);
    expect(meta).toMatchObject({
      catalogCount: expect.any(Number),
      catalogUpdatedAt: snapshot.catalogUpdatedAt,
      accessoryCount: 1,
      accessoryUpdatedAt: snapshot.accessoryUpdatedAt,
      accessoryPriceCoverage: { priced: 0, unpriced: 1 },
      accessoryCoverage: { updatedAt: fake.accessoryUpdatedAt, categories: [{ storedProductCount: 1 }] }
    });
  });

  it("keeps concurrent metadata calls tied to their own snapshot freshness", async () => {
    const [{ loadCatalogSnapshot }, { catalogMeta }] = await Promise.all([
      import("./catalog-snapshot"),
      import("./catalog")
    ]);
    fake.databaseCatalog = [syntheticPart];
    fake.accessories = [syntheticAccessory];
    fake.accessoryUpdatedAt = "2026-09-28T00:00:00.000Z";
    const olderSnapshot = await loadCatalogSnapshot();

    fake.databaseCatalog = [
      syntheticPart,
      { ...syntheticPart, id: "catalog-meta-fixture-newer-gpu", category: "gpu", updatedAt: "2026-10-01T00:00:00.000Z" }
    ];
    fake.accessories = [syntheticAccessory, { ...syntheticAccessory, id: "catalog-meta-fixture-newer-fan" }];
    fake.accessoryUpdatedAt = "2026-09-30T00:00:00.000Z";
    const newerSnapshot = await loadCatalogSnapshot();

    const [olderMeta, newerMeta] = await Promise.all([
      catalogMeta(olderSnapshot),
      catalogMeta(newerSnapshot)
    ]);

    expect(newerMeta.catalogCount).toBe(olderMeta.catalogCount + 1);
    expect(newerMeta.accessoryCount).toBe(olderMeta.accessoryCount + 1);
    expect(olderMeta.catalogUpdatedAt).toBe(olderSnapshot.catalogUpdatedAt);
    expect(newerMeta.catalogUpdatedAt).toBe(newerSnapshot.catalogUpdatedAt);
    expect(olderMeta.accessoryUpdatedAt).toBe(olderSnapshot.accessoryUpdatedAt);
    expect(newerMeta.accessoryUpdatedAt).toBe(newerSnapshot.accessoryUpdatedAt);
  });
});
