import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCESSORY_CATEGORIES, PART_CATEGORIES } from "../../shared/types";
import type { BuildSelection } from "../../shared/types";
import { generateBuildDraft } from "../../shared/domain/engine";
import { classifyDataFreshness } from "../../shared/domain/data-health";
import { compatibilityResultForPublicTransport, evaluateBuildWithAccessories } from "../../shared/domain/compatibility-evaluator";
import { publicApiPayloadProjection } from "../../shared/domain/public-api-projection";
import { seedAccessories } from "../../server/seed-accessories";
import { seedCatalog } from "../../server/seed-catalog";
import { projectOfflineAccessory, projectOfflinePart } from "../../scripts/offline-snapshot";
import { offlineApiRequest } from "./offline-api";
import type { OfflineCatalogSnapshot } from "../../shared/offline-catalog";

const snapshotAt = "2026-09-24T00:00:00.000Z";
const fixtureSnapshot: OfflineCatalogSnapshot = {
  manifest: {
    schemaVersion: 1,
    kind: "pc-supporter-offline-catalog",
    revision: "catalog-3-1234567890abcdef",
    snapshotAt,
    accessorySnapshotAt: snapshotAt,
    catalogRevision: 3,
    privateRecommendationEvidenceIncluded: false,
    generatedAt: "2026-09-29T00:00:00.000Z",
    selectedCategories: { parts: [...PART_CATEGORIES], accessories: [...ACCESSORY_CATEGORIES] },
    counts: { parts: seedCatalog.length, accessories: seedAccessories.length },
    sourceHashes: { catalog: "1".repeat(64), accessories: "2".repeat(64) },
    bundleHashes: { parts: "3".repeat(64), accessories: "4".repeat(64) }
  },
  parts: seedCatalog.map(projectOfflinePart),
  accessories: seedAccessories.map(projectOfflineAccessory)
};
const testNow = Date.parse("2026-09-29T00:00:00.000Z");

