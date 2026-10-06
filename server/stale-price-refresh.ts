import type { AccessoryItem, Part } from "../shared/types";
import { ACCESSORY_CATEGORIES, isKnownPrice } from "../shared/types";
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
// 실패·바쁨은 삼키고 다음 조회 때 다시 큐에 들어온다 — best-effort 신선도 보강.
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

function isStaleDanawaItem(item: Part | AccessoryItem) {
  if (item.source !== "danawa" || !item.sourceProductCode || !item.danawaUrl) return false;
  if ("delistedAt" in item && item.delistedAt) return false;
  const checked = Date.parse(item.priceCheckedAt ?? item.updatedAt);
  return !Number.isFinite(checked) || Date.now() - checked > STALE_PRICE_TTL_MS;
}

/**
 * 방금 사용자에게 서빙된 부품·주변 부품 목록에서 가격 확인이 오래된 다나와 매물을
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
      const [partId] = pendingParts;
      const [accessoryId] = pendingAccessories;
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
      } catch {
        // 크롤·가격 잡이 인제스천 레인을 쥐고 있거나, 매물이 사라졌거나, 네트워크
        // 오류면 이 항목은 건너뛴다 — 다음 서빙에서 다시 큐에 들어온다.
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
}
