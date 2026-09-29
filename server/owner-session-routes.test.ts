import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import express, { type Request, type RequestHandler, type Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createShareOwnerCredential, hashShareOwnerToken } from "./build-share";
import { OWNER_SESSION_COOKIE_NAME } from "./owner-session-cookie";
import {
  attachOwnerSessionGrant,
  createOwnerSessionRouter,
  OWNER_SESSION_MIGRATION_MAX_BODY_BYTES,
  OWNER_SESSION_MODE_HEADER,
  OWNER_SESSION_MODE_VALUE,
  ownerManagedShareResponse,
  ownerSessionGrantAllowsRequest,
  ownerSessionOrLegacyTokenOrAdminCanManage,
  ownerSessionUnsafeOriginAllowed,
  type OwnerSessionGrant,
  type OwnerSessionGrantReference,
  type OwnerSessionResource,
  type OwnerSessionResourceType,
  type OwnerSessionStoreApi
} from "./owner-session-routes";

const SESSION_TOKEN = "S".repeat(43);

class InMemoryOwnerSessionStore implements OwnerSessionStoreApi {
  sessions = new Map<string, { sessionHash: string; createdAt: string; expiresAt: string }>();
  grants = new Map<string, OwnerSessionGrant>();
  grantWritesEnabled = true;

  async createOwnerShareSession(session: { sessionHash: string; createdAt: string; expiresAt: string }) {
    this.sessions.set(session.sessionHash, session);
  }

  async ownerShareSessionIsActive(sessionHash: string, nowValue?: Date | string) {
    const session = this.sessions.get(sessionHash);
    const now = nowValue instanceof Date ? nowValue.getTime() : nowValue ? Date.parse(nowValue) : Date.now();
    return Boolean(session && Date.parse(session.expiresAt) > now);
  }

  async deleteOwnerShareSession(sessionHash: string) {
    const existed = this.sessions.delete(sessionHash);
    for (const [key, grant] of this.grants) if (grant.sessionHash === sessionHash) this.grants.delete(key);
    return existed;
  }

  async pruneExpiredOwnerShareSessions(_limit?: number, nowValue?: Date | string) {
    const now = nowValue instanceof Date ? nowValue.getTime() : nowValue ? Date.parse(nowValue) : Date.now();
    let deleted = 0;
    for (const [hash, session] of this.sessions) {
      if (Date.parse(session.expiresAt) <= now) {
        await this.deleteOwnerShareSession(hash);
        deleted += 1;
      }
    }
    for (const [key, grant] of this.grants) {
      if (grant.expiresAt && Date.parse(grant.expiresAt) <= now) this.grants.delete(key);
    }
    return deleted;
  }

