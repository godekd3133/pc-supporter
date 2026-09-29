/** PostgreSQL-only durable queue used by isolated API and worker processes. */
import { randomUUID } from "node:crypto";
import { withPostgresTransaction, type PostgresTransactionRunner } from "./repository";

export const BACKGROUND_JOB_KINDS = [
  "catalog-ingestion",
  "price-refresh",
  "saved-build-monitor"
] as const;

export type BackgroundJobKind = typeof BACKGROUND_JOB_KINDS[number];
export type BackgroundJobStatus = "queued" | "running" | "succeeded" | "failed";

export const BACKGROUND_JOB_PROGRESS_PHASES = [
  "initializing",
  "fetching",
  "parsing",
  "validating",
  "calculating",
  "persisting",
  "publishing",
  "finalizing",
  "retry_wait"
] as const;

export type BackgroundJobProgressPhase = typeof BACKGROUND_JOB_PROGRESS_PHASES[number];
export type BackgroundJobErrorCode =
  | "WORKER_FAILED"
  | "DEPENDENCY_UNAVAILABLE"
  | "VALIDATION_FAILED"
  | "LEASE_EXPIRED"
  | "ATTEMPTS_EXHAUSTED";

export interface BackgroundJobProgress {
  phase: BackgroundJobProgressPhase;
  completed?: number;
  total?: number;
}

export interface BackgroundJobError {
  code: BackgroundJobErrorCode;
  retryable: boolean;
}

export interface BackgroundJob {
  id: string;
  kind: BackgroundJobKind;
  status: BackgroundJobStatus;
  payload: Record<string, unknown>;
  idempotencyKey: string | null;
  result: Record<string, unknown> | null;
  attempt: number;
  maxAttempts: number;
  availableAt: string;
  progress: BackgroundJobProgress | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  leaseOwner: string | null;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  error: BackgroundJobError | null;
}

export interface BackgroundJobClaim {
  owner: string;
  token: string;
}

export interface EnqueueBackgroundJobInput {
  kind: BackgroundJobKind;
  payload: Record<string, unknown>;
  maxAttempts?: number;
  availableAt?: Date;
  idempotencyKey?: string;
  deduplicateActive?: boolean;
}

export interface BackgroundJobStore {
  enqueue(input: EnqueueBackgroundJobInput): Promise<BackgroundJob>;
  claimNext(owner: string, leaseDurationMs?: number, kinds?: readonly BackgroundJobKind[]): Promise<BackgroundJob | null>;
  heartbeat(id: string, claim: BackgroundJobClaim, leaseDurationMs?: number): Promise<boolean>;
  updateProgress(id: string, claim: BackgroundJobClaim, progress: BackgroundJobProgress): Promise<boolean>;
  complete(id: string, claim: BackgroundJobClaim, progress?: BackgroundJobProgress, result?: Record<string, unknown>): Promise<boolean>;
  fail(id: string, claim: BackgroundJobClaim, error: BackgroundJobError, retryDelayMs?: number): Promise<boolean>;
  requeue(id: string, claim: BackgroundJobClaim, delayMs?: number): Promise<boolean>;
  getById(id: string): Promise<BackgroundJob | null>;
  getLatestByKind(kind: BackgroundJobKind): Promise<BackgroundJob | null>;
  getActiveByKind(kind: BackgroundJobKind): Promise<BackgroundJob | null>;
  pruneFinished(retentionDays?: number, limit?: number): Promise<number>;
}

export class BackgroundJobIdempotencyConflictError extends Error {
  constructor() {
    super("The idempotency key is already associated with a different job payload.");
    this.name = "BackgroundJobIdempotencyConflictError";
  }
}

export class BackgroundJobActiveConflictError extends Error {
  constructor() {
    super("A price-refresh job with different options is already queued or running.");
    this.name = "BackgroundJobActiveConflictError";
  }
}

