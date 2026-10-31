import type { AccessoryItem, Part } from "../shared/types";
import { ACCESSORY_CATEGORIES } from "../shared/types";
import { loadCatalog, findPart } from "./catalog";
import { loadAccessories, findAccessory } from "./accessories";
import { upsertCatalog } from "./catalog";
import { upsertAccessories } from "./accessories";
import { accessoryRefreshBlockReason, accessoryRefreshResponse, partRefreshBlockReason, partRefreshResponse, refreshDanawaAccessory, refreshDanawaPart } from "./part-refresh";
import { appendCatalogChangeRecord, catalogChangeRecord } from "./catalog-change-log";
import { withCatalogIngestionLease } from "./catalog-ingestion-coordinator";

// 표시가 드리프트 해결 — 예약된 가격 갱신 사이클(기본 3시간) 사이에 사용자가
// 실제로 보는 부품만 골라 백그라운드로 재확인한다. 서빙된 부품 중 priceCheckedAt이
// TTL을 넘긴 다나와 매물을 큐에 넣고, 인제스천 레인이 비어 있을 때 한 건씩 갱신한다.
// 실패/바쁨은 대기 큐에 남기고 상태를 기록한다. 다음 목록 조회 때 재시도한다.
export const STALE_PRICE_TTL_MS = 12 * 60 * 60 * 1000;
const DRAIN_MIN_INTERVAL_MS = 60_000;
const DRAIN_BATCH_LIMIT = 8;
const QUEUE_LIMIT = 80;
const ITEM_GAP_MS = 350;

const pendingParts = new Set<string>();
const pendingAccessories = new Set<string>();
// 드레인이 항목을 꺼내는 순간 큐에서 빠지므로, 진행 중인 id는 따로 잡는다 —
// 그 사이 다시 서빙되면 같은 매물을 연속으로 두 번 갱신하게 된다.
const inFlightParts = new Set<string>();
const inFlightAccessories = new Set<string>();
let drainRunning = false;
let drainPromise: Promise<void> | null = null;
let lastDrainAt = 0;
const retryAfter = new Map<string, number>();
const observation = { succeeded: 0, failed: 0, deferred: 0, lastFailure: undefined as undefined | { itemId: string; kind: "part" | "accessory"; message: string; at: string } };

function isStaleDanawaItem(item: Part | AccessoryItem) {
  if (item.source !== "danawa" || !item.sourceProductCode || !item.danawaUrl) return false;
  if ("delistedAt" in item && item.delistedAt) return false;
  const checked = Math.max(0, ...[item.priceCheckedAt, "priceUnavailableAt" in item ? item.priceUnavailableAt : undefined].map((time) => Date.parse(time ?? "")).filter(Number.isFinite));
  return !Number.isFinite(checked) || Date.now() - checked > STALE_PRICE_TTL_MS;
}

/**
 * 방금 사용자에게 서빙된 부품/주변 부품 목록에서 가격 확인이 오래된 다나와 매물을
 * 골라 백그라운드 재확인 큐에 넣는다. 응답 경로를 막지 않도록 fire-and-forget.
 */
export function noteStaleServedPrices(items: readonly (Part | AccessoryItem)[]) {
  const now = Date.now();
  for (const item of items) {
    if (!isStaleDanawaItem(item)) continue;
    const isAccessory = ACCESSORY_CATEGORIES.includes(item.category as AccessoryItem["category"]);
    const queue = isAccessory ? pendingAccessories : pendingParts;
    const inFlight = isAccessory ? inFlightAccessories : inFlightParts;
    if (queue.size >= QUEUE_LIMIT || queue.has(item.id) || inFlight.has(item.id)) continue;
    queue.add(item.id);
  }
  if ((pendingParts.size === 0 && pendingAccessories.size === 0) || drainRunning || now - lastDrainAt < DRAIN_MIN_INTERVAL_MS) return;
  lastDrainAt = now;
  drainPromise = drainStalePriceQueue().finally(() => {
    drainPromise = null;
  });
}

