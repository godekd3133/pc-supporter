import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createShareOwnerCredential } from "./build-share";

const selection = { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: true };

async function closeServer(server: { close(callback: (error?: Error) => void): void }) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe("purchase price history persistence API", () => {
  it("persists revisions, rejects stale or unauthenticated writes, and exposes no owner hash", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-purchase-price-history-"));
    const previousDataDirectory = process.env.PC_SUPPORTER_DATA_DIR;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    process.env.DATABASE_URL = "";
    let server: Server | undefined;
    try {
      const [{ app, parseRecommendationPreferences }, { BUILDS_PATH, writeJson }, { buildCompatibilityInputFingerprint }] = await Promise.all([
        import("./index"),
        import("./storage"),
        import("../shared/build-fingerprint")
      ]);
      const credential = createShareOwnerCredential();
      const buildId = "purchase-price-history-api-test";
      await writeJson(BUILDS_PATH, [{ id: buildId, name: "가격 이력 통합 테스트", selection, createdAt: "2026-09-02T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z", ownerTokenHash: credential.hash }]);
      const preferences = parseRecommendationPreferences(undefined);
      const inputFingerprint = buildCompatibilityInputFingerprint(selection, preferences);
      const rowKeys = ["row:cpu", "row:gpu"];
      const history = (secondPrice: number) => ({ inputFingerprint, rowKeys, priceHistory: { "row:cpu": [{ checkedAt: "2026-09-02T00:00:00.000Z", unitPriceWon: 100_000 }, { checkedAt: "2026-09-02T01:00:00.000Z", unitPriceWon: 110_000 }], "row:gpu": [{ checkedAt: "2026-09-02T00:00:00.000Z", unitPriceWon: 300_000 }, { checkedAt: "2026-09-02T01:00:00.000Z", unitPriceWon: secondPrice }] } });

      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve, reject) => { server?.once("listening", resolve); server?.once("error", reject); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("isolated test server did not expose a TCP port");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const request = async (expectedRevision: number | null, payload: Record<string, unknown>, token = credential.token) => {
        const response = await fetch(`${baseUrl}/api/builds/${buildId}/purchase-price-history`, { method: "PUT", headers: { "Content-Type": "application/json", ...(token ? { "X-Share-Owner-Token": token } : {}) }, body: JSON.stringify({ expectedRevision, priceHistory: payload }) });
        return { status: response.status, payload: await response.json() as Record<string, any> };
      };

      const unauthenticated = await request(null, history(300_000), "");
      expect(unauthenticated.status).toBe(401);
      expect(unauthenticated.payload.code).toBe("SHARE_OWNER_AUTH_REQUIRED");
      expect(unauthenticated.payload.error).toBe("가격 확인 이력을 저장하려면 견적 소유자 인증이 필요합니다.");

      const first = await request(null, history(300_000));
      expect(first.status).toBe(200);
      expect(first.payload.purchasePriceHistory).toMatchObject({ revision: 1, inputFingerprint, rowKeys });
      expect(first.payload.purchasePriceHistory.history).toBeUndefined();

      const stale = await request(null, history(280_000));
      expect(stale.status).toBe(409);
      expect(stale.payload.code).toBe("PURCHASE_PRICE_HISTORY_CONFLICT");
      expect(stale.payload.purchasePriceHistory).toMatchObject({ revision: 1 });

      const second = await request(1, history(280_000));
      expect(second.status).toBe(200);
      expect(second.payload.purchasePriceHistory).toMatchObject({ revision: 2, priceHistory: history(280_000).priceHistory });
      expect(second.payload.purchasePriceHistory.history).toHaveLength(1);
      expect(second.payload.purchasePriceHistory.history[0]).toMatchObject({ revision: 1, priceHistory: history(300_000).priceHistory });

      const wrongFingerprint = await request(2, { ...history(270_000), inputFingerprint: "other-fingerprint" });
      expect(wrongFingerprint.status).toBe(409);
      expect(wrongFingerprint.payload.code).toBe("PURCHASE_PRICE_HISTORY_BUILD_MISMATCH");

      const restoreResponse = await fetch(`${baseUrl}/api/builds/${buildId}/purchase-price-history/restore`, { method: "POST", headers: { "Content-Type": "application/json", "X-Share-Owner-Token": credential.token }, body: JSON.stringify({ expectedRevision: 2, revision: 1, rowKeys }) });
      const restored = await restoreResponse.json() as Record<string, any>;
      expect(restoreResponse.status).toBe(200);
      expect(restored.purchasePriceHistory).toMatchObject({ revision: 3, priceHistory: history(300_000).priceHistory });
      expect(restored.purchasePriceHistory.history.map((entry: { revision: number }) => entry.revision)).toEqual([2, 1]);

      const staleRestore = await fetch(`${baseUrl}/api/builds/${buildId}/purchase-price-history/restore`, { method: "POST", headers: { "Content-Type": "application/json", "X-Share-Owner-Token": credential.token }, body: JSON.stringify({ expectedRevision: 2, revision: 1, rowKeys }) });
      const staleRestorePayload = await staleRestore.json() as Record<string, any>;
      expect(staleRestore.status).toBe(409);
      expect(staleRestorePayload.code).toBe("PURCHASE_PRICE_HISTORY_CONFLICT");
      expect(staleRestorePayload.purchasePriceHistory).toMatchObject({ revision: 3 });

      const unavailableHistory = await fetch(`${baseUrl}/api/builds/${buildId}/purchase-price-history/restore`, { method: "POST", headers: { "Content-Type": "application/json", "X-Share-Owner-Token": credential.token }, body: JSON.stringify({ expectedRevision: 3, revision: 999, rowKeys }) });
      const unavailableHistoryPayload = await unavailableHistory.json() as Record<string, any>;
      expect(unavailableHistory.status).toBe(409);
      expect(unavailableHistoryPayload.code).toBe("PURCHASE_PRICE_HISTORY_HISTORY_UNAVAILABLE");
      expect(unavailableHistoryPayload.purchasePriceHistory).toMatchObject({ revision: 3 });

      const publicResponse = await fetch(`${baseUrl}/api/builds/${buildId}`);
      const publicBuild = await publicResponse.json() as Record<string, any>;
      expect(publicResponse.status).toBe(200);
      expect(publicBuild.purchasePriceHistory).toMatchObject({ revision: 3 });
      expect(publicBuild.purchasePriceHistory.history).toHaveLength(2);
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
