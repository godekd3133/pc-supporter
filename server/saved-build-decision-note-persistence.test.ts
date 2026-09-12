import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const selection = { cpu: { partId: "cpu-7500f", quantity: 1 }, memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: true };

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe("saved build decision note persistence API", () => {
  it("trims and persists a shareable note while rejecting invalid input", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-saved-build-decision-note-"));
    const previousDataDirectory = process.env.PC_SUPPORTER_DATA_DIR;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    process.env.DATABASE_URL = "";
    vi.resetModules();
    let server: Server | undefined;
    try {
      const { app } = await import("./index");
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve, reject) => { server?.once("listening", resolve); server?.once("error", reject); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("isolated test server did not expose a TCP port");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const createResponse = await fetch(`${baseUrl}/api/builds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "결정 메모 저장 테스트", selection, decisionNote: "  QHD 게이밍과 업그레이드 여유를 우선  " })
      });
      const created = await createResponse.json() as Record<string, any>;
      expect(createResponse.status).toBe(201);
      expect(created.decisionNote).toBe("QHD 게이밍과 업그레이드 여유를 우선");

      const unauthorizedUpdateResponse = await fetch(`${baseUrl}/api/builds/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisionNote: "권한 없는 변경" })
      });
      expect(unauthorizedUpdateResponse.status).toBe(401);

      const updateResponse = await fetch(`${baseUrl}/api/builds/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Share-Owner-Token": created.ownerToken },
        body: JSON.stringify({ name: "결정 메모 수정 테스트", decisionNote: "  소음과 업그레이드 여유를 다시 우선  " })
      });
      const updated = await updateResponse.json() as Record<string, any>;
      expect(updateResponse.status).toBe(200);
      expect(updated.name).toBe("결정 메모 수정 테스트");
      expect(updated.decisionNote).toBe("소음과 업그레이드 여유를 다시 우선");

      const unauthorizedHistoryResponse = await fetch(`${baseUrl}/api/builds/${created.id}/metadata-history`);
      expect(unauthorizedHistoryResponse.status).toBe(401);
      const historyResponse = await fetch(`${baseUrl}/api/builds/${created.id}/metadata-history`, { headers: { "X-Share-Owner-Token": created.ownerToken } });
      const history = await historyResponse.json() as Record<string, any>;
      expect(historyResponse.status).toBe(200);
      expect(history.total).toBe(1);
      expect(history.items[0]).toMatchObject({ changedFields: ["name", "decisionNote"], previousName: "결정 메모 저장 테스트", previousDecisionNote: "QHD 게이밍과 업그레이드 여유를 우선", nextName: "결정 메모 수정 테스트", nextDecisionNote: "소음과 업그레이드 여유를 다시 우선" });

      const publicResponse = await fetch(`${baseUrl}/api/builds/${created.id}`);
      const publicBuild = await publicResponse.json() as Record<string, any>;
      expect(publicResponse.status).toBe(200);
      expect(publicBuild.name).toBe("결정 메모 수정 테스트");
      expect(publicBuild.decisionNote).toBe("소음과 업그레이드 여유를 다시 우선");
      expect(publicBuild.ownerTokenHash).toBeUndefined();
      expect(publicBuild.metadataHistory).toBeUndefined();

      const clearResponse = await fetch(`${baseUrl}/api/builds/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Share-Owner-Token": created.ownerToken },
        body: JSON.stringify({ decisionNote: "" })
      });
      const cleared = await clearResponse.json() as Record<string, any>;
      expect(clearResponse.status).toBe(200);
      expect(cleared.decisionNote).toBeUndefined();
      const clearedHistoryResponse = await fetch(`${baseUrl}/api/builds/${created.id}/metadata-history`, { headers: { "X-Share-Owner-Token": created.ownerToken } });
      const clearedHistory = await clearedHistoryResponse.json() as Record<string, any>;
      expect(clearedHistoryResponse.status).toBe(200);
      expect(clearedHistory.total).toBe(2);
      expect(clearedHistory.items[0].nextDecisionNote).toBeUndefined();

      const invalidResponse = await fetch(`${baseUrl}/api/builds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selection, decisionNote: "x".repeat(501) })
      });
      const invalid = await invalidResponse.json() as Record<string, any>;
      expect(invalidResponse.status).toBe(400);
      expect(invalid.code).toBe("DECISION_NOTE_INVALID");
    } finally {
      if (server) await closeServer(server);
      if (previousDataDirectory === undefined) delete process.env.PC_SUPPORTER_DATA_DIR;
      else process.env.PC_SUPPORTER_DATA_DIR = previousDataDirectory;
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);
});
