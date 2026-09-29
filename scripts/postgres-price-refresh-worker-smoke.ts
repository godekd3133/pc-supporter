import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackgroundJobIdempotencyConflictError, backgroundJobStore, type BackgroundJobClaim } from "../server/background-job-store";
import { withPostgresTransaction } from "../server/repository";
import { startPriceRefreshQueueWorker } from "../server/price-refresh-worker";

const apiBaseUrl = process.env.PC_SUPPORTER_API_BASE_URL?.trim() || "http://127.0.0.1:4174";
const readerBaseUrl = process.env.PC_SUPPORTER_PRICE_REFRESH_READER_URL?.trim() || "http://api-reader:4174";
const phase = process.env.PC_SUPPORTER_PRICE_REFRESH_SMOKE_PHASE;
const adminPassword = process.env.ADMIN_PASSWORD?.trim();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function adminCookie(baseUrl: string) {
  assert(adminPassword, "ADMIN_PASSWORD must be supplied by the isolated smoke environment.");
  const health = await fetch(`${baseUrl}/api/health`);
  const healthBody = await health.json() as { ok?: boolean; persistence?: { ready?: boolean; storageMode?: string } };
  assert(health.ok && healthBody.ok === true && healthBody.persistence?.ready === true
    && healthBody.persistence.storageMode === "postgres", "Smoke API is not connected to ready PostgreSQL persistence.");
  const response = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: adminPassword })
  });
  assert(response.ok, `Admin login failed with HTTP ${response.status}.`);
  const cookie = response.headers.getSetCookie?.()[0] ?? response.headers.get("set-cookie");
  assert(cookie, "Admin login did not return its session cookie.");
  return cookie.split(";")[0];
}

