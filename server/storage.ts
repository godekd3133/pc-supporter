import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";

const configuredDataDirectory = process.env.PC_SUPPORTER_DATA_DIR?.trim();
export const DATA_DIR = configuredDataDirectory ? resolve(configuredDataDirectory) : resolve(process.cwd(), "data");
export const CATALOG_PATH = resolve(DATA_DIR, "catalog.json");
export const ACCESSORIES_PATH = resolve(DATA_DIR, "accessories.json");
export const BUILDS_PATH = resolve(DATA_DIR, "builds.json");
export const SAVED_BUILD_VERSION_LEASE_PATH = resolve(DATA_DIR, "saved-build-version.lease");
export const SAVED_BUILD_VERSION_BACKUP_PATH = resolve(DATA_DIR, "saved-build-version-backup.json");
export const SAVED_BUILD_MONITOR_LEASE_PATH = resolve(DATA_DIR, "saved-build-monitor.lease");
export const CRAWL_STATE_PATH = resolve(DATA_DIR, "crawl-state.json");
export const CRAWL_LOCK_PATH = resolve(DATA_DIR, "crawl.lock");
export const CRAWL_MANIFEST_PATH = resolve(DATA_DIR, "crawl-manifest.json");
export const M2_SLOT_OVERRIDES_PATH = resolve(DATA_DIR, "m2-slot-overrides.json");
export const GPU_PHYSICAL_OVERRIDES_PATH = resolve(DATA_DIR, "gpu-physical-overrides.json");
export const PHYSICAL_SOURCE_CHECK_HISTORY_PATH = resolve(DATA_DIR, "physical-source-check-history.json");
export const BENCHMARK_OVERRIDES_PATH = resolve(DATA_DIR, "benchmark-overrides.json");
export const CASE_RGB_LOAD_OVERRIDES_PATH = resolve(DATA_DIR, "case-rgb-load-overrides.json");
export const COOLING_FAN_LOAD_OVERRIDES_PATH = resolve(DATA_DIR, "cooling-fan-load-overrides.json");
export const ACCESSORY_CRAWL_STATE_PATH = resolve(DATA_DIR, "accessory-crawl-state.json");
export const ACCESSORY_CRAWL_LOCK_PATH = resolve(DATA_DIR, "accessory-crawl.lock");
export const ACCESSORY_CRAWL_MANIFEST_PATH = resolve(DATA_DIR, "accessory-crawl-manifest.json");
export const ACCESSORY_COVERAGE_PATH = resolve(DATA_DIR, "accessory-coverage.json");
export const CATALOG_CHANGE_LOG_PATH = resolve(DATA_DIR, "catalog-change-log.json");
export const WATCHLISTS_PATH = resolve(DATA_DIR, "watchlists.json");
export const WATCHLIST_ALERT_STATES_PATH = resolve(DATA_DIR, "watchlist-alert-states.json");
export const COMPARISONS_PATH = resolve(DATA_DIR, "comparisons.json");
export const BUDGET_LADDERS_PATH = resolve(DATA_DIR, "budget-ladders.json");

export async function ensureDataDirectory() {
  await mkdir(DATA_DIR, { recursive: true });
}

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function writeJson<T>(path: string, value: T) {
  await ensureDataDirectory();
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporaryPath, path);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

const mutationQueues = new Map<string, Promise<void>>();

export async function withSerializedFileMutation<T>(path: string, operation: () => Promise<T>) {
  const previous = mutationQueues.get(path) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  mutationQueues.set(path, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (mutationQueues.get(path) === current) mutationQueues.delete(path);
  }
}

export async function fileUpdatedAt(path: string, fallback = new Date().toISOString()) {
  try {
    return (await stat(path)).mtime.toISOString();
  } catch {
    return fallback;
  }
}

export function resolveProjectPath(relativePath: string) {
  return resolve(process.cwd(), relativePath);
}

export function ensureParentPath(path: string) {
  return mkdir(dirname(path), { recursive: true });
}

export async function createExclusiveFile(path: string, contents: string) {
  const handle = await open(path, "wx");
  try {
    await handle.writeFile(contents, "utf8");
  } finally {
    await handle.close();
  }
}

export async function removeGeneratedFile(path: string) {
  await unlink(path).catch(() => undefined);
}