const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_PAYLOAD_DEPTH = 16;
const MAX_PAYLOAD_NODES = 2_000;
const MIN_LEASE_MS = 1_000;
const MAX_LEASE_MS = 10 * 60 * 1_000;
const DEFAULT_LEASE_MS = 60 * 1_000;
const MAX_DELAY_MS = 24 * 60 * 60 * 1_000;
const MAX_ATTEMPTS = 20;
const MAX_PROGRESS_COUNT = 1_000_000_000;
const MAX_PRUNE_BATCH = 250;
const MAX_RETENTION_DAYS = 3_650;

const progressPhases = new Set<string>(BACKGROUND_JOB_PROGRESS_PHASES);
const jobKinds = new Set<string>(BACKGROUND_JOB_KINDS);
const jobErrorCodes = new Set<string>([
  "WORKER_FAILED",
  "DEPENDENCY_UNAVAILABLE",
  "VALIDATION_FAILED",
  "LEASE_EXPIRED",
  "ATTEMPTS_EXHAUSTED"
]);

type QueryResult<Row> = { rows: Row[]; rowCount?: number | null };
type QueryClient = {
  query<Row = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<QueryResult<Row>>;
};

interface BackgroundJobRow {
  id: string;
  kind: string;
  status: string;
  payload: unknown;
  attempt: number;
  max_attempts: number;
  available_at: Date | string;
  progress: unknown;
  idempotency_key: string | null;
  result: unknown;
  created_at: Date | string;
  updated_at: Date | string;
  finished_at: Date | string | null;
  lease_owner: string | null;
  lease_token: string | null;
  lease_expires_at: Date | string | null;
  error: unknown;
}

type TransactionRunner = PostgresTransactionRunner;

interface BackgroundJobStoreDependencies {
  transactionRunner?: TransactionRunner;
  now?: () => number;
  createId?: () => string;
}

function invalid(message: string): never {
  throw new TypeError(`Invalid background job ${message}.`);
}

function assertKind(value: unknown): asserts value is BackgroundJobKind {
  if (typeof value !== "string" || !jobKinds.has(value)) invalid("kind");
}

function assertUuid(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) invalid(field);
}

function assertOwner(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) invalid("lease owner");
}

function assertIdempotencyKey(value: unknown): asserts value is string | undefined {
  if (value === undefined) return;
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) invalid("idempotency key");
}

function assertKinds(value: unknown): asserts value is readonly BackgroundJobKind[] | undefined {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length === 0 || value.length > BACKGROUND_JOB_KINDS.length
    || value.some((kind) => typeof kind !== "string" || !jobKinds.has(kind))
    || new Set(value).size !== value.length) invalid("claim kinds");
}

function assertClaim(value: unknown): asserts value is BackgroundJobClaim {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("claim");
  const claim = value as Record<string, unknown>;
  assertOwner(claim.owner);
  assertUuid(claim.token, "lease token");
}

function assertDelay(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > MAX_DELAY_MS) invalid(field);
}

function assertLeaseDuration(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < MIN_LEASE_MS || Number(value) > MAX_LEASE_MS) invalid("lease duration");
}

function assertPlainRecord(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(field);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid(field);
}

function assertJsonValue(value: unknown, field: string, depth: number, nodes: { count: number }, seen: Set<object>): void {
  nodes.count += 1;
  if (nodes.count > MAX_PAYLOAD_NODES || depth > MAX_PAYLOAD_DEPTH) invalid(`${field} complexity`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid(`${field} number`);
    return;
  }
  if (typeof value !== "object") invalid(`${field} JSON value`);
  if (seen.has(value)) invalid(`${field} circular reference`);
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertJsonValue(item, field, depth + 1, nodes, seen);
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) invalid(`${field} object`);
    for (const [key, item] of Object.entries(value)) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") invalid(`${field} key`);
      assertJsonValue(item, field, depth + 1, nodes, seen);
    }
  }
  seen.delete(value);
}

function serializePayload(value: unknown): { value: Record<string, unknown>; json: string } {
  assertPlainRecord(value, "payload");
  assertJsonValue(value, "payload", 0, { count: 0 }, new Set());
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, "utf8") > MAX_PAYLOAD_BYTES) invalid("payload size");
  return { value: JSON.parse(json) as Record<string, unknown>, json };
}