  async pruneExpiredOwnerShareSessionGrants(_limit?: number, nowValue?: Date | string) {
    const now = nowValue instanceof Date ? nowValue.getTime() : nowValue ? Date.parse(nowValue) : Date.now();
    let deleted = 0;
    for (const [key, grant] of this.grants) {
      if (grant.expiresAt && Date.parse(grant.expiresAt) <= now) {
        this.grants.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }

  async upsertOwnerShareSessionGrant(grant: OwnerSessionGrant, nowValue?: Date | string) {
    if (!this.grantWritesEnabled || !await this.ownerShareSessionIsActive(grant.sessionHash, nowValue)) return false;
    this.grants.set(JSON.stringify([grant.sessionHash, grant.resourceType, grant.resourceId, grant.ownerTokenHash]), grant);
    return true;
  }

  async ownerShareSessionGrantMatches(query: {
    sessionHash: string;
    resourceType: OwnerSessionResourceType;
    resourceId: string;
    ownerTokenHash: string;
    now?: Date | string;
  }) {
    if (!await this.ownerShareSessionIsActive(query.sessionHash, query.now)) return false;
    const grant = this.grants.get(JSON.stringify([query.sessionHash, query.resourceType, query.resourceId, query.ownerTokenHash]));
    const now = query.now instanceof Date ? query.now.getTime() : query.now ? Date.parse(query.now) : Date.now();
    return Boolean(grant && (!grant.expiresAt || Date.parse(grant.expiresAt) > now));
  }

  async listOwnerShareSessionGrants(sessionHash: string, nowValue?: Date | string): Promise<OwnerSessionGrantReference[]> {
    const now = nowValue instanceof Date ? nowValue.getTime() : nowValue ? Date.parse(nowValue) : Date.now();
    if (!await this.ownerShareSessionIsActive(sessionHash, nowValue)) return [];
    return [...this.grants.values()]
      .filter((grant) => grant.sessionHash === sessionHash && (!grant.expiresAt || Date.parse(grant.expiresAt) > now))
      .map(({ resourceType, resourceId, ownerTokenHash }) => ({ resourceType, resourceId, ownerTokenHash }));
  }
}

function requestFor(options: {
  protocol?: string;
  secure?: boolean;
  host?: string;
  origin?: string;
  cookie?: string;
  ownerToken?: string;
  ownerMode?: string;
}) {
  const headers: Record<string, string | undefined> = {
    ...(options.origin ? { origin: options.origin } : {}),
    ...(options.cookie ? { cookie: options.cookie } : {}),
    ...(options.ownerToken ? { "x-share-owner-token": options.ownerToken } : {}),
    ...(options.ownerMode ? { [OWNER_SESSION_MODE_HEADER.toLowerCase()]: options.ownerMode } : {})
  };
  return {
    protocol: options.protocol ?? "https",
    secure: options.secure ?? true,
    method: "POST",
    headers,
    header(name: string) { return headers[name.toLowerCase()]; },
    get(name: string) { return name.toLowerCase() === "host" ? options.host ?? "api.example.com" : undefined; }
  } as unknown as Request;
}

const servers: Server[] = [];
async function startRouter(
  store: InMemoryOwnerSessionStore,
  resources: Map<OwnerSessionResourceType, OwnerSessionResource[]>,
  migrationRateLimit: RequestHandler = (_request, _response, next) => next()
) {
  const app = express();
  app.use(express.json());
  app.use("/api/owner-sessions", createOwnerSessionRouter({
    ...storeApi(store),
    migrationRateLimit,
    readResources: async (resourceType) => resources.get(resourceType) ?? []
  }));
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind a TCP port.");
  const origin = `http://127.0.0.1:${address.port}`;
  return { server, origin };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

function sessionRecord(store: InMemoryOwnerSessionStore, token = SESSION_TOKEN) {
  const sessionHash = createHash("sha256").update(token).digest("hex");
  store.sessions.set(sessionHash, {
    sessionHash,
    createdAt: new Date(Date.now() - 1_000).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  });
  return { token, sessionHash, cookie: `${OWNER_SESSION_COOKIE_NAME}=${token}` };
}

function storeApi(store: InMemoryOwnerSessionStore): OwnerSessionStoreApi {
  return {
    createOwnerShareSession: store.createOwnerShareSession.bind(store),
    ownerShareSessionIsActive: store.ownerShareSessionIsActive.bind(store),
    deleteOwnerShareSession: store.deleteOwnerShareSession.bind(store),
    pruneExpiredOwnerShareSessions: store.pruneExpiredOwnerShareSessions.bind(store),
    pruneExpiredOwnerShareSessionGrants: store.pruneExpiredOwnerShareSessionGrants.bind(store),
    upsertOwnerShareSessionGrant: store.upsertOwnerShareSessionGrant.bind(store),
    ownerShareSessionGrantMatches: store.ownerShareSessionGrantMatches.bind(store),
    listOwnerShareSessionGrants: store.listOwnerShareSessionGrants.bind(store)
  };
}

describe("owner session route security", () => {
  it("migrates owner credentials partially and idempotently without returning token or hash", async () => {
    const store = new InMemoryOwnerSessionStore();
    const owner = createShareOwnerCredential();
    const otherOwner = createShareOwnerCredential();
    const currentSession = sessionRecord(store);
    const resources = new Map<OwnerSessionResourceType, OwnerSessionResource[]>([
      ["build", [
        { id: "build-owned", ownerTokenHash: owner.hash, expiresAt: new Date(Date.now() + 60_000).toISOString() },
        { id: "build-other-owner", ownerTokenHash: otherOwner.hash }
      ]]
    ]);
    const target = await startRouter(store, resources);
    const body = {
      items: [
        { resourceType: "build", resourceId: "build-owned", ownerToken: owner.token },
        { resourceType: "build", resourceId: "build-other-owner", ownerToken: owner.token },
        { resourceType: "build", resourceId: "missing", ownerToken: owner.token },
        { resourceType: "build", resourceId: "build-owned", ownerToken: owner.token }
      ]
    };
    const headers = {
      Origin: target.origin,
      Cookie: currentSession.cookie,
      "Content-Type": "application/json"
    };
    const firstResponse = await fetch(`${target.origin}/api/owner-sessions/migrate`, { method: "POST", headers, body: JSON.stringify(body) });
    const first = await firstResponse.json() as { migratedCount: number; rejectedCount: number; items: Array<{ status: string; code?: string }> };
    expect(firstResponse.status).toBe(200);
    expect(firstResponse.headers.get("cache-control")).toBe("no-store");
    expect(first.migratedCount).toBe(2);
    expect(first.rejectedCount).toBe(2);
    expect(first.items[1]?.code).toBe("OWNER_TOKEN_MISMATCH");
    expect(store.grants.size).toBe(1);
    const firstText = JSON.stringify(first);
    expect(firstText).not.toContain(owner.token);
    expect(firstText).not.toContain(owner.hash);

    const secondResponse = await fetch(`${target.origin}/api/owner-sessions/migrate`, { method: "POST", headers, body: JSON.stringify(body) });
    const second = await secondResponse.json() as { migratedCount: number; rejectedCount: number };
    expect(secondResponse.status).toBe(200);
    expect(second.migratedCount).toBe(2);
    expect(second.rejectedCount).toBe(2);
    expect(store.grants.size).toBe(1);
  });

  it("bootstraps a missing session from a valid migration and does not pin mutable watchlist expiry", async () => {
    const store = new InMemoryOwnerSessionStore();
    const owner = createShareOwnerCredential();
    const resources = new Map<OwnerSessionResourceType, OwnerSessionResource[]>([["watchlist", [{
      id: "renewable-watchlist",
      ownerTokenHash: owner.hash,
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    }]]]);
    const target = await startRouter(store, resources);
    const migrated = await fetch(`${target.origin}/api/owner-sessions/migrate`, {
      method: "POST",
      headers: { Origin: target.origin, "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ resourceType: "watchlist", resourceId: "renewable-watchlist", ownerToken: owner.token }] })
    });
    const migrationBody = await migrated.json() as { migratedCount: number; rejectedCount: number };
    const cookie = migrated.headers.get("set-cookie")?.split(";")[0];
    expect(migrated.status).toBe(200);
    expect(migrationBody).toEqual({ migratedCount: 1, rejectedCount: 0, items: [{ index: 0, status: "migrated" }] });
    expect(cookie).toMatch(/^pc_supporter_owner_session=[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(migrationBody)).not.toContain(owner.token);
    expect(JSON.stringify(migrationBody)).not.toContain(owner.hash);
    expect(store.sessions.size).toBe(1);
    expect([...store.grants.values()][0]?.expiresAt).toBeUndefined();

    resources.set("watchlist", [{ id: "renewable-watchlist", ownerTokenHash: owner.hash, expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString() }]);
    const listed = await fetch(`${target.origin}/api/owner-sessions/resources`, { headers: { Origin: target.origin, Cookie: cookie! } });
    expect(listed.status).toBe(200);
    expect(listed.headers.get("cache-control")).toBe("no-store");
    expect(await listed.json()).toEqual({ resources: [{ id: "renewable-watchlist", kind: "watchlist" }] });
  });

  it("does not leave a cookie-less bootstrap session when every supplied owner token is invalid", async () => {
    const store = new InMemoryOwnerSessionStore();
    const owner = createShareOwnerCredential();
    const resources = new Map<OwnerSessionResourceType, OwnerSessionResource[]>([["build", [{ id: "owner-build", ownerTokenHash: owner.hash }]]]);
    const target = await startRouter(store, resources);
    const rejected = await fetch(`${target.origin}/api/owner-sessions/migrate`, {
      method: "POST",
      headers: { Origin: target.origin, "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ resourceType: "build", resourceId: "owner-build", ownerToken: createShareOwnerCredential().token }] })
    });
    expect(rejected.status).toBe(200);
    expect(await rejected.json()).toMatchObject({ migratedCount: 0, rejectedCount: 1 });
    expect(rejected.headers.get("set-cookie")).toBeNull();
    expect(store.sessions.size).toBe(0);
    expect(store.grants.size).toBe(0);
  });

  it("rejects oversized, untrusted-origin, and duplicate-cookie migrations before grants change", async () => {
    const store = new InMemoryOwnerSessionStore();
    const currentSession = sessionRecord(store);
    const owner = createShareOwnerCredential();
    const resources = new Map<OwnerSessionResourceType, OwnerSessionResource[]>([["build", [{ id: "b", ownerTokenHash: owner.hash }]]]);
    const target = await startRouter(store, resources);
    const item = { resourceType: "build", resourceId: "b", ownerToken: owner.token };

    const untrusted = await fetch(`${target.origin}/api/owner-sessions/migrate`, {
      method: "POST",
      headers: { Origin: "https://attacker.example", Cookie: currentSession.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ items: [item] })
    });
    expect(untrusted.status).toBe(403);
    expect(store.grants.size).toBe(0);

    const duplicate = await fetch(`${target.origin}/api/owner-sessions/migrate`, {
      method: "POST",
      headers: { Origin: target.origin, Cookie: `${currentSession.cookie}; ${currentSession.cookie}`, "Content-Type": "application/json" },
      body: JSON.stringify({ items: [item] })
    });
    expect(duplicate.status).toBe(400);
    expect(store.grants.size).toBe(0);

    const tooMany = await fetch(`${target.origin}/api/owner-sessions/migrate`, {
      method: "POST",
      headers: { Origin: target.origin, Cookie: currentSession.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ items: Array.from({ length: 201 }, () => item) })
    });
    expect(tooMany.status).toBe(400);
    expect(store.grants.size).toBe(0);
  });

  it("runs the migration limiter first and avoids storage work for invalid, oversized, and empty batches", async () => {
    const store = new InMemoryOwnerSessionStore();
    const owner = createShareOwnerCredential();
    const resources = new Map<OwnerSessionResourceType, OwnerSessionResource[]>([["build", [{ id: "b", ownerTokenHash: owner.hash }]]]);
    const order: string[] = [];
    const migrationRateLimit: RequestHandler = (_request, _response, next) => {
      order.push("rate-limit");
      next();
    };
    const pruneSessions = vi.spyOn(store, "pruneExpiredOwnerShareSessions").mockImplementation(async () => {
      order.push("prune-sessions");
      return 0;
    });
    const pruneGrants = vi.spyOn(store, "pruneExpiredOwnerShareSessionGrants").mockImplementation(async () => {
      order.push("prune-grants");
      return 0;
    });
    const target = await startRouter(store, resources, migrationRateLimit);
    const headers = { Origin: target.origin, "Content-Type": "application/json" };
    const post = (body: unknown) => fetch(`${target.origin}/api/owner-sessions/migrate`, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });

    const invalid = await post({ items: "not-an-array" });
    expect(invalid.status).toBe(400);
    const empty = await post({ items: [] });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ migratedCount: 0, rejectedCount: 0, items: [] });
    const tooMany = await post({ items: Array.from({ length: 201 }, () => ({ resourceType: "build", resourceId: "b", ownerToken: owner.token })) });
    expect(tooMany.status).toBe(400);
    const tooLarge = await post({ items: [{ note: "x".repeat(OWNER_SESSION_MIGRATION_MAX_BODY_BYTES) }] });
    expect(tooLarge.status).toBe(413);
    expect(order).toEqual(["rate-limit", "rate-limit", "rate-limit", "rate-limit"]);
    expect(pruneSessions).not.toHaveBeenCalled();
    expect(pruneGrants).not.toHaveBeenCalled();

    const valid = await post({ items: [{ resourceType: "build", resourceId: "b", ownerToken: owner.token }] });
    expect(valid.status).toBe(200);
    expect(order.slice(-3)).toEqual(["rate-limit", "prune-sessions", "prune-grants"]);
    expect(pruneSessions).toHaveBeenCalledTimes(1);
    expect(pruneGrants).toHaveBeenCalledTimes(1);
  });

  it("lists only existing, active resources whose current owner hash still matches", async () => {
    const store = new InMemoryOwnerSessionStore();
    const currentSession = sessionRecord(store);
    const currentOwner = createShareOwnerCredential();
    const staleOwner = createShareOwnerCredential();
    const expiredAt = new Date(Date.now() - 1_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    const resources = new Map<OwnerSessionResourceType, OwnerSessionResource[]>([
      ["build", [
        { id: "current", ownerTokenHash: currentOwner.hash, expiresAt: future },
        { id: "rotated", ownerTokenHash: currentOwner.hash, expiresAt: future },
        { id: "expired", ownerTokenHash: currentOwner.hash, expiresAt: expiredAt }
      ]]
    ]);
    await store.upsertOwnerShareSessionGrant({ sessionHash: currentSession.sessionHash, resourceType: "build", resourceId: "current", ownerTokenHash: currentOwner.hash, createdAt: new Date().toISOString(), expiresAt: future });
    await store.upsertOwnerShareSessionGrant({ sessionHash: currentSession.sessionHash, resourceType: "build", resourceId: "rotated", ownerTokenHash: staleOwner.hash, createdAt: new Date().toISOString(), expiresAt: future });
    await store.upsertOwnerShareSessionGrant({ sessionHash: currentSession.sessionHash, resourceType: "build", resourceId: "expired", ownerTokenHash: currentOwner.hash, createdAt: new Date().toISOString(), expiresAt: future });
    await store.upsertOwnerShareSessionGrant({ sessionHash: currentSession.sessionHash, resourceType: "build", resourceId: "deleted", ownerTokenHash: currentOwner.hash, createdAt: new Date().toISOString(), expiresAt: future });
    const target = await startRouter(store, resources);
    const response = await fetch(`${target.origin}/api/owner-sessions/resources`, {
      headers: { Origin: target.origin, Cookie: currentSession.cookie }
    });
    const payload = await response.json() as { resources: Array<Record<string, unknown>> };
    expect(response.status).toBe(200);
    expect(payload.resources).toEqual([{ id: "current", kind: "build" }]);
    expect(JSON.stringify(payload)).not.toContain(currentOwner.hash);
    expect(JSON.stringify(payload)).not.toContain(staleOwner.hash);
    expect(Object.keys(payload.resources[0] ?? {}).sort()).toEqual(["id", "kind"]);
  });

  it("revokes the session and grants and clears its cookie only for an allowed origin", async () => {
    const store = new InMemoryOwnerSessionStore();
    const currentSession = sessionRecord(store);
    const owner = createShareOwnerCredential();
    await store.upsertOwnerShareSessionGrant({ sessionHash: currentSession.sessionHash, resourceType: "build", resourceId: "b", ownerTokenHash: owner.hash, createdAt: new Date().toISOString() });
    const target = await startRouter(store, new Map());

    const rejected = await fetch(`${target.origin}/api/owner-sessions`, {
      method: "DELETE",
      headers: { Origin: "https://attacker.example", Cookie: currentSession.cookie }
    });
    expect(rejected.status).toBe(403);
    expect(rejected.headers.get("set-cookie")).toBeNull();
    expect(store.sessions.has(currentSession.sessionHash)).toBe(true);
    expect(store.grants.size).toBe(1);

    const response = await fetch(`${target.origin}/api/owner-sessions`, {
      method: "DELETE",
      headers: { Origin: target.origin, Cookie: currentSession.cookie }
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ loggedOut: true });
    expect(response.headers.get("set-cookie")).toContain(`${OWNER_SESSION_COOKIE_NAME}=;`);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(store.sessions.has(currentSession.sessionHash)).toBe(false);
    expect(store.grants.size).toBe(0);
  });
});

describe("owner session authentication and share response contract", () => {
  it("keeps session, legacy owner token, and enabled-admin authorization separate", async () => {
    const store = new InMemoryOwnerSessionStore();
    const currentSession = sessionRecord(store);
    const owner = createShareOwnerCredential();
    const resource = { id: "build-1", ownerTokenHash: owner.hash };
    await store.upsertOwnerShareSessionGrant({ sessionHash: currentSession.sessionHash, resourceType: "build", resourceId: resource.id, ownerTokenHash: owner.hash, createdAt: new Date().toISOString() });
    const sessionRequest = requestFor({ cookie: currentSession.cookie, ownerToken: owner.token, ownerMode: OWNER_SESSION_MODE_VALUE });
    const nonOwnerSession = sessionRecord(store, "N".repeat(43));
    const nonOwnerRequest = requestFor({ cookie: nonOwnerSession.cookie, ownerToken: owner.token, ownerMode: OWNER_SESSION_MODE_VALUE });
    const legacyRequest = requestFor({ ownerToken: owner.token });
    const headerlessLegacyWithCookie = requestFor({ cookie: nonOwnerSession.cookie, ownerToken: owner.token });

    expect(await ownerSessionOrLegacyTokenOrAdminCanManage(sessionRequest, "build", resource, owner.token, true, false, store)).toBe(true);
    expect(await ownerSessionGrantAllowsRequest(nonOwnerRequest, "build", resource, store)).toBe(false);
    expect(await ownerSessionOrLegacyTokenOrAdminCanManage(nonOwnerRequest, "build", resource, undefined, true, false, store)).toBe(false);
    expect(await ownerSessionOrLegacyTokenOrAdminCanManage(legacyRequest, "build", resource, owner.token, true, false, store)).toBe(true);
    expect(await ownerSessionOrLegacyTokenOrAdminCanManage(headerlessLegacyWithCookie, "build", resource, owner.token, true, false, store)).toBe(true);
    expect(await ownerSessionOrLegacyTokenOrAdminCanManage(legacyRequest, "build", resource, undefined, true, true, store)).toBe(true);
    expect(await ownerSessionOrLegacyTokenOrAdminCanManage(legacyRequest, "build", resource, undefined, false, true, store)).toBe(false);

    const rotatedResource = { ...resource, ownerTokenHash: hashShareOwnerToken(createShareOwnerCredential().token) };
    expect(await ownerSessionGrantAllowsRequest(sessionRequest, "build", rotatedResource, store)).toBe(false);
  });

  it("issues owner-managed create responses without a token and preserves legacy token payloads", async () => {
    const store = new InMemoryOwnerSessionStore();
    const token = createShareOwnerCredential().token;
    const request = requestFor({ origin: "https://api.example.com", ownerMode: OWNER_SESSION_MODE_VALUE });
    const response = { append: vi.fn() } as unknown as Response;
    const resource: OwnerSessionResource = { id: "new-build", ownerTokenHash: hashShareOwnerToken(token), expiresAt: new Date(Date.now() + 60_000).toISOString() };
    const ownerManaged = await attachOwnerSessionGrant(request, response, "build", resource, store);
    expect(ownerManaged).toBe(true);
    expect(response.append).toHaveBeenCalledWith("Set-Cookie", expect.stringContaining("HttpOnly"));
    const sessionPayload = ownerManagedShareResponse({ id: resource.id, recoveryCode: "ABCD-EFGH-JKLM" }, token, ownerManaged === true);
    expect(sessionPayload).toEqual({ id: resource.id, recoveryCode: "ABCD-EFGH-JKLM", ownerManaged: true });
    expect(sessionPayload).not.toHaveProperty("ownerToken");

    const legacyPayload = ownerManagedShareResponse({ id: resource.id }, token, false);
    expect(legacyPayload).toEqual({ id: resource.id, ownerToken: token });
    expect(legacyPayload).not.toHaveProperty("ownerManaged");
  });

  it("rolls back a persisted share if its session grant cannot be stored", async () => {
    const store = new InMemoryOwnerSessionStore();
    store.grantWritesEnabled = false;
    const request = requestFor({ origin: "https://api.example.com", ownerMode: OWNER_SESSION_MODE_VALUE });
    const response = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      append: vi.fn()
    } as unknown as Response;
    const rollback = vi.fn(async () => undefined);
    const result = await attachOwnerSessionGrant(request, response, "build", { id: "new-build", ownerTokenHash: createShareOwnerCredential().hash }, store, rollback);
    expect(result).toBeUndefined();
    expect(rollback).toHaveBeenCalledOnce();
    expect(store.sessions.size).toBe(0);
    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.append).not.toHaveBeenCalled();
  });

  it("rejects cross-site session mutations while leaving legacy header requests outside the cookie gate", () => {
    expect(ownerSessionUnsafeOriginAllowed(requestFor({ ownerMode: OWNER_SESSION_MODE_VALUE, origin: "https://attacker.example" }))).toBe(false);
    expect(ownerSessionUnsafeOriginAllowed(requestFor({ cookie: `${OWNER_SESSION_COOKIE_NAME}=${SESSION_TOKEN}; ${OWNER_SESSION_COOKIE_NAME}=${SESSION_TOKEN}`, origin: "https://api.example.com" }))).toBe(false);
    expect(ownerSessionUnsafeOriginAllowed(requestFor({ ownerToken: "legacy-token", origin: "https://attacker.example" }))).toBe(true);
  });
});
