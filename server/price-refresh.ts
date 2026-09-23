import type { AccessoryItem, Part } from "../shared/types";
import { isKnownPrice } from "../shared/types";
import { readFile } from "node:fs/promises";
import { loadCatalog, upsertCatalog } from "./catalog";
import { loadAccessories, upsertAccessories } from "./accessories";
import { appendCatalogChangeRecords, catalogChangeRecord } from "./catalog-change-log";
import { refreshDanawaAccessory, refreshDanawaPart } from "./part-refresh";
import {
  PRICE_REFRESH_LOCK_PATH,
  PRICE_REFRESH_STATE_PATH,
  PRICE_REFRESH_ATTEMPTS_PATH,
  CRAWL_LOCK_PATH,
  ACCESSORY_CRAWL_LOCK_PATH,
  createExclusiveFile,
  ensureDataDirectory,
  readJson,
  fileUpdatedAt,
  removeGeneratedFile,
  writeJson
} from "./storage";

const CHECKPOINT_SIZE = 25;
const MAX_FAILURES = 50;
const DEFAULT_LIMIT = 25;
const JOB_LOCK_PATHS = [PRICE_REFRESH_LOCK_PATH, CRAWL_LOCK_PATH, ACCESSORY_CRAWL_LOCK_PATH];
const MAX_CORE_LIMIT = 100;
const MAX_ACCESSORY_LIMIT = 1000;

export interface PriceRefreshFailure {
  itemId: string;
  itemName: string;
  kind: "part" | "accessory";
  message: string;
}

export interface PriceRefreshStatus {
  startedAt: string;
  completedAt?: string;
  running: boolean;
  dryRun: boolean;
  attempted: number;
  succeeded: number;
  changed: number;
  failed: number;
  failures: PriceRefreshFailure[];
}

export interface PriceRefreshJobOptions {
  coreLimit?: number;
  accessoryLimit?: number;
  delayMs?: number;
  dryRun?: boolean;
}

const emptyStatus = (): PriceRefreshStatus => ({
  startedAt: "",
  running: false,
  dryRun: false,
  attempted: 0,
  succeeded: 0,
  changed: 0,
  failed: 0,
  failures: []
});

export async function readPriceRefreshStatus(): Promise<PriceRefreshStatus> {
  const status = await readJson<PriceRefreshStatus>(PRICE_REFRESH_STATE_PATH, emptyStatus());
  if (status.running && !(await lockIsActive(PRICE_REFRESH_LOCK_PATH))) {
    status.running = false;
    status.completedAt ??= new Date().toISOString();
    addFailure(status, { itemId: "job", itemName: "가격 갱신 작업", kind: "part", message: "작업 프로세스가 종료되어 마지막 체크포인트에서 중단되었습니다." });
    await writeJson(PRICE_REFRESH_STATE_PATH, status);
  }
  return status;
}

async function lockIsActive(path: string) {
  let raw: string;
  try { raw = await readFile(path, "utf8"); } catch { return false; }
  let pid = 0;
  try { pid = Number(path === PRICE_REFRESH_LOCK_PATH ? (JSON.parse(raw || "{}") as { pid?: number }).pid : raw.trim()); } catch { /* treat a recent partial lock as active */ }
  if (Number.isInteger(pid) && pid > 0) {
    try { process.kill(pid, 0); return true; } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
      return false;
    }
  }
  const mtime = Date.parse(await fileUpdatedAt(path, ""));
  return Number.isFinite(mtime) && Date.now() - mtime < 120_000;
}

export async function isPriceRefreshJobRunning() {
  for (const path of JOB_LOCK_PATHS) if (await lockIsActive(path)) return true;
  return false;
}

async function acquireJobLocks() {
  await ensureDataDirectory();
  const acquired: string[] = [];
  try {
    for (const path of JOB_LOCK_PATHS) {
      try {
        await createExclusiveFile(path, path === PRICE_REFRESH_LOCK_PATH
          ? JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })
          : `${process.pid}\n`);
        acquired.push(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error;
        if (await lockIsActive(path)) throw new Error("가격 갱신 또는 카탈로그 크롤링 작업이 이미 실행 중입니다.");
        await removeGeneratedFile(path);
        await createExclusiveFile(path, path === PRICE_REFRESH_LOCK_PATH
          ? JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })
          : `${process.pid}\n`);
        acquired.push(path);
      }
    }
    return async () => {
      for (const path of acquired.reverse()) {
        if (await lockIsOwnedByCurrentProcess(path)) await removeGeneratedFile(path);
      }
    };
  } catch (error) {
    for (const path of acquired.reverse()) {
      if (await lockIsOwnedByCurrentProcess(path)) await removeGeneratedFile(path);
    }
    throw error;
  }
}