function compatibleBuild(): BuildSelection {
  return {
    cpu: { partId: "cpu-7800x3d", quantity: 1 },
    cooler: { partId: "cooler-tower-am5-1700", quantity: 1 },
    motherboard: { partId: "mb-b650-4x3", quantity: 1 },
    memory: [{ partId: "memory-ddr5-16-5600", quantity: 2 }],
    gpu: { partId: "gpu-rtx-4060", quantity: 1 },
    ssd: [{ partId: "ssd-nvme-1tb", quantity: 1 }],
    hdd: [{ partId: "hdd-seagate-4tb", quantity: 1 }],
    case: { partId: "case-full-airflow", quantity: 1 },
    psu: { partId: "psu-1000w", quantity: 1 },
    accessories: [],
    useIntegratedGraphics: false
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("local offline API", () => {
  it("searches and opens bundled parts with the same basic category, query, price, and sort contract", async () => {
    const query = new URLSearchParams({ category: "cpu", q: "AMD", brand: "AMD", quality: "all", freshness: "all", priceStatus: "all", listingPolicy: "retail_only", sort: "name", limit: "5", offset: "0" });
    const response = await offlineApiRequest<{ items: Array<{ id: string; dataFreshness: string }>; total: number }>(`/api/parts?${query}`, undefined, fixtureSnapshot, testNow);
    const expected = seedCatalog.filter((part) => part.category === "cpu"
      && `${part.name} ${part.brand ?? ""} ${part.model ?? ""}`.toLocaleLowerCase("ko-KR").includes("amd")
      && part.brand?.toLocaleLowerCase("ko-KR").includes("amd"))
      .sort((left, right) => left.name.localeCompare(right.name, "ko-KR"));
    expect(response.total).toBe(expected.length);
    expect(response.items.map((part) => part.id)).toEqual(expected.slice(0, 5).map((part) => part.id));
    expect(response.items[0]?.dataFreshness).toBe(classifyDataFreshness(expected[0]?.updatedAt, testNow));

    const detail = await offlineApiRequest<typeof seedCatalog[number] & { dataFreshness: string }>(`/api/parts/${encodeURIComponent(expected[0]!.id)}`, undefined, fixtureSnapshot, testNow);
    expect(detail.id).toBe(expected[0]?.id);
    expect(detail.dataFreshness).toBe(classifyDataFreshness(expected[0]?.updatedAt, testNow));
  });

  it("searches and opens bundled accessories", async () => {
    const params = new URLSearchParams({ category: "cooling_fan", q: "팬", sort: "name", limit: "10" });
    const response = await offlineApiRequest<{ items: Array<{ id: string }>; total: number }>(`/api/accessories?${params}`, undefined, fixtureSnapshot, testNow);
    const expected = seedAccessories.filter((item) => item.category === "cooling_fan" && `${item.name} ${item.brand ?? ""} ${item.model ?? ""} ${item.rawSpecText ?? ""}`.toLocaleLowerCase("ko-KR").includes("팬"))
      .sort((left, right) => left.name.localeCompare(right.name, "ko-KR"));
    expect(response.total).toBe(expected.length);
    expect(response.items.map((item) => item.id)).toEqual(expected.map((item) => item.id));

    const detail = await offlineApiRequest<{ id: string }>(`/api/accessories/${encodeURIComponent(expected[0]!.id)}`, undefined, fixtureSnapshot, testNow);
    expect(detail.id).toBe(expected[0]?.id);
  });

  it("matches the shared evaluator's public core compatibility result", async () => {
    const build = compatibleBuild();
    const recommendationPreferences = { profile: "gaming", priority: "balanced", listingPolicy: "retail_only", gamingResolution: "1440p", gamingRefreshRate: 144 } as const;
    const expected = compatibilityResultForPublicTransport(evaluateBuildWithAccessories(build, fixtureSnapshot.parts, fixtureSnapshot.accessories, {
      catalogSnapshotAt: snapshotAt,
      recommendationPreferences,
      gamingPerformanceEvidence: [],
      now: testNow
    })) as unknown as Record<string, unknown>;
    const actual = await offlineApiRequest<Record<string, unknown>>("/api/compatibility/check", {
      method: "POST",
      body: JSON.stringify({ ...build, recommendationPreferences })
    }, fixtureSnapshot, testNow);
    expect(actual).toEqual({ ...expected, offlineSnapshotRevision: fixtureSnapshot.manifest.revision, offlineSnapshotAt: snapshotAt });
    expect(actual).not.toHaveProperty("analysis");
    expect(actual).not.toHaveProperty("benchmarkSnapshot");
    expect(JSON.stringify(actual)).not.toMatch(/Cinebench|3DMark|benchmarkProvenance|gamingPerformanceEvidence/i);
  });

  it("includes shared accessory compatibility, recommendations, and accessory price in local checks", async () => {
    const build = { ...compatibleBuild(), accessories: [{ accessoryId: seedAccessories[0]!.id, quantity: 1 }] };
    const recommendationPreferences = { profile: "general", priority: "balanced", listingPolicy: "retail_only" } as const;
    const expected = compatibilityResultForPublicTransport(evaluateBuildWithAccessories(build, fixtureSnapshot.parts, fixtureSnapshot.accessories, {
      catalogSnapshotAt: snapshotAt,
      recommendationPreferences,
      gamingPerformanceEvidence: [],
      now: testNow
    })) as unknown as Record<string, unknown>;
    const actual = await offlineApiRequest<Record<string, unknown>>("/api/compatibility/check", {
      method: "POST",
      body: JSON.stringify({ ...build, recommendationPreferences })
    }, fixtureSnapshot, testNow);
    expect(actual).toEqual({ ...expected, offlineSnapshotRevision: fixtureSnapshot.manifest.revision, offlineSnapshotAt: snapshotAt });
    expect(actual).toHaveProperty("accessoryCompatibility");
    expect(actual).toHaveProperty("accessoryRecommendations");
    expect(actual).toHaveProperty("accessoryTotalPriceWon");
    expect(JSON.stringify(actual)).not.toMatch(/benchmarkProvenance|cinebench|3dmark|gamingPerformanceEvidence/i);
  });

  it("serves the catalog and picker compatible-candidate consumers with local risk assessment", async () => {
    const body = {
      category: "cpu",
      build: compatibleBuild(),
      profile: "general",
      q: "",
      brand: "",
      quality: "all",
      priceStatus: "all",
      freshness: "all",
      sort: "similarity",
      listingPolicy: "retail_only",
      mode: "no_blocker",
      riskFilter: "all",
      performanceFilter: "all",
      physicalEvidenceFilter: "all",
      recommendationTrustFilter: "all",
      specFilter: {},
      offset: 0,
      limit: 20
    };
    const response = await offlineApiRequest<{ items: Array<{ category: string; candidateRisk: string; candidateReasons?: string[] }>; total: number; riskCounts: { safe: number; review: number; unsafe: number }; offset: number; limit: number }>("/api/parts/compatible", {
      method: "POST",
      body: JSON.stringify(body)
    }, fixtureSnapshot, testNow);
    expect(response.total).toBeGreaterThan(0);
    expect(response.items.length).toBeGreaterThan(0);
    expect(response.items.every((item) => item.category === "cpu" && ["safe", "review", "unsafe"].includes(item.candidateRisk))).toBe(true);
    expect(response.riskCounts.safe + response.riskCounts.review + response.riskCounts.unsafe).toBeGreaterThan(0);
    expect(response).toMatchObject({ offset: 0, limit: 20 });
    expect(JSON.stringify(response)).not.toMatch(/similarityEvidence|recommendationTrust|benchmarkProvenance|cinebench|3dmark/i);
  });

  it("blocks non-default internal evidence filters in compatible candidate search", async () => {
    await expect(offlineApiRequest("/api/parts/compatible", {
      method: "POST",
      body: JSON.stringify({ category: "cpu", build: compatibleBuild(), performanceFilter: "benchmark" })
    }, fixtureSnapshot, testNow)).rejects.toMatchObject({ status: 501, payload: { code: "OFFLINE_FILTER_UNAVAILABLE" } });
  });

  it("matches the shared engine's automatic recommendation result", async () => {
    const request = { profile: "office", budgetWon: 1_500_000, includeGpu: false } as const;
    const expected = publicApiPayloadProjection(generateBuildDraft(fixtureSnapshot.parts, request, [], { now: testNow }));
    const actual = await offlineApiRequest<Record<string, unknown>>("/api/builds/recommend", {
      method: "POST",
      body: JSON.stringify(request)
    }, fixtureSnapshot, testNow);
    expect(actual).toEqual({ ...expected as Record<string, unknown>, offlineSnapshotRevision: fixtureSnapshot.manifest.revision, offlineSnapshotAt: snapshotAt });
    expect(JSON.stringify(actual)).not.toMatch(/Cinebench|3DMark|benchmarkProvenance|gamingPerformanceEvidence/i);
  });

  it("never uses fetch and returns a typed unavailable error for server-only routes", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(offlineApiRequest<{ items: Array<{ id: string }> }>("/api/parts?category=cpu", { method: "GET" }, fixtureSnapshot, testNow)).resolves.toMatchObject({ items: expect.any(Array) });
    await expect(offlineApiRequest("/api/builds?ids=remote-history", undefined, fixtureSnapshot, testNow)).rejects.toMatchObject({ status: 503, payload: { code: "OFFLINE_FEATURE_UNAVAILABLE" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed selections, unknown accessory references, and invalid generation ranges before evaluation", async () => {
    const badQuantity = { ...compatibleBuild(), memory: [{ partId: "memory-ddr5-16-5600", quantity: 0 }] };
    await expect(offlineApiRequest("/api/compatibility/check", { method: "POST", body: JSON.stringify(badQuantity) }, fixtureSnapshot, testNow))
      .rejects.toMatchObject({ status: 400, payload: { code: "OFFLINE_BUILD_INVALID" } });

    const unknownAccessory = { ...compatibleBuild(), accessories: [{ accessoryId: "missing-accessory", quantity: 1 }] };
    await expect(offlineApiRequest("/api/compatibility/check", { method: "POST", body: JSON.stringify(unknownAccessory) }, fixtureSnapshot, testNow))
      .rejects.toMatchObject({ status: 400, payload: { code: "OFFLINE_BUILD_ACCESSORY_MISSING" } });

    const invalidTarget = { ...compatibleBuild(), accessories: [{ accessoryId: seedAccessories[0]!.id, quantity: 1, targetPartId: "missing-ssd" }] };
    await expect(offlineApiRequest("/api/compatibility/check", { method: "POST", body: JSON.stringify(invalidTarget) }, fixtureSnapshot, testNow))
      .rejects.toMatchObject({ status: 400, payload: { code: "OFFLINE_BUILD_TARGET_INVALID" } });

    await expect(offlineApiRequest("/api/builds/recommend", { method: "POST", body: JSON.stringify({ profile: "office", budgetWon: 500_000, includeGpu: false, memoryCapacityGb: 48 }) }, fixtureSnapshot, testNow))
      .rejects.toMatchObject({ status: 400, payload: { code: "OFFLINE_RECOMMENDATION_INVALID" } });
  });
});
