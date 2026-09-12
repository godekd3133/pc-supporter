import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createShareOwnerCredential } from "./build-share";

const selection = { cpu: { partId: "cpu-7500f", quantity: 1 }, memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: true };

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe("catalog refresh report persistence API", () => {
  it("stores a refresh report only for the matching build fingerprint and selected target", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-catalog-refresh-report-"));
    const previousDataDirectory = process.env.PC_SUPPORTER_DATA_DIR;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    process.env.DATABASE_URL = "";
    vi.resetModules();
    let server: Server | undefined;
    try {
      const [{ app, parseRecommendationPreferences }, { buildCompatibilityInputFingerprint }] = await Promise.all([import("./index"), import("../shared/build-fingerprint")]);
      const credential = createShareOwnerCredential();
      const preferences = parseRecommendationPreferences(undefined);
      const inputFingerprint = buildCompatibilityInputFingerprint(selection, preferences);
      const report = { inputFingerprint, status: "failed", requestedCount: 1, successCount: 0, failureCount: 1, items: [], failures: [{ target: { kind: "part", id: "cpu-7500f" }, message: "테스트 원문 확인 실패" }], completedAt: "2026-09-04T00:00:00.000Z" };
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve, reject) => { server?.once("listening", resolve); server?.once("error", reject); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("isolated test server did not expose a TCP port");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const createResponse = await fetch(`${baseUrl}/api/builds`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "원문 보고서 저장 테스트", selection, recommendationPreferences: preferences, catalogRefreshReport: report }) });
      const created = await createResponse.json() as Record<string, any>;
      expect(createResponse.status).toBe(201);
      expect(created.checkSnapshot.catalogRefreshReport).toMatchObject({ inputFingerprint, status: "failed", failureCount: 1 });
      const checkResponse = await fetch(`${baseUrl}/api/builds/${created.id}/check`, { method: "POST", headers: { "Content-Type": "application/json", "X-Share-Owner-Token": credential.token }, body: JSON.stringify({ catalogRefreshReport: report }) });
      expect(checkResponse.status).toBe(401);
      const ownerToken = created.ownerToken as string;
      const authorizedCheckResponse = await fetch(`${baseUrl}/api/builds/${created.id}/check`, { method: "POST", headers: { "Content-Type": "application/json", "X-Share-Owner-Token": ownerToken }, body: JSON.stringify({ catalogRefreshReport: report }) });
      const checked = await authorizedCheckResponse.json() as Record<string, any>;
      expect(authorizedCheckResponse.status).toBe(200);
      expect(checked.checkHistory.at(-1).catalogRefreshReport).toMatchObject({ inputFingerprint, status: "failed", failureCount: 1 });
      const invalidReportResponse = await fetch(`${baseUrl}/api/builds/${created.id}/check`, { method: "POST", headers: { "Content-Type": "application/json", "X-Share-Owner-Token": ownerToken }, body: JSON.stringify({ catalogRefreshReport: { ...report, inputFingerprint: "different-build" } }) });
      const invalidReport = await invalidReportResponse.json() as Record<string, any>;
      expect(invalidReportResponse.status).toBe(400);
      expect(invalidReport.code).toBe("CATALOG_REFRESH_REPORT_INVALID");
    } finally {
      if (server) await closeServer(server);
      if (previousDataDirectory === undefined) delete process.env.PC_SUPPORTER_DATA_DIR;
      else process.env.PC_SUPPORTER_DATA_DIR = previousDataDirectory;
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
      await rm(directory, { recursive: true, force: true });
    }
  });
});