async function refreshStalePart(partId: string) {
  const catalog = await loadCatalog();
  const before = findPart(catalog, partId);
  if (!before || partRefreshBlockReason(before) || !isStaleDanawaItem(before)) return;
  const refreshed = await refreshDanawaPart(before);
  if (refreshed.priceCheckedAt === before.priceCheckedAt && refreshed.priceUnavailableAt === before.priceUnavailableAt) throw new Error("새 가격 또는 판매처 없음 상태를 확인하지 못했습니다.");
  const saved = findPart(await upsertCatalog([refreshed]), before.id);
  if (!saved) return;
  const result = partRefreshResponse(before, saved);
  await appendCatalogChangeRecord(catalogChangeRecord("part", before, saved, result.changedFields, { changedAt: result.refreshedAt }))
    .catch(() => undefined);
}

async function refreshStaleAccessory(accessoryId: string) {
  const accessories = await loadAccessories();
  const before = findAccessory(accessories, accessoryId);
  if (!before || accessoryRefreshBlockReason(before) || !isStaleDanawaItem(before)) return;
  const refreshed = await refreshDanawaAccessory(before);
  if (refreshed.priceCheckedAt === before.priceCheckedAt) throw new Error("새 가격을 확인하지 못했습니다.");
  const saved = findAccessory(await upsertAccessories([refreshed]), before.id);
  if (!saved) return;
  const result = accessoryRefreshResponse(before, saved);
  await appendCatalogChangeRecord(catalogChangeRecord("accessory", before, saved, result.changedFields, { changedAt: result.refreshedAt }))
    .catch(() => undefined);
}

async function drainStalePriceQueue() {
  drainRunning = true;
  try {
    let processed = 0;
    while ((pendingParts.size > 0 || pendingAccessories.size > 0) && processed < DRAIN_BATCH_LIMIT) {
      const partId = [...pendingParts].find((id) => (retryAfter.get(`part:${id}`) ?? 0) <= Date.now());
      const accessoryId = [...pendingAccessories].find((id) => (retryAfter.get(`accessory:${id}`) ?? 0) <= Date.now());
      if (!partId && !accessoryId) break;
      const target = partId !== undefined ? ("part" as const) : ("accessory" as const);
      const id = partId ?? accessoryId!;
      const inFlight = target === "part" ? inFlightParts : inFlightAccessories;
      (target === "part" ? pendingParts : pendingAccessories).delete(id);
      inFlight.add(id);
      try {
        await withCatalogIngestionLease(async () => {
          if (target === "part") await refreshStalePart(id);
          else await refreshStaleAccessory(id);
        });
        observation.succeeded += 1;
        retryAfter.delete(`${target}:${id}`);
      } catch (error) {
        const busy = error instanceof Error && error.name === "CatalogIngestionBusyError";
        const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
        if (busy) observation.deferred += 1;
        else observation.failed += 1;
        observation.lastFailure = { itemId: id, kind: target, message, at: new Date().toISOString() };
        (target === "part" ? pendingParts : pendingAccessories).add(id);
        retryAfter.set(`${target}:${id}`, Date.now() + (busy ? DRAIN_MIN_INTERVAL_MS : 5 * DRAIN_MIN_INTERVAL_MS));
        console.warn("Served price refresh deferred", { itemId: id, kind: target, busy, message });
        if (busy) break;
      } finally {
        inFlight.delete(id);
      }
      processed += 1;
      if (processed < DRAIN_BATCH_LIMIT) await new Promise((resolve) => setTimeout(resolve, ITEM_GAP_MS));
    }
  } finally {
    drainRunning = false;
  }
}

/** Operational status: freshness timestamps remain unchanged on failed or deferred work. */
export function stalePriceRefreshStatus() {
  return { ...observation, pending: pendingParts.size + pendingAccessories.size, inFlight: inFlightParts.size + inFlightAccessories.size, running: drainRunning };
}

/** 테스트/관측용 — 현재 큐에 대기 중인 항목 수 */
export function stalePriceRefreshQueueSize() {
  return pendingParts.size + pendingAccessories.size;
}

/** 테스트/관측용 — 진행 중인 드레인이 있으면 그 완료를 돌려준다 */
export function whenStalePriceRefreshIdle() {
  return drainPromise ?? Promise.resolve();
}

/** 테스트용 — 큐와 스로틀 상태를 초기화한다 */
export function resetStalePriceRefreshState() {
  pendingParts.clear();
  pendingAccessories.clear();
  inFlightParts.clear();
  inFlightAccessories.clear();
  drainRunning = false;
  drainPromise = null;
  lastDrainAt = 0;
  retryAfter.clear();
  observation.succeeded = 0;
  observation.failed = 0;
  observation.deferred = 0;
  observation.lastFailure = undefined;
}
