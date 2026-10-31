#!/usr/bin/env node
// Root-operated postdeploy procedure. Defaults to a read-only audit.
import { createRequire } from "node:module";
import { readFile, lstat, realpath, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";

const require = createRequire(resolve(process.cwd(), "package.json"));
const { parse } = require("dotenv");
const { Client } = require("pg");
const args = process.argv.slice(2);
const refresh = args.includes("--refresh");
const reportArg = args.find((arg) => arg.startsWith("--output="));
const output = resolve(reportArg?.slice(9) || `/var/lib/pc-supporter/reports/gpu-prices-${Date.now()}.json`);
const maxRoundsArg = args.find((arg) => arg.startsWith("--max-rounds="));
const maxRounds = Number(maxRoundsArg?.slice(13) || 8);
if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 20 || args.some((arg) => !["--refresh", "--audit-only"].includes(arg) && !arg.startsWith("--output=") && !arg.startsWith("--max-rounds="))) throw new Error("Invalid procedure options");
const base = "http://127.0.0.1:4174";
const publicHost = "pc-supporter-71697d83-kc.koreacentral.cloudapp.azure.com";
const origin = `https://${publicHost}`;
let cookie = "";
const report = { startedAt: new Date().toISOString(), refreshRequested: refresh, maxPriceAgeHours: 12, jobs: [], before: null, after: null };
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function api(path, body, headers = {}) {
  const response = await fetch(base + path, { method: body ? "POST" : "GET", headers: { Host: publicHost, "X-Forwarded-Proto": "https", ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json", Origin: origin } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
  const result = await response.json();
  return { response, result };
}

function eligible(part) {
  if (part.category !== "gpu" || part.source !== "danawa" || part.delistedAt || !part.sourceProductCode || !part.danawaUrl) return false;
  const text = `${part.name} ${part.rawSpecText || ""}`;
  if (/\b(?:AORUS|GIGABYTE)\b.*\b(?:AI|GAMING)\s*BOX\b|\beGPU\b|(?:외장\s*그래픽|GPU)\s*(?:도크|독|박스|인클로저)|\b(?:external\s*GPU|GPU)\s*(?:dock|enclosure)\b/i.test(part.name)) return false;
  if (/(중고|리퍼|전시|반품|병행수입|해외구매|해외직구|직구)/i.test(text) || /(?:라이저\s*케이블|브라켓|지지대)/i.test(part.name)) return false;
  if (part.listingType && !["retail", "bulk", "unknown"].includes(part.listingType)) return false;
  return /\bRTX\s*50[0-9]{2}(?:\s*Ti)?\b/i.test(part.name) || /\bRX\s*90[0-9]{2}(?:\s*XT)?\b/i.test(part.name) || (/MSI/i.test(part.name) && /RTX\s*3050\b/i.test(part.name)) || (/AFOX/i.test(part.name) && /RX\s*580\b/i.test(part.name));
}

async function audit(client) {
  const { rows } = await client.query("SELECT payload FROM catalog_parts WHERE payload->>'category' = 'gpu'");
  const now = Date.now();
  const items = rows.map(({ payload }) => payload).filter(eligible).map((part) => {
    const observedAt = Math.max(0, ...[part.priceCheckedAt, part.priceUnavailableAt].map((date) => Date.parse(date || "")).filter(Number.isFinite));
    return { id: part.id, productCode: part.sourceProductCode, name: part.name, priceWon: part.priceWon, priceCheckedAt: part.priceCheckedAt, priceUnavailableAt: part.priceUnavailableAt, stale: observedAt === 0 || now - observedAt > 12 * 3600000, status: part.priceUnavailableAt && (!part.priceCheckedAt || Date.parse(part.priceUnavailableAt) >= Date.parse(part.priceCheckedAt)) ? "no_offers" : typeof part.priceWon === "number" && part.priceWon > 0 ? "priced" : "price_unknown" };
  });
  return { observedAt: new Date(now).toISOString(), total: items.length, stale: items.filter((item) => item.stale).length, priced: items.filter((item) => item.status === "priced").length, noOffers: items.filter((item) => item.status === "no_offers").length, unknown: items.filter((item) => item.status === "price_unknown").length, items };
}

async function waitJob(jobId) {
  const deadline = Date.now() + 40 * 60000;
  while (Date.now() < deadline) {
    const { response, result } = await api(`/api/admin/prices/refresh/status?jobId=${encodeURIComponent(jobId)}`);
    if (!response.ok) throw new Error("Price status request failed");
    const job = result.job;
    if (!job) throw new Error("Price job missing");
    if (!["queued", "running", "retry_wait"].includes(job.status)) return job;
    await sleep(10000);
  }
  throw new Error("Price job wait timed out; existing job was not cancelled");
}

let client;
try {
  const envPath = "/etc/pc-supporter/backend.env";
  const info = await lstat(envPath);
  if (process.getuid?.() !== 0 || await realpath(envPath) !== envPath || !info.isFile() || info.uid !== 0 || (info.mode & 0o137) !== 0) throw new Error("Verified root-owned backend env required");
  const env = parse(await readFile(envPath));
  const url = new URL(env.DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1"].includes(url.hostname) || (url.port || "5432") !== "5432" || decodeURIComponent(url.pathname.slice(1)) !== "pcsupporter") throw new Error("Database boundary mismatch");
  client = new Client({ connectionString: env.DATABASE_URL, password: decodeURIComponent(url.password) || env.PGPASSWORD, connectionTimeoutMillis: 10000, statement_timeout: 30000 });
  await client.connect();
  report.before = await audit(client);
  report.estimatedMinimumRounds = Math.ceil(report.before.stale / 80);
  console.log(JSON.stringify({ event: "gpu-price-audit.before", total: report.before.total, stale: report.before.stale, noOffers: report.before.noOffers, estimatedMinimumRounds: report.estimatedMinimumRounds, maxRounds }));
  if (refresh && report.before.stale > 0) {
    const login = await api("/api/admin/login", { password: env.ADMIN_PASSWORD });
    if (!login.response.ok || !login.result.authenticated) throw new Error("Local administrator login failed");
    cookie = login.response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    if (!cookie) throw new Error("Administrator session cookie missing");
    for (let round = 1; round <= maxRounds; round++) {
      const status = await api("/api/admin/prices/refresh/status");
      if (!status.response.ok) throw new Error("Price status request failed");
      if (status.result.job && ["queued", "running", "retry_wait"].includes(status.result.job.status)) {
        const existing = await waitJob(status.result.job.jobId);
        report.jobs.push({ existing: true, jobId: existing.jobId, status: existing.status, result: existing.result, error: existing.error });
      }
      const beforeRound = await audit(client);
      if (beforeRound.stale === 0) break;
      const started = await api("/api/admin/prices/refresh", { coreLimit: 100, accessoryLimit: 1, delayMs: 1200 }, { "Idempotency-Key": `gpu-oct12-${randomUUID()}` });
      if (started.response.status === 409) { await sleep(10000); continue; }
      if (started.response.status !== 202 || !started.result.jobId) throw new Error("Price refresh enqueue failed");
      const job = await waitJob(started.result.jobId);
      report.jobs.push({ round, jobId: job.jobId, status: job.status, result: job.result, error: job.error });
      const afterRound = await audit(client);
      console.log(JSON.stringify({ event: "gpu-price-audit.round", round, status: job.status, attempted: job.result?.attempted, succeeded: job.result?.succeeded, failed: job.result?.failed, stale: afterRound.stale }));
      if (afterRound.stale === 0) break;
      if (afterRound.stale >= beforeRound.stale) { report.stoppedReason = "No freshness progress; failed or deferred SKUs remain stale"; break; }
    }
  }
  report.after = await audit(client);
  report.completedAt = new Date().toISOString();
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ event: "gpu-price-audit.after", total: report.after.total, stale: report.after.stale, noOffers: report.after.noOffers, report: output }));
  if (refresh && report.after.stale > 0) process.exitCode = 2;
} catch {
  report.failureCode = "PROCEDURE_ABORTED";
  report.completedAt = new Date().toISOString();
  if (client) report.after = await audit(client).catch(() => null);
  await mkdir(dirname(output), { recursive: true, mode: 0o700 }).then(() => writeFile(output, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 })).catch(() => undefined);
  // Connection/auth exceptions can include credentials; never print their messages.
  console.error("GPU price procedure failed; check the local service and private configuration. No credentials were printed.");
  process.exitCode = 1;
} finally {
  if (cookie) await api("/api/admin/logout", {}).catch(() => undefined);
  if (client) await client.end().catch(() => undefined);
}
