import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OwnerSessionResourceType } from "../shared/owner-session-contract";

const fakeDatabase = vi.hoisted(() => ({
  sessions: new Map<string, { session_hash: string; created_at: string; expires_at: string }>(),
  grants: new Map<string, { session_hash: string; resource_type: string; resource_id: string; owner_token_hash: string; created_at: string; expires_at: string | null }>(),
  queries: [] as Array<{ sql: string; values?: unknown[] }>,
  clientQueries: [] as Array<{ sql: string; values?: unknown[] }>,
  failOwnerSessionOperations: false
}));

vi.mock("pg", () => ({
  Pool: class {
    async query(sql: string, values?: unknown[]) {
      fakeDatabase.queries.push({ sql, values });
      if (sql.includes("CREATE TABLE IF NOT EXISTS catalog_parts")) return { rows: [], rowCount: 0 };
      if (fakeDatabase.failOwnerSessionOperations && /owner_sessions|owner_session_grants/.test(sql)) throw new Error("synthetic owner-session database outage");

      if (sql.startsWith("INSERT INTO owner_sessions")) {
        const [sessionHash, createdAt, expiresAt] = values ?? [];
        const hasPendingGrant = [...fakeDatabase.grants.values()].some((grant) => grant.session_hash === sessionHash);
        if (fakeDatabase.sessions.has(String(sessionHash)) || hasPendingGrant) return { rows: [], rowCount: 0 };
        const session = { session_hash: String(sessionHash), created_at: String(createdAt), expires_at: String(expiresAt) };
        fakeDatabase.sessions.set(String(sessionHash), session);
        return { rows: [{ session_hash: session.session_hash }], rowCount: 1 };
      }

      if (sql.startsWith("SELECT 1 AS active FROM owner_sessions")) {
        const [sessionHash, now] = values ?? [];
        const session = fakeDatabase.sessions.get(String(sessionHash));
        const active = Boolean(session && Date.parse(session.expires_at) > Date.parse(String(now)));
        return { rows: active ? [{ active: 1 }] : [], rowCount: active ? 1 : 0 };
      }

      if (sql.includes("WITH expired_sessions AS (")) {
        const [limit, now] = values ?? [];
        const expired = [...fakeDatabase.sessions.entries()]
          .filter(([, session]) => Date.parse(session.expires_at) <= Date.parse(String(now)))
          .sort((left, right) => Date.parse(left[1].expires_at) - Date.parse(right[1].expires_at) || left[0].localeCompare(right[0]))
          .slice(0, Number(limit));
        for (const [key] of expired) {
          fakeDatabase.sessions.delete(key);
          for (const [grantKey, grant] of fakeDatabase.grants) if (grant.session_hash === key) fakeDatabase.grants.delete(grantKey);
        }
        return { rows: expired.map(([, session]) => ({ session_hash: session.session_hash })), rowCount: expired.length };
      }

      if (sql.startsWith("INSERT INTO owner_session_grants")) {
        const [sessionHash, resourceType, resourceId, ownerTokenHash, createdAt, expiresAt, now] = values ?? [];
        const session = fakeDatabase.sessions.get(String(sessionHash));
        if (!session || Date.parse(session.expires_at) <= Date.parse(String(now))) return { rows: [], rowCount: 0 };
        const key = JSON.stringify([sessionHash, resourceType, resourceId, ownerTokenHash]);
        const existing = fakeDatabase.grants.get(key);
        fakeDatabase.grants.set(key, {
          session_hash: String(sessionHash),
          resource_type: String(resourceType),
          resource_id: String(resourceId),
          owner_token_hash: String(ownerTokenHash),
          created_at: existing?.created_at ?? String(createdAt),
          expires_at: expiresAt === null ? existing?.expires_at ?? null : String(expiresAt)
        });
        return { rows: [{ session_hash: String(sessionHash) }], rowCount: 1 };
      }

      if (sql.startsWith("SELECT 1 AS present")) {
        const [sessionHash, resourceType, resourceId, ownerTokenHash, now] = values ?? [];
        const session = fakeDatabase.sessions.get(String(sessionHash));
        const grant = fakeDatabase.grants.get(JSON.stringify([sessionHash, resourceType, resourceId, ownerTokenHash]));
        const matches = Boolean(session && Date.parse(session.expires_at) > Date.parse(String(now)) && grant && (grant.expires_at === null || Date.parse(grant.expires_at) > Date.parse(String(now))));
        return { rows: matches ? [{ present: 1 }] : [], rowCount: matches ? 1 : 0 };
      }

      if (sql.startsWith("SELECT grants.resource_type, grants.resource_id, grants.owner_token_hash")) {
        const [sessionHash, now] = values ?? [];
        const session = fakeDatabase.sessions.get(String(sessionHash));
        const rows = [...fakeDatabase.grants.values()]
          .filter((grant) => session && Date.parse(session.expires_at) > Date.parse(String(now)) && grant.session_hash === sessionHash && (grant.expires_at === null || Date.parse(grant.expires_at) > Date.parse(String(now))))
          .map(({ resource_type, resource_id, owner_token_hash }) => ({ resource_type, resource_id, owner_token_hash }))
          .sort((left, right) => left.resource_type.localeCompare(right.resource_type) || left.resource_id.localeCompare(right.resource_id) || left.owner_token_hash.localeCompare(right.owner_token_hash));
        return { rows, rowCount: rows.length };
      }

      if (sql.startsWith("DELETE FROM owner_session_grants WHERE resource_type")) {
        const [resourceType, resourceId] = values ?? [];
        let rowCount = 0;
        for (const [key, grant] of fakeDatabase.grants) {
          if (grant.resource_type === resourceType && grant.resource_id === resourceId) {
            fakeDatabase.grants.delete(key);
            rowCount += 1;
          }
        }
        return { rows: [], rowCount };
      }

      if (sql.startsWith("DELETE FROM owner_session_grants WHERE session_hash")) {
        const [sessionHash] = values ?? [];
        let rowCount = 0;
        for (const [key, grant] of fakeDatabase.grants) {
          if (grant.session_hash === sessionHash) {
            fakeDatabase.grants.delete(key);
            rowCount += 1;
          }
        }
        return { rows: [], rowCount };
      }

      if (sql.includes("WITH expired AS (")) {
        const [limit, now] = values ?? [];
        const expired = [...fakeDatabase.grants.entries()]
          .filter(([, grant]) => grant.expires_at !== null && Date.parse(grant.expires_at) <= Date.parse(String(now)))
          .sort((left, right) => Date.parse(left[1].expires_at!) - Date.parse(right[1].expires_at!) || left[1].resource_id.localeCompare(right[1].resource_id))
          .slice(0, Number(limit));
        expired.forEach(([key]) => fakeDatabase.grants.delete(key));
        return { rows: expired.map(([, grant]) => ({ session_hash: grant.session_hash })), rowCount: expired.length };
      }

      throw new Error(`Unexpected fake PostgreSQL query: ${sql.slice(0, 140)}`);
    }

    async connect() {
      return {
        query: async (sql: string, values?: unknown[]) => {
          fakeDatabase.clientQueries.push({ sql, values });
          if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK"
            || sql.includes("pg_advisory_xact_lock")
            || sql.includes("CREATE TABLE IF NOT EXISTS catalog_parts")) {
            return { rows: [], rowCount: 0 };
          }
          if (fakeDatabase.failOwnerSessionOperations && /owner_sessions|owner_session_grants/.test(sql)) throw new Error("synthetic owner-session database outage");
          if (sql.startsWith("DELETE FROM owner_sessions WHERE session_hash")) {
            const [sessionHash] = values ?? [];
            const session = fakeDatabase.sessions.get(String(sessionHash));
            fakeDatabase.sessions.delete(String(sessionHash));
            if (session) for (const [key, grant] of fakeDatabase.grants) if (grant.session_hash === session.session_hash) fakeDatabase.grants.delete(key);
            return { rows: session ? [{ session_hash: session.session_hash }] : [], rowCount: session ? 1 : 0 };
          }
          if (sql.startsWith("DELETE FROM owner_session_grants WHERE session_hash")) {
            const [sessionHash] = values ?? [];
            let rowCount = 0;
            for (const [key, grant] of fakeDatabase.grants) {
              if (grant.session_hash === sessionHash) {
                fakeDatabase.grants.delete(key);
                rowCount += 1;
              }
            }
            return { rows: [], rowCount };
          }
          throw new Error(`Unexpected fake PostgreSQL client query: ${sql.slice(0, 140)}`);
        },
        release: () => undefined
      };
    }
  }
}));

