import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createShareOwnerCredential } from "./build-share";

const selection = { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: true };

async function closeServer(server: { close(callback: (error?: Error) => void): void }) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe("purchase progress persistence API", () => {
  it("persists revisions, rejects stale writes, and restores a previous state in an isolated file store", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-purchase-progress-"));
    const previousDataDirectory = process.env.PC_SUPPORTER_DATA_DIR;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    process.env.DATABASE_URL = "";
    vi.resetModules();
    let server: Server | undefined;
    try {
      const [{ app, parseRecommendationPreferences }, { BUILDS_PATH, writeJson }, { buildCompatibilityInputFingerprint }] = await Promise.all([
        import("./index"),
        import("./storage"),
        import("../shared/build-fingerprint")
      ]);
      const credential = createShareOwnerCredential();
      const buildId = "purchase-progress-api-test";
      await writeJson(BUILDS_PATH, [{ id: buildId, name: "구매 진행률 통합 테스트", selection, createdAt: "2026-09-02T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z", ownerTokenHash: credential.hash }]);
      const preferences = parseRecommendationPreferences(undefined);
      const inputFingerprint = buildCompatibilityInputFingerprint(selection, preferences);
      const rowKeys = ["row:cpu", "row:gpu"];

      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve, reject) => { server?.once("listening", resolve); server?.once("error", reject); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("isolated test server did not expose a TCP port");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const request = async (path: string, body: Record<string, unknown>) => {
        const response = await fetch(`${baseUrl}${path}`, { method: "PUT", headers: { "Content-Type": "application/json", "X-Share-Owner-Token": credential.token }, body: JSON.stringify(body) });
        return { status: response.status, payload: await response.json() as Record<string, any> };
      };
      const progress = (checkedIds: string[]) => ({ inputFingerprint, rowKeys, checkedIds });

      const unauthenticated = await fetch(`${baseUrl}/api/builds/${buildId}/purchase-progress`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: null, progress: progress([]) }) });
      expect(unauthenticated.status).toBe(401);
      expect(await unauthenticated.json()).toMatchObject({ code: "SHARE_OWNER_AUTH_REQUIRED", error: "구매 진행률을 저장하려면 견적 소유자 인증이 필요합니다." });

      const first = await request(`/api/builds/${buildId}/purchase-progress`, { expectedRevision: null, progress: progress([rowKeys[0]]) });
      expect(first.status).toBe(200);
      expect(first.payload.purchaseProgress).toMatchObject({ revision: 1, checkedIds: [rowKeys[0]] });
      expect(first.payload.purchaseProgress.history).toBeUndefined();

      const staleBeforeSecond = await request(`/api/builds/${buildId}/purchase-progress`, { expectedRevision: null, progress: progress([]) });
      expect(staleBeforeSecond.status).toBe(409);
      expect(staleBeforeSecond.payload.code).toBe("PURCHASE_PROGRESS_CONFLICT");
      expect(staleBeforeSecond.payload.purchaseProgress).toMatchObject({ revision: 1, checkedIds: [rowKeys[0]] });

      const second = await request(`/api/builds/${buildId}/purchase-progress`, { expectedRevision: 1, progress: progress(rowKeys) });
      expect(second.status).toBe(200);
      expect(second.payload.purchaseProgress).toMatchObject({ revision: 2, checkedIds: rowKeys });
      expect(second.payload.purchaseProgress.history).toHaveLength(1);
      expect(second.payload.purchaseProgress.history[0]).toMatchObject({ revision: 1, checkedIds: [rowKeys[0]] });

      const staleAfterSecond = await request(`/api/builds/${buildId}/purchase-progress`, { expectedRevision: 1, progress: progress([]) });
      expect(staleAfterSecond.status).toBe(409);
      expect(staleAfterSecond.payload.purchaseProgress).toMatchObject({ revision: 2, checkedIds: rowKeys });

      const restoreResponse = await fetch(`${baseUrl}/api/builds/${buildId}/purchase-progress/restore`, { method: "POST", headers: { "Content-Type": "application/json", "X-Share-Owner-Token": credential.token }, body: JSON.stringify({ expectedRevision: 2, revision: 1, rowKeys }) });
      const restored = await restoreResponse.json() as Record<string, any>;
      expect(restoreResponse.status).toBe(200);
      expect(restored.purchaseProgress).toMatchObject({ revision: 3, checkedIds: [rowKeys[0]] });
      expect(restored.purchaseProgress.history.map((entry: { revision: number }) => entry.revision)).toEqual([2, 1]);

      const staleRestore = await fetch(`${baseUrl}/api/builds/${buildId}/purchase-progress/restore`, { method: "POST", headers: { "Content-Type": "application/json", "X-Share-Owner-Token": credential.token }, body: JSON.stringify({ expectedRevision: 2, revision: 1, rowKeys }) });
      const staleRestorePayload = await staleRestore.json() as Record<string, any>;
      expect(staleRestore.status).toBe(409);
      expect(staleRestorePayload.code).toBe("PURCHASE_PROGRESS_CONFLICT");
      expect(staleRestorePayload.purchaseProgress).toMatchObject({ revision: 3, checkedIds: [rowKeys[0]] });

      const unavailableHistory = await fetch(`${baseUrl}/api/builds/${buildId}/purchase-progress/restore`, { method: "POST", headers: { "Content-Type": "application/json", "X-Share-Owner-Token": credential.token }, body: JSON.stringify({ expectedRevision: 3, revision: 999, rowKeys }) });
      const unavailableHistoryPayload = await unavailableHistory.json() as Record<string, any>;
      expect(unavailableHistory.status).toBe(409);
      expect(unavailableHistoryPayload.code).toBe("PURCHASE_PROGRESS_HISTORY_UNAVAILABLE");
      expect(unavailableHistoryPayload.purchaseProgress).toMatchObject({ revision: 3 });

      const publicResponse = await fetch(`${baseUrl}/api/builds/${buildId}`);
      const publicBuild = await publicResponse.json() as Record<string, any>;
      expect(publicResponse.status).toBe(200);
      expect(publicBuild.purchaseProgress).toMatchObject({ revision: 3, checkedIds: [rowKeys[0]] });
      expect(publicBuild.purchaseProgress.history).toHaveLength(2);
      expect(publicBuild.ownerTokenHash).toBeUndefined();
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
