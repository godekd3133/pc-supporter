import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const selection = { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: true };
const grantFailureOverride = { denyWrites: false };

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe("owner session API integration", () => {
  const previousDataDirectory = process.env.PC_SUPPORTER_DATA_DIR;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousAdminPassword = process.env.ADMIN_PASSWORD;
  const previousProcessRole = process.env.PC_SUPPORTER_PROCESS_ROLE;
  const temporaryDirectories: string[] = [];
  const servers: Server[] = [];

  afterEach(async () => {
    grantFailureOverride.denyWrites = false;
    vi.doUnmock("./repository");
    vi.resetModules();
    if (previousDataDirectory === undefined) delete process.env.PC_SUPPORTER_DATA_DIR;
    else process.env.PC_SUPPORTER_DATA_DIR = previousDataDirectory;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previousAdminPassword;
    if (previousProcessRole === undefined) delete process.env.PC_SUPPORTER_PROCESS_ROLE;
    else process.env.PC_SUPPORTER_PROCESS_ROLE = previousProcessRole;
    await Promise.all(servers.splice(0).map(closeServer));
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("keeps legacy create responses, hides session-mode tokens, migrates credentials, rotates grants, and logs out", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-owner-session-api-"));
    temporaryDirectories.push(directory);
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    process.env.DATABASE_URL = "";
    process.env.ADMIN_PASSWORD = "";
    process.env.PC_SUPPORTER_PROCESS_ROLE = "combined";
    const [{ app }, { BUILDS_PATH, readJson }] = await Promise.all([import("./index"), import("./storage")]);
    const server = app.listen(0, "127.0.0.1");
    servers.push(server);
    await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("owner session API test server did not expose a TCP port");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const originHeaders = { Origin: baseUrl };

    const createLegacy = async (name: string) => {
      const response = await fetch(`${baseUrl}/api/builds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, selection })
      });
      expect(response.status).toBe(201);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      return await response.json() as { id: string; ownerToken: string; recoveryCode: string };
    };
    const legacy = await createLegacy("legacy owner-token response");
    expect(legacy.ownerToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(legacy.recoveryCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    const watchlistCreate = await fetch(`${baseUrl}/api/watchlists`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...originHeaders },
      body: JSON.stringify({
        name: "개인 알림 테스트",
        entries: [{ itemId: "test-cpu", itemName: "테스트 CPU", category: "cpu", kind: "part", addedAt: new Date().toISOString(), targetPriceWon: 100_000 }],
        nearLowThresholdPercent: 10
      })
    });
    expect(watchlistCreate.status).toBe(201);
    expect(watchlistCreate.headers.get("cache-control")).toBe("private, no-store");
    const watchlist = await watchlistCreate.json() as { id: string; ownerToken: string };
    const watchlistAlerts = await fetch(`${baseUrl}/api/watchlists/${watchlist.id}/alerts`, {
      headers: { "X-Share-Owner-Token": watchlist.ownerToken }
    });
    expect(watchlistAlerts.status).toBe(200);
    expect(watchlistAlerts.headers.get("cache-control")).toBe("private, no-store");

    const rejectedBeforeWrite = await fetch(`${baseUrl}/api/builds`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://attacker.example", "X-PC-Owner-Mode": "session-v1" },
      body: JSON.stringify({ name: "untrusted origin should not save", selection })
    });
    expect(rejectedBeforeWrite.status).toBe(403);
    expect(await readJson<unknown[]>(BUILDS_PATH, [])).toHaveLength(1);

    const sessionCreate = await fetch(`${baseUrl}/api/builds`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...originHeaders, "X-PC-Owner-Mode": "session-v1" },
      body: JSON.stringify({ name: "session-managed build", selection })
    });
    expect(sessionCreate.status).toBe(201);
    expect(sessionCreate.headers.get("cache-control")).toBe("private, no-store");
    const sessionBuild = await sessionCreate.json() as { id: string; ownerManaged: boolean; recoveryCode: string; ownerToken?: string };
    const sessionCookie = sessionCreate.headers.get("set-cookie")?.split(";")[0];
    expect(sessionBuild).toMatchObject({ ownerManaged: true });
    expect(sessionBuild.recoveryCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(sessionBuild).not.toHaveProperty("ownerToken");
    expect(sessionCookie).toMatch(/^pc_supporter_owner_session=[A-Za-z0-9_-]{43}$/);
    expect(sessionCreate.headers.get("set-cookie")).toContain("HttpOnly");

    const sessionTwoCreate = await fetch(`${baseUrl}/api/builds`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...originHeaders, "X-PC-Owner-Mode": "session-v1" },
      body: JSON.stringify({ name: "second session build", selection })
    });
    expect(sessionTwoCreate.status).toBe(201);
    expect(sessionTwoCreate.headers.get("cache-control")).toBe("private, no-store");
    const sessionTwoCookie = sessionTwoCreate.headers.get("set-cookie")?.split(";")[0];
    expect(sessionTwoCookie).toBeTruthy();

    const migrate = await fetch(`${baseUrl}/api/owner-sessions/migrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...originHeaders, Cookie: sessionTwoCookie! },
      body: JSON.stringify({ items: [
        { resourceType: "build", resourceId: legacy.id, ownerToken: legacy.ownerToken },
        { resourceType: "build", resourceId: legacy.id, ownerToken: sessionBuild.recoveryCode }
      ] })
    });
    expect(migrate.status).toBe(200);
    expect(migrate.headers.get("cache-control")).toBe("no-store");
    const migrationBody = await migrate.json() as { migratedCount: number; rejectedCount: number; items: Array<{ status: string }> };
    expect(migrationBody).toMatchObject({ migratedCount: 1, rejectedCount: 1 });
    expect(migrationBody.items.map((item) => item.status)).toEqual(["migrated", "rejected"]);
    expect(JSON.stringify(migrationBody)).not.toContain(legacy.ownerToken);

    const sessionTwoOwnerRead = await fetch(`${baseUrl}/api/builds/${legacy.id}/monitor`, { headers: { Cookie: sessionTwoCookie! } });
    expect(sessionTwoOwnerRead.status).toBe(200);
    expect(sessionTwoOwnerRead.headers.get("cache-control")).toBe("private, no-store");
    const nonOwnerRead = await fetch(`${baseUrl}/api/builds/${legacy.id}/monitor`, { headers: { Cookie: sessionCookie! } });
    expect(nonOwnerRead.status).toBe(401);

    const deletable = await createLegacy("session-owned deletion target");
    const migrateDeletable = await fetch(`${baseUrl}/api/owner-sessions/migrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...originHeaders, Cookie: sessionTwoCookie! },
      body: JSON.stringify({ items: [{ resourceType: "build", resourceId: deletable.id, ownerToken: deletable.ownerToken }] })
    });
    expect((await migrateDeletable.json() as { migratedCount: number }).migratedCount).toBe(1);
    const resourceDelete = await fetch(`${baseUrl}/api/builds/${deletable.id}`, {
      method: "DELETE",
      headers: { ...originHeaders, Cookie: sessionTwoCookie! }
    });
    expect(resourceDelete.status).toBe(200);
    const afterResourceDelete = await fetch(`${baseUrl}/api/owner-sessions/resources`, { headers: { Cookie: sessionTwoCookie!, ...originHeaders } });
    expect((await afterResourceDelete.json() as { resources: Array<{ id: string; kind: string }> }).resources).not.toContainEqual({ id: deletable.id, kind: "build" });

    const untrustedMutation = await fetch(`${baseUrl}/api/builds/${legacy.id}/monitor`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: sessionTwoCookie!, Origin: "https://attacker.example" },
      body: JSON.stringify({ enabled: true })
    });
    expect(untrustedMutation.status).toBe(403);

    const recovered = await fetch(`${baseUrl}/api/builds/${legacy.id}/recover`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...originHeaders, Cookie: sessionCookie!, "X-PC-Owner-Mode": "session-v1" },
      body: JSON.stringify({ recoveryCode: legacy.recoveryCode })
    });
    expect(recovered.status).toBe(200);
    expect(recovered.headers.get("cache-control")).toBe("private, no-store");
    const recoveredBody = await recovered.json() as { ownerManaged: boolean; recoveryCode: string; ownerToken?: string };
    expect(recoveredBody.ownerManaged).toBe(true);
    expect(recoveredBody).not.toHaveProperty("ownerToken");
    expect(recoveredBody.recoveryCode).not.toBe(legacy.recoveryCode);

    const sessionOneAfterRecovery = await fetch(`${baseUrl}/api/builds/${legacy.id}/monitor`, { headers: { Cookie: sessionCookie! } });
    const staleSessionAfterRecovery = await fetch(`${baseUrl}/api/builds/${legacy.id}/monitor`, { headers: { Cookie: sessionTwoCookie! } });
    const staleLegacyTokenAfterRecovery = await fetch(`${baseUrl}/api/builds/${legacy.id}/monitor`, { headers: { "X-Share-Owner-Token": legacy.ownerToken } });
    expect(sessionOneAfterRecovery.status).toBe(200);
    expect(staleSessionAfterRecovery.status).toBe(401);
    expect(staleLegacyTokenAfterRecovery.status).toBe(401);

    const resources = await fetch(`${baseUrl}/api/owner-sessions/resources`, { headers: { Cookie: sessionCookie!, ...originHeaders } });
    expect(resources.status).toBe(200);
    expect(resources.headers.get("cache-control")).toBe("no-store");
    const resourceBody = await resources.json() as { resources: Array<{ id: string; kind: string }> };
    expect(resourceBody.resources).toContainEqual({ id: legacy.id, kind: "build" });
    expect(JSON.stringify(resourceBody)).not.toContain(legacy.ownerToken);

    const metadataHistory = await fetch(`${baseUrl}/api/builds/${sessionBuild.id}/metadata-history`, {
      headers: { Cookie: sessionCookie!, ...originHeaders }
    });
    expect(metadataHistory.status).toBe(200);
    expect(metadataHistory.headers.get("cache-control")).toBe("private, no-store");

    const issuedRecoveryCode = await fetch(`${baseUrl}/api/builds/${sessionBuild.id}/recovery-code`, {
      method: "POST",
      headers: { Cookie: sessionCookie!, ...originHeaders }
    });
    expect(issuedRecoveryCode.status).toBe(201);
    expect(issuedRecoveryCode.headers.get("cache-control")).toBe("private, no-store");

    const logout = await fetch(`${baseUrl}/api/owner-sessions`, { method: "DELETE", headers: { Cookie: sessionCookie!, ...originHeaders } });
    expect(logout.status).toBe(200);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await logout.json()).loggedOut).toBe(true);
    const afterLogout = await fetch(`${baseUrl}/api/builds/${sessionBuild.id}/monitor`, { headers: { Cookie: sessionCookie! } });
    expect(afterLogout.status).toBe(401);
  }, 20_000);

  it("preserves the prior cookie grant and credentials when recovery grant storage fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-owner-session-recovery-failure-"));
    temporaryDirectories.push(directory);
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    process.env.DATABASE_URL = "";
    process.env.ADMIN_PASSWORD = "";
    process.env.PC_SUPPORTER_PROCESS_ROLE = "combined";
    vi.doMock("./repository", async (importOriginal) => {
      const repository = await importOriginal<typeof import("./repository")>();
      return {
        ...repository,
        upsertOwnerShareSessionGrant: (...args: Parameters<typeof repository.upsertOwnerShareSessionGrant>) => grantFailureOverride.denyWrites
          ? Promise.resolve(false)
          : repository.upsertOwnerShareSessionGrant(...args)
      };
    });
    const [{ app }] = await Promise.all([import("./index")]);
    const server = app.listen(0, "127.0.0.1");
    servers.push(server);
    await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("owner session recovery test server did not expose a TCP port");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const originHeaders = { Origin: baseUrl };

    const create = await fetch(`${baseUrl}/api/builds`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "recovery rollback target", selection })
    });
    expect(create.status).toBe(201);
    const legacyBuild = await create.json() as { id: string; ownerToken: string; recoveryCode: string };

    const migration = await fetch(`${baseUrl}/api/owner-sessions/migrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...originHeaders },
      body: JSON.stringify({ items: [{ resourceType: "build", resourceId: legacyBuild.id, ownerToken: legacyBuild.ownerToken }] })
    });
    expect(migration.status).toBe(200);
    const cookie = migration.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toBeTruthy();
    expect((await migration.json() as { migratedCount: number }).migratedCount).toBe(1);

    grantFailureOverride.denyWrites = true;
    const failedRecovery = await fetch(`${baseUrl}/api/builds/${legacyBuild.id}/recover`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...originHeaders, Cookie: cookie!, "X-PC-Owner-Mode": "session-v1" },
      body: JSON.stringify({ recoveryCode: legacyBuild.recoveryCode })
    });
    expect(failedRecovery.status).toBe(503);
    expect(await failedRecovery.json()).toMatchObject({ code: "OWNER_SESSION_GRANT_FAILED" });
    grantFailureOverride.denyWrites = false;

    const oldSessionStillOwnsBuild = await fetch(`${baseUrl}/api/builds/${legacyBuild.id}/monitor`, { headers: { Cookie: cookie! } });
    const oldOwnerTokenStillWorks = await fetch(`${baseUrl}/api/builds/${legacyBuild.id}/monitor`, { headers: { "X-Share-Owner-Token": legacyBuild.ownerToken } });
    expect(oldSessionStillOwnsBuild.status).toBe(200);
    expect(oldOwnerTokenStillWorks.status).toBe(200);

    const retryWithRestoredCode = await fetch(`${baseUrl}/api/builds/${legacyBuild.id}/recover`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...originHeaders, Cookie: cookie!, "X-PC-Owner-Mode": "session-v1" },
      body: JSON.stringify({ recoveryCode: legacyBuild.recoveryCode })
    });
    expect(retryWithRestoredCode.status).toBe(200);
    const recovered = await retryWithRestoredCode.json() as { ownerManaged: boolean; ownerToken?: string };
    expect(recovered.ownerManaged).toBe(true);
    expect(recovered).not.toHaveProperty("ownerToken");
  }, 20_000);
});