const sessionHash = "a".repeat(64);
const secondSessionHash = "c".repeat(64);
const ownerTokenHash = "b".repeat(64);
const secondOwnerTokenHash = "d".repeat(64);
const createdAt = "2026-09-29T10:00:00.000Z";
const farFuture = "2099-01-01T00:00:00.000Z";

type TestGrant = {
  sessionHash: string;
  resourceType: OwnerSessionResourceType;
  resourceId: string;
  ownerTokenHash: string;
  createdAt: string;
  expiresAt?: string;
};

function grant(overrides: Partial<{
  sessionHash: TestGrant["sessionHash"];
  resourceType: TestGrant["resourceType"];
  resourceId: TestGrant["resourceId"];
  ownerTokenHash: TestGrant["ownerTokenHash"];
  createdAt: TestGrant["createdAt"];
  expiresAt: string;
}> = {}): TestGrant {
  return {
    sessionHash,
    resourceType: "build" as const,
    resourceId: "build-1",
    ownerTokenHash,
    createdAt,
    ...overrides
  };
}

describe("HttpOnly owner-session grant persistence foundation", () => {
  const environmentKeys = ["DATABASE_URL", "PC_SUPPORTER_DATA_DIR", "NODE_ENV"] as const;
  const previousEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]])) as Record<(typeof environmentKeys)[number], string | undefined>;
  let dataDirectory = "";

  beforeEach(async () => {
    vi.resetModules();
    fakeDatabase.sessions.clear();
    fakeDatabase.grants.clear();
    fakeDatabase.queries = [];
    fakeDatabase.clientQueries = [];
    fakeDatabase.failOwnerSessionOperations = false;
    dataDirectory = await mkdtemp(join(tmpdir(), "pc-supporter-owner-session-test-"));
    process.env.DATABASE_URL = "";
    process.env.PC_SUPPORTER_DATA_DIR = dataDirectory;
    process.env.NODE_ENV = "test";
  });

  afterEach(async () => {
    for (const key of environmentKeys) {
      const value = previousEnvironment[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.resetModules();
    await rm(dataDirectory, { recursive: true, force: true });
  });

  async function loadRepository(databaseUrl?: string) {
    process.env.DATABASE_URL = databaseUrl ?? "";
    vi.resetModules();
    return import("./repository");
  }

  async function createSession(repository: Awaited<ReturnType<typeof loadRepository>>, hash = sessionHash, expiresAt = farFuture) {
    await repository.createOwnerShareSession({ sessionHash: hash, createdAt, expiresAt });
  }

  it("serializes file upserts and lists only unexpired IDs, types, and owner-token hashes", async () => {
    const repository = await loadRepository();
    const now = "2026-09-29T12:00:00.000Z";
    const first = grant({ expiresAt: "2026-09-29T12:30:00.000Z" });
    const expired = grant({ resourceId: "expired-build", ownerTokenHash: secondOwnerTokenHash, expiresAt: "2026-09-29T11:59:59.000Z" });
    const permanent = grant({ resourceType: "watchlist", resourceId: "watch-1", ownerTokenHash: secondOwnerTokenHash });

    await createSession(repository, sessionHash, farFuture);
    await Promise.all([
      expect(repository.upsertOwnerShareSessionGrant(first, now)).resolves.toBe(true),
      expect(repository.upsertOwnerShareSessionGrant(expired, now)).resolves.toBe(true),
      expect(repository.upsertOwnerShareSessionGrant(permanent, now)).resolves.toBe(true)
    ]);
    const renewed = { ...first, createdAt: "2026-09-29T11:00:00.000Z", expiresAt: "2026-09-29T13:00:00.000Z" };
    await expect(repository.upsertOwnerShareSessionGrant(renewed, now)).resolves.toBe(true);
    const unboundedRenewal = grant({ createdAt: "2026-09-29T11:30:00.000Z" });
    await expect(repository.upsertOwnerShareSessionGrant(unboundedRenewal, now)).resolves.toBe(true);

    await expect(repository.ownerShareSessionGrantMatches({ sessionHash, resourceType: "build", resourceId: "build-1", ownerTokenHash, now })).resolves.toBe(true);
    await expect(repository.ownerShareSessionGrantMatches({ sessionHash: secondSessionHash, resourceType: "build", resourceId: "build-1", ownerTokenHash, now })).resolves.toBe(false);
    await expect(repository.ownerShareSessionGrantMatches({ sessionHash, resourceType: "watchlist", resourceId: "build-1", ownerTokenHash, now })).resolves.toBe(false);
    await expect(repository.ownerShareSessionGrantMatches({ sessionHash, resourceType: "build", resourceId: "missing", ownerTokenHash, now })).resolves.toBe(false);
    await expect(repository.ownerShareSessionGrantMatches({ sessionHash, resourceType: "build", resourceId: "build-1", ownerTokenHash: secondOwnerTokenHash, now })).resolves.toBe(false);
    await expect(repository.ownerShareSessionGrantMatches({ sessionHash, resourceType: "build", resourceId: "expired-build", ownerTokenHash: secondOwnerTokenHash, now })).resolves.toBe(false);
    await expect(repository.ownerShareSessionGrantMatches({ sessionHash, resourceType: "watchlist", resourceId: "watch-1", ownerTokenHash: secondOwnerTokenHash, now: "2050-01-01T00:00:00.000Z" })).resolves.toBe(true);
    await expect(repository.listOwnerShareSessionGrants(sessionHash, now)).resolves.toEqual([
      { resourceType: "build", resourceId: "build-1", ownerTokenHash },
      { resourceType: "watchlist", resourceId: "watch-1", ownerTokenHash: secondOwnerTokenHash }
    ]);

    const stored = JSON.parse(await readFile(join(dataDirectory, "owner-session-grants.json"), "utf8")) as { grants: Array<Record<string, unknown>> };
    expect(stored.grants).toHaveLength(3);
    expect(stored.grants.find((entry) => entry.resourceId === "build-1")).toMatchObject({ createdAt, expiresAt: renewed.expiresAt });
    expect(stored.grants.find((entry) => entry.resourceId === "watch-1")).not.toHaveProperty("expiresAt");
    expect(stored.grants.every((entry) => !("ownerToken" in entry))).toBe(true);
  });

  it("deletes all grants for a revoked resource or a closed session", async () => {
    const repository = await loadRepository();
    await createSession(repository, sessionHash);
    await createSession(repository, secondSessionHash);
    await Promise.all([
      repository.upsertOwnerShareSessionGrant(grant()),
      repository.upsertOwnerShareSessionGrant(grant({ sessionHash: secondSessionHash, ownerTokenHash: secondOwnerTokenHash })),
      repository.upsertOwnerShareSessionGrant(grant({ resourceType: "comparison", resourceId: "comparison-1" }))
    ]);

    await expect(repository.deleteOwnerShareSessionGrantsForResource("build", "build-1")).resolves.toBe(2);
    await expect(repository.listOwnerShareSessionGrants(sessionHash)).resolves.toEqual([
      { resourceType: "comparison", resourceId: "comparison-1", ownerTokenHash }
    ]);
    await expect(repository.deleteOwnerShareSessionGrantsForSession(sessionHash)).resolves.toBe(1);
    await expect(repository.listOwnerShareSessionGrants(sessionHash)).resolves.toEqual([]);
    await expect(repository.listOwnerShareSessionGrants(secondSessionHash)).resolves.toEqual([]);
  });

  it("prunes only the requested number of expired file grants and retains a corrupt file", async () => {
    const repository = await loadRepository();
    const now = "2026-09-29T12:00:00.000Z";
    await createSession(repository, sessionHash);
    await Promise.all([
      repository.upsertOwnerShareSessionGrant(grant({ resourceId: "expired-1", expiresAt: "2026-09-29T11:00:00.000Z" }), now),
      repository.upsertOwnerShareSessionGrant(grant({ resourceId: "expired-2", expiresAt: "2026-09-29T11:10:00.000Z" }), now),
      repository.upsertOwnerShareSessionGrant(grant({ resourceId: "expired-3", expiresAt: "2026-09-29T11:20:00.000Z" }), now),
      repository.upsertOwnerShareSessionGrant(grant({ resourceId: "still-valid", expiresAt: "2026-09-29T12:01:00.000Z" }), now)
    ]);

    await expect(repository.pruneExpiredOwnerShareSessionGrants(2, now)).resolves.toBe(2);
    const stored = JSON.parse(await readFile(join(dataDirectory, "owner-session-grants.json"), "utf8")) as { sessions: unknown[]; grants: Array<{ resourceId: string }> };
    expect(stored.sessions).toHaveLength(1);
    expect(stored.grants.map((entry) => entry.resourceId).sort()).toEqual(["expired-3", "still-valid"]);
    await expect(repository.pruneExpiredOwnerShareSessionGrants(0, now)).resolves.toBe(0);

    const path = join(dataDirectory, "owner-session-grants.json");
    const malformed = "{ owner grants are not json";
    await writeFile(path, malformed, "utf8");
    await expect(repository.upsertOwnerShareSessionGrant(grant({ resourceId: "must-not-overwrite" }))).rejects.toBeInstanceOf(SyntaxError);
    await expect(readFile(path, "utf8")).resolves.toBe(malformed);
  });

  it("keeps session expiry separate from resource expiry and deletes its grants on revoke", async () => {
    const repository = await loadRepository();
    const now = "2026-09-29T12:00:00.000Z";
    const session = { sessionHash, createdAt, expiresAt: "2026-09-29T13:00:00.000Z" };
    const grantWithLaterResourceExpiry = grant({ expiresAt: "2026-09-29T14:00:00.000Z" });
    await repository.createOwnerShareSession(session);
    await expect(repository.ownerShareSessionIsActive(sessionHash, now)).resolves.toBe(true);
    await expect(repository.upsertOwnerShareSessionGrant(grantWithLaterResourceExpiry, now)).resolves.toBe(true);

    await expect(repository.createOwnerShareSession({ ...session, expiresAt: farFuture })).rejects.toThrow("already exists");
    await expect(repository.ownerShareSessionIsActive(sessionHash, "2026-09-29T13:00:00.000Z")).resolves.toBe(false);
    await expect(repository.ownerShareSessionGrantMatches({ sessionHash, resourceType: "build", resourceId: "build-1", ownerTokenHash, now: "2026-09-29T13:30:00.000Z" })).resolves.toBe(false);
    await expect(repository.listOwnerShareSessionGrants(sessionHash, "2026-09-29T13:30:00.000Z")).resolves.toEqual([]);

    const storedBeforeRevoke = JSON.parse(await readFile(join(dataDirectory, "owner-session-grants.json"), "utf8")) as { sessions: Array<{ expiresAt: string }>; grants: Array<{ expiresAt: string }> };
    expect(storedBeforeRevoke.sessions[0]?.expiresAt).toBe(session.expiresAt);
    expect(storedBeforeRevoke.grants[0]?.expiresAt).toBe(grantWithLaterResourceExpiry.expiresAt);
    await expect(repository.deleteOwnerShareSession(sessionHash)).resolves.toBe(true);
    await expect(repository.ownerShareSessionIsActive(sessionHash, now)).resolves.toBe(false);
    await expect(repository.listOwnerShareSessionGrants(sessionHash, now)).resolves.toEqual([]);
    const storedAfterRevoke = JSON.parse(await readFile(join(dataDirectory, "owner-session-grants.json"), "utf8")) as { sessions: unknown[]; grants: unknown[] };
    expect(storedAfterRevoke.sessions).toEqual([]);
    expect(storedAfterRevoke.grants).toEqual([]);
  });

  it("prunes expired file sessions and their grants in the same mutation", async () => {
    const repository = await loadRepository();
    const now = "2026-09-29T12:00:00.000Z";
    const sessionHashes = ["e", "f", "1", "2"].map((letter) => letter.repeat(64));
    const expiries = ["2026-09-29T11:00:00.000Z", "2026-09-29T11:30:00.000Z", "2026-09-29T12:00:00.000Z", "2026-09-29T13:00:00.000Z"];
    for (let index = 0; index < sessionHashes.length; index += 1) {
      await repository.createOwnerShareSession({ sessionHash: sessionHashes[index], createdAt, expiresAt: expiries[index] });
      const beforeExpiry = new Date(Date.parse(expiries[index]) - 1_000).toISOString();
      await expect(repository.upsertOwnerShareSessionGrant(grant({ sessionHash: sessionHashes[index], resourceId: `session-${index}` }), beforeExpiry)).resolves.toBe(true);
    }

    await expect(repository.pruneExpiredOwnerShareSessions(2, now)).resolves.toBe(2);
    const afterFirstPrune = JSON.parse(await readFile(join(dataDirectory, "owner-session-grants.json"), "utf8")) as { sessions: Array<{ sessionHash: string }>; grants: Array<{ sessionHash: string }> };
    expect(afterFirstPrune.sessions.map(({ sessionHash: value }) => value).sort()).toEqual(sessionHashes.slice(2).sort());
    expect(afterFirstPrune.grants.map(({ sessionHash: value }) => value).sort()).toEqual(sessionHashes.slice(2).sort());
    await expect(repository.pruneExpiredOwnerShareSessions(0, now)).resolves.toBe(0);
    await expect(repository.pruneExpiredOwnerShareSessions(10_000, now)).resolves.toBe(1);
    const afterSecondPrune = JSON.parse(await readFile(join(dataDirectory, "owner-session-grants.json"), "utf8")) as { sessions: Array<{ sessionHash: string }>; grants: Array<{ sessionHash: string }> };
    expect(afterSecondPrune.sessions.map(({ sessionHash: value }) => value)).toEqual([sessionHashes[3]]);
    expect(afterSecondPrune.grants.map(({ sessionHash: value }) => value)).toEqual([sessionHashes[3]]);
  });

  it("prunes PostgreSQL sessions with a hard cap and relies on the FK cascade for grants", async () => {
    const repository = await loadRepository("postgres://synthetic.test/pc_supporter");
    const now = "2026-09-29T12:00:00.000Z";
    const sessionHashes = ["3", "4", "5"].map((digit) => digit.repeat(64));
    const expiries = ["2026-09-29T11:00:00.000Z", "2026-09-29T11:30:00.000Z", "2026-09-29T13:00:00.000Z"];

    for (let index = 0; index < sessionHashes.length; index += 1) {
      await repository.createOwnerShareSession({ sessionHash: sessionHashes[index], createdAt, expiresAt: expiries[index] });
      const beforeExpiry = new Date(Date.parse(expiries[index]) - 1_000).toISOString();
      await expect(repository.upsertOwnerShareSessionGrant(grant({ sessionHash: sessionHashes[index], resourceId: `pg-session-${index}` }), beforeExpiry)).resolves.toBe(true);
    }

    await expect(repository.pruneExpiredOwnerShareSessions(1, now)).resolves.toBe(1);
    expect(fakeDatabase.sessions.has(sessionHashes[0])).toBe(false);
    expect([...fakeDatabase.grants.values()].some((entry) => entry.session_hash === sessionHashes[0])).toBe(false);
    await expect(repository.pruneExpiredOwnerShareSessions(9999, now)).resolves.toBe(1);
    expect(fakeDatabase.queries.filter(({ sql }) => sql.includes("WITH expired_sessions AS (")).map(({ values }) => values?.[0])).toEqual([1, repository.OWNER_SHARE_SESSION_MAX_PRUNE_BATCH]);
    expect(fakeDatabase.sessions.has(sessionHashes[1])).toBe(false);
    expect(fakeDatabase.sessions.has(sessionHashes[2])).toBe(true);
    expect([...fakeDatabase.grants.values()].map((entry) => entry.session_hash)).toEqual([sessionHashes[2]]);
  });

  it("preserves legacy grant-only JSON without exposing or reviving its token hash", async () => {
    const repository = await loadRepository();
    const legacyGrant = grant({ resourceId: "legacy-build", expiresAt: farFuture });
    const path = join(dataDirectory, "owner-session-grants.json");
    const legacyJson = JSON.stringify({ schemaVersion: 1, grants: [legacyGrant] });
    await writeFile(path, legacyJson, "utf8");

    await expect(repository.ownerShareSessionIsActive(sessionHash, createdAt)).resolves.toBe(false);
    await expect(repository.listOwnerShareSessionGrants(sessionHash, createdAt)).resolves.toEqual([]);
    await expect(repository.ownerShareSessionGrantMatches({ sessionHash, resourceType: "build", resourceId: "legacy-build", ownerTokenHash, now: createdAt })).resolves.toBe(false);
    await expect(repository.upsertOwnerShareSessionGrant(legacyGrant, createdAt)).resolves.toBe(false);
    await expect(repository.createOwnerShareSession({ sessionHash, createdAt, expiresAt: farFuture })).rejects.toThrow("pending grant");
    await expect(readFile(path, "utf8")).resolves.toBe(legacyJson);
  });

  it("does not expose or revive a pending PostgreSQL grant without its session row", async () => {
    const repository = await loadRepository("postgres://synthetic.test/pc_supporter");
    const legacyGrant = grant({ resourceId: "legacy-database-build", expiresAt: farFuture });
    fakeDatabase.grants.set(JSON.stringify([sessionHash, legacyGrant.resourceType, legacyGrant.resourceId, ownerTokenHash]), {
      session_hash: sessionHash,
      resource_type: legacyGrant.resourceType,
      resource_id: legacyGrant.resourceId,
      owner_token_hash: ownerTokenHash,
      created_at: legacyGrant.createdAt,
      expires_at: legacyGrant.expiresAt ?? null
    });

    await expect(repository.ownerShareSessionIsActive(sessionHash, createdAt)).resolves.toBe(false);
    await expect(repository.listOwnerShareSessionGrants(sessionHash, createdAt)).resolves.toEqual([]);
    await expect(repository.ownerShareSessionGrantMatches({ sessionHash, resourceType: "build", resourceId: legacyGrant.resourceId, ownerTokenHash, now: createdAt })).resolves.toBe(false);
    await expect(repository.createOwnerShareSession({ sessionHash, createdAt, expiresAt: farFuture })).rejects.toThrow("pending grant");
    expect(fakeDatabase.grants.size).toBe(1);
    expect(fakeDatabase.sessions.size).toBe(0);
  });

  it("aligns runtime bootstrap, baseline schema, and the additive migration", async () => {
    const repository = await loadRepository("postgres://synthetic.test/pc_supporter");
    const baseline = await readFile(new URL("../db/schema.sql", import.meta.url), "utf8");
    const migration = await readFile(new URL("../db/migrations/20260930_owner_session_grants.sql", import.meta.url), "utf8");
    const definitions = [
      "CREATE TABLE IF NOT EXISTS owner_sessions",
      "CREATE INDEX IF NOT EXISTS owner_sessions_expiry_idx",
      "CREATE TABLE IF NOT EXISTS owner_session_grants",
      "FOREIGN KEY (session_hash) REFERENCES owner_sessions(session_hash) ON DELETE CASCADE",
      "PRIMARY KEY (session_hash, resource_type, resource_id, owner_token_hash)",
      "CREATE INDEX IF NOT EXISTS owner_session_grants_session_expiry_idx",
      "CREATE INDEX IF NOT EXISTS owner_session_grants_resource_idx",
      "CREATE INDEX IF NOT EXISTS owner_session_grants_expiry_idx"
    ];

    for (const definition of definitions) {
      expect(repository.POSTGRES_SCHEMA_SQL).toContain(definition);
      expect(baseline).toContain(definition);
      expect(migration).toContain(definition);
    }

    const ownerSessionDdl = (source: string) => source
      .split(";")
      .map((statement) => statement.replace(/\s+/g, " ").trim())
      .filter((statement) => statement.includes("owner_session"))
      .sort();
    expect(ownerSessionDdl(repository.POSTGRES_SCHEMA_SQL)).toEqual(ownerSessionDdl(baseline));
    expect(ownerSessionDdl(repository.POSTGRES_SCHEMA_SQL)).toEqual(ownerSessionDdl(migration));
  });

  it("uses PostgreSQL for grant insert, match, list, revoke, and bounded expiry pruning", async () => {
    const repository = await loadRepository("postgres://synthetic.test/pc_supporter");
    const now = "2026-09-29T12:00:00.000Z";
    await createSession(repository, sessionHash, "2026-09-29T23:59:59.000Z");
    await createSession(repository, secondSessionHash, farFuture);
    const permanent = grant();
    const expired = grant({ resourceType: "watchlist", resourceId: "expired-watch", expiresAt: "2026-09-29T11:00:00.000Z" });
    await expect(repository.upsertOwnerShareSessionGrant(permanent, now)).resolves.toBe(true);
    await expect(repository.upsertOwnerShareSessionGrant({ ...permanent, expiresAt: "2026-09-29T13:00:00.000Z" }, now)).resolves.toBe(true);
    await expect(repository.upsertOwnerShareSessionGrant(permanent, now)).resolves.toBe(true);
    await expect(repository.upsertOwnerShareSessionGrant(expired, now)).resolves.toBe(true);
    await expect(repository.upsertOwnerShareSessionGrant(grant({ sessionHash: secondSessionHash, resourceId: "build-2", ownerTokenHash: secondOwnerTokenHash }), now)).resolves.toBe(true);
    await expect(repository.ownerShareSessionGrantMatches({ sessionHash: secondSessionHash, resourceType: "build", resourceId: "build-2", ownerTokenHash: secondOwnerTokenHash, now: "2050-01-01T00:00:00.000Z" })).resolves.toBe(true);

    await expect(repository.ownerShareSessionGrantMatches({ sessionHash, resourceType: "build", resourceId: "build-1", ownerTokenHash, now })).resolves.toBe(true);
    await expect(repository.ownerShareSessionGrantMatches({ sessionHash, resourceType: "build", resourceId: "build-1", ownerTokenHash, now: "2026-09-29T13:30:00.000Z" })).resolves.toBe(false);
    await expect(repository.ownerShareSessionGrantMatches({ sessionHash, resourceType: "watchlist", resourceId: "expired-watch", ownerTokenHash, now })).resolves.toBe(false);
    await expect(repository.listOwnerShareSessionGrants(sessionHash, now)).resolves.toEqual([
      { resourceType: "build", resourceId: "build-1", ownerTokenHash }
    ]);
    await expect(repository.pruneExpiredOwnerShareSessionGrants(9999, now)).resolves.toBe(1);
    expect(fakeDatabase.queries.find(({ sql }) => sql.includes("WITH expired AS ("))?.values?.[0]).toBe(repository.OWNER_SHARE_SESSION_GRANT_MAX_PRUNE_BATCH);
    await expect(repository.deleteOwnerShareSessionGrantsForResource("build", "build-2")).resolves.toBe(1);
    await expect(repository.deleteOwnerShareSessionGrantsForSession(sessionHash)).resolves.toBe(1);
    expect(fakeDatabase.grants.size).toBe(0);
    expect(fakeDatabase.queries.some(({ sql }) => sql.includes("ON CONFLICT (session_hash, resource_type, resource_id, owner_token_hash)"))).toBe(true);
    expect(fakeDatabase.queries.some(({ sql }) => sql.includes("COALESCE(EXCLUDED.expires_at, owner_session_grants.expires_at)"))).toBe(true);
  });

  it("uses PostgreSQL session expiry as an independent gate and cascades revoke/prune to grants", async () => {
    const repository = await loadRepository("postgres://synthetic.test/pc_supporter");
    const now = "2026-09-29T12:00:00.000Z";
    await repository.createOwnerShareSession({ sessionHash, createdAt, expiresAt: "2026-09-29T13:00:00.000Z" });
    await repository.createOwnerShareSession({ sessionHash: secondSessionHash, createdAt, expiresAt: "2026-09-29T11:00:00.000Z" });
    await expect(repository.createOwnerShareSession({ sessionHash, createdAt, expiresAt: farFuture })).rejects.toThrow("already exists");
    await expect(repository.ownerShareSessionIsActive(sessionHash, now)).resolves.toBe(true);
    await expect(repository.ownerShareSessionIsActive(secondSessionHash, now)).resolves.toBe(false);
    await expect(repository.upsertOwnerShareSessionGrant(grant({ expiresAt: "2026-09-29T14:00:00.000Z" }), now)).resolves.toBe(true);
    const expiredSessionGrant = grant({ sessionHash: secondSessionHash, resourceId: "expired-session", expiresAt: "2026-09-29T14:00:00.000Z" });
    await expect(repository.upsertOwnerShareSessionGrant(expiredSessionGrant, "2026-09-29T10:30:00.000Z")).resolves.toBe(true);
    await expect(repository.upsertOwnerShareSessionGrant(grant({ sessionHash: secondSessionHash, resourceId: "blocked-after-expiry" }), now)).resolves.toBe(false);

    await expect(repository.ownerShareSessionGrantMatches({ sessionHash, resourceType: "build", resourceId: "build-1", ownerTokenHash, now: "2026-09-29T13:30:00.000Z" })).resolves.toBe(false);
    await expect(repository.listOwnerShareSessionGrants(sessionHash, "2026-09-29T13:30:00.000Z")).resolves.toEqual([]);
    await expect(repository.pruneExpiredOwnerShareSessions(9999, now)).resolves.toBe(1);
    expect(fakeDatabase.queries.find(({ sql }) => sql.includes("WITH expired_sessions AS ("))?.values?.[0]).toBe(repository.OWNER_SHARE_SESSION_MAX_PRUNE_BATCH);
    expect(fakeDatabase.sessions.has(secondSessionHash)).toBe(false);
    expect([...fakeDatabase.grants.values()].some((entry) => entry.session_hash === secondSessionHash)).toBe(false);

    await expect(repository.deleteOwnerShareSession(sessionHash)).resolves.toBe(true);
    await expect(repository.ownerShareSessionIsActive(sessionHash, now)).resolves.toBe(false);
    expect(fakeDatabase.grants.size).toBe(0);
    expect(fakeDatabase.sessions.size).toBe(0);
  });

  it("fails closed on PostgreSQL errors without writing a JSON fallback", async () => {
    const repository = await loadRepository("postgres://synthetic.test/pc_supporter");
    await createSession(repository, sessionHash);
    fakeDatabase.failOwnerSessionOperations = true;

    await expect(repository.upsertOwnerShareSessionGrant(grant())).rejects.toThrow("synthetic owner-session database outage");
    await expect(access(join(dataDirectory, "owner-session-grants.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects malformed hashes and malformed file rows instead of accepting partial ownership", async () => {
    const repository = await loadRepository();
    await expect(repository.upsertOwnerShareSessionGrant(grant({ sessionHash: "A".repeat(64) }))).rejects.toThrow("lowercase SHA-256");
    await expect(repository.upsertOwnerShareSessionGrant(grant({ resourceType: "unknown" as never }))).rejects.toThrow("resource type");

    const path = join(dataDirectory, "owner-session-grants.json");
    await writeFile(path, JSON.stringify({ schemaVersion: 1, grants: [{ ...grant(), ownerTokenHash: "not-a-hash" }] }), "utf8");
    await expect(repository.listOwnerShareSessionGrants(sessionHash)).rejects.toThrow("lowercase SHA-256");
    await expect(readFile(path, "utf8")).resolves.toContain("not-a-hash");
  });
});
