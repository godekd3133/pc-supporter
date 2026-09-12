export const PURCHASE_ITEM_STATUS_VALUES = ["planned", "ordered", "received", "installed"] as const;
export type PurchaseItemStatus = (typeof PURCHASE_ITEM_STATUS_VALUES)[number];

export const PURCHASE_ITEM_STATUS_LABELS: Record<PurchaseItemStatus, string> = {
  planned: "구매 예정",
  ordered: "주문 완료",
  received: "수령 완료",
  installed: "조립 완료"
};

export const PURCHASE_ITEM_STATUS_RANK: Record<PurchaseItemStatus, number> = {
  planned: 0,
  ordered: 1,
  received: 2,
  installed: 3
};

export interface PurchaseListItemStatus {
  rowKey: string;
  status: PurchaseItemStatus;
  updatedAt: string;
}

export interface PurchaseListItemStatusEnvelope {
  type: "pc-supporter-purchase-list-item-status";
  schemaVersion: 1;
  storageKey: string;
  exportedAt: string;
  items: PurchaseListItemStatus[];
}

const MAX_ITEMS = 100;
const MAX_KEY_LENGTH = 240;

function parsedStatus(value: unknown): PurchaseItemStatus | undefined {
  return PURCHASE_ITEM_STATUS_VALUES.includes(value as PurchaseItemStatus) ? value as PurchaseItemStatus : undefined;
}

function validTimestamp(value: unknown) {
  return typeof value === "string" && value.length > 0 && value.length <= 120 && Number.isFinite(Date.parse(value));
}

export function purchaseListItemStatusesFromUnknown(value: unknown, validRowKeys?: ReadonlyArray<string>) {
  if (value === undefined) return { items: [] as PurchaseListItemStatus[], errors: [] as string[] };
  if (!Array.isArray(value) || value.length > MAX_ITEMS) return { items: [] as PurchaseListItemStatus[], errors: ["구매 단계 상태 형식이 올바르지 않습니다."] };
  const validKeys = validRowKeys ? new Set(validRowKeys) : undefined;
  const seen = new Set<string>();
  const items: PurchaseListItemStatus[] = [];
  const errors: string[] = [];
  for (const valueItem of value) {
    if (!valueItem || typeof valueItem !== "object" || Array.isArray(valueItem)) {
      errors.push("구매 단계 상태 항목이 올바르지 않습니다.");
      continue;
    }
    const candidate = valueItem as Partial<PurchaseListItemStatus>;
    const rowKey = typeof candidate.rowKey === "string" ? candidate.rowKey.trim() : "";
    const status = parsedStatus(candidate.status);
    if (!rowKey || rowKey.length > MAX_KEY_LENGTH || !status || !validTimestamp(candidate.updatedAt) || (validKeys && !validKeys.has(rowKey)) || seen.has(rowKey)) {
      errors.push("구매 단계 상태의 행 key·상태·시각이 올바르지 않거나 현재 목록과 다릅니다.");
      continue;
    }
    seen.add(rowKey);
    items.push({ rowKey, status, updatedAt: new Date(candidate.updatedAt!).toISOString() });
  }
  return { items, errors };
}

export function purchaseListItemStatusesFromJson(raw: string | null | undefined, expectedStorageKey?: string) {
  if (!raw) return [] as PurchaseListItemStatus[];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const envelope = parsed as Partial<PurchaseListItemStatusEnvelope>;
    if (envelope.type !== "pc-supporter-purchase-list-item-status" || envelope.schemaVersion !== 1 || (expectedStorageKey !== undefined && envelope.storageKey !== expectedStorageKey)) return [];
    return purchaseListItemStatusesFromUnknown(envelope.items).items;
  } catch {
    return [];
  }
}

export function purchaseListItemStatusesJsonFor(storageKey: string, items: ReadonlyArray<PurchaseListItemStatus>, exportedAt = new Date().toISOString()) {
  const parsed = purchaseListItemStatusesFromUnknown(items).items;
  const envelope: PurchaseListItemStatusEnvelope = { type: "pc-supporter-purchase-list-item-status", schemaVersion: 1, storageKey, exportedAt, items: parsed };
  return JSON.stringify(envelope, null, 2);
}

export function purchaseListItemStatusFor(items: ReadonlyArray<PurchaseListItemStatus>, rowKey: string, checkedIds?: ReadonlySet<string>) {
  return items.find((item) => item.rowKey === rowKey)?.status ?? (checkedIds?.has(rowKey) ? "received" : "planned");
}

export function purchaseListItemStatusesWithNextFor(items: ReadonlyArray<PurchaseListItemStatus>, rowKey: string, status: PurchaseItemStatus, updatedAt = new Date().toISOString()) {
  const next = items.filter((item) => item.rowKey !== rowKey);
  next.push({ rowKey, status, updatedAt });
  return next.slice(-MAX_ITEMS);
}

export function purchaseListItemStatusIsPurchased(status: PurchaseItemStatus) {
  return PURCHASE_ITEM_STATUS_RANK[status] >= PURCHASE_ITEM_STATUS_RANK.received;
}

export function purchaseListCheckedIdsForItemStatuses(rowKeys: ReadonlyArray<string>, items: ReadonlyArray<PurchaseListItemStatus>, fallbackCheckedIds: ReadonlyArray<string> = []) {
  const fallback = new Set(fallbackCheckedIds);
  const stateByRowKey = new Map(items.map((item) => [item.rowKey, item.status]));
  return rowKeys.filter((rowKey) => stateByRowKey.has(rowKey) ? purchaseListItemStatusIsPurchased(stateByRowKey.get(rowKey)!) : fallback.has(rowKey));
}

export function purchaseListItemStatusCountsFor(rowKeys: ReadonlyArray<string>, items: ReadonlyArray<PurchaseListItemStatus>, checkedIds?: ReadonlySet<string>) {
  const counts: Record<PurchaseItemStatus, number> = { planned: 0, ordered: 0, received: 0, installed: 0 };
  rowKeys.forEach((rowKey) => { counts[purchaseListItemStatusFor(items, rowKey, checkedIds)] += 1; });
  return { ...counts, total: rowKeys.length };
}

export function purchaseListItemStatusMatchesFilter(filter: PurchaseItemStatus | "all", status: PurchaseItemStatus) {
  return filter === "all" || filter === status;
}
