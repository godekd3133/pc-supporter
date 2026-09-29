import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import {
  createBackgroundJobStore,
  type BackgroundJob,
  type BackgroundJobError,
  type BackgroundJobProgress
} from "./background-job-store";

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

interface MutableClock {
  now: number;
}

interface FakeRow {
  id: string;
  kind: string;
  status: string;
  payload: Record<string, unknown>;
  attempt: number;
  max_attempts: number;
  available_at: Date;
  progress: BackgroundJobProgress | null;
  idempotency_key: string | null;
  result: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
  finished_at: Date | null;
  lease_owner: string | null;
  lease_token: string | null;
  lease_expires_at: Date | null;
  error: BackgroundJobError | null;
}

function dateMilliseconds(value: Date | string | null) {
  if (value === null) return Number.NEGATIVE_INFINITY;
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function cloneRow<T>(value: T): T {
  return structuredClone(value);
}

function createHarness() {
  const clock: MutableClock = { now: Date.parse("2026-09-29T12:00:00.000Z") };
  const rows = new Map<string, FakeRow>();
  const sqlLog: Array<{ sql: string; values: unknown[] }> = [];
  let nextId = 1;

  const client = {
    async query<Row = Record<string, unknown>>(sql: string, values: unknown[] = []) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      sqlLog.push({ sql: normalized, values: structuredClone(values) });

      if (normalized.startsWith("INSERT INTO background_jobs")) {
        expect(normalized).toContain("RETURNING *");
        const [id, kind, payloadJson, maxAttempts, availableAt, idempotencyKey] = values;
        const previous = idempotencyKey === null ? undefined : [...rows.values()].find((candidate) => candidate.kind === kind && candidate.idempotency_key === idempotencyKey);
        if (previous) {
          if (JSON.stringify(previous.payload) !== JSON.stringify(JSON.parse(String(payloadJson))) || previous.max_attempts !== Number(maxAttempts)) {
            return { rows: [], rowCount: 0 };
          }
          return { rows: [cloneRow(previous) as Row], rowCount: 1 };
        }
        const row: FakeRow = {
          id: String(id),
          kind: String(kind),
          status: "queued",
          payload: JSON.parse(String(payloadJson)) as Record<string, unknown>,
          attempt: 0,
          max_attempts: Number(maxAttempts),
          available_at: new Date(String(availableAt)),
          progress: null,
          idempotency_key: idempotencyKey === null ? null : String(idempotencyKey),
          result: null,
          created_at: new Date(clock.now),
          updated_at: new Date(clock.now),
          finished_at: null,
          lease_owner: null,
          lease_token: null,
          lease_expires_at: null,
          error: null
        };
        rows.set(row.id, row);
        return { rows: [cloneRow(row) as Row], rowCount: 1 };
      }

      if (normalized.startsWith("SELECT pg_advisory_xact_lock")) return { rows: [], rowCount: 1 };

      if (normalized.startsWith("SELECT * FROM background_jobs WHERE kind = $1 AND status IN ('queued', 'running') AND payload =")) {
        const [kind, payloadJson] = values;
        const expectedPayload = JSON.parse(String(payloadJson)) as Record<string, unknown>;
        const row = [...rows.values()].find((candidate) => candidate.kind === kind
          && (candidate.status === "queued" || candidate.status === "running")
          && JSON.stringify(candidate.payload) === JSON.stringify(expectedPayload));
        return { rows: row ? [cloneRow(row) as Row] : [], rowCount: row ? 1 : 0 };
      }

      if (normalized.startsWith("SELECT id FROM background_jobs WHERE kind = $1 AND status IN ('queued', 'running')")) {
        const row = [...rows.values()].find((candidate) => candidate.kind === values[0]
          && (candidate.status === "queued" || candidate.status === "running"));
        return { rows: row ? [{ id: row.id } as Row] : [], rowCount: row ? 1 : 0 };
      }

      if (normalized.startsWith("SELECT * FROM background_jobs WHERE kind = $1 AND status IN ('queued', 'running')")) {
        const row = [...rows.values()].find((candidate) => candidate.kind === values[0]
          && (candidate.status === "queued" || candidate.status === "running"));
        return { rows: row ? [cloneRow(row) as Row] : [], rowCount: row ? 1 : 0 };
      }

      if (normalized.startsWith("UPDATE background_jobs SET status = CASE WHEN attempt >= max_attempts")) {
        expect(normalized).toContain("WHERE status = 'running' AND lease_expires_at <= clock_timestamp()");
        const kindFilter = values[0] as string[] | null;
        for (const row of rows.values()) {
          if (kindFilter && !kindFilter.includes(row.kind)) continue;
          if (row.status !== "running" || dateMilliseconds(row.lease_expires_at) > clock.now) continue;
          const exhausted = row.attempt >= row.max_attempts;
          row.status = exhausted ? "failed" : "queued";
          row.available_at = exhausted ? row.available_at : new Date(clock.now);
          row.finished_at = exhausted ? new Date(clock.now) : null;
          row.error = exhausted
            ? { code: "ATTEMPTS_EXHAUSTED", retryable: false }
            : { code: "LEASE_EXPIRED", retryable: true };
          row.lease_owner = null;
          row.lease_token = null;
          row.lease_expires_at = null;
          row.updated_at = new Date(clock.now);
        }
        return { rows: [], rowCount: 0 };
      }

      if (normalized.startsWith("UPDATE background_jobs SET status = 'failed'")) {
        expect(normalized).toContain("WHERE status = 'queued' AND attempt >= max_attempts");
        const kindFilter = values[0] as string[] | null;
        for (const row of rows.values()) {
          if (kindFilter && !kindFilter.includes(row.kind)) continue;
          if (row.status !== "queued" || row.attempt < row.max_attempts) continue;
          row.status = "failed";
          row.finished_at = new Date(clock.now);
          row.error = { code: "ATTEMPTS_EXHAUSTED", retryable: false };
          row.lease_owner = null;
          row.lease_token = null;
          row.lease_expires_at = null;
          row.updated_at = new Date(clock.now);
        }
        return { rows: [], rowCount: 0 };
      }

      if (normalized.startsWith("WITH candidate AS (")) {
        expect(normalized).toContain("FOR UPDATE SKIP LOCKED");
        expect(normalized).toContain("ORDER BY available_at ASC, created_at ASC, id ASC");
        expect(normalized).toContain("AND available_at <= clock_timestamp()");
        const [owner, token, leaseDurationMs, kindFilter] = values as [string, string, number, string[] | null];
        const row = [...rows.values()]
          .filter((candidate) => candidate.status === "queued"
            && candidate.attempt < candidate.max_attempts
            && (!kindFilter || kindFilter.includes(candidate.kind))
            && dateMilliseconds(candidate.available_at) <= clock.now)
          .sort((left, right) => dateMilliseconds(left.available_at) - dateMilliseconds(right.available_at)
            || dateMilliseconds(left.created_at) - dateMilliseconds(right.created_at)
            || left.id.localeCompare(right.id))[0];
        if (!row) return { rows: [], rowCount: 0 };
        row.status = "running";
        row.attempt += 1;
        row.lease_owner = String(owner);
        row.lease_token = String(token);
        row.lease_expires_at = new Date(clock.now + Number(leaseDurationMs));
        row.updated_at = new Date(clock.now);
        return { rows: [cloneRow(row) as Row], rowCount: 1 };
      }

      if (normalized.startsWith("SELECT * FROM background_jobs WHERE id =")) {
        const row = rows.get(String(values[0]));
        return { rows: row ? [cloneRow(row) as Row] : [], rowCount: row ? 1 : 0 };
      }

      if (normalized.startsWith("SELECT * FROM background_jobs WHERE kind =")) {
        const row = [...rows.values()]
          .filter((candidate) => candidate.kind === String(values[0]))
          .sort((left, right) => dateMilliseconds(right.created_at) - dateMilliseconds(left.created_at)
            || right.id.localeCompare(left.id))[0];
        expect(normalized).toContain("ORDER BY created_at DESC, id DESC");
        return { rows: row ? [cloneRow(row) as Row] : [], rowCount: row ? 1 : 0 };
      }

      if (normalized.startsWith("WITH expired AS (")) {
        expect(normalized).toContain("finished_at < clock_timestamp() - ($1 * INTERVAL '1 day')");
        const [retentionDays, limit] = values.map(Number);
        const expired = [...rows.values()]
          .filter((row) => (row.status === "succeeded" || row.status === "failed")
            && dateMilliseconds(row.finished_at) < clock.now - retentionDays * 86_400_000)
          .sort((left, right) => dateMilliseconds(left.finished_at) - dateMilliseconds(right.finished_at))
          .slice(0, limit);
        for (const row of expired) rows.delete(row.id);
        return { rows: expired.map(({ id }) => ({ id }) as Row), rowCount: expired.length };
      }

      if (normalized.startsWith("UPDATE background_jobs")) {
        expect(normalized).toContain("status = 'running'");
        expect(normalized).toContain("lease_owner = $2");
        expect(normalized).toContain("lease_token = $3::uuid");
        expect(normalized).toContain("lease_expires_at > clock_timestamp()");
        expect(normalized).toContain("RETURNING id");
        const [id, owner, token, ...mutationValues] = values;
        const row = rows.get(String(id));
        if (!row || row.status !== "running" || row.lease_owner !== owner || row.lease_token !== token
          || dateMilliseconds(row.lease_expires_at) <= clock.now) {
          return { rows: [], rowCount: 0 };
        }

        if (normalized.includes("SET lease_expires_at = clock_timestamp()")) {
          row.lease_expires_at = new Date(clock.now + Number(mutationValues[0]));
        } else if (normalized.includes("SET progress = $4::jsonb")) {
          row.progress = JSON.parse(String(mutationValues[0])) as BackgroundJobProgress;
        } else if (normalized.includes("SET status = 'succeeded'")) {
          row.status = "succeeded";
          row.progress = mutationValues[0] === null ? row.progress : JSON.parse(String(mutationValues[0])) as BackgroundJobProgress;
          row.result = mutationValues[1] === null ? null : JSON.parse(String(mutationValues[1])) as Record<string, unknown>;
          row.error = null;
          row.finished_at = new Date(clock.now);
          row.lease_owner = null;
          row.lease_token = null;
          row.lease_expires_at = null;
        } else if (normalized.includes("SET status = CASE WHEN $4::boolean AND attempt < max_attempts")) {
          const [retryable, retryDelayMs, errorJson] = mutationValues;
          const shouldRetry = retryable === true && row.attempt < row.max_attempts;
          row.status = shouldRetry ? "queued" : "failed";
          if (shouldRetry) row.available_at = new Date(clock.now + Number(retryDelayMs));
          else row.finished_at = new Date(clock.now);
          row.error = JSON.parse(String(errorJson)) as BackgroundJobError;
          if (!shouldRetry && row.error.retryable) row.error.retryable = false;
          row.lease_owner = null;
          row.lease_token = null;
          row.lease_expires_at = null;
        } else if (normalized.includes("SET status = CASE WHEN attempt < max_attempts")) {
          const shouldRetry = row.attempt < row.max_attempts;
          row.status = shouldRetry ? "queued" : "failed";
          if (shouldRetry) row.available_at = new Date(clock.now + Number(mutationValues[0]));
          else {
            row.finished_at = new Date(clock.now);
            row.error = { code: "ATTEMPTS_EXHAUSTED", retryable: false };
          }
          row.lease_owner = null;
          row.lease_token = null;
          row.lease_expires_at = null;
        } else {
          throw new Error(`Unrecognized fake background-job mutation: ${normalized}`);
        }
        row.updated_at = new Date(clock.now);
        return { rows: [{ id: row.id } as Row], rowCount: 1 };
      }

      throw new Error(`Unexpected fake PostgreSQL query: ${normalized}`);
    }
  };

  const transactionRunner = async <T>(_operation: string, callback: (queryClient: never) => Promise<T>) => callback(client as never);
  const store = createBackgroundJobStore({
    transactionRunner,
    now: () => clock.now,
    createId: () => uuid(nextId++)
  });
  return { store, clock, rows, sqlLog };
}

