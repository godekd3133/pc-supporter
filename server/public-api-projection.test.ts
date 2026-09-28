import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { publicApiPayloadProjection } from "./public-api-projection";

const sourceCheck = {
  requestedUrl: "https://review.example/benchmark-boundary",
  checkedAt: "2026-09-20T00:00:00.000Z",
  status: "reachable",
  identityStatus: "matched",
  redirectCount: 0,
  httpStatus: 200
};

function closeServer(server: Server) {
  server.closeAllConnections?.();
  return new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe("public API evidence projection", () => {
  it("hides engine ranking evidence from catalog, recommendation, and share routes while retaining buyer facts", async () => {
    const projectedRankEvidence = publicApiPayloadProjection({
      item: {
        id: "gpu-public-boundary",
        priceWon: 650000,
        specs: { socket: "AM5", lengthMm: 270 },
        valueLabel: "가성비 우수",
        valueEvidence: { scoreScale: 200, similarityScore: 92 },
        similarityLabel: "동급",
        improvementPercent: 18.2,
        improvedDimensions: ["VRAM", "대역폭"],
        scoreDelta: 7,
        candidateScore: 88,
        confidence: "high",
        catalogSpecSourceCheckNeedsReview: true,
        benchmarkChanged: true,
        benchmarkNeedsReview: true
      }
    });
    expect(projectedRankEvidence).toEqual({ item: { id: "gpu-public-boundary", priceWon: 650000, specs: { socket: "AM5", lengthMm: 270 } } });

    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-public-api-projection-"));
    const envKeys = ["PC_SUPPORTER_DATA_DIR", "DATABASE_URL", "ADMIN_PASSWORD", "GAMING_PERFORMANCE_EVIDENCE_PATH"] as const;
    const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]])) as Record<typeof envKeys[number], string | undefined>;
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    process.env.DATABASE_URL = "";
    process.env.ADMIN_PASSWORD = "test-admin-password";
    process.env.GAMING_PERFORMANCE_EVIDENCE_PATH = join(directory, "gaming-performance-evidence.json");
    vi.resetModules();

    let server: Server | undefined;
    try {
      const [{ app }, storage, catalog, engine] = await Promise.all([import("./index"), import("./storage"), import("./catalog"), import("./engine")]);
      const cpu = {
        id: "cpu-public-boundary",
        category: "cpu",
        name: "Public Boundary CPU",
        brand: "Boundary",
        model: "CPU-1",
        source: "manual",
        listingType: "retail",
        danawaUrl: "https://prod.danawa.com/info/?pcode=cpu-public-boundary",
        priceWon: 310000,
        specs: {
          socket: "AM5",
          memoryType: "DDR5",
          cores: 8,
          threads: 16,
          cinebenchR23Single: 98765,
          cinebenchR23Multi: 87654,
          benchmarkProvenance: {
            sourceKind: "independent_review",
            sourceNote: "CPU_PRIVATE_BENCHMARK_SOURCE",
            sourceUrl: "https://review.example/cpu-private",
            updatedAt: "2026-09-20T00:00:00.000Z",
            sourceCheck
          }
        },
        dataQuality: "manual",
        missingFields: [],
        updatedAt: "2026-09-20T00:00:00.000Z"
      };
      const gpu = {
        id: "gpu-public-boundary",
        category: "gpu",
        name: "Public Boundary GPU",
        brand: "Boundary",
        model: "GPU-1",
        source: "manual",
        listingType: "retail",
        danawaUrl: "https://prod.danawa.com/info/?pcode=gpu-public-boundary",
        priceWon: 650000,
        specs: {
          vramGb: 12,
          powerW: 220,
          lengthMm: 270,
          gpuVendor: "NVIDIA",
          gpuMemoryBandwidthGbps: 320,
          gpu3dmarkTimeSpyScore: 24680,
          gpu3dmarkPortRoyalScore: 13579,
          benchmarkProvenance: {
            sourceKind: "independent_review",
            sourceNote: "GPU_PRIVATE_BENCHMARK_SOURCE",
            sourceUrl: "https://review.example/gpu-private",
            updatedAt: "2026-09-20T00:00:00.000Z",
            sourceCheck
          }
        },
        dataQuality: "manual",
        missingFields: [],
        updatedAt: "2026-09-20T00:00:00.000Z"
      };
      const selectedGpu = {
        id: "gpu-rtx-4060",
        category: "gpu",
        name: "NVIDIA GeForce RTX 4060",
        brand: "NVIDIA",
        model: "RTX 4060",
        source: "manual",
        listingType: "retail",
        priceWon: 439000,
        specs: { vramGb: 8, powerW: 115, recommendedPsuW: 550, lengthMm: 221, gpuVendor: "NVIDIA" },
        dataQuality: "manual",
        missingFields: [],
        updatedAt: "2026-09-20T00:00:00.000Z"
      };
      const gamingEvidence = [{
        id: "fps-private-boundary",
        gameId: "cyberpunk",
        gpuPartId: "gpu-rtx-4060",
        gpuName: "NVIDIA GeForce RTX 4060",
        resolution: "4k",
        refreshRate: 144,
        graphicsPreset: "high",
        rayTracing: true,
        upscaling: "quality",
        averageFps: 158,
        onePercentLowFps: 111,
        driverVersion: "private-test-driver",
        measuredAt: "2026-09-20T00:00:00.000Z",
        sourceKind: "lab",
        sourceUrl: "https://review.example/fps-private"
      }];
      await writeFile(storage.CATALOG_PATH, JSON.stringify([cpu, gpu, selectedGpu]), "utf8");
      await writeFile(process.env.GAMING_PERFORMANCE_EVIDENCE_PATH, JSON.stringify(gamingEvidence), "utf8");
      await writeFile(storage.BENCHMARK_OVERRIDES_PATH, JSON.stringify({
        "gpu-public-boundary": {
          partId: "gpu-public-boundary",
          scores: { gpu3dmarkTimeSpyScore: 24680 },
          sourceKind: "independent_review",
          sourceNote: "GPU_PRIVATE_BENCHMARK_SOURCE",
          sourceUrl: "https://review.example/gpu-private",
          updatedAt: "2026-09-20T00:00:00.000Z"
        }
      }), "utf8");

      const loadedCatalog = await catalog.loadCatalog();
      expect(loadedCatalog.find((part) => part.id === cpu.id)?.specs.cinebenchR23Multi).toBe(87654);
      expect(loadedCatalog.find((part) => part.id === gpu.id)?.specs.gpu3dmarkTimeSpyScore).toBe(24680);
      const qhdBuild = {
        cpu: { partId: "cpu-7800x3d", quantity: 1 },
        cooler: { partId: "cooler-tower-am5-1700", quantity: 1 },
        motherboard: { partId: "mb-b650-4x3", quantity: 1 },
        memory: [{ partId: "memory-ddr5-16-5600", quantity: 2 }],
        gpu: { partId: "gpu-rtx-4060", quantity: 1 },
        ssd: [{ partId: "ssd-nvme-1tb", quantity: 1 }],
        hdd: [],
        case: { partId: "case-full-airflow", quantity: 1 },
        psu: { partId: "psu-1000w", quantity: 1 },
        useIntegratedGraphics: false
      };
      const qhdPreferences = {
        profile: "gaming" as const,
        priority: "balanced" as const,
        listingPolicy: "retail_only" as const,
        gamingResolution: "1440p" as const,
        gamingRefreshRate: 144 as const
      };
      const internalQhdResult = engine.evaluateBuild(qhdBuild, loadedCatalog, {
        catalogSnapshotAt: "2026-09-20T00:00:00.000Z",
        recommendationPreferences: qhdPreferences
      });
      expect(internalQhdResult.analysis.gpuTarget).toMatchObject({
        resolution: "1440p",
        refreshRate: 144,
        targetVramGb: 12,
        currentVramGb: 8,
        currentFit: "partial",
        summary: expect.stringContaining("QHD · 144Hz · 권장 VRAM 12GB")
      });

      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve, reject) => { server?.once("listening", resolve); server?.once("error", reject); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("public API projection test server did not expose a TCP port");
      const baseUrl = "http://127.0.0.1:" + address.port;

      const publicMetaResponse = await fetch(baseUrl + "/api/meta");
      expect(publicMetaResponse.status).toBe(200);
      const publicMeta = await publicMetaResponse.json() as Record<string, any>;
      expect(publicMeta).not.toHaveProperty("benchmarkCoverage");

      const adminLogin = await fetch(baseUrl + "/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "test-admin-password" })
      });
      expect(adminLogin.status).toBe(200);
      const adminCookie = adminLogin.headers.get("set-cookie")?.split(";")[0];
      if (!adminCookie) throw new Error("public API projection test did not receive an admin session cookie");
      const adminHeaders = { Cookie: adminCookie };
      const adminMetaResponse = await fetch(baseUrl + "/api/meta", { headers: adminHeaders });
      expect(adminMetaResponse.status).toBe(200);
      const adminMeta = await adminMetaResponse.json() as Record<string, any>;
      expect(adminMeta.benchmarkCoverage.cpu.total).toEqual(expect.any(Number));

      for (const part of [cpu, gpu]) {
        const detail = await fetch(baseUrl + "/api/parts/" + part.id);
        expect(detail.status).toBe(200);
        const payload = await detail.json() as Record<string, any>;
        expect(payload.priceWon).toBe(part.priceWon);
        expect(payload.danawaUrl).toBe(part.danawaUrl);
        expect(payload.specs.lengthMm ?? payload.specs.cores).toBeDefined();
        expect(JSON.stringify(payload)).not.toContain("cinebenchR23");
        expect(JSON.stringify(payload)).not.toContain("gpu3dmark");
        expect(JSON.stringify(payload)).not.toContain("benchmarkProvenance");
        expect(JSON.stringify(payload)).not.toContain("CPU_PRIVATE_BENCHMARK_SOURCE");
        expect(JSON.stringify(payload)).not.toContain("GPU_PRIVATE_BENCHMARK_SOURCE");
      }

      const qhdCompatibility = await fetch(baseUrl + "/api/compatibility/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...qhdBuild, recommendationPreferences: qhdPreferences })
      });
      expect(qhdCompatibility.status).toBe(200);
      const qhdCompatibilityPayload = await qhdCompatibility.json() as Record<string, any>;
      expect(qhdCompatibilityPayload.status).toBeDefined();
      expect(qhdCompatibilityPayload.analysis).toBeUndefined();
      expect(JSON.stringify(qhdCompatibilityPayload)).not.toMatch(/gpuTarget|performanceSummary|analysisConfidence|scoreModelVersion|valueLabel|valueEvidence|similarityLabel|improvementPercent|improvedDimensions|scoreDelta|candidateScore|catalogSpecSourceCheckNeedsReview|benchmarkChanged|benchmarkNeedsReview|confidence|QHD · 144Hz · 권장 VRAM 12GB/);

      const completeBenchmarkRequest = await fetch(baseUrl + "/api/parts?category=gpu&benchmarkStatus=complete");
      const partialBenchmarkRequest = await fetch(baseUrl + "/api/parts?category=gpu&benchmarkStatus=partial");
      expect(completeBenchmarkRequest.status).toBe(200);
      expect(partialBenchmarkRequest.status).toBe(200);
      const completeBenchmarkPayload = await completeBenchmarkRequest.json() as Record<string, any>;
      const partialBenchmarkPayload = await partialBenchmarkRequest.json() as Record<string, any>;
      expect(completeBenchmarkPayload.total).toEqual(expect.any(Number));
      expect(partialBenchmarkPayload.total).toBe(completeBenchmarkPayload.total);
      expect(partialBenchmarkPayload.items).toEqual(completeBenchmarkPayload.items);
      for (const payload of [completeBenchmarkPayload, partialBenchmarkPayload]) {
        expect(payload.benchmarkStatus).toBeUndefined();
        expect(payload.benchmarkExcludedCount).toBeUndefined();
        expect(JSON.stringify(payload)).not.toMatch(/benchmarkStatus|benchmarkExcludedCount/);
      }

      const compatible = await fetch(baseUrl + "/api/parts/compatible", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: "gpu",
          q: "Public Boundary GPU",
          mode: "precision",
          profile: "gaming",
          gamingResolution: "1440p",
          gamingRefreshRate: 144,
          build: {
            cpu: { partId: "cpu-7800x3d", quantity: 1 },
            cooler: { partId: "cooler-tower-am5-1700", quantity: 1 },
            motherboard: { partId: "mb-b650-4x3", quantity: 1 },
            memory: [{ partId: "memory-ddr5-16-5600", quantity: 2 }],
            gpu: { partId: "gpu-rtx-4060", quantity: 1 },
            ssd: [{ partId: "ssd-nvme-1tb", quantity: 1 }],
            hdd: [],
            case: { partId: "case-full-airflow", quantity: 1 },
            psu: { partId: "psu-1000w", quantity: 1 },
            useIntegratedGraphics: false
          }
        })
      });
      expect(compatible.status).toBe(200);
      const compatiblePayload = await compatible.json() as Record<string, any>;
      expect(compatiblePayload.total).toBeGreaterThan(0);
      expect(compatiblePayload.riskCounts).toEqual(expect.objectContaining({ safe: expect.any(Number), review: expect.any(Number), unsafe: expect.any(Number) }));
      expect(compatiblePayload.recommendationTrustCounts).toBeUndefined();
      expect(compatiblePayload.items[0]).toMatchObject({
        id: gpu.id,
        priceWon: gpu.priceWon,
        candidateRisk: expect.any(String),
        remainingBlockers: expect.any(Number)
      });
      expect(compatiblePayload.items[0].recommendationTrust).toBeUndefined();
      expect(compatiblePayload.items[0].similarityEvidence).toBeUndefined();
      expect(compatiblePayload.items[0].similarityLabel).toBeUndefined();
      expect(compatiblePayload.items[0].valueLabel).toBeUndefined();
      expect(compatiblePayload.items[0].valueEvidence).toBeUndefined();
      expect(compatiblePayload.items[0].performanceSummary).toBeUndefined();
      expect(compatiblePayload.items[0].decision).toBeUndefined();
      expect(compatiblePayload.trustExcludedCount).toBeUndefined();
      expect(JSON.stringify(compatiblePayload)).not.toMatch(/24680|13579|recommendationTrust|similarityEvidence|gpu3dmark|benchmarkProvenance/);

      const benchmarkEvidence = {
        partId: gpu.id,
        category: "gpu",
        name: gpu.name,
        rows: [
          { key: "gpu3dmarkTimeSpyScore", label: "3DMark Time Spy", value: 24680, unit: "점" },
          { key: "gpu3dmarkPortRoyalScore", label: "3DMark Port Royal", value: 13579, unit: "점" }
        ],
        provenance: {
          sourceKind: "independent_review",
          sourceNote: "GPU_PRIVATE_BENCHMARK_SOURCE",
          sourceUrl: "https://review.example/gpu-private",
          updatedAt: "2026-09-20T00:00:00.000Z",
          sourceCheck
        },
        benchmarkFreshness: "fresh",
        dataUpdatedAt: "2026-09-20T00:00:00.000Z"
      };
      const candidate = (id: string, extra: Record<string, unknown> = {}) => ({
        name: id === gpu.id ? gpu.name : "다른 GPU",
        category: "gpu",
        partId: id,
        summary: "VRAM 12GB · 270mm",
        price: "650,000원",
        priceWon: 650000,
        similarity: "대안 83점 · 정보 충분",
        performance: "3DMark Time Spy 24680점 · GPU_PRIVATE_BENCHMARK_SOURCE",
        compatibility: "호환 확인",
        recommendationTrust: "높음 94점",
        decisionSummary: "추천 부품 · 높음 94점",
        physicalEvidence: "길이 270mm · 제조사 안내 확인",
        physicalEvidenceSources: [{ category: "gpu", manufacturerModel: "GPU-1", note: "제조사 장착 안내", url: "https://vendor.example/gpu-1" }],
        sourceUrl: "https://prod.danawa.com/info/?pcode=gpu-public-boundary",
        dataQuality: "수동 확인",
        ...(id === gpu.id ? { benchmarkEvidence } : {}),
        scenario: {
          status: "needs_review",
          blockerCount: 0,
          warningCount: 1,
          unknownCount: 2,
          analysisScore: 82,
          analysisScoreLabel: "상위권",
          analysisConfidence: "high",
          analysisScoreDelta: -4
        },
        ...extra
      });
      const comparisonCreate = await fetch(baseUrl + "/api/comparisons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "검수 비교", candidates: [candidate(gpu.id), candidate("gpu-other")] })
      });
      expect(comparisonCreate.status).toBe(201);
      const comparison = await comparisonCreate.json() as Record<string, any>;
      expect(comparison.candidates[0]).toMatchObject({
        priceWon: 650000,
        compatibility: "호환 확인",
        physicalEvidence: expect.any(String),
        physicalEvidenceSources: [expect.objectContaining({ url: "https://vendor.example/gpu-1" })],
        sourceUrl: "https://prod.danawa.com/info/?pcode=gpu-public-boundary",
        scenario: { status: "needs_review", blockerCount: 0, warningCount: 1, unknownCount: 2 }
      });
      expect(comparison.candidates[0].recommendationTrust).toBeUndefined();
      expect(comparison.candidates[0].decisionSummary).toBeUndefined();
      expect(comparison.candidates[0].benchmarkEvidence).toBeUndefined();
      expect(comparison.candidates[0].performance).toBeUndefined();
      expect(comparison.candidates[0].scenario).not.toHaveProperty("analysisScore");
      expect(JSON.stringify(comparison)).not.toMatch(/24680|13579|GPU_PRIVATE_BENCHMARK_SOURCE|recommendationTrust|analysisScore|benchmarkEvidence/);

      const adminEvidence = await fetch(baseUrl + "/api/admin/gaming-performance-evidence", { headers: adminHeaders });
      expect(adminEvidence.status).toBe(200);
      expect(await adminEvidence.json()).toMatchObject({ count: 1, items: [{ id: "fps-private-boundary", averageFps: 158, onePercentLowFps: 111, sourceUrl: "https://review.example/fps-private" }] });

      const adminBenchmarks = await fetch(baseUrl + "/api/admin/benchmark-overrides", { headers: adminHeaders });
      expect(adminBenchmarks.status).toBe(200);
      expect(JSON.stringify(await adminBenchmarks.json())).toContain("24680");

      const adminBenchmarkReview = await fetch(baseUrl + "/api/admin/benchmark-review?limit=500", { headers: adminHeaders });
      expect(adminBenchmarkReview.status).toBe(200);
      expect(await adminBenchmarkReview.json()).toMatchObject({ sourceTotals: { gpu: { benchmarked: expect.any(Number) } } });
    } finally {
      if (server) await closeServer(server);
      vi.resetModules();
      for (const key of envKeys) {
        if (previousEnv[key] === undefined) delete process.env[key];
        else process.env[key] = previousEnv[key];
      }
      await rm(directory, { recursive: true, force: true });
    }
  });
});

afterAll(() => vi.resetModules());