function serializeProgress(value: unknown): { value: BackgroundJobProgress; json: string } {
  assertPlainRecord(value, "progress");
  const keys = Object.keys(value);
  if (keys.some((key) => !["phase", "completed", "total"].includes(key))) invalid("progress fields");
  const { phase, completed, total } = value;
  if (typeof phase !== "string" || !progressPhases.has(phase)) invalid("progress phase");
  if (completed !== undefined && (!Number.isSafeInteger(completed) || Number(completed) < 0 || Number(completed) > MAX_PROGRESS_COUNT)) invalid("progress completed count");
  if (total !== undefined && (!Number.isSafeInteger(total) || Number(total) < 0 || Number(total) > MAX_PROGRESS_COUNT)) invalid("progress total count");
  if (completed !== undefined && total !== undefined && Number(completed) > Number(total)) invalid("progress range");
  const normalized: BackgroundJobProgress = {
    phase: phase as BackgroundJobProgressPhase,
    ...(completed === undefined ? {} : { completed: Number(completed) }),
    ...(total === undefined ? {} : { total: Number(total) })
  };
  const json = JSON.stringify(normalized);
  if (Buffer.byteLength(json, "utf8") > 256) invalid("progress size");
  return { value: normalized, json };
}

function serializeJobError(value: unknown): { value: BackgroundJobError; json: string } {
  assertPlainRecord(value, "error");
  const keys = Object.keys(value);
  if (keys.some((key) => !["code", "retryable"].includes(key))) invalid("error fields");
  const { code, retryable } = value;
  if (typeof code !== "string" || !jobErrorCodes.has(code)) invalid("error code");
  if (typeof retryable !== "boolean") invalid("error retryability");
  if (code === "ATTEMPTS_EXHAUSTED" && retryable) invalid("terminal error retryability");
  const normalized: BackgroundJobError = { code: code as BackgroundJobErrorCode, retryable };
  const json = JSON.stringify(normalized);
  if (Buffer.byteLength(json, "utf8") > 128) invalid("error size");
  return { value: normalized, json };
}

function isoDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("PostgreSQL returned an invalid background job timestamp.");
  return date.toISOString();
}

function nullableIsoDate(value: Date | string | null): string | null {
  return value === null ? null : isoDate(value);
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("PostgreSQL returned invalid background job JSON.");
  return value as Record<string, unknown>;
}

function progressFromDatabase(value: unknown): BackgroundJobProgress | null {
  if (value === null) return null;
  return serializeProgress(objectRecord(value)).value;
}

function errorFromDatabase(value: unknown): BackgroundJobError | null {
  if (value === null) return null;
  return serializeJobError(objectRecord(value)).value;
}

function resultFromDatabase(value: unknown): Record<string, unknown> | null {
  if (value === null) return null;
  return serializePayload(objectRecord(value)).value;
}

function backgroundJobFromRow(row: BackgroundJobRow): BackgroundJob {
  if (!jobKinds.has(row.kind) || !["queued", "running", "succeeded", "failed"].includes(row.status)) {
    throw new Error("PostgreSQL returned an unknown background job kind or status.");
  }
  const payload = serializePayload(objectRecord(row.payload)).value;
  if (!Number.isSafeInteger(row.attempt) || !Number.isSafeInteger(row.max_attempts)) {
    throw new Error("PostgreSQL returned invalid background job attempt counts.");
  }
  return {
    id: row.id,
    kind: row.kind as BackgroundJobKind,
    status: row.status as BackgroundJobStatus,
    payload,
    idempotencyKey: row.idempotency_key,
    result: resultFromDatabase(row.result),
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    availableAt: isoDate(row.available_at),
    progress: progressFromDatabase(row.progress),
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at),
    finishedAt: nullableIsoDate(row.finished_at),
    leaseOwner: row.lease_owner,
    leaseToken: row.lease_token,
    leaseExpiresAt: nullableIsoDate(row.lease_expires_at),
    error: errorFromDatabase(row.error)
  };
}

function queryClient(client: QueryClient) {
  return client as QueryClient;
}