describe("PostgreSQL durable background job store", () => {
  it("validates known job kinds, bounded JSON payloads, safe progress, and structured errors", async () => {
    const { store } = createHarness();

    await expect(store.enqueue({ kind: "unknown-job" as never, payload: {} })).rejects.toThrow(/kind/);
    await expect(store.enqueue({ kind: "price-refresh", payload: { token: "x".repeat(66_000) } })).rejects.toThrow(/payload size/);
    await expect(store.enqueue({ kind: "price-refresh", payload: {}, maxAttempts: 0 })).rejects.toThrow(/max attempts/);
    await expect(store.enqueue({ kind: "price-refresh", payload: {}, maxAttempts: 21 })).rejects.toThrow(/max attempts/);
    await expect(store.enqueue({ kind: "price-refresh", payload: { value: Number.POSITIVE_INFINITY } })).rejects.toThrow(/payload number/);
    await expect(store.enqueue({ kind: "price-refresh", payload: { nested: { value: undefined } } })).rejects.toThrow(/JSON value/);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(store.enqueue({ kind: "price-refresh", payload: circular })).rejects.toThrow(/circular reference/);

    const job = await store.enqueue({ kind: "price-refresh", payload: { source: "catalog" } });
    const claim = { owner: "worker-east-1", token: uuid(10) };
    const invalidProgress = [
      { phase: "fetching", message: "response body" },
      { phase: "fetching", requestId: "secret-token" },
      { phase: "https://example.test" },
      { phase: "fetching", completed: 2, total: 1 }
    ];
    for (const progress of invalidProgress) {
      await expect(store.updateProgress(job.id, claim, progress as never)).rejects.toThrow(/progress/);
    }
    await expect(store.fail(job.id, claim, { code: "WORKER_FAILED", retryable: true, message: "private response" } as never))
      .rejects.toThrow(/error fields/);
    await expect(store.fail(job.id, claim, { code: "raw database error" as never, retryable: false }))
      .rejects.toThrow(/error code/);
    await expect(store.claimNext("worker@example.com")).rejects.toThrow(/lease owner/);
    await expect(store.claimNext("worker-1", 0)).rejects.toThrow(/lease duration/);
    await expect(store.getById("invalid-id")).rejects.toThrow(/id/);
  });

  it("enqueues and reads typed jobs, then claims with an atomic skip-locked query", async () => {
    const { store, sqlLog } = createHarness();
    const job = await store.enqueue({
      kind: "catalog-ingestion",
      payload: { categories: ["gpu", "cpu"] },
      maxAttempts: 3,
      availableAt: new Date("2026-09-29T12:00:00.000Z")
    });

    expect(job).toMatchObject({
      id: uuid(1),
      kind: "catalog-ingestion",
      status: "queued",
      attempt: 0,
      maxAttempts: 3,
      payload: { categories: ["gpu", "cpu"] },
      progress: null,
      finishedAt: null,
      leaseOwner: null,
      error: null
    });
    await expect(store.getById(job.id)).resolves.toEqual(job);
    await expect(store.getById(uuid(99))).resolves.toBeNull();
    await expect(store.getLatestByKind("catalog-ingestion")).resolves.toEqual(job);
    await expect(store.getLatestByKind("unknown-job" as never)).rejects.toThrow(/kind/);

    const claimed = await store.claimNext("worker-1", 5_000);
    expect(claimed).toMatchObject({
      id: job.id,
      status: "running",
      attempt: 1,
      leaseOwner: "worker-1",
      leaseToken: uuid(2),
      leaseExpiresAt: "2026-09-29T12:00:05.000Z"
    });
    const claimQuery = sqlLog.find(({ sql }) => sql.includes("FOR UPDATE SKIP LOCKED"));
    expect(claimQuery?.sql).toContain("ORDER BY available_at ASC, created_at ASC, id ASC");
    expect(claimQuery?.sql).toContain("attempt < max_attempts");
  });

  it("deduplicates a caller key and limits expired-lease recovery and claims to selected kinds", async () => {
    const { store, rows, sqlLog, clock } = createHarness();
    const first = await store.enqueue({ kind: "price-refresh", payload: { dryRun: true }, idempotencyKey: "price-refresh:manual:hash" });
    const duplicate = await store.enqueue({ kind: "price-refresh", payload: { dryRun: true }, idempotencyKey: "price-refresh:manual:hash" });
    expect(duplicate.id).toBe(first.id);
    expect(duplicate.payload).toEqual({ dryRun: true });
    await expect(store.enqueue({ kind: "price-refresh", payload: { dryRun: false }, idempotencyKey: "price-refresh:manual:hash" }))
      .rejects.toThrow(/idempotency key/);
    await expect(store.enqueue({ kind: "price-refresh", payload: {}, idempotencyKey: "bad key" })).rejects.toThrow(/idempotency key/);

    const otherKind = await store.enqueue({ kind: "catalog-ingestion", payload: { source: "manual" } });
    const catalogClaim = await store.claimNext("catalog-worker", 1_000, ["catalog-ingestion"]);
    expect(catalogClaim?.id).toBe(otherKind.id);
    clock.now += 1_001;
    const priceClaim = await store.claimNext("price-worker", 1_000, ["price-refresh"]);
    expect(priceClaim?.id).toBe(first.id);
    expect(rows.get(otherKind.id)?.status).toBe("running");
    const claimQuery = sqlLog.filter(({ sql }) => sql.includes("FOR UPDATE SKIP LOCKED")).at(-1);
    expect(claimQuery?.sql).toContain("kind = ANY($4::text[])");
    expect(claimQuery?.values[3]).toEqual(["price-refresh"]);
  });

  it("deduplicates keyless manual requests while a matching price-refresh is active and conflicts on changed options", async () => {
    const { store } = createHarness();
    const input = { kind: "price-refresh" as const, payload: { coreLimit: 0, accessoryLimit: 0, dryRun: true }, deduplicateActive: true };
    const first = await store.enqueue(input);
    const duplicate = await store.enqueue(input);
    expect(duplicate.id).toBe(first.id);
    await expect(store.enqueue({ ...input, payload: { coreLimit: 1, accessoryLimit: 0, dryRun: true } }))
      .rejects.toThrow(/already queued or running/);
    await expect(store.getActiveByKind("price-refresh")).resolves.toMatchObject({ id: first.id, status: "queued" });
  });

  it("allows only the active owner and lease token to update, heartbeat, complete, or write late", async () => {
    const { store, clock } = createHarness();
    const queued = await store.enqueue({ kind: "price-refresh", payload: { catalog: "current" } });
    const claimed = await store.claimNext("worker-a");
    if (!claimed?.leaseToken) throw new Error("Expected a lease token.");
    const activeClaim = { owner: "worker-a", token: claimed.leaseToken };

    await expect(store.heartbeat(claimed.id, { ...activeClaim, owner: "worker-b" })).resolves.toBe(false);
    await expect(store.updateProgress(claimed.id, { ...activeClaim, token: uuid(90) }, { phase: "fetching", completed: 1, total: 4 }))
      .resolves.toBe(false);
    await expect(store.heartbeat(claimed.id, activeClaim, 120_000)).resolves.toBe(true);
    await expect(store.updateProgress(claimed.id, activeClaim, { phase: "fetching", completed: 1, total: 4 })).resolves.toBe(true);
    await expect(store.complete(claimed.id, activeClaim, { phase: "finalizing", completed: 4, total: 4 }, {
      attempted: 4, succeeded: 3, changed: 2, failed: 1, sourceHtml: "must not be exposed"
    })).resolves.toBe(true);

    const completed = await store.getById(queued.id);
    expect(completed).toMatchObject({
      status: "succeeded",
      attempt: 1,
      progress: { phase: "finalizing", completed: 4, total: 4 },
      result: { attempted: 4, succeeded: 3, changed: 2, failed: 1, sourceHtml: "must not be exposed" },
      finishedAt: new Date(clock.now).toISOString(),
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      error: null
    });
    await expect(store.heartbeat(claimed.id, activeClaim)).resolves.toBe(false);
    await expect(store.updateProgress(claimed.id, activeClaim, { phase: "persisting" })).resolves.toBe(false);
    await expect(store.fail(claimed.id, activeClaim, { code: "WORKER_FAILED", retryable: true })).resolves.toBe(false);
    await expect(store.requeue(claimed.id, activeClaim)).resolves.toBe(false);
  });

  it("retries structured failures within the cap and fails closed when attempts are exhausted", async () => {
    const { store, clock } = createHarness();
    const enqueued = await store.enqueue({ kind: "saved-build-monitor", payload: { scope: "daily" }, maxAttempts: 2 });
    const firstClaim = await store.claimNext("monitor-1", 2_000);
    if (!firstClaim?.leaseToken) throw new Error("Expected the first claim.");

    await expect(store.fail(firstClaim.id, { owner: "monitor-1", token: firstClaim.leaseToken }, {
      code: "DEPENDENCY_UNAVAILABLE",
      retryable: true
    }, 3_000)).resolves.toBe(true);
    await expect(store.claimNext("monitor-2")).resolves.toBeNull();
    clock.now += 3_000;
    const secondClaim = await store.claimNext("monitor-2", 2_000);
    expect(secondClaim).toMatchObject({ status: "running", attempt: 2, maxAttempts: 2 });
    if (!secondClaim?.leaseToken) throw new Error("Expected the second claim.");

    await expect(store.requeue(secondClaim.id, { owner: "monitor-2", token: secondClaim.leaseToken }, 500)).resolves.toBe(true);
    await expect(store.claimNext("monitor-3")).resolves.toBeNull();
    const failed = await store.getById(enqueued.id);
    expect(failed).toMatchObject({
      status: "failed",
      attempt: 2,
      error: { code: "ATTEMPTS_EXHAUSTED", retryable: false },
      finishedAt: new Date(clock.now).toISOString(),
      leaseToken: null
    });

    const singleAttemptJob = await store.enqueue({ kind: "price-refresh", payload: { scope: "single" }, maxAttempts: 1 });
    const onlyClaim = await store.claimNext("worker-single");
    if (!onlyClaim?.leaseToken) throw new Error("Expected a single attempt claim.");
    await expect(store.fail(onlyClaim.id, { owner: "worker-single", token: onlyClaim.leaseToken }, {
      code: "WORKER_FAILED",
      retryable: true
    })).resolves.toBe(true);
    await expect(store.getById(singleAttemptJob.id)).resolves.toMatchObject({
      status: "failed",
      attempt: 1,
      error: { code: "WORKER_FAILED", retryable: false }
    });
  });

  it("reclaims expired leases, invalidates stale workers, and terminally fails an exhausted lease", async () => {
    const { store, clock } = createHarness();
    const enqueued = await store.enqueue({ kind: "catalog-ingestion", payload: { categories: ["memory"] }, maxAttempts: 2 });
    const stale = await store.claimNext("worker-old", 1_000);
    if (!stale?.leaseToken) throw new Error("Expected an initial lease.");
    const staleClaim = { owner: "worker-old", token: stale.leaseToken };
    clock.now += 1_001;
    await expect(store.heartbeat(stale.id, staleClaim)).resolves.toBe(false);

    const reclaimed = await store.claimNext("worker-new", 1_000);
    expect(reclaimed).toMatchObject({ status: "running", attempt: 2, leaseOwner: "worker-new", error: { code: "LEASE_EXPIRED", retryable: true } });
    if (!reclaimed?.leaseToken) throw new Error("Expected the reclaimed lease.");
    await expect(store.complete(stale.id, staleClaim)).resolves.toBe(false);
    await expect(store.fail(stale.id, staleClaim, { code: "WORKER_FAILED", retryable: true })).resolves.toBe(false);
    await expect(store.requeue(stale.id, staleClaim)).resolves.toBe(false);
    await expect(store.updateProgress(stale.id, staleClaim, { phase: "persisting" })).resolves.toBe(false);

    clock.now += 1_001;
    await expect(store.claimNext("worker-third")).resolves.toBeNull();
    await expect(store.getById(enqueued.id)).resolves.toMatchObject({
      status: "failed",
      attempt: 2,
      error: { code: "ATTEMPTS_EXHAUSTED", retryable: false },
      leaseToken: null,
      leaseExpiresAt: null
    });
  });

  it("retains terminal rows for 90 days and bounds cleanup to the requested batch", async () => {
    const { store, clock } = createHarness();
    const old = await store.enqueue({ kind: "price-refresh", payload: { scope: "old" } });
    const oldClaim = await store.claimNext("retention-old");
    if (!oldClaim?.leaseToken) throw new Error("Expected an old-job lease.");
    await store.complete(old.id, { owner: "retention-old", token: oldClaim.leaseToken });
    clock.now += 91 * 86_400_000;
    const recent = await store.enqueue({ kind: "price-refresh", payload: { scope: "recent" } });
    const recentClaim = await store.claimNext("retention-recent");
    if (!recentClaim?.leaseToken) throw new Error("Expected a recent-job lease.");
    await store.complete(recent.id, { owner: "retention-recent", token: recentClaim.leaseToken });
    await expect(store.pruneFinished(90, 1)).resolves.toBe(1);
    await expect(store.getById(old.id)).resolves.toBeNull();
    await expect(store.getById(recent.id)).resolves.toMatchObject({ status: "succeeded" });
    await expect(store.pruneFinished(0, 1)).rejects.toThrow(/retention days/);
    await expect(store.pruneFinished(90, 251)).rejects.toThrow(/prune batch/);
  });
});

