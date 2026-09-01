import type { CatalogChangeKind } from "../shared/types";

export interface PublicPriceHistoryRequestKey {
  kind: CatalogChangeKind;
  itemId: string;
}

export interface PublicPriceHistoryRequestResult {
  items: PublicPriceHistoryRequestKey[];
  error?: string;
}

export const PUBLIC_PRICE_HISTORY_WINDOWS = [7, 30, 90] as const;
export type PublicPriceHistoryWindow = (typeof PUBLIC_PRICE_HISTORY_WINDOWS)[number];

export function parsePublicPriceHistoryWindow(value: unknown): { days: PublicPriceHistoryWindow; error?: string } {
  if (value === undefined || value === null || value === "") return { days: 30 };
  const days = Number(value);
  return PUBLIC_PRICE_HISTORY_WINDOWS.includes(days as PublicPriceHistoryWindow)
    ? { days: days as PublicPriceHistoryWindow }
    : { days: 30, error: "가격 이력 기간은 7일, 30일, 90일 중 하나여야 합니다." };
}

export function parsePublicPriceHistoryIds(value: unknown, maxItems = 50): PublicPriceHistoryRequestResult {
  if (typeof value !== "string" || value.trim() === "") return { items: [], error: "가격 이력을 조회하려면 kind:itemId 형식의 ids가 필요합니다." };
  const parsed = value.split(",").map((part) => {
    const separator = part.indexOf(":");
    const kind = separator > 0 ? part.slice(0, separator) : "";
    const itemId = separator > 0 ? part.slice(separator + 1).trim() : "";
    return (kind === "part" || kind === "accessory") && itemId ? { kind: kind as CatalogChangeKind, itemId } : undefined;
  });
  if (parsed.some((item) => item === undefined)) return { items: [], error: "가격 이력을 조회하려면 kind:itemId 형식의 ids가 필요합니다." };
  const items = [...new Map(parsed.filter((item): item is PublicPriceHistoryRequestKey => item !== undefined).map((item) => [item.kind + ":" + item.itemId, item] as const)).values()];
  if (items.length > maxItems) return { items: [], error: "한 번에 최대 50개 부품의 가격 이력만 조회할 수 있습니다." };
  return { items };
}