async function submitDryRun(idempotencyKey: string, cookie: string) {
  return fetch(`${apiBaseUrl}/api/admin/prices/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      Cookie: cookie
    },
    body: JSON.stringify({ dryRun: true, coreLimit: 0, accessoryLimit: 0, delayMs: 0 })
  });
}

async function apiWorkerSmoke() {
  let workerReturnedHttp = false;
  try {
    await fetch("http://worker:4174/api/health", { signal: AbortSignal.timeout(1_000) });
    workerReturnedHttp = true;
  } catch {
    // Connection refusal is the expected result: the worker owns no public HTTP listener.
  }
  assert(!workerReturnedHttp, "Worker role unexpectedly opened an HTTP listener on the API port.");

  const apiCookie = await adminCookie(apiBaseUrl);
  const readerCookie = await adminCookie(readerBaseUrl);
  const key = `pc-supporter-smoke:${randomUUID()}`;
  const first = await submitDryRun(key, apiCookie);
  const firstBody = await first.json() as { accepted?: boolean; dryRun?: boolean; jobId?: string; statusUrl?: string };
  assert(first.status === 202 && firstBody.accepted === true && firstBody.dryRun === true, "API did not durably accept the synthetic dry-run.");
  assert(typeof firstBody.jobId === "string" && typeof firstBody.statusUrl === "string", "API response omitted the job id or status URL.");

  const duplicate = await submitDryRun(key, apiCookie);
  const duplicateBody = await duplicate.json() as { jobId?: string };
  assert(duplicate.status === 202 && duplicateBody.jobId === firstBody.jobId, "The same active caller idempotency key was not deduplicated.");

  const statusUrl = new URL(firstBody.statusUrl, readerBaseUrl);
  let statusResponse: Response | undefined;
  let projected: { job?: { status?: string; attempt?: number; result?: Record<string, unknown> | null } } | undefined;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    statusResponse = await fetch(statusUrl, { headers: { Cookie: readerCookie } });
    if (statusResponse.ok) {
      projected = await statusResponse.json() as typeof projected;
      if (["succeeded", "failed"].includes(projected.job?.status ?? "")) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert(statusResponse?.ok && projected?.job?.status === "succeeded", "A second API context did not observe worker completion.");
  assert(projected.job.attempt === 1 && projected.job.result?.attempted === 0, "Worker result did not match the synthetic zero-item run.");
  const serialized = JSON.stringify(projected);
  for (const forbidden of ["payload", "leaseOwner", "leaseToken", "leaseExpiresAt", "idempotencyKey", "sourceHtml", "danawaUrl"]) {
    assert(!serialized.includes(forbidden), `Status projection exposed forbidden field ${forbidden}.`);
  }

  const unrelated = await backgroundJobStore.enqueue({ kind: "catalog-ingestion", payload: { smoke: true } });
  const filteredClaim = await backgroundJobStore.claimNext(`filter-smoke-${process.pid}`, 1_000, ["price-refresh"]);
  assert(filteredClaim === null, "Price-refresh worker claim filter selected an unrelated job.");
  assert((await backgroundJobStore.getById(unrelated.id))?.status === "queued", "Kind-filtered claim mutated an unrelated job.");
  console.log("PostgreSQL price-refresh API/worker smoke passed: 202, idempotency, second-API status projection, and kind filtering.");
}

async function crashReclaimSmoke() {
  const idempotencyKey = `price-refresh:crash-smoke:${randomUUID()}`;
  const queued = await backgroundJobStore.enqueue({
    kind: "price-refresh",
    payload: { dryRun: true, coreLimit: 0, accessoryLimit: 0, delayMs: 0 },
    idempotencyKey,
    availableAt: new Date(Date.now() + 60 * 60_000)
  });
  const deduplicated = await backgroundJobStore.enqueue({
    kind: "price-refresh",
    payload: { dryRun: true, coreLimit: 0, accessoryLimit: 0, delayMs: 0 },
    idempotencyKey,
    availableAt: new Date(Date.now() + 60 * 60_000)
  });
  assert(deduplicated.id === queued.id, "PostgreSQL idempotency key did not return the existing job.");
  let mismatchedPayloadRejected = false;
  try {
    await backgroundJobStore.enqueue({
      kind: "price-refresh",
      payload: { dryRun: true, coreLimit: 1, accessoryLimit: 0, delayMs: 0 },
      idempotencyKey,
      availableAt: new Date(Date.now() + 60 * 60_000)
    });
  } catch (error) {
    mismatchedPayloadRejected = error instanceof BackgroundJobIdempotencyConflictError;
  }
  assert(mismatchedPayloadRejected, "Reusing the same idempotency key with changed options was not rejected.");
  await withPostgresTransaction("make crash smoke job available", async (client) => {
    await client.query("UPDATE background_jobs SET available_at = clock_timestamp() WHERE id = $1::uuid AND status = 'queued'", [queued.id]);
  });

  const markerDirectory = await mkdtemp(join(tmpdir(), "pc-supporter-price-refresh-crash-"));
  const markerPath = join(markerDirectory, "handler-started.json");
  const crashedOwner = `crashed-child-${randomUUID().slice(0, 8)}`;
  const scriptPath = new URL("./postgres-price-refresh-worker-smoke.ts", import.meta.url).pathname;
  const child = spawn(process.execPath, ["--import", "tsx", scriptPath], {
    env: {
      ...process.env,
      PC_SUPPORTER_PRICE_REFRESH_SMOKE_PHASE: "crash-owner",
      PC_SUPPORTER_PRICE_REFRESH_SMOKE_JOB_ID: queued.id,
      PC_SUPPORTER_PRICE_REFRESH_SMOKE_OWNER: crashedOwner,
      PC_SUPPORTER_PRICE_REFRESH_SMOKE_MARKER: markerPath
    },
    stdio: "ignore"
  });
  let childStartError: Error | undefined;
  child.on("error", (error) => { childStartError = error; });
  const waitForChildExit = () => new Promise<void>((resolveExit) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolveExit();
    child.once("exit", () => resolveExit());
  });
  let crashedClaim: BackgroundJobClaim | undefined;
  try {
    const markerDeadline = Date.now() + 10_000;
    while (Date.now() < markerDeadline && !crashedClaim) {
      try {
        const marker = JSON.parse(await readFile(markerPath, "utf8")) as { owner?: string };
        const current = await backgroundJobStore.getById(queued.id);
        if (marker.owner === crashedOwner && current?.status === "running" && current.leaseOwner === crashedOwner && current.leaseToken) {
          crashedClaim = { owner: crashedOwner, token: current.leaseToken };
        }
      } catch {
        if (childStartError) throw childStartError;
      }
      if (!crashedClaim) {
        if (childStartError) throw childStartError;
        if (child.exitCode !== null || child.signalCode !== null) throw new Error("Queue worker child exited before entering the controlled handler.");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    assert(crashedClaim?.owner === crashedOwner && crashedClaim.token, "Queue worker process did not own the expected live lease.");
    child.kill("SIGKILL");
    await waitForChildExit();
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await waitForChildExit();
    }
    await rm(markerDirectory, { recursive: true, force: true });
  }
  if (!crashedClaim?.token) throw new Error("Synthetic worker claim token is missing.");

  await new Promise((resolve) => setTimeout(resolve, 3_250));
  const reclaimed = await backgroundJobStore.claimNext(`replacement-smoke-${process.pid}`, 1_000, ["price-refresh"]);
  assert(reclaimed?.id === queued.id && reclaimed.attempt === 2 && reclaimed.leaseToken, "The crashed process's expired lease was not reclaimed by a replacement worker.");

  const staleClaim = crashedClaim;
  assert(!await backgroundJobStore.heartbeat(queued.id, staleClaim), "Expired claim unexpectedly extended its lease.");
  assert(!await backgroundJobStore.updateProgress(queued.id, staleClaim, { phase: "persisting" }), "Stale claim unexpectedly wrote progress.");
  assert(!await backgroundJobStore.complete(queued.id, staleClaim, { phase: "finalizing" }, { attempted: 999 }), "Stale claim unexpectedly completed the job.");
  assert(await backgroundJobStore.complete(queued.id, { owner: reclaimed.leaseOwner!, token: reclaimed.leaseToken }, { phase: "finalizing" }, { dryRun: true, attempted: 0, succeeded: 0, changed: 0, failed: 0 }), "Replacement claim could not complete its lease.");
  assert((await backgroundJobStore.getById(queued.id))?.attempt === 2, "Crash-recovered attempt count was not persisted.");
  console.log("PostgreSQL price-refresh recovery smoke passed: killed queue worker child, expired lease reclaim, and stale-token fencing.");
}

async function crashOwnerChild() {
  const jobId = process.env.PC_SUPPORTER_PRICE_REFRESH_SMOKE_JOB_ID ?? "";
  const owner = process.env.PC_SUPPORTER_PRICE_REFRESH_SMOKE_OWNER ?? "";
  const markerPath = process.env.PC_SUPPORTER_PRICE_REFRESH_SMOKE_MARKER ?? "";
  assert(jobId && owner && markerPath, "Crash-owner child inputs are incomplete.");
  const worker = startPriceRefreshQueueWorker({
    owner,
    leaseDurationMs: 3_000,
    pollIntervalMs: 100,
    run: async () => {
      await writeFile(markerPath, `${JSON.stringify({ owner, jobId })}\n`, { mode: 0o600 });
      return await new Promise<never>(() => undefined);
    }
  });
  await worker.start();
}

assert(Boolean(process.env.DATABASE_URL?.trim()), "DATABASE_URL is required for the PostgreSQL smoke.");
if (phase === "crash-owner") await crashOwnerChild();
else if (phase === "api-worker") await apiWorkerSmoke();
else if (phase === "recovery") await crashReclaimSmoke();
else throw new Error("Set PC_SUPPORTER_PRICE_REFRESH_SMOKE_PHASE to api-worker or recovery.");