describe("PostgreSQL transaction helper for durable jobs", () => {
  const savedDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedDatabaseUrl;
    vi.doUnmock("pg");
    vi.resetModules();
  });

  it("rejects file mode without attempting a JSON fallback", async () => {
    process.env.DATABASE_URL = "";
    const repository = await import("./repository");
    await expect(repository.withPostgresTransaction("test durable job", async () => "done"))
      .rejects.toThrow(/PostgreSQL is required/);
    await expect(repository.persistenceMode()).resolves.toBe("file");
  });

  it("runs PostgreSQL-only work inside a transaction and checks the shared schema", async () => {
    process.env.DATABASE_URL = "postgres://synthetic.test/pc_supporter";
    const queries: string[] = [];
    const released: unknown[] = [];
    vi.doMock("pg", () => ({
      Pool: class {
        async query(sql: string) {
          queries.push(sql);
          expect(sql).toContain("CREATE TABLE IF NOT EXISTS background_jobs");
          return { rows: [], rowCount: 0 };
        }

        async connect() {
          return {
            async query(sql: string, values?: unknown[]) {
              queries.push(sql);
              if (sql === "SELECT 1") return { rows: [{ value: 1 }], rowCount: 1 };
              if (sql.includes("INSERT INTO background_jobs")) {
                const [id, kind, payloadJson, maxAttempts, availableAt, idempotencyKey] = values ?? [];
                return {
                  rows: [{
                    id,
                    kind,
                    status: "queued",
                    payload: JSON.parse(String(payloadJson)) as Record<string, unknown>,
                    attempt: 0,
                    max_attempts: maxAttempts,
                    available_at: new Date(String(availableAt)),
                    progress: null,
                    idempotency_key: idempotencyKey === null ? null : String(idempotencyKey),
                    result: null,
                    created_at: new Date("2026-09-29T12:00:00.000Z"),
                    updated_at: new Date("2026-09-29T12:00:00.000Z"),
                    finished_at: null,
                    lease_owner: null,
                    lease_token: null,
                    lease_expires_at: null,
                    error: null
                  }],
                  rowCount: 1
                };
              }
              return { rows: [], rowCount: 0 };
            },
            release(discard?: unknown) { released.push(discard); }
          };
        }
      }
    }));
    vi.resetModules();
    const repository = await import("./repository");

    await expect(repository.withPostgresTransaction("test durable job", async (client) => {
      await client.query("SELECT 1");
      return "done";
    })).resolves.toBe("done");
    expect(queries).toEqual(expect.arrayContaining(["BEGIN", "SELECT 1", "COMMIT"]));
    expect(queries.lastIndexOf("BEGIN")).toBeLessThan(queries.indexOf("SELECT 1"));
    expect(queries.indexOf("SELECT 1")).toBeLessThan(queries.lastIndexOf("COMMIT"));
    expect(released).toEqual([undefined, false]);
    const schemaLock = queries.findIndex((sql) => sql.includes("pg_advisory_xact_lock(hashtextextended($1, 0))"));
    const schemaDdl = queries.findIndex((sql) => sql.includes("CREATE TABLE IF NOT EXISTS background_jobs"));
    expect(schemaLock).toBeGreaterThanOrEqual(0);
    expect(schemaLock).toBeLessThan(schemaDdl);

    const { backgroundJobStore } = await import("./background-job-store");
    const persisted = await backgroundJobStore.enqueue({ kind: "price-refresh", payload: { catalog: "daily" } });
    expect(persisted).toMatchObject({ kind: "price-refresh", status: "queued", payload: { catalog: "daily" } });
    await expect(backgroundJobStore.claimNext("worker-contract")).resolves.toBeNull();
    expect(queries.some((sql) => sql.includes("FOR UPDATE SKIP LOCKED"))).toBe(true);
    expect(queries.filter((sql) => sql === "BEGIN")).toHaveLength(4);
    expect(queries.filter((sql) => sql === "COMMIT")).toHaveLength(4);
  });
});

