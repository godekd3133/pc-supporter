import type { AccessoryItem, AccessoryRefreshResponse, Part, PartRefreshResponse } from "../shared/types";
import { isKnownPrice } from "../shared/types";
import { DANAWA_CATEGORIES, fetchDanawaHtml, isAllowedSourceUrl, parseDanawaProductPage, type DanawaCrawlerOptions, type DanawaListItem } from "./danawa";
import { DANAWA_ACCESSORY_CATEGORIES, parseDanawaAccessoryPage } from "./accessory-crawler";

function categoryConfig(part: Part) {
  return DANAWA_CATEGORIES.find((config) => config.category === part.category);
}

export function partRefreshBlockReason(part: Part) {
  if (part.source !== "danawa") return "프로젝트 또는 수동 검수 부품은 다나와 원문 재확인 대상이 아닙니다.";
  if (!categoryConfig(part)) return "지원하지 않는 부품 카테고리입니다.";
  if (!part.sourceProductCode) return "다나와 상품 코드가 없어 원문을 다시 찾을 수 없습니다.";
  if (!part.danawaUrl || !isAllowedSourceUrl(part.danawaUrl)) return "허용된 다나와 원문 링크가 없어 재확인할 수 없습니다.";
  try {
    const url = new URL(part.danawaUrl);
    if (url.hostname.toLowerCase() !== "prod.danawa.com" && url.hostname.toLowerCase() !== "www.danawa.com") return "상품 상세 원문은 다나와 상품 페이지여야 합니다.";
    if (url.searchParams.get("pcode") !== part.sourceProductCode) return "원문 링크와 저장된 상품 코드가 일치하지 않습니다.";
  } catch {
    return "다나와 원문 링크 형식이 올바르지 않습니다.";
  }
  return undefined;
}

function fieldChanged(before: unknown, after: unknown) {
  return JSON.stringify(before ?? null) !== JSON.stringify(after ?? null);
}

export function changedPartFields(before: Part, after: Part) {
  const fields: Array<[string, unknown, unknown]> = [
    ["상품명", before.name, after.name],
    ["가격", before.priceWon, after.priceWon],
    ["이미지", before.imageUrl, after.imageUrl],
    ["원문 스펙", before.rawSpecText, after.rawSpecText],
    ["정규화 스펙", before.specs, after.specs],
    ["데이터 품질", before.dataQuality, after.dataQuality],
    ["누락 필드", before.missingFields, after.missingFields]
  ];
  return fields.filter(([, beforeValue, afterValue]) => fieldChanged(beforeValue, afterValue)).map(([label]) => label);
}

export function reconcileRefreshedPart(before: Part, parsed: Part) {
  if (!parsed.rawSpecText?.trim()) throw new Error("다나와 상세 원문에서 스펙을 확인하지 못해 기존 데이터를 보존했습니다.");
  if (before.dataQuality === "live" && parsed.dataQuality === "incomplete") {
    throw new Error("새 원문이 기존 데이터보다 부족해 기존 스펙을 보존했습니다.");
  }
  return {
    ...parsed,
    priceWon: isKnownPrice(parsed.priceWon) ? parsed.priceWon : before.priceWon,
    imageUrl: parsed.imageUrl ?? before.imageUrl,
    rawSpecText: parsed.rawSpecText || before.rawSpecText,
    updatedAt: new Date().toISOString()
  } satisfies Part;
}

export type PartRefreshOptions = {
  timeoutMs?: number;
  retries?: number;
  fetchHtml?: (url: string, options: DanawaCrawlerOptions) => Promise<string>;
};

export async function refreshDanawaPart(part: Part, options: PartRefreshOptions = {}) {
  const blockReason = partRefreshBlockReason(part);
  if (blockReason) throw new Error(blockReason);
  const config = categoryConfig(part)!;
  const fetchHtml = options.fetchHtml ?? fetchDanawaHtml;
  const html = await fetchHtml(part.danawaUrl!, {
    timeoutMs: Math.max(1000, options.timeoutMs ?? 12000),
    retries: Math.max(0, options.retries ?? 1),
    delayMs: 0
  });
  const item: DanawaListItem = {
    name: part.name,
    url: part.danawaUrl!,
    imageUrl: part.imageUrl,
    rawSpecText: part.rawSpecText,
    sourceProductCode: part.sourceProductCode!
  };
  return reconcileRefreshedPart(part, parseDanawaProductPage(part.category, item, html, config.categoryId));
}

