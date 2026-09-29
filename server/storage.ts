import { constants } from "node:fs";
import { access, mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
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
export const BENCHMARK_SOURCE_CHECK_HISTORY_PATH = resolve(DATA_DIR, "benchmark-source-check-history.json");
export const BENCHMARK_OVERRIDES_PATH = resolve(DATA_DIR, "benchmark-overrides.json");
export const CASE_RGB_LOAD_OVERRIDES_PATH = resolve(DATA_DIR, "case-rgb-load-overrides.json");
export const COOLING_FAN_LOAD_OVERRIDES_PATH = resolve(DATA_DIR, "cooling-fan-load-overrides.json");
export const ACCESSORY_CRAWL_STATE_PATH = resolve(DATA_DIR, "accessory-crawl-state.json");
export const ACCESSORY_CRAWL_LOCK_PATH = resolve(DATA_DIR, "accessory-crawl.lock");
export const ACCESSORY_CRAWL_MANIFEST_PATH = resolve(DATA_DIR, "accessory-crawl-manifest.json");
export const ACCESSORY_COVERAGE_PATH = resolve(DATA_DIR, "accessory-coverage.json");
export const CATALOG_CHANGE_LOG_PATH = resolve(DATA_DIR, "catalog-change-log.json");
export const PRICE_REFRESH_STATE_PATH = resolve(DATA_DIR, "price-refresh-state.json");
export const PRICE_REFRESH_ATTEMPTS_PATH = resolve(DATA_DIR, "price-refresh-attempts.json");
export const PRICE_REFRESH_LOCK_PATH = resolve(DATA_DIR, "price-refresh.lock");
export const CATALOG_SPEC_OVERRIDES_PATH = resolve(DATA_DIR, "catalog-spec-overrides.json");
export const CATALOG_SPEC_OVERRIDE_SOURCE_CHECK_HISTORY_PATH = resolve(DATA_DIR, "catalog-spec-override-source-check-history.json");
export const CATALOG_SPEC_REFRESH_HISTORY_PATH = resolve(DATA_DIR, "catalog-spec-refresh-history.json");
export const CATALOG_SEED_MAPPINGS_PATH = resolve(DATA_DIR, "catalog-seed-mappings.json");
export const WATCHLISTS_PATH = resolve(DATA_DIR, "watchlists.json");
export const WATCHLIST_ALERT_STATES_PATH = resolve(DATA_DIR, "watchlist-alert-states.json");
export const COMPARISONS_PATH = resolve(DATA_DIR, "comparisons.json");
export const VERSION_COMPARISONS_PATH = resolve(DATA_DIR, "version-comparisons.json");
export const BUDGET_LADDERS_PATH = resolve(DATA_DIR, "budget-ladders.json");
export const GENERATOR_VARIANTS_PATH = resolve(DATA_DIR, "generator-variants.json");
export const USAGE_EVENTS_PATH = resolve(DATA_DIR, "usage-events.json");

const filePersistenceErrors = new Map<string, unknown>();

function errorHasCode(error: unknown, code: string) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

function recordFilePersistenceError(path: string, error: unknown) {
  filePersistenceErrors.set(path, error);
}

function clearFilePersistenceError(path: string) {
  filePersistenceErrors.delete(path);
}

export async function ensureDataDirectory() {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    clearFilePersistenceError(DATA_DIR);
  } catch (error: unknown) {
    recordFilePersistenceError(DATA_DIR, error);
    throw error;
  }
}

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error: unknown) {
    if (errorHasCode(error, "ENOENT")) {
      clearFilePersistenceError(path);
      return fallback;
    }
    recordFilePersistenceError(path, error);
    throw error;
  }
  try {
    const parsed = JSON.parse(raw) as T;
    clearFilePersistenceError(path);
    return parsed;
  } catch (error: unknown) {
    recordFilePersistenceError(path, error);
    throw error;
  }
}

export async function writeJson<T>(path: string, value: T) {
  try {
    await ensureDataDirectory();
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      await rename(temporaryPath, path);
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
    clearFilePersistenceError(path);
  } catch (error: unknown) {
    recordFilePersistenceError(path, error);
    throw error;
  }
}

export async function filePersistenceIsReady() {
  for (const path of filePersistenceErrors.keys()) {
    if (path === DATA_DIR) continue;
    try {
      const raw = await readFile(path, "utf8");
      JSON.parse(raw);
      clearFilePersistenceError(path);
    } catch (error: unknown) {
      if (errorHasCode(error, "ENOENT")) clearFilePersistenceError(path);
    }
  }
  if ([...filePersistenceErrors.keys()].some((path) => path !== DATA_DIR)) return false;
  try {
    const directoryInfo = await stat(DATA_DIR);
    if (!directoryInfo.isDirectory()) return false;
    await access(DATA_DIR, constants.R_OK | constants.W_OK);
    clearFilePersistenceError(DATA_DIR);
    return true;
  } catch (error: unknown) {
    return errorHasCode(error, "ENOENT") && !filePersistenceErrors.has(DATA_DIR);
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