describe("price-refresh PostgreSQL schema alignment", () => {
  it("keeps runtime DDL, the baseline schema, and additive migrations aligned", async () => {
    const [runtimeSource, baseline, backgroundMigration, attemptsMigration] = await Promise.all([
      readFile(new URL("./repository.ts", import.meta.url), "utf8"),
      readFile(new URL("../db/schema.sql", import.meta.url), "utf8"),
      readFile(new URL("../db/migrations/20260930_background_jobs.sql", import.meta.url), "utf8"),
      readFile(new URL("../db/migrations/20260930_price_refresh_attempts.sql", import.meta.url), "utf8")
    ]);
    const runtime = runtimeSource.match(/export const POSTGRES_SCHEMA_SQL = `([\s\S]*?)`;/)?.[1];
    expect(runtime).toBeTruthy();
    for (const surface of [runtime!, baseline, backgroundMigration]) {
      expect(surface).toContain("idempotency_key TEXT");
      expect(surface).toContain("result JSONB");
      expect(surface).toContain("background_jobs_kind_idempotency_idx");
    }
    for (const surface of [runtime!, baseline, attemptsMigration]) {
      expect(surface).toContain("CREATE TABLE IF NOT EXISTS price_refresh_attempts");
      expect(surface).toContain("item_kind TEXT NOT NULL");
      expect(surface).toContain("item_id TEXT NOT NULL");
      expect(surface).toContain("attempted_at TIMESTAMPTZ NOT NULL");
    }
  });
});
