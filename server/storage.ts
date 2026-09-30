import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";

const configuredDataDirectory = process.env.PC_SUPPORTER_DATA_DIR?.trim();
export const DATA_DIR = configuredDataDirectory ? resolve(configuredDataDirectory) : resolve(process.cwd(), "data");
export const CRAWL_STATE_PATH = resolve(DATA_DIR, "crawl-state.json");
export const CRAWL_LOCK_PATH = resolve(DATA_DIR, "crawl.lock");
export const CRAWL_MANIFEST_PATH = resolve(DATA_DIR, "crawl-manifest.json");
export const GPU_PHYSICAL_OVERRIDES_PATH = resolve(DATA_DIR, "gpu-physical-overrides.json");
export const PHYSICAL_SOURCE_CHECK_HISTORY_PATH = resolve(DATA_DIR, "physical-source-check-history.json");
export const BENCHMARK_SOURCE_CHECK_HISTORY_PATH = resolve(DATA_DIR, "benchmark-source-check-history.json");
export const CASE_RGB_LOAD_OVERRIDES_PATH = resolve(DATA_DIR, "case-rgb-load-overrides.json");
export const ACCESSORY_CRAWL_STATE_PATH = resolve(DATA_DIR, "accessory-crawl-state.json");
export const ACCESSORY_CRAWL_LOCK_PATH = resolve(DATA_DIR, "accessory-crawl.lock");
export const ACCESSORY_CRAWL_MANIFEST_PATH = resolve(DATA_DIR, "accessory-crawl-manifest.json");
export const CATALOG_CHANGE_LOG_PATH = resolve(DATA_DIR, "catalog-change-log.json");
export const PRICE_REFRESH_STATE_PATH = resolve(DATA_DIR, "price-refresh-state.json");
export const PRICE_REFRESH_LOCK_PATH = resolve(DATA_DIR, "price-refresh.lock");
export const CATALOG_SPEC_OVERRIDE_SOURCE_CHECK_HISTORY_PATH = resolve(DATA_DIR, "catalog-spec-override-source-check-history.json");
export const CATALOG_SPEC_REFRESH_HISTORY_PATH = resolve(DATA_DIR, "catalog-spec-refresh-history.json");
export const CATALOG_SEED_MAPPINGS_PATH = resolve(DATA_DIR, "catalog-seed-mappings.json");

function errorHasCode(error: unknown, code: string) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

export async function ensureDataDirectory() {
  await mkdir(DATA_DIR, { recursive: true });
}

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error: unknown) {
    if (errorHasCode(error, "ENOENT")) return fallback;
    throw error;
  }
  return JSON.parse(raw) as T;
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