async function lockIsOwnedByCurrentProcess(path: string) {
  try {
    const raw = await readFile(path, "utf8");
    const pid = Number(path === PRICE_REFRESH_LOCK_PATH ? (JSON.parse(raw || "{}") as { pid?: number }).pid : raw.trim());
    return pid === process.pid;
  } catch { return false; }
}

function boundedLimit(value: number | undefined, maximum: number) {
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.max(0, Math.min(maximum, Math.floor(value!)));
}

function lastChecked(item: { priceCheckedAt?: string; updatedAt: string }) {
  const value = item.priceCheckedAt ?? item.updatedAt;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function failureText(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 300);
}

function addFailure(status: PriceRefreshStatus, failure: PriceRefreshFailure) {
  status.failed += 1;
  status.failures = [...status.failures, failure].slice(-MAX_FAILURES);
}

type CoreQueueItem = { before: Part; after: Part };
type AccessoryQueueItem = { before: AccessoryItem; after: AccessoryItem };
type PriceRefreshAttempts = Record<string, string>;

function refreshAttemptKey(kind: "part" | "accessory", item: Part | AccessoryItem) {
  return `${kind}:${item.id}`;
}

function lastAttempted(item: Part | AccessoryItem, kind: "part" | "accessory", attempts: PriceRefreshAttempts) {
  const attemptedAt = attempts[refreshAttemptKey(kind, item)];
  if (attemptedAt) {
    const time = Date.parse(attemptedAt);
    if (Number.isFinite(time)) return time;
  }
  return lastChecked(item);
}