export function partRefreshResponse(before: Part, refreshed: Part, refreshedAt = new Date().toISOString()): PartRefreshResponse {
  return {
    part: refreshed,
    previousDataQuality: before.dataQuality,
    previousMissingFields: [...before.missingFields],
    changedFields: changedPartFields(before, refreshed),
    refreshedAt
  };
}

function accessoryCategoryConfig(item: AccessoryItem) {
  return DANAWA_ACCESSORY_CATEGORIES.find((config) => config.category === item.category);
}

export function accessoryRefreshBlockReason(item: AccessoryItem) {
  if (item.source !== "danawa") return "수동 검수 주변 부품은 다나와 원문 재확인 대상이 아닙니다.";
  if (!accessoryCategoryConfig(item)) return "지원하지 않는 주변 부품 카테고리입니다.";
  if (!item.sourceProductCode) return "다나와 상품 코드가 없어 원문을 다시 찾을 수 없습니다.";
  if (!item.danawaUrl || !isAllowedSourceUrl(item.danawaUrl)) return "허용된 다나와 원문 링크가 없어 재확인할 수 없습니다.";
  try {
    const url = new URL(item.danawaUrl);
    if (url.hostname.toLowerCase() !== "prod.danawa.com" && url.hostname.toLowerCase() !== "www.danawa.com") return "상품 상세 원문은 다나와 상품 페이지여야 합니다.";
    if (url.searchParams.get("pcode") !== item.sourceProductCode) return "원문 링크와 저장된 상품 코드가 일치하지 않습니다.";
  } catch {
    return "다나와 원문 링크 형식이 올바르지 않습니다.";
  }
  return undefined;
}

export function changedAccessoryFields(before: AccessoryItem, after: AccessoryItem) {
  const fields: Array<[string, unknown, unknown]> = [
    ["상품명", before.name, after.name],
    ["가격", before.priceWon, after.priceWon],
    ["이미지", before.imageUrl, after.imageUrl],
    ["원문 스펙", before.rawSpecText, after.rawSpecText],
    ["정규화 스펙", before.specs, after.specs],
    ["데이터 품질", before.dataQuality, after.dataQuality],
    ["누락 필드", before.missingFields, after.missingFields]
  ];
  return fields.filter(([, beforeValue, afterValue]) => fieldChanged(beforeValue, afterValue)).map(([label]) => label);
}

export function reconcileRefreshedAccessory(before: AccessoryItem, parsed: AccessoryItem) {
  if (!parsed.rawSpecText?.trim()) throw new Error("다나와 상세 원문에서 스펙을 확인하지 못해 기존 주변 부품 데이터를 보존했습니다.");
  if (before.dataQuality === "live" && parsed.dataQuality === "incomplete") {
    throw new Error("새 주변 부품 원문이 기존 데이터보다 부족해 기존 스펙을 보존했습니다.");
  }
  return {
    ...parsed,
    priceWon: isKnownPrice(parsed.priceWon) ? parsed.priceWon : before.priceWon,
    imageUrl: parsed.imageUrl ?? before.imageUrl,
    rawSpecText: parsed.rawSpecText || before.rawSpecText,
    updatedAt: new Date().toISOString()
  } satisfies AccessoryItem;
}

export async function refreshDanawaAccessory(item: AccessoryItem, options: PartRefreshOptions = {}) {
  const blockReason = accessoryRefreshBlockReason(item);
  if (blockReason) throw new Error(blockReason);
  const config = accessoryCategoryConfig(item)!;
  const fetchHtml = options.fetchHtml ?? fetchDanawaHtml;
  const html = await fetchHtml(item.danawaUrl!, {
    timeoutMs: Math.max(1000, options.timeoutMs ?? 12000),
    retries: Math.max(0, options.retries ?? 1),
    delayMs: 0
  });
  const listItem: DanawaListItem = {
    name: item.name,
    url: item.danawaUrl!,
    imageUrl: item.imageUrl,
    rawSpecText: item.rawSpecText,
    sourceProductCode: item.sourceProductCode!
  };
  return reconcileRefreshedAccessory(item, parseDanawaAccessoryPage(item.category, listItem, html, config.categoryId));
}

export function accessoryRefreshResponse(before: AccessoryItem, refreshed: AccessoryItem, refreshedAt = new Date().toISOString()): AccessoryRefreshResponse {
  return {
    item: refreshed,
    previousDataQuality: before.dataQuality,
    previousMissingFields: [...before.missingFields],
    changedFields: changedAccessoryFields(before, refreshed),
    refreshedAt
  };
}
