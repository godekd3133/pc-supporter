import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function waitForUsageEventCount(path: string, expected: number) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const payload = JSON.parse(await readFile(path, "utf8")) as { daily?: Record<string, { check?: number }> };
      const count = Object.values(payload.daily ?? {}).reduce((total, bucket) => total + (typeof bucket.check === "number" ? bucket.check : 0), 0);
      if (count >= expected) return;
    } catch {
      // The fire-and-forget usage event may not have created its file yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const evidence = {
  id: "api-cyberpunk-rx7900xtx",
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
  driverVersion: "test-driver",
  measuredAt: "2026-09-10T00:00:00.000Z",
  sourceKind: "lab",
  sourceUrl: "https://example.com/cyberpunk-rx7900xtx"
};

describe("gaming performance evidence admin API", () => {
  it("validates atomically and persists only a fully valid evidence array", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-gaming-evidence-api-"));
    const previousDataDirectory = process.env.PC_SUPPORTER_DATA_DIR;
    const previousEvidencePath = process.env.GAMING_PERFORMANCE_EVIDENCE_PATH;
    const previousAdminPassword = process.env.ADMIN_PASSWORD;
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    delete process.env.GAMING_PERFORMANCE_EVIDENCE_PATH;
    process.env.ADMIN_PASSWORD = "";
    vi.resetModules();
    let server: Server | undefined;
    try {
      const [{ app }, { gamingPerformanceEvidencePath }] = await Promise.all([import("./index"), import("./gaming-performance-evidence")]);
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve, reject) => { server?.once("listening", resolve); server?.once("error", reject); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("gaming evidence API test server did not expose a TCP port");
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const initial = await fetch(`${baseUrl}/api/admin/gaming-performance-evidence`);
      expect(initial.status).toBe(200);
      const initialPayload = await initial.json();
      expect(initialPayload).toMatchObject({ count: 0, items: [] });
      expect(initialPayload.updatedAt).toBeUndefined();

      const invalid = await fetch(`${baseUrl}/api/admin/gaming-performance-evidence`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ ...evidence, gpuPartId: undefined }] })
      });
      expect(invalid.status).toBe(400);
      const invalidPayload = await invalid.json();
      expect(invalidPayload).toMatchObject({ saved: false, valid: false });
      expect(invalidPayload.count).toBeUndefined();

      const preview = await fetch(`${baseUrl}/api/admin/gaming-performance-evidence/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [evidence] })
      });
      expect(preview.status).toBe(200);
      expect(await preview.json()).toMatchObject({ valid: true, validCount: 1, invalidCount: 0 });

      const saved = await fetch(`${baseUrl}/api/admin/gaming-performance-evidence`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [evidence] })
      });
      expect(saved.status).toBe(200);
      expect(await saved.json()).toMatchObject({ saved: true, count: 1, items: [expect.objectContaining({ id: evidence.id, gpuPartId: evidence.gpuPartId })] });

      const reloaded = await fetch(`${baseUrl}/api/admin/gaming-performance-evidence`);
      expect(await reloaded.json()).toMatchObject({ count: 1, items: [expect.objectContaining({ id: evidence.id })] });
      expect(JSON.parse(await readFile(gamingPerformanceEvidencePath(), "utf8"))).toMatchObject([expect.objectContaining({ id: evidence.id })]);

      const compatibility = await fetch(`${baseUrl}/api/compatibility/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cpu: { partId: "cpu-7800x3d", quantity: 1 },
          cooler: { partId: "cooler-tower-am5-1700", quantity: 1 },
          motherboard: { partId: "mb-b650-4x3", quantity: 1 },
          memory: [{ partId: "memory-ddr5-16-5600", quantity: 2 }],
          gpu: { partId: "gpu-rtx-4060", quantity: 1 },
          ssd: [{ partId: "ssd-nvme-1tb", quantity: 1 }],
          hdd: [{ partId: "hdd-seagate-4tb", quantity: 1 }],
          case: { partId: "case-full-airflow", quantity: 1 },
          psu: { partId: "psu-1000w", quantity: 1 },
          useIntegratedGraphics: false,
          recommendationPreferences: {
            profile: "gaming",
            priority: "balanced",
            listingPolicy: "retail_only",
            gamingResolution: "4k",
            gamingRefreshRate: 144,
            gamingGameIds: ["cyberpunk"],
            gamingGraphicsPreset: "high",
            gamingRayTracing: true,
            gamingUpscaling: "quality"
          }
        })
      });
      expect(compatibility.status).toBe(200);
      expect(await compatibility.json()).toMatchObject({ gamingPerformanceAssessment: { status: "verified", gameIds: ["cyberpunk"], gpuPartId: "gpu-rtx-4060", matchedRecordIds: [evidence.id], measurements: [{ averageFps: 158 }] } });

      const updated = await fetch(`${baseUrl}/api/admin/gaming-performance-evidence`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ ...evidence, averageFps: 170 }] })
      });
      expect(updated.status).toBe(200);
      const compatibilityAfterEvidenceUpdate = await fetch(`${baseUrl}/api/compatibility/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cpu: { partId: "cpu-7800x3d", quantity: 1 },
          cooler: { partId: "cooler-tower-am5-1700", quantity: 1 },
          motherboard: { partId: "mb-b650-4x3", quantity: 1 },
          memory: [{ partId: "memory-ddr5-16-5600", quantity: 2 }],
          gpu: { partId: "gpu-rtx-4060", quantity: 1 },
          ssd: [{ partId: "ssd-nvme-1tb", quantity: 1 }],
          hdd: [{ partId: "hdd-seagate-4tb", quantity: 1 }],
          case: { partId: "case-full-airflow", quantity: 1 },
          psu: { partId: "psu-1000w", quantity: 1 },
          useIntegratedGraphics: false,
          recommendationPreferences: {
            profile: "gaming",
            priority: "balanced",
            listingPolicy: "retail_only",
            gamingResolution: "4k",
            gamingRefreshRate: 144,
            gamingGameIds: ["cyberpunk"],
            gamingGraphicsPreset: "high",
            gamingRayTracing: true,
            gamingUpscaling: "quality"
          }
        })
      });
      expect(compatibilityAfterEvidenceUpdate.status).toBe(200);
      expect(await compatibilityAfterEvidenceUpdate.json()).toMatchObject({ gamingPerformanceAssessment: { status: "verified", measurements: [{ averageFps: 170 }] } });
      await waitForUsageEventCount(join(directory, "usage-events.json"), 2);
    } finally {
      if (server) await closeServer(server);
      if (previousDataDirectory === undefined) delete process.env.PC_SUPPORTER_DATA_DIR;
      else process.env.PC_SUPPORTER_DATA_DIR = previousDataDirectory;
      if (previousEvidencePath === undefined) delete process.env.GAMING_PERFORMANCE_EVIDENCE_PATH;
      else process.env.GAMING_PERFORMANCE_EVIDENCE_PATH = previousEvidencePath;
      if (previousAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
      else process.env.ADMIN_PASSWORD = previousAdminPassword;
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