export async function runPriceRefreshJob(options: PriceRefreshJobOptions = {}): Promise<PriceRefreshStatus> {
  const startedAt = new Date().toISOString();
  const status: PriceRefreshStatus = {
    ...emptyStatus(),
    startedAt,
    running: true,
    dryRun: options.dryRun === true
  };

  const releaseLocks = await acquireJobLocks();

  let coreQueue: CoreQueueItem[] = [];
  let accessoryQueue: AccessoryQueueItem[] = [];

  const checkpoint = async () => {
    await writeJson(PRICE_REFRESH_STATE_PATH, status);
  };

  const flush = async () => {
    if (status.dryRun) {
      status.succeeded += coreQueue.length + accessoryQueue.length;
      status.changed += coreQueue.filter(({ before, after }) => before.priceWon !== after.priceWon).length;
      status.changed += accessoryQueue.filter(({ before, after }) => before.priceWon !== after.priceWon).length;
      coreQueue = [];
      accessoryQueue = [];
      await checkpoint();
      return;
    }
    const allChanges = [];
    if (coreQueue.length) {
      const queue = coreQueue;
      coreQueue = [];
      try {
        const latest = await loadCatalog();
        const updates: CoreQueueItem[] = [];
        for (const entry of queue) {
          const current = latest.find((item) => item.id === entry.before.id);
          if (!current || current.source !== "danawa" || current.sourceProductCode !== entry.before.sourceProductCode || current.danawaUrl !== entry.before.danawaUrl) {
            addFailure(status, { itemId: entry.before.id, itemName: entry.before.name, kind: "part", message: "갱신 중 원본 항목이 바뀌거나 삭제되어 가격 반영을 건너뛰었습니다." });
            continue;
          }
          updates.push({ before: current, after: { ...current, priceWon: entry.after.priceWon, priceCheckedAt: entry.after.priceCheckedAt } });
        }
        await upsertCatalog(updates.map(({ after }) => after));
        status.succeeded += updates.length;
        status.changed += updates.filter(({ before, after }) => before.priceWon !== after.priceWon).length;
        allChanges.push(...updates.filter(({ before, after }) => before.priceWon !== after.priceWon).map(({ before, after }) => catalogChangeRecord("part", before, after, ["가격"])));
      } catch (error) {
        for (const { before } of queue) addFailure(status, { itemId: before.id, itemName: before.name, kind: "part", message: `저장 실패: ${failureText(error)}` });
      }
    }
    if (accessoryQueue.length) {
      const queue = accessoryQueue;
      accessoryQueue = [];
      try {
        const latest = await loadAccessories();
        const updates: AccessoryQueueItem[] = [];
        for (const entry of queue) {
          const current = latest.find((item) => item.id === entry.before.id);
          if (!current || current.source !== "danawa" || current.sourceProductCode !== entry.before.sourceProductCode || current.danawaUrl !== entry.before.danawaUrl) {
            addFailure(status, { itemId: entry.before.id, itemName: entry.before.name, kind: "accessory", message: "갱신 중 원본 항목이 바뀌거나 삭제되어 가격 반영을 건너뛰었습니다." });
            continue;
          }
          updates.push({ before: current, after: { ...current, priceWon: entry.after.priceWon, priceCheckedAt: entry.after.priceCheckedAt } });
        }
        await upsertAccessories(updates.map(({ after }) => after));
        status.succeeded += updates.length;
        status.changed += updates.filter(({ before, after }) => before.priceWon !== after.priceWon).length;
        allChanges.push(...updates.filter(({ before, after }) => before.priceWon !== after.priceWon).map(({ before, after }) => catalogChangeRecord("accessory", before, after, ["가격"])));
      } catch (error) {
        for (const { before } of queue) addFailure(status, { itemId: before.id, itemName: before.name, kind: "accessory", message: `저장 실패: ${failureText(error)}` });
      }
    }
    await appendCatalogChangeRecords(allChanges).catch(() => undefined);
    await checkpoint();
  };

  try {
    const [parts, accessories] = await Promise.all([loadCatalog(), loadAccessories()]);
    const attempts = await readJson<PriceRefreshAttempts>(PRICE_REFRESH_ATTEMPTS_PATH, {});
    const coreLimit = boundedLimit(options.coreLimit, MAX_CORE_LIMIT);
    const accessoryLimit = boundedLimit(options.accessoryLimit, MAX_ACCESSORY_LIMIT);
    const coreCandidates = parts
      .filter((part) => part.source === "danawa" && Boolean(part.sourceProductCode && part.danawaUrl))
      .sort((left, right) => lastAttempted(left, "part", attempts) - lastAttempted(right, "part", attempts))
      .slice(0, coreLimit);
    const accessoryCandidates = accessories
      .filter((item) => item.source === "danawa" && Boolean(item.sourceProductCode && item.danawaUrl))
      .sort((left, right) => lastAttempted(left, "accessory", attempts) - lastAttempted(right, "accessory", attempts))
      .slice(0, accessoryLimit);
    const work = [
      ...coreCandidates.map((item) => ({ kind: "part" as const, item })),
      ...accessoryCandidates.map((item) => ({ kind: "accessory" as const, item }))
    ].sort((left, right) => lastAttempted(left.item, left.kind, attempts) - lastAttempted(right.item, right.kind, attempts));
    const delayMs = Number.isFinite(options.delayMs) ? Math.max(0, Math.min(10_000, Math.floor(options.delayMs!))) : 750;

    for (const [index, entry] of work.entries()) {
      status.attempted += 1;
      try {
        if (entry.kind === "part") {
          let observedPriceWon: number | undefined;
          try {
            await refreshDanawaPart(entry.item, { onPriceObserved: (price) => { observedPriceWon = price; } });
          } catch (error) {
            if (!isKnownPrice(observedPriceWon)) throw error;
          }
          if (!isKnownPrice(observedPriceWon)) throw new Error("다나와 상세 원문에서 유효한 양수 가격을 확인하지 못했습니다.");
          const after: Part = { ...entry.item, priceWon: observedPriceWon, priceCheckedAt: new Date().toISOString() };
          coreQueue.push({ before: entry.item, after });
        } else {
          let observedPriceWon: number | undefined;
          try {
            await refreshDanawaAccessory(entry.item, { onPriceObserved: (price) => { observedPriceWon = price; } });
          } catch (error) {
            if (!isKnownPrice(observedPriceWon)) throw error;
          }
          if (!isKnownPrice(observedPriceWon)) throw new Error("다나와 상세 원문에서 유효한 양수 가격을 확인하지 못했습니다.");
          const after: AccessoryItem = { ...entry.item, priceWon: observedPriceWon, priceCheckedAt: new Date().toISOString() };
          accessoryQueue.push({ before: entry.item, after });
        }
      } catch (error) {
        addFailure(status, { itemId: entry.item.id, itemName: entry.item.name, kind: entry.kind, message: failureText(error) });
      }
      attempts[refreshAttemptKey(entry.kind, entry.item)] = new Date().toISOString();
      await writeJson(PRICE_REFRESH_ATTEMPTS_PATH, attempts);
      if (coreQueue.length + accessoryQueue.length >= CHECKPOINT_SIZE) await flush();
      else await checkpoint();
      if (delayMs > 0 && index < work.length - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    await flush();
    status.running = false;
    status.completedAt = new Date().toISOString();
    await writeJson(PRICE_REFRESH_STATE_PATH, status);
    return status;
  } catch (error) {
    status.running = false;
    status.completedAt = new Date().toISOString();
    addFailure(status, { itemId: "job", itemName: "가격 갱신 작업", kind: "part", message: failureText(error) });
    await writeJson(PRICE_REFRESH_STATE_PATH, status).catch(() => undefined);
    throw error;
  } finally {
    await releaseLocks();
  }
}
