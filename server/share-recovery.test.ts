import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createShareOwnerCredential, createShareRecoveryCode } from "./build-share";

const selection = { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: true };

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function startIsolatedServer() {
  const [{ app }] = await Promise.all([import("./index")]);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("recovery test server did not expose a TCP port");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

describe("saved build share recovery", () => {
  const previousDataDirectory = process.env.PC_SUPPORTER_DATA_DIR;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousAdminPassword = process.env.ADMIN_PASSWORD;
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    vi.resetModules();
    if (previousDataDirectory === undefined) delete process.env.PC_SUPPORTER_DATA_DIR;
    else process.env.PC_SUPPORTER_DATA_DIR = previousDataDirectory;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previousAdminPassword;
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  async function seedBuild(id: string) {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-recovery-"));
    temporaryDirectories.push(directory);
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    process.env.DATABASE_URL = "";
    process.env.ADMIN_PASSWORD = "";
    const { BUILDS_PATH, writeJson } = await import("./storage");
    const ownerCredential = createShareOwnerCredential();
    const recoveryCredential = createShareRecoveryCode();
    await writeJson(BUILDS_PATH, [{
      id,
      name: "Recovery boundary build",
      selection,
      createdAt: "2026-09-09T00:00:00.000Z",
      updatedAt: "2026-09-09T00:00:00.000Z",
      ownerTokenHash: ownerCredential.hash,
      recoveryCodeHash: recoveryCredential.hash
    }]);
    return { ownerCredential, recoveryCredential };
  }

  it("issues a new owner token for a matching recovery code and retires the old token", async () => {
    const buildId = "recovery-flow-build";
    const { ownerCredential, recoveryCredential } = await seedBuild(buildId);
    const { server, baseUrl } = await startIsolatedServer();
    try {
      const recovered = await fetch(`${baseUrl}/api/builds/${buildId}/recover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recoveryCode: recoveryCredential.code })
      });
      expect(recovered.status).toBe(200);
      const { ownerToken, recoveryCode: rotatedCode } = await recovered.json() as { ownerToken: string; recoveryCode: string };
      expect(ownerToken).toBeTruthy();
      expect(ownerToken).not.toBe(ownerCredential.token);
      expect(rotatedCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      expect(rotatedCode).not.toBe(recoveryCredential.code);

      const withNewToken = await fetch(`${baseUrl}/api/builds/${buildId}/monitor`, { headers: { "X-Share-Owner-Token": ownerToken } });
      expect(withNewToken.status).toBe(200);

      const withOldToken = await fetch(`${baseUrl}/api/builds/${buildId}/monitor`, { headers: { "X-Share-Owner-Token": ownerCredential.token } });
      expect(withOldToken.status).toBe(401);

      // 사용된 복구 코드는 회전된다 — 같은 코드로 다시 소유권을 가져올 수 없다.
      const reused = await fetch(`${baseUrl}/api/builds/${buildId}/recover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recoveryCode: recoveryCredential.code })
      });
      expect(reused.status).toBe(401);

      const withRotated = await fetch(`${baseUrl}/api/builds/${buildId}/recover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recoveryCode: rotatedCode })
      });
      expect(withRotated.status).toBe(200);
    } finally {
      await closeServer(server);
    }
  }, 15_000);

  it("rejects wrong and malformed recovery codes", async () => {
    const buildId = "recovery-reject-build";
    await seedBuild(buildId);
    const { server, baseUrl } = await startIsolatedServer();
    try {
      const malformed = await fetch(`${baseUrl}/api/builds/${buildId}/recover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recoveryCode: "short" })
      });
      expect(malformed.status).toBe(400);
      expect(await malformed.json()).toMatchObject({ code: "RECOVERY_CODE_INVALID" });

      const wrong = await fetch(`${baseUrl}/api/builds/${buildId}/recover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recoveryCode: "AAAA-BBBB-CCCC" })
      });
      expect(wrong.status).toBe(401);
      expect(await wrong.json()).toMatchObject({ code: "RECOVERY_CODE_MISMATCH" });
    } finally {
      await closeServer(server);
    }
  }, 15_000);

  it("lets an owner issue a fresh recovery code which replaces the previous one", async () => {
    const buildId = "recovery-issue-build";
    const { ownerCredential, recoveryCredential } = await seedBuild(buildId);
    const { server, baseUrl } = await startIsolatedServer();
    try {
      const unauthorized = await fetch(`${baseUrl}/api/builds/${buildId}/recovery-code`, { method: "POST" });
      expect(unauthorized.status).toBe(401);

      const issued = await fetch(`${baseUrl}/api/builds/${buildId}/recovery-code`, {
        method: "POST",
        headers: { "X-Share-Owner-Token": ownerCredential.token }
      });
      expect(issued.status).toBe(201);
      const { recoveryCode } = await issued.json() as { recoveryCode: string };
      expect(recoveryCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      expect(recoveryCode).not.toBe(recoveryCredential.code);

      const oldCode = await fetch(`${baseUrl}/api/builds/${buildId}/recover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recoveryCode: recoveryCredential.code })
      });
      expect(oldCode.status).toBe(401);

      const newCode = await fetch(`${baseUrl}/api/builds/${buildId}/recover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recoveryCode })
      });
      expect(newCode.status).toBe(200);
    } finally {
      await closeServer(server);
    }
  }, 15_000);

  it("does not leak the recovery code hash through the public build read", async () => {
    const buildId = "recovery-leak-build";
    await seedBuild(buildId);
    const { server, baseUrl } = await startIsolatedServer();
    try {
      const publicRead = await fetch(`${baseUrl}/api/builds/${buildId}`);
      expect(publicRead.status).toBe(200);
      const body = await publicRead.json() as Record<string, unknown>;
      expect(body).not.toHaveProperty("recoveryCodeHash");
      expect(body).not.toHaveProperty("ownerTokenHash");
    } finally {
      await closeServer(server);
    }
  }, 15_000);
});