export function createBackgroundJobStore(dependencies: BackgroundJobStoreDependencies = {}): BackgroundJobStore {
  const runTransaction = dependencies.transactionRunner ?? withPostgresTransaction;
  const now = dependencies.now ?? Date.now;
  const createId = dependencies.createId ?? randomUUID;

  async function updateOwnedJob(
    operation: string,
    sql: string,
    id: string,
    claim: BackgroundJobClaim,
    values: unknown[]
  ): Promise<boolean> {
    assertUuid(id, "id");
    assertClaim(claim);
    return runTransaction(operation, async (client) => {
      const result = await queryClient(client).query<{ id: string }>(sql, [id, claim.owner, claim.token, ...values]);
      return result.rows.length > 0;
    });
  }

  return {
    async enqueue(input) {
      if (!input || typeof input !== "object") invalid("input");
      assertKind(input.kind);
      assertIdempotencyKey(input.idempotencyKey);
      if (input.deduplicateActive !== undefined && typeof input.deduplicateActive !== "boolean") invalid("active deduplication");
      if (input.deduplicateActive && input.kind !== "price-refresh") invalid("active deduplication kind");
      const payload = serializePayload(input.payload);
      const maxAttempts = input.maxAttempts ?? 5;
      if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_ATTEMPTS) invalid("max attempts");
      const availableAt = input.availableAt ?? new Date(now());
      if (!(availableAt instanceof Date) || !Number.isFinite(availableAt.getTime())) invalid("available-at timestamp");
      const id = createId();
      assertUuid(id, "generated id");
      return runTransaction("enqueue background job", async (client) => {
        if (input.kind === "price-refresh") {
          await queryClient(client).query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            ["pc-supporter:background-job-active:price-refresh"]
          );
        }
        if (input.deduplicateActive) {
          const matching = await queryClient(client).query<BackgroundJobRow>(`
            SELECT * FROM background_jobs
            WHERE kind = $1 AND status IN ('queued', 'running') AND payload = $2::jsonb
            ORDER BY created_at ASC, id ASC
            LIMIT 1
            FOR UPDATE
          `, [input.kind, payload.json]);
          if (matching.rows[0]) return backgroundJobFromRow(matching.rows[0]);
          const active = await queryClient(client).query<{ id: string }>(`
            SELECT id FROM background_jobs
            WHERE kind = $1 AND status IN ('queued', 'running')
            ORDER BY created_at ASC, id ASC
            LIMIT 1
            FOR UPDATE
          `, [input.kind]);
          if (active.rows[0]) throw new BackgroundJobActiveConflictError();
        }
        const result = await queryClient(client).query<BackgroundJobRow>(`
          INSERT INTO background_jobs (id, kind, status, payload, attempt, max_attempts, available_at, idempotency_key)
          VALUES ($1::uuid, $2, 'queued', $3::jsonb, 0, $4, $5::timestamptz, $6)
          ON CONFLICT (kind, idempotency_key) DO UPDATE
            SET idempotency_key = EXCLUDED.idempotency_key
            WHERE background_jobs.payload = EXCLUDED.payload
              AND background_jobs.max_attempts = EXCLUDED.max_attempts
          RETURNING *
        `, [id, input.kind, payload.json, maxAttempts, availableAt.toISOString(), input.idempotencyKey ?? null]);
        const row = result.rows[0];
        if (!row && input.idempotencyKey) throw new BackgroundJobIdempotencyConflictError();
        if (!row) throw new Error("PostgreSQL did not return the enqueued background job.");
        return backgroundJobFromRow(row);
      });
    },

    async claimNext(owner, leaseDurationMs = DEFAULT_LEASE_MS, kinds) {
      assertOwner(owner);
      assertLeaseDuration(leaseDurationMs);
      assertKinds(kinds);
      const token = createId();
      assertUuid(token, "generated lease token");
      return runTransaction("claim background job", async (client) => {
        await queryClient(client).query(`
          UPDATE background_jobs
          SET status = CASE WHEN attempt >= max_attempts THEN 'failed' ELSE 'queued' END,
              available_at = CASE WHEN attempt >= max_attempts THEN available_at ELSE clock_timestamp() END,
              finished_at = CASE WHEN attempt >= max_attempts THEN clock_timestamp() ELSE NULL END,
              error = CASE
                WHEN attempt >= max_attempts THEN '{"code":"ATTEMPTS_EXHAUSTED","retryable":false}'::jsonb
                ELSE '{"code":"LEASE_EXPIRED","retryable":true}'::jsonb
              END,
              lease_owner = NULL,
              lease_token = NULL,
              lease_expires_at = NULL,
              updated_at = clock_timestamp()
          WHERE status = 'running' AND lease_expires_at <= clock_timestamp()
            AND ($1::text[] IS NULL OR kind = ANY($1::text[]))
        `, [kinds ?? null]);
        await queryClient(client).query(`
          UPDATE background_jobs
          SET status = 'failed',
              finished_at = clock_timestamp(),
              error = '{"code":"ATTEMPTS_EXHAUSTED","retryable":false}'::jsonb,
              lease_owner = NULL,
              lease_token = NULL,
              lease_expires_at = NULL,
              updated_at = clock_timestamp()
          WHERE status = 'queued' AND attempt >= max_attempts
            AND ($1::text[] IS NULL OR kind = ANY($1::text[]))
        `, [kinds ?? null]);
        const result = await queryClient(client).query<BackgroundJobRow>(`
          WITH candidate AS (
            SELECT id
            FROM background_jobs
            WHERE status = 'queued'
              AND attempt < max_attempts
              AND available_at <= clock_timestamp()
              AND ($4::text[] IS NULL OR kind = ANY($4::text[]))
            ORDER BY available_at ASC, created_at ASC, id ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
          )
          UPDATE background_jobs AS job
          SET status = 'running',
              attempt = job.attempt + 1,
              lease_owner = $1,
              lease_token = $2::uuid,
              lease_expires_at = clock_timestamp() + ($3 * INTERVAL '1 millisecond'),
              updated_at = clock_timestamp()
          FROM candidate
          WHERE job.id = candidate.id
          RETURNING job.*
        `, [owner, token, leaseDurationMs, kinds ?? null]);
        const row = result.rows[0];
        return row ? backgroundJobFromRow(row) : null;
      });
    },

    async heartbeat(id, claim, leaseDurationMs = DEFAULT_LEASE_MS) {
      assertLeaseDuration(leaseDurationMs);
      return updateOwnedJob("heartbeat background job", `
        UPDATE background_jobs
        SET lease_expires_at = clock_timestamp() + ($4 * INTERVAL '1 millisecond'),
            updated_at = clock_timestamp()
        WHERE id = $1::uuid
          AND status = 'running'
          AND lease_owner = $2
          AND lease_token = $3::uuid
          AND lease_expires_at > clock_timestamp()
        RETURNING id
      `, id, claim, [leaseDurationMs]);
    },

    async updateProgress(id, claim, progress) {
      const serialized = serializeProgress(progress);
      return updateOwnedJob("update background job progress", `
        UPDATE background_jobs
        SET progress = $4::jsonb,
            updated_at = clock_timestamp()
        WHERE id = $1::uuid
          AND status = 'running'
          AND lease_owner = $2
          AND lease_token = $3::uuid
          AND lease_expires_at > clock_timestamp()
        RETURNING id
      `, id, claim, [serialized.json]);
    },

    async complete(id, claim, progress, result) {
      const serialized = progress === undefined ? undefined : serializeProgress(progress);
      const serializedResult = result === undefined ? undefined : serializePayload(result);
      return updateOwnedJob("complete background job", `
        UPDATE background_jobs
        SET status = 'succeeded',
            progress = COALESCE($4::jsonb, progress),
            result = $5::jsonb,
            error = NULL,
            finished_at = clock_timestamp(),
            lease_owner = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            updated_at = clock_timestamp()
        WHERE id = $1::uuid
          AND status = 'running'
          AND lease_owner = $2
          AND lease_token = $3::uuid
          AND lease_expires_at > clock_timestamp()
        RETURNING id
      `, id, claim, [serialized?.json ?? null, serializedResult?.json ?? null]);
    },

    async fail(id, claim, error, retryDelayMs = 0) {
      const serialized = serializeJobError(error);
      assertDelay(retryDelayMs, "retry delay");
      return updateOwnedJob("fail background job", `
        UPDATE background_jobs
        SET status = CASE WHEN $4::boolean AND attempt < max_attempts THEN 'queued' ELSE 'failed' END,
            available_at = CASE WHEN $4::boolean AND attempt < max_attempts
              THEN clock_timestamp() + ($5 * INTERVAL '1 millisecond') ELSE available_at END,
            finished_at = CASE WHEN $4::boolean AND attempt < max_attempts THEN NULL ELSE clock_timestamp() END,
            error = jsonb_set($6::jsonb, '{retryable}', to_jsonb($4::boolean AND attempt < max_attempts), true),
            lease_owner = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            updated_at = clock_timestamp()
        WHERE id = $1::uuid
          AND status = 'running'
          AND lease_owner = $2
          AND lease_token = $3::uuid
          AND lease_expires_at > clock_timestamp()
        RETURNING id
      `, id, claim, [serialized.value.retryable, retryDelayMs, serialized.json]);
    },

    async requeue(id, claim, delayMs = 0) {
      assertDelay(delayMs, "requeue delay");
      return updateOwnedJob("requeue background job", `
        UPDATE background_jobs
        SET status = CASE WHEN attempt < max_attempts THEN 'queued' ELSE 'failed' END,
            available_at = CASE WHEN attempt < max_attempts
              THEN clock_timestamp() + ($4 * INTERVAL '1 millisecond') ELSE available_at END,
            finished_at = CASE WHEN attempt < max_attempts THEN NULL ELSE clock_timestamp() END,
            error = CASE WHEN attempt < max_attempts THEN error
              ELSE '{"code":"ATTEMPTS_EXHAUSTED","retryable":false}'::jsonb END,
            lease_owner = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            updated_at = clock_timestamp()
        WHERE id = $1::uuid
          AND status = 'running'
          AND lease_owner = $2
          AND lease_token = $3::uuid
          AND lease_expires_at > clock_timestamp()
        RETURNING id
      `, id, claim, [delayMs]);
    },

    async getById(id) {
      assertUuid(id, "id");
      return runTransaction("read background job", async (client) => {
        const result = await queryClient(client).query<BackgroundJobRow>(
          "SELECT * FROM background_jobs WHERE id = $1::uuid",
          [id]
        );
        const row = result.rows[0];
        return row ? backgroundJobFromRow(row) : null;
      });
    },

    async getLatestByKind(kind) {
      assertKind(kind);
      return runTransaction("read latest background job", async (client) => {
        const result = await queryClient(client).query<BackgroundJobRow>(`
          SELECT * FROM background_jobs
          WHERE kind = $1
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        `, [kind]);
        const row = result.rows[0];
        return row ? backgroundJobFromRow(row) : null;
      });
    },

    async getActiveByKind(kind) {
      assertKind(kind);
      return runTransaction("read active background job", async (client) => {
        const result = await queryClient(client).query<BackgroundJobRow>(`
          SELECT * FROM background_jobs
          WHERE kind = $1 AND status IN ('queued', 'running')
          ORDER BY created_at ASC, id ASC
          LIMIT 1
        `, [kind]);
        const row = result.rows[0];
        return row ? backgroundJobFromRow(row) : null;
      });
    },

    async pruneFinished(retentionDays = 90, limit = 250) {
      if (!Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > MAX_RETENTION_DAYS) invalid("retention days");
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PRUNE_BATCH) invalid("prune batch size");
      return runTransaction("prune finished background jobs", async (client) => {
        const result = await queryClient(client).query<{ id: string }>(`
          WITH expired AS (
            SELECT id FROM background_jobs
            WHERE status IN ('succeeded', 'failed')
              AND finished_at < clock_timestamp() - ($1 * INTERVAL '1 day')
            ORDER BY finished_at ASC, id ASC
            FOR UPDATE SKIP LOCKED
            LIMIT $2
          )
          DELETE FROM background_jobs AS job
          USING expired
          WHERE job.id = expired.id
          RETURNING job.id
        `, [retentionDays, limit]);
        return result.rows.length;
      });
    }
  };
}

export const backgroundJobStore = createBackgroundJobStore();
