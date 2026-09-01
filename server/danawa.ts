import * as cheerio from "cheerio";
import type { M2LaneSharingScope, MemoryProfile, Part, PartCategory, PartSpecs, PciePowerConnectorKind, PciePowerRequirement, RadiatorMountPosition, RadiatorSupport } from "../shared/types";
import { CATEGORY_LABELS } from "../shared/types";
import { inferListingType } from "./listing";

export const DANAWA_CATEGORIES: Array<{
  category: PartCategory;
  categoryId: string;
}> = [
  { category: "cpu", categoryId: "112747" },
  { category: "cooler", categoryId: "11347549" },
  { category: "motherboard", categoryId: "112751" },
  { category: "memory", categoryId: "112752" },
  { category: "gpu", categoryId: "112753" },
  { category: "ssd", categoryId: "112760" },
  { category: "hdd", categoryId: "112763" },
  { category: "case", categoryId: "112775" },
  { category: "psu", categoryId: "112777" }
];

const DEFAULT_USER_AGENT =
  "PCSupporterStudentProject/1.0 (+compatibility catalog; contact unavailable)";
const DANAWA_LIST_AJAX_URL = "https://prod.danawa.com/list/ajax/getProductList.ajax.php";

export type DanawaCrawlerOptions = {
  pages?: number;
  all?: boolean;
  limitPerCategory?: number;
  details?: boolean;
  enrichMissingOnly?: boolean;
  delayMs?: number;
  timeoutMs?: number;
  retries?: number;
  userAgent?: string;
  signal?: AbortSignal;
};

export type DanawaListItem = {
  name: string;
  url: string;
  imageUrl?: string;
  priceWon?: number;
  rawSpecText?: string;
  sourceProductCode: string;
};

export type DanawaListPageInfo = {
  totalProductCount?: number;
  pageSize?: number;
};

export type DanawaListRequestContext = {
  group: string;
  depth: string;
  categoryCode: string;
  listCategoryCode: string;
  physicsCate1: string;
  physicsCate2: string;
  physicsCate3: string;
  physicsCate4: string;
  powerLinkKeyword: string;
  currentCategoryCode: string;
  categoryMappingCode: string;
  assemblyGalleryCategory: string;
  quickDeliveryCategoryYN: string;
  quickDeliveryDisplay: string;
  priceUnitSort: string;
  priceUnitSortOrder: string;
  simpleDescriptionDisplayYN: string;
};

export type DanawaCategoryCrawlResult = {
  category: PartCategory;
  categoryId: string;
  parts: Part[];
  pagesExpected: number;
  pagesVisited: number;
  listedProducts: number;
  uniqueProducts: number;
  detailFetched: number;
  detailFailed: number;
  missingProducts: number;
  incompleteSpecs: number;
  coverage: "partial" | "complete";
  specCoverage: "partial" | "complete";
};

function normalizeSpace(value: string | undefined | null) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function absoluteUrl(value: string | undefined) {
  if (!value) return undefined;
  const normalized = value.startsWith("//") ? `https:${value}` : value;
  return isAllowedSourceUrl(normalized) ? normalized : undefined;
}

const ALLOWED_SOURCE_HOSTS = new Set([
  "prod.danawa.com",
  "www.danawa.com",
  "danawa.com",
  "img.danawa.com",
  "img.danuri.io"
]);

export function isAllowedSourceUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ALLOWED_SOURCE_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function productCodeFromUrl(url: string) {
  return url.match(/[?&]pcode=(\d+)/)?.[1] ?? "";
}

function readJsonLd($: cheerio.CheerioAPI) {
  const values: unknown[] = [];
  $("script[type='application/ld+json']").each((_, node) => {
    const raw = $(node).contents().text();
    try {
      values.push(JSON.parse(raw));
    } catch {
      // Some pages contain analytics JSON that is not valid JSON-LD. Ignore it.
    }
  });
  return values;
}

function collectItemLists(value: unknown, output: DanawaListItem[]) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectItemLists(item, output);
    return;
  }
  const candidate = value as Record<string, unknown>;
  if (Array.isArray(candidate.itemListElement)) {
    for (const element of candidate.itemListElement) {
      if (!element || typeof element !== "object") continue;
      const item = element as Record<string, unknown>;
      const rawUrl = typeof item.url === "string" ? item.url : undefined;
      const name = typeof item.name === "string" ? normalizeSpace(item.name) : "";
      const imageUrl = typeof item.image === "string" ? absoluteUrl(item.image) : undefined;
      const url = rawUrl ? absoluteUrl(rawUrl) : undefined;
      const sourceProductCode = url ? productCodeFromUrl(url) : "";
      if (name && url && sourceProductCode) output.push({ name, url, imageUrl, sourceProductCode });
    }
  }
  for (const child of Object.values(candidate)) collectItemLists(child, output);
}

export function parseDanawaListPage(html: string): DanawaListItem[] {
  const $ = cheerio.load(html);
  const items: DanawaListItem[] = [];
  const productRows = $("li.prod_item[id^='productItem']");
  if (productRows.length > 0) {
    productRows.each((_, rowNode) => {
      const row = $(rowNode);
      const anchor = row.find("a[name='productName'][href*='pcode='], a.prod_name[href*='pcode=']").first();
      const url = absoluteUrl(anchor.attr("href"));
      const name = normalizeSpace(anchor.text());
      const sourceProductCode = url ? productCodeFromUrl(url) : "";
      if (!url || !name || !sourceProductCode) return;
      const imageUrl = absoluteUrl(row.find("img").first().attr("src"));
      const priceWon = parseWon(row.find("a.click_wish_prod[price]").first().attr("price"))
        ?? parseWon(row.find(".prod_pricelist .price_sect strong, .price_sect strong").first().text());
      const rawSpecText = normalizeSpace(row.find(".spec-box .spec_list").first().text());
      items.push({ name, url, imageUrl, priceWon, rawSpecText, sourceProductCode });
    });
  } else {
    for (const jsonLd of readJsonLd($)) collectItemLists(jsonLd, items);
    $("a.prod_name[href*='pcode='], a[name='productName'][href*='pcode=']").each((_, node) => {
      const anchor = $(node);
      const url = absoluteUrl(anchor.attr("href"));
      const name = normalizeSpace(anchor.text());
      const sourceProductCode = url ? productCodeFromUrl(url) : "";
      if (!url || !name || !sourceProductCode) return;
      items.push({ name, url, sourceProductCode });
    });
  }

  const unique = new Map<string, DanawaListItem>();
  for (const item of items) {
    const existing = unique.get(item.sourceProductCode);
    unique.set(item.sourceProductCode, {
      ...(existing ?? item),
      ...item,
      priceWon: item.priceWon ?? existing?.priceWon,
      imageUrl: item.imageUrl ?? existing?.imageUrl,
      rawSpecText: item.rawSpecText || existing?.rawSpecText
    });
  }
  return [...unique.values()];
}

export function parseDanawaListPageInfo(html: string): DanawaListPageInfo {
  const $ = cheerio.load(html);
  const totalProductCount = parseWon($("#totalProductCount").attr("value"))
    ?? parseNumber(normalizeSpace($("#totalProductCount").text()), /([\d,]+)/);
  const pageSize = $("li.prod_item[id^='productItem']").length || undefined;
  return { totalProductCount, pageSize };
}

function readDanawaScriptValue(html: string, key: string) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`\\b${escapedKey}\\s*(?::|=)\\s*(?:[\\\"']([^\\\"']*)[\\\"']|(\\d+))`));
  return match?.[1] ?? match?.[2] ?? "";
}

export function parseDanawaListRequestContext(html: string): DanawaListRequestContext | undefined {
  const categoryCode = readDanawaScriptValue(html, "nCategoryCode");
  const listCategoryCode = readDanawaScriptValue(html, "nListCategoryCode");
  if (!categoryCode || !listCategoryCode) return undefined;
  return {
    group: readDanawaScriptValue(html, "nListGroup") || readDanawaScriptValue(html, "nGroup"),
    depth: readDanawaScriptValue(html, "nListDepth") || readDanawaScriptValue(html, "nDepth"),
    categoryCode,
    listCategoryCode,
    physicsCate1: readDanawaScriptValue(html, "sPhysicsCate1"),
    physicsCate2: readDanawaScriptValue(html, "sPhysicsCate2"),
    physicsCate3: readDanawaScriptValue(html, "sPhysicsCate3"),
    physicsCate4: readDanawaScriptValue(html, "sPhysicsCate4"),
    powerLinkKeyword: readDanawaScriptValue(html, "sPowerLinkKeyword"),
    currentCategoryCode: readDanawaScriptValue(html, "oCurrentCategoryCode"),
    categoryMappingCode: readDanawaScriptValue(html, "sCategoryMappingCode"),
    assemblyGalleryCategory: readDanawaScriptValue(html, "bAssemblyGalleryCategory"),
    quickDeliveryCategoryYN: readDanawaScriptValue(html, "sQuickDeliveryCategoryYN"),
    quickDeliveryDisplay: readDanawaScriptValue(html, "sQuickDeliveryDisplay"),
    priceUnitSort: readDanawaScriptValue(html, "sPriceUnitSort"),
    priceUnitSortOrder: readDanawaScriptValue(html, "sPriceUnitSortOrder"),
    simpleDescriptionDisplayYN: readDanawaScriptValue(html, "sSimpleDescriptionDisplayYN")
  };
}

export function buildDanawaListAjaxParams(page: number, context: DanawaListRequestContext) {
  return {
    page: String(page),
    listCategoryCode: context.listCategoryCode,
    categoryCode: context.categoryCode,
    physicsCate1: context.physicsCate1,
    physicsCate2: context.physicsCate2,
    physicsCate3: context.physicsCate3,
    physicsCate4: context.physicsCate4,
    viewMethod: "LIST",
    sortMethod: "BEST",
    listCount: "30",
    group: context.group,
    depth: context.depth,
    brandName: "",
    makerName: "",
    searchOptionName: "",
    sDiscountProductRate: "0",
    sInitialPriceDisplay: "N",
    sPowerLinkKeyword: context.powerLinkKeyword,
    oCurrentCategoryCode: context.currentCategoryCode,
    sMallMinPriceDisplayYN: "",
    quickDeliveryCategoryYN: context.quickDeliveryCategoryYN,
    quickDeliveryDisplay: context.quickDeliveryDisplay,
    priceUnitSort: context.priceUnitSort,
    priceUnitSortOrder: context.priceUnitSortOrder,
    simpleDescriptionDisplayYN: context.simpleDescriptionDisplayYN,
    simpleDescriptionOpen: "Y",
    isDpgZoneUICategory: "N",
    isAssemblyGalleryCategory: context.assemblyGalleryCategory,
    sProductListApi: "search",
    innerSearchKeyword: "",
    innerDetailSearchKeyword: "",
    zeroPriceYN: "Y",
    categoryMappingCode: context.categoryMappingCode,
    priceUnit: "0",
    priceUnitValue: "0",
    priceUnitClass: "",
    cmRecommendSort: "N",
    cmRecommendSortDefault: "N",
    bundleImagePreview: "N",
    nPackageLimit: "6",
    bMakerDisplayYN: "Y",
    dnwSwitchOn: "",
    addDelivery: "N",
    coupangMemberSort: "",
    coupangMemberSortLayerType: ""
  };
}

function partFromListItem(category: PartCategory, categoryId: string, item: DanawaListItem): Part {
  const specs = parseSpecs(category, item.name, "", item.rawSpecText ?? "");
  const listingType = inferListingType({ category, name: item.name, rawSpecText: item.rawSpecText });
  const missing = [
    ...missingFields(category, specs),
    ...(listingType === "accessory" ? ["internal storage device"] : [])
  ];
  return {
    id: `danawa-${category}-${item.sourceProductCode}`,
    category,
    name: item.name,
    model: item.name,
    imageUrl: item.imageUrl,
    danawaUrl: item.url,
    source: "danawa",
    sourceProductCode: item.sourceProductCode,
    sourceCategoryId: categoryId,
    listingType,
    priceWon: item.priceWon,
    rawSpecText: item.rawSpecText,
    specs,
    dataQuality: missing.length === 0 ? "live" : "incomplete",
    missingFields: missing,
    updatedAt: new Date().toISOString()
  };
}

function parseNumber(text: string, pattern: RegExp) {
  const match = text.match(pattern);
  if (!match) return undefined;
  const number = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(number) ? number : undefined;
}

function parsePerDeviceRgbMeasurement(text: string, unit: "A" | "W") {
  const label = "(?:ARGB|RGB|LED(?:\\s*(?:팬|장치))?)";
  const marker = "(?:1\\s*개\\s*당|개\\s*당|장치\\s*당|팬\\s*당|/\\s*개|per\\s*(?:device|fan))";
  const number = `([\\d,.]+)\\s*${unit}(?![A-Za-z])`;
  const patterns = [
    new RegExp(`${label}[^/]{0,80}?${marker}[^/]{0,30}?${number}`, "i"),
    new RegExp(`${label}[^/]{0,60}?(?:소비전류|정격전류|소비전력|정격전력)\\s*[:：]?\\s*${number}[^/]{0,12}?${marker}`, "i"),
    new RegExp(`${number}\\s*${marker}[^/]{0,30}?${label}`, "i")
  ];
  for (const pattern of patterns) {
    const value = parseNumber(text, pattern);
    if (value !== undefined && value > 0) return value;
  }
  return undefined;
}

function parseScaledNumber(text: string, pattern: RegExp) {
  const match = text.match(pattern);
  if (!match) return undefined;
  const number = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(number)) return undefined;
  const multiplier = match[2]?.toUpperCase() === "M"
    ? 1_000_000
    : match[2]?.toUpperCase() === "K"
      ? 1_000
      : match[2]?.toUpperCase() === "G"
        ? 1_000_000_000
        : 1;
  return number * multiplier;
}

function parseRatedWattage(text: string, name: string) {
  const labeled = parseNumber(text, /(?:정격\s*출력|정격출력|(?<!권장\s)출력)\s*[:：]?\s*([\d,]{3,5})\s*W\b/i);
  if (labeled !== undefined) return labeled;
  const candidates = [text, name]
    .flatMap((value) => value.split("/"))
    .filter((segment) => !/(?:최대|지원|권장|12VHPWR|12V2x6|PCIe)/i.test(segment))
    .map((segment) => parseNumber(segment, /(?:^|[^\d])([\d,]{3,5})\s*W\b/i))
    .filter((value): value is number => value !== undefined);
  return candidates[0];
}

function parseSummedNumber(text: string, pattern: RegExp) {
  const match = text.match(pattern);
  if (!match) return undefined;
  const number = match
    .slice(1)
    .filter(Boolean)
    .flatMap((value) => value.split("+"))
    .map((value) => Number(value.replace(/[^\d]/g, "")))
    .reduce((sum, value) => sum + value, 0);
  return Number.isFinite(number) ? number : undefined;
}

function parseWon(text: string | undefined) {
  if (!text) return undefined;
  const number = Number(text.replace(/[^\d]/g, ""));
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function parseLowestPrice(text: string | undefined) {
  if (!text) return undefined;
  return parseNumber(text, /최저가\s*([\d,]+)\s*원/i);
}

function capacityMatches(text: string) {
  return [...text.matchAll(/([\d,.]+)\s*(TB|GB)\b/gi)]
    .map((match) => {
      if (match[2] !== "TB" && match[2] !== "GB") return undefined;
      const number = Number(match[1].replace(/,/g, ""));
      if (!Number.isFinite(number)) return undefined;
      return {
        value: match[2].toUpperCase() === "TB" ? number * 1000 : number,
        unit: match[2].toUpperCase(),
        index: match.index ?? 0,
        source: match[0]
      };
    })
    .filter((value): value is { value: number; unit: string; index: number; source: string } => value !== undefined);
}

function parseCapacityGb(text: string, preferredText = "") {
  const preferred = capacityMatches(preferredText);
  if (preferred.length > 0) return Math.max(...preferred.map((candidate) => candidate.value));

  const labeled = [...text.matchAll(/(?:용량|capacity|저장\s*용량|디스크\s*용량)[^\d]{0,24}([\d,.]+)\s*(TB|GB)\b/gi)]
    .map((match) => {
      if (match[2] !== "TB" && match[2] !== "GB") return undefined;
      const number = Number(match[1].replace(/,/g, ""));
      if (!Number.isFinite(number)) return undefined;
      return match[2].toUpperCase() === "TB" ? number * 1000 : number;
    })
    .filter((value): value is number => value !== undefined);
  if (labeled.length > 0) return Math.max(...labeled);

  const candidates = capacityMatches(text);
  const terabytes = candidates.filter((candidate) => candidate.unit === "TB");
  if (terabytes.length > 0) return Math.max(...terabytes.map((candidate) => candidate.value));

  const genericGigabytes = candidates.filter((candidate) => {
    if (candidate.unit !== "GB") return false;
    const context = text.slice(Math.max(0, candidate.index - 24), candidate.index).toLowerCase();
    return !/(dram|sLC|캐시|cache|nand|slc)/i.test(context);
  });
  return genericGigabytes.length > 0 ? Math.max(...genericGigabytes.map((candidate) => candidate.value)) : undefined;
}

function parseSocket(text: string) {
  const labeled = text.match(/(?:소켓|socket)\s*[:：]?\s*([A-Z0-9+/-]+)/i)?.[1];
  const lga = text.match(/\bLGA\s*\d{4,5}(?:-\d+)?\b/i)?.[0];
  const raw = (lga ?? labeled)?.replace(/\s/g, "").toUpperCase();
  if (!raw) return undefined;
  return /^\d{4,5}(?:-\d+)?$/.test(raw) ? `LGA${raw}` : raw;
}

function parseMemoryType(text: string) {
  return text.match(/DDR\s*[2345]/i)?.[0].replace(/\s/g, "").toUpperCase();
}

export function parseM2FormFactors(text: string) {
  const dimensions = [
    ...text.matchAll(/M\.2[^\d\n/]{0,40}(2242|2260|2280|22110)\b/gi),
    ...text.matchAll(/\b(2242|2260|2280|22110)\b[^\n/]{0,40}M\.2/gi)
  ].map((match) => `M.2 ${match[1]}`);
  return [...new Set(dimensions)];
}

export function parseM2FormFactor(text: string) {
  const dimension = parseM2FormFactors(text)[0];
  if (dimension) return dimension;
  return /M\.2/i.test(text) ? "M.2" : undefined;
}

const PCIE_POWER_TOKEN = /16\s*핀(?:\s*\(\s*(12V2x6|12VHPWR)\s*\))?|12V2x6|12VHPWR|6\s*\+\s*2\s*핀|8\s*핀|6\s*핀/gi;

function pciePowerKind(token: string): PciePowerConnectorKind | undefined {
  if (/12V2x6/i.test(token)) return "12v2x6";
  if (/12VHPWR/i.test(token)) return "12vhpwr";
  if (/16\s*핀/i.test(token)) return undefined;
  if (/6\s*\+\s*2\s*핀|8\s*핀/i.test(token)) return "pcie_8pin_6plus2";
  if (/6\s*핀/i.test(token)) return "pcie_6pin";
  return undefined;
}

function connectorCountFromTail(tail: string, fallback?: number) {
  const counts = [...tail.matchAll(/(?:x|×|✕|\*)\s*(\d+)|(\d+)\s*개/gi)]
    .map((match) => Number(match[1] ?? match[2]))
    .filter((value) => Number.isFinite(value));
  return counts.at(-1) ?? fallback;
}

function parseConnectorCounts(text: string, fallbackCount?: number) {
  const counts: Partial<Record<PciePowerConnectorKind, number>> = {};
  let found = false;
  const matches = [...text.matchAll(PCIE_POWER_TOKEN)];
  const boundaryPattern = new RegExp(PCIE_POWER_TOKEN.source, "i");
  for (const match of matches) {
    const token = match[0];
    const kind = pciePowerKind(token);
    if (!kind) continue;
    const start = (match.index ?? 0) + token.length;
    const remaining = text.slice(start);
    const boundary = remaining.search(boundaryPattern);
    const tail = boundary >= 0 ? remaining.slice(0, boundary) : remaining;
    if (kind === "pcie_8pin_6plus2" && /4\s*\+\s*4/.test(tail) && !/6\s*\+\s*2/.test(tail)) continue;
    const count = connectorCountFromTail(tail, fallbackCount);
    if (count === undefined) continue;
    counts[kind] = count;
    found = true;
  }
  return found ? counts : undefined;
}

export function parsePciePowerConnectors(text: string) {
  const counts: Partial<Record<PciePowerConnectorKind, number>> = {};
  let found = false;
  let inConnectorSection = false;
  for (const segment of text.split("/")) {
    if (/\[커넥터\]/i.test(segment)) inConnectorSection = true;
    else if (/\[[^\]]+\]/.test(segment)) inConnectorSection = false;
    const hasPcieLabel = /\bPCI\s*-?\s*E\b|\bPCIe\b/i.test(segment);
    if (!hasPcieLabel && !inConnectorSection) continue;
    if (/(?:\[변경사항\]|변경|→|->|⇢)/i.test(segment)) continue;
    if (/보조전원[^/]*(?:4\s*\+\s*4|EPS)/i.test(segment) && !hasPcieLabel) continue;
    const parsed = parseConnectorCounts(segment);
    if (!parsed) continue;
    Object.assign(counts, parsed);
    found = true;
  }
  return found ? counts : undefined;
}

function requirementsFromCounts(counts: Partial<Record<PciePowerConnectorKind, number>>) {
  return (Object.entries(counts) as Array<[PciePowerConnectorKind, number | undefined]>)
    .filter(([, count]) => count !== undefined && count > 0)
    .map(([kind, count]) => ({ kind, count: count as number } satisfies PciePowerRequirement));
}

export function parsePciePowerOptions(text: string) {
  const stableText = text.split(/\[변경사항\]/i, 1)[0];
  const powerPortText = text.match(/(?:전원\s*(?:포트|커넥터)|보조\s*전원)\s*[:：]?\s*([^/]+)/i)?.[1]
    ?? text.match(/(?:전원|보조전원)[^/]{0,80}/i)?.[0]
    ?? "";
  if (/(?:없음|미탑재|미지원|불필요)/i.test(powerPortText)) return [];
  if (/(?:최대|지원)[^/]*(?:W|와트)/i.test(powerPortText)
    && !/(?:x|×|✕|\*)\s*\d+|\d+\s*개/i.test(powerPortText)) return undefined;
  const direct = parseConnectorCounts(powerPortText);
  if (!direct) return undefined;
  const directRequirements = requirementsFromCounts(direct);
  if (directRequirements.length === 0) return undefined;
  const adapterCount = stableText.match(/(?:구성품|동봉|포함)[^/]{0,160}?([1-9]\d?)\s*(?:x|×|✕|\*)\s*(?:8\s*핀|6\s*\+\s*2\s*핀)\s*(?:to|→|->)\s*16\s*핀/i)?.[1];
  const hasHighPowerRequirement = directRequirements.some((requirement) => requirement.kind === "12vhpwr" || requirement.kind === "12v2x6");
  const parsedAdapterCount = adapterCount ? Number(adapterCount) : undefined;
  return parsedAdapterCount !== undefined && parsedAdapterCount <= 8 && hasHighPowerRequirement
    ? [directRequirements, [{ kind: "pcie_8pin_6plus2", count: parsedAdapterCount } satisfies PciePowerRequirement]]
    : [directRequirements];
}

export function parsePciePowerAdapterOptions(text: string) {
  const stableText = text.split(/\[변경사항\]/i, 1)[0];
  const adapterCounts = [...stableText.matchAll(/(?:구성품|동봉|포함)[^/]{0,180}?([1-9]\d?)\s*(?:x|×|✕|\*)\s*(?:8\s*핀|6\s*\+\s*2\s*핀)\s*(?:to|→|->)\s*16\s*핀/gi)]
    .map((match) => Number(match[1]))
    .filter((count) => Number.isInteger(count) && count > 0 && count <= 8);
  return adapterCounts.length > 0
    ? [...new Set(adapterCounts)].map((count) => [{ kind: "pcie_8pin_6plus2" as const, count }])
    : undefined;
}

function parseCaseRadiatorSizes(text: string) {
  const stableText = text.split(/\[변경사항\]/i, 1)[0];
  const supportedSizes = new Set<number>();
  const collectSizes = (segment: string) => {
    for (const match of segment.matchAll(/\b(120|140|240|280|360|420)\s*(?:mm)?\b/gi)) supportedSizes.add(Number(match[1]));
  };
  for (const match of stableText.matchAll(/(?:라디에이터|RAD|수랭|수냉)[^/]{0,100}/gi)) collectSizes(match[0]);
  for (const match of stableText.matchAll(/\b(120|140|240|280|360|420)\s*mm\s*(?:\d\s*열\s*)?(?:수랭|수냉)/gi)) supportedSizes.add(Number(match[1]));
  return [...supportedSizes].sort((left, right) => left - right);
}

const RADIATOR_POSITION_LABELS: Array<[RadiatorMountPosition, string]> = [
  ["front", "전면"],
  ["top", "상단"],
  ["bottom", "하단"],
  ["side", "측면"],
  ["rear", "후면"]
];

function radiatorPositionFromText(text: string) {
  const stableText = text.split(/\[변경사항\]/i, 1)[0];
  const radiatorPattern = "(?:라디에이터|RAD|수랭|수냉)";
  for (const [position, label] of RADIATOR_POSITION_LABELS) {
    if (new RegExp(`${label}[^/]{0,80}${radiatorPattern}`, "i").test(stableText)
      || new RegExp(`${radiatorPattern}[^/]{0,80}${label}`, "i").test(stableText)) return position;
  }
  return undefined;
}

function caseRadiatorSupportsFromText(text: string): RadiatorSupport[] {
  const stableText = text.split(/\[변경사항\]/i, 1)[0];
  const supports = new Map<RadiatorMountPosition, Set<number>>();
  const collect = (position: RadiatorMountPosition, segment: string) => {
    const sizes = [...segment.matchAll(/\b(120|140|240|280|360|420)\s*(?:mm)?\b/gi)].map((match) => Number(match[1]));
    if (sizes.length === 0) return;
    const current = supports.get(position) ?? new Set<number>();
    sizes.forEach((size) => current.add(size));
    supports.set(position, current);
  };
  const radiatorPattern = "(?:라디에이터|RAD|수랭|수냉)";
  for (const [position, label] of RADIATOR_POSITION_LABELS) {
    const beforePattern = new RegExp(`${label}[^/]{0,100}${radiatorPattern}[^/]{0,100}`, "gi");
    const afterPattern = new RegExp(`${radiatorPattern}[^/]{0,100}${label}[^/]{0,100}`, "gi");
    for (const match of stableText.matchAll(beforePattern)) collect(position, match[0]);
    for (const match of stableText.matchAll(afterPattern)) collect(position, match[0]);
  }
  return RADIATOR_POSITION_LABELS
    .flatMap(([position]) => {
      const sizes = supports.get(position);
      return sizes && sizes.size > 0 ? [{ position, sizesMm: [...sizes].sort((left, right) => left - right) }] : [];
    });
}

export function parseM2LaneSharing(text: string) {
  const scopes = new Set<M2LaneSharingScope>();
  if (/PCIe\s*레인\s*공유/i.test(text)) scopes.add("pcie");
  if (/SATA\s*레인\s*공유/i.test(text)) scopes.add("sata");
  if (/USB4\s*레인\s*공유/i.test(text)) scopes.add("usb4");
  if (/M\.2\s*간\s*레인\s*공유/i.test(text)) scopes.add("m2");
  const notes = [...text.matchAll(/(?:PCIe\s*레인\s*공유|SATA\s*레인\s*공유|USB4\s*레인\s*공유|M\.2\s*간\s*레인\s*공유)/gi)]
    .map((match) => normalizeSpace(match[0]));
  return {
    scopes: [...scopes],
    notes: [...new Set(notes)]
  };
}

function parsePcieGenerations(text: string) {
  return [...new Set(
    [...text.matchAll(/\bPCIe\s*(?:Gen(?:eration)?\s*)?([2-6](?:\.\d)?)/gi)]
      .map((match) => Number.parseFloat(match[1]))
      .filter((value) => Number.isFinite(value))
  )];
}

function parseMemoryProfiles(text: string): MemoryProfile[] | undefined {
  const profiles: MemoryProfile[] = [];
  if (/\bEXPO\b/i.test(text)) profiles.push("EXPO");
  if (/\bXMP(?:\s*\d(?:\.\d+)?)?/i.test(text)) profiles.push("XMP");
  return profiles.length > 0 ? [...new Set(profiles)] : undefined;
}

function parseMemoryTiming(text: string) {
  const match = text.match(/(?:램\s*타이밍|메모리\s*타이밍|타이밍)\s*[:：]?\s*(CL\s*\d+(?:\s*[-–—]\s*\d+){0,3})/i)
    ?? text.match(/\b(CL\s*\d+(?:\s*[-–—]\s*\d+){0,3})\b/i);
  if (!match) return undefined;
  return match[1].replace(/\s+/g, "").replace(/[–—]/g, "-").toUpperCase();
}

function memoryTimingValues(timing: string | undefined) {
  return timing?.match(/\d+/g)?.map(Number).filter((value) => Number.isFinite(value)) ?? [];
}

function parseMemoryCasLatency(text: string, timing?: string) {
  return memoryTimingValues(timing)[0]
    ?? parseNumber(text, /(?:램\s*타이밍|메모리\s*타이밍|타이밍)\s*[:：]?\s*CL\s*(\d{1,3})/i)
    ?? parseNumber(text, /\bCL\s*(\d{1,3})\b/i);
}

function parseMemoryVoltage(text: string) {
  return parseNumber(text, /(?:동작\s*)?전압\s*[:：]?\s*(\d+(?:\.\d+)?)\s*V\b/i)
    ?? parseNumber(text, /\b(\d+(?:\.\d+)?)\s*V\b/i);
}

function parseMemoryModuleCount(text: string) {
  const explicit = parseNumber(text, /램\s*개수\s*[:：]?\s*(\d+)\s*개/i);
  const named = parseNumber(text, /\(\s*[\d,.]+\s*[Gg]\s*[x×]\s*(\d+)\s*\)/i);
  const count = explicit ?? named;
  return count !== undefined && Number.isInteger(count) && count > 0 ? count : undefined;
}

function parseCpuMemorySpeed(text: string) {
  const memoryStart = text.search(/메모리\s*(?:규격|속도|클럭)/i);
  if (memoryStart < 0) return undefined;
  return parseNumber(text.slice(memoryStart, memoryStart + 240), /\b([\d,]{4,6})\s*MHz\b/i);
}

function parseSpecs(category: PartCategory, name: string, description: string, rawSpecText: string): PartSpecs {
  const text = normalizeSpace(`${name} ${description} ${rawSpecText}`);
  const specs: PartSpecs = {};

  if (category === "cpu") {
    specs.socket = parseSocket(text);
    specs.memoryType = parseMemoryType(text);
    specs.cores = parseSummedNumber(text, /(?:P(\d+)\s*\+\s*E(\d+)|([\d+]+))\s*코어/i);
    specs.threads = parseSummedNumber(text, /([\d+]+)\s*스레드/i);
    specs.boostClockGhz = parseNumber(text, /최대\s*클럭\s*[:：]?\s*([\d.]+)\s*GHz/i);
    specs.cinebenchR23Single = parseNumber(text, /시네벤치\s*R23\s*\(\s*싱글\s*\)\s*[:：]?\s*([\d,]+)/i);
    specs.cinebenchR23Multi = parseNumber(text, /시네벤치\s*R23\s*\(\s*멀티\s*\)\s*[:：]?\s*([\d,]+)/i);
    specs.tdpW = parseNumber(text, /TDP\s*[:：]?\s*([\d,]+)\s*W/i);
    specs.pptW = parseNumber(text, /PPT\s*[:：]?\s*([\d,]+)\s*W/i);
    specs.tdpW = specs.tdpW
      ?? parseNumber(text, /PBP-MTP\s*[:：]?\s*([\d,]+)(?:\s*-\s*[\d,]+)?\s*W/i);
    specs.maxMemorySpeedMhz = parseNumber(text, /(?:메모리|Memory)[^\d]{0,32}([\d,]{4,6})\s*MHz/i)
      ?? parseCpuMemorySpeed(text);
    const integratedGraphicsAbsent = /(?:내장\s*그래픽|내장그래픽|그래픽)\s*[:：]?\s*(?:미\s*탑재|미탑재|미\s*포함|미포함|미지원|없음|없습니다)/i.test(text);
    specs.integratedGraphics = integratedGraphicsAbsent
      ? false
      : /라데온\s*그래픽|인텔\s*그래픽스|UHD\s*Graphics|Xe\s*LPG|그래픽\s*탑재/i.test(text)
        ? true
        : undefined;
    specs.coolerIncluded = /쿨러\s*:\s*(?!미포함|없음)[^/]*(?:포함|기본)/i.test(text);
  }

  if (category === "cooler") {
    specs.coolerType = /수랭|일체형|라디에이터|Liquid/i.test(text) ? "liquid" : "air";
    const sockets = [...text.matchAll(/AM[45]|LGA\s*\d{4,5}/gi)].map((match) => match[0].replace(/\s/g, "").toUpperCase());
    specs.supportedSockets = [...new Set(sockets)];
    specs.maxCoolingW = parseNumber(text, /(?:최대\s*)?(?:지원\s*)?(?:TDP|발열량)\s*[:：]?\s*([\d,]+)\s*W/i);
    if (specs.coolerType === "liquid") {
      specs.radiatorSizeMm = parseNumber(text, /(?:라디에이터|RAD)[^\d]{0,20}(120|240|280|360|420)\s*mm/i)
        ?? Number(text.match(/(?:DN-|RT|A|B|C|D)?(120|240|280|360|420)(?:D|S|GT|X)?\b/i)?.[1] ?? NaN);
      specs.radiatorPosition = radiatorPositionFromText(text);
    } else {
      specs.maxCoolerHeightMm = parseNumber(text, /(?:높이|쿨러 높이)\s*[:：]?\s*([\d,.]+)\s*mm/i);
    }
  }

  if (category === "motherboard") {
    specs.socket = parseSocket(text);
    specs.memoryType = parseMemoryType(text);
    specs.memoryProfiles = parseMemoryProfiles(text);
    specs.memoryFormFactor = /SO-?DIMM|SODIMM|노트북용/i.test(text)
      ? "SO-DIMM"
      : /(?:^|[\s/])DIMM(?!\s*\.)/i.test(text)
        ? "DIMM"
        : undefined;
    specs.maxMemoryGb = parseNumber(text, /(?:메모리\s*용량|용량)\s*[:：]?\s*(?:최대\s*)?([\d,]+)\s*GB/i);
    specs.memorySlots = parseNumber(text, /(?:메모리\s*슬롯|DIMM)\s*[:：]?\s*(\d+)\s*개/i)
      ?? parseNumber(text, /(?:\[메모리\]|메모리).{0,120}?\b(\d+)\s*개/i);
    specs.maxMemorySpeedMhz = parseNumber(text, /(?:메모리\s*)?(?:속도|클럭)\s*[:：]?\s*([\d,]{4,6})\s*MHz/i)
      ?? parseNumber(text, /\[메모리\]\s*([\d,]{4,6})\s*MHz/i);
    const m2Match = text.match(/M\.2\s*[:：]?\s*(\d+)(?:\s*\+\s*(\d+))?\s*개/i);
    specs.m2Slots = m2Match
      ? Number(m2Match[1]) + Number(m2Match[2] ?? 0)
      : parseNumber(text, /M\.2[^\d]{0,32}(\d+)\s*개/i);
    const m2ConnectionText = text.match(/M\.2\s*연결\s*[:：]?\s*([^/]+)/i)?.[1] ?? "";
    const m2Interfaces = (["NVMe", "SATA"] as const).filter((interfaceName) => new RegExp(`\\b${interfaceName}\\b`, "i").test(m2ConnectionText));
    if (m2Interfaces.length > 0) specs.m2Interfaces = m2Interfaces;
    const m2PcieGenerations = parsePcieGenerations(m2ConnectionText);
    if (m2PcieGenerations.length > 0) specs.m2PcieGenerations = m2PcieGenerations;
    const laneSharing = parseM2LaneSharing(m2ConnectionText);
    if (laneSharing.scopes.length > 0) {
      specs.m2LaneSharingScopes = laneSharing.scopes;
      if (laneSharing.scopes.includes("pcie")) specs.m2LaneSharing = true;
      specs.m2LaneSharingNote = `M.2 연결: ${normalizeSpace(m2ConnectionText)}`;
    }
    const expansionSlotText = text.match(/\[확장슬롯\]([\s\S]*?)(?=\[(?:저장장치|후면단자|내부I\/O|특징)\]|$)/i)?.[1] ?? "";
    if (/PCIe\s*x\d+/i.test(expansionSlotText)) {
      specs.pcieX16Slots = parseNumber(expansionSlotText, /PCIe\s*x16(?:\s*\([^)]*\))?\s*[:：]?\s*(\d+)\s*개/i) ?? 0;
      specs.pcieX8Slots = parseNumber(expansionSlotText, /PCIe\s*x8(?:\s*\([^)]*\))?\s*[:：]?\s*(\d+)\s*개/i) ?? 0;
    }
    specs.sataPorts = parseNumber(text, /SATA\d?[^\d]{0,32}(\d+)\s*개/i);
    const systemFanPorts = parseNumber(text, /시스템팬\s*4핀\s*[:：]?\s*(\d+)\s*개/i);
    const cpuFanHeaders = [...text.matchAll(/CPU(?:\s*추가)?팬(?:\([^)]*\))?\s*(?:4핀\s*)?헤더/gi)].length;
    if (systemFanPorts !== undefined || cpuFanHeaders > 0) specs.fanPortCount = (systemFanPorts ?? 0) + cpuFanHeaders;
    const rgbHeaders = [...text.matchAll(/(?:ARGB|RGB)\s*(?:12V|5V)?\s*(?:4핀|3핀)\s*헤더/gi)].length;
    const rgb5vHeaders = [...text.matchAll(/ARGB\s*5V\s*3핀\s*헤더/gi)].length;
    const rgb12vHeaders = [...text.matchAll(/RGB\s*12V\s*4핀\s*헤더/gi)].length;
    if (rgbHeaders > 0) {
      specs.rgbPortCount = rgbHeaders;
      specs.rgb5vPortCount = rgb5vHeaders;
      specs.rgb12vPortCount = rgb12vHeaders;
    }
    specs.formFactor = /M-ATX|Micro-ATX|mATX/i.test(text)
      ? "mATX"
      : /M-ITX|Mini-ITX|\bITX\b/i.test(text)
        ? "ITX"
        : /\bATX\b/i.test(text)
          ? "ATX"
          : undefined;
  }

  if (category === "memory") {
    specs.memoryType = parseMemoryType(text);
    specs.memoryProfiles = parseMemoryProfiles(text);
    specs.memoryModuleCountPerKit = parseMemoryModuleCount(text);
    const memoryTiming = parseMemoryTiming(text);
    const timingValues = memoryTimingValues(memoryTiming);
    specs.memoryTiming = memoryTiming;
    specs.memoryCasLatency = parseMemoryCasLatency(text, memoryTiming);
    specs.memoryRcdLatency = timingValues[1];
    specs.memoryTrpLatency = timingValues[2];
    specs.memoryTrasLatency = timingValues[3];
    specs.memoryVoltageV = parseMemoryVoltage(text);
    specs.capacityGb = parseCapacityGb(text, name);
    specs.speedMhz = parseNumber(text, /(?:DDR\s*[2345][- ]?)?([\d,]{3,6})\s*MHz/i);
    specs.memoryEffectiveLatencyNs = specs.speedMhz !== undefined && specs.speedMhz > 0 && specs.memoryCasLatency !== undefined
      ? Number(((specs.memoryCasLatency * 2000) / specs.speedMhz).toFixed(2))
      : undefined;
    specs.formFactor = /SO-DIMM|노트북용/i.test(text) ? "SO-DIMM" : "DIMM";
  }

  if (category === "gpu") {
    if (/(?:NVIDIA|GEFORCE|RTX|GTX|QUADRO|TESLA|CUDA)/i.test(text)) {
      specs.gpuVendor = "nvidia";
    } else if (/(?:AMD|RADEON|\bRX\s*\d|RADEON\s*PRO)/i.test(text)) {
      specs.gpuVendor = "amd";
    } else if (/(?:INTEL|\bARC\b)/i.test(text)) {
      specs.gpuVendor = "intel";
    }
    const gpuFamilyMatch = text.match(/\b(RTX|GTX|RX)\s*([0-9]{2})[0-9]{2}\b/i);
    const arcFamilyMatch = text.match(/\bARC\s*([AB])\d+/i);
    specs.gpuMemoryType = text.match(/\b(GDDR[345567]X?|HBM[23](?:E)?)\b/i)?.[1].toUpperCase();
    specs.gpuArchitectureFamily = gpuFamilyMatch
      ? `${gpuFamilyMatch[1].toUpperCase()} ${gpuFamilyMatch[2]}`
      : arcFamilyMatch
        ? `ARC ${arcFamilyMatch[1].toUpperCase()}`
        : undefined;
    const pcieWidth = text.match(/PCIe(?:\s*[\d.]+)?\s*x(16|8|4|1)(?:\s*\([^)]*\))?/i)?.[1];
    specs.pcieSlotWidth = pcieWidth ? Number(pcieWidth) : undefined;
    specs.pciePowerOptions = parsePciePowerOptions(text);
    specs.pciePowerAdapterOptions = parsePciePowerAdapterOptions(text);
    specs.powerW = parseNumber(text, /(?:소비전력|사용전력|TDP)\s*[:：]?\s*([\d,]+)\s*W/i);
    specs.recommendedPsuW = parseNumber(text, /(?:권장\s*파워|권장\s*PSU)\s*[:：]?\s*([\d,]+)\s*W/i)
      ?? parseNumber(text, /([\d,]{3,5})\s*W\s*이상/i);
    specs.vramGb = parseNumber(text, /(?:VRAM|비디오\s*메모리|그래픽\s*메모리)\s*[:：]?\s*(?!대역폭)[^/\d]{0,24}([\d,]+)\s*GB(?!\s*\/\s*s)/i)
      ?? parseNumber(name, /([\d,]+)\s*GB/i);
    specs.gpuBoostClockMhz = parseNumber(text, /부스트\s*클럭\s*[:：]?\s*([\d,]+)\s*MHz/i);
    specs.gpuStreamProcessors = parseNumber(text, /(?:스트림\s*프로세서|CUDA\s*코어|쿠다\s*코어)\s*[:：]?\s*([\d,]+)/i);
    specs.gpuMemoryBandwidthGbps = parseNumber(text, /VRAM\s*대역폭\s*[:：]?\s*([\d,.]+)\s*GB\s*\/\s*s/i);
    specs.gpu3dmarkTimeSpyScore = parseNumber(text, /(?:3DMark\s*)?(?:Time\s*Spy|타임\s*스파이)[^\d]{0,32}([\d,]{3,6})/i);
    specs.gpu3dmarkPortRoyalScore = parseNumber(text, /(?:3DMark\s*)?(?:Port\s*Royal|포트\s*로열)[^\d]{0,32}([\d,]{3,6})/i);
    specs.lengthMm = parseNumber(text, /(?:가로\s*\(길이\)|GPU\s*길이|길이)\s*[:：]?\s*([\d,.]+)\s*mm/i);
    specs.widthMm = parseNumber(text, /(?:가로)\s*[:：]?\s*([\d,.]+)\s*mm/i);
    specs.thicknessMm = parseNumber(text, /(?:두께)\s*[:：]?\s*([\d,.]+)\s*mm/i);
  }

  if (category === "ssd") {
    specs.capacityGb = parseCapacityGb(text, name);
    specs.interface = /NVMe/i.test(text) ? "NVMe" : /SATA/i.test(text) ? "SATA" : undefined;
    specs.formFactor = parseM2FormFactor(text) ?? (/2\.5(?:인치|형)|2\.5\"|6\.4cm/i.test(text) ? "2.5인치" : undefined);
    specs.sequentialReadMbps = parseNumber(text, /순차읽기\s*[:：]?\s*([\d,]+)\s*MB\/s/i);
    specs.sequentialWriteMbps = parseNumber(text, /순차쓰기\s*[:：]?\s*([\d,]+)\s*MB\/s/i);
    const ssdPcieGenerations = parsePcieGenerations(text);
    specs.m2PcieGeneration = ssdPcieGenerations.length > 0 ? Math.max(...ssdPcieGenerations) : undefined;
    specs.ssdController = text.match(/(?:컨트롤러|controller)\s*[:：]?\s*([^/]+)/i)?.[1].trim();
    specs.ssdNandType = text.match(/(?:^|\/)\s*(TLC|QLC|MLC|SLC)(?:\s*\([^/]*\))?\s*(?=\/|$)/i)?.[1].toUpperCase()
      ?? text.match(/NAND\s*[:：]?\s*(TLC|QLC|MLC|SLC)\b/i)?.[1].toUpperCase();
    specs.ssdTbwTb = parseNumber(text, /\bTBW\s*[:：]?\s*([\d,.]+)\s*TB\b/i);
    specs.ssdReadIops = parseScaledNumber(text, /(?:읽기|read)\s*IOPS\s*[:：]?\s*([\d,.]+)\s*([KMG])?/i);
    specs.ssdWriteIops = parseScaledNumber(text, /(?:쓰기|write)\s*IOPS\s*[:：]?\s*([\d,.]+)\s*([KMG])?/i);
  }

  if (category === "hdd") {
    specs.capacityGb = parseCapacityGb(text, name);
    specs.formFactor = /3\.5(?:인치|형)|3\.5\"|8\.9cm/i.test(text) ? "3.5인치" : /2\.5(?:인치|형)|2\.5\"|6\.4cm/i.test(text) ? "2.5인치" : undefined;
    specs.interface = /SATA/i.test(text) ? "SATA" : undefined;
    specs.sequentialReadMbps = parseNumber(text, /순차읽기\s*[:：]?\s*([\d,]+)\s*MB\/s/i);
    specs.sequentialWriteMbps = parseNumber(text, /순차쓰기\s*[:：]?\s*([\d,]+)\s*MB\/s/i);
  }

  if (category === "case") {
    const gpuLengthRange = text.match(/(?:VGA|그래픽카드|GPU)\s*길이\s*[:：]?\s*([\d,.]+)\s*(?:~|∼|-)\s*([\d,.]+)\s*mm/i);
    specs.maxGpuLengthMm = gpuLengthRange
      ? Number(gpuLengthRange[2].replace(/,/g, ""))
      : parseNumber(text, /(?:VGA|그래픽카드|GPU)[^\d]{0,18}(?:길이)?\s*[:：]?\s*([\d,.]+)\s*mm/i);
    specs.maxCoolerHeightMm = parseNumber(text, /(?:CPU\s*)?쿨러[^\d]{0,18}(?:높이)?\s*[:：]?\s*([\d,.]+)\s*mm/i);
    const psuLengthRange = text.match(/파워\s*장착\s*길이\s*[:：]?\s*([\d,.]+)\s*(?:~|∼|-)\s*([\d,.]+)\s*mm/i);
    specs.maxPsuLengthMm = psuLengthRange
      ? Number(psuLengthRange[2].replace(/,/g, ""))
      : parseNumber(text, /파워\s*장착\s*길이\s*[:：]?\s*([\d,.]+)\s*mm/i);
    specs.hddBays = parseNumber(text, /(?:3\.5인치|HDD)[^\d]{0,18}(?:베이|장착)[^\d]{0,10}(\d+)\s*개/i);
    specs.ssdBays = parseNumber(text, /(?:2\.5인치|SSD)[^\d]{0,18}(?:베이|장착)[^\d]{0,10}(\d+)\s*개/i);
    specs.fanCount = parseNumber(text, /쿨링팬\s*[:：]?\s*총\s*(\d+)\s*개/i);
    specs.rgbDeviceCount = parseNumber(text, /LED팬\s*[:：]?\s*(\d+)\s*개/i);
    specs.rgbDeviceCurrentA = parsePerDeviceRgbMeasurement(text, "A");
    specs.rgbDevicePowerW = parsePerDeviceRgbMeasurement(text, "W");
    const ledColorText = text.match(/LED\s*색상\s*[:：]?\s*([^/]+)/i)?.[1] ?? "";
    const ledColorWithoutArgb = ledColorText.replace(/ARGB/gi, "");
    const hasArgbDevice = /ARGB/i.test(ledColorText);
    const hasRgbDevice = /\bRGB\b/i.test(ledColorWithoutArgb);
    specs.rgbDeviceVoltage = hasArgbDevice && hasRgbDevice ? "mixed" : hasArgbDevice ? "5V" : hasRgbDevice ? "12V" : undefined;
    if (/(?:ARGB|RGB)\s*(?:컨트롤|컨트롤러)|허브\s*제공/i.test(text)) specs.rgbControllerIncluded = true;
    specs.radiatorSizesMm = parseCaseRadiatorSizes(text);
    specs.radiatorSupports = caseRadiatorSupportsFromText(text);
    const supportedBoardText = text.match(/지원보드규격\s*[:：]\s*([^/]+)/i)?.[1] ?? "";
    const supportedBoardPatterns: Array<[string, RegExp]> = [
      ["ATX", /(?:^|[\s,])ATX(?:\s|,|$)/i],
      ["mATX", /M-ATX|Micro-ATX|(?:^|[\s,])mATX(?:\s|,|$)/i],
      ["ITX", /M-ITX|Mini-ITX|(?:^|[\s,])ITX(?:\s|,|$)/i]
    ];
    specs.motherboardFormFactors = supportedBoardPatterns
      .filter(([, pattern]) => pattern.test(supportedBoardText))
      .map(([form]) => form as string);
    const supportedPsuText = text.match(/지원파워규격\s*[:：]\s*([^/]+)/i)?.[1] ?? "";
    const supportedPsuFormFactors = [
      [/SFX-L/i, "SFX-L"],
      [/(?:^|[\s,])SFX(?:[\s,]|$)/i, "SFX"],
      [/ATX|표준-ATX/i, "ATX"]
    ]
      .filter(([pattern]) => (pattern as RegExp).test(supportedPsuText))
      .map(([, form]) => form as string);
    if (supportedPsuFormFactors.length > 0) specs.supportedPsuFormFactors = [...new Set(supportedPsuFormFactors)];
  }

  if (category === "psu") {
    specs.pciePowerConnectors = parsePciePowerConnectors(text);
    specs.wattageW = parseRatedWattage(text, name);
    specs.psuDepthMm = parseNumber(text, /깊이(?:\s*\([^)]+\))?\s*[:：]?\s*([\d,.]+)\s*mm/i);
    const stablePsuText = text.split(/\[변경사항\]/i, 1)[0];
    specs.psuCableType = /케이블\s*연결\s*[:：]?\s*풀\s*모듈러/i.test(stablePsuText)
      ? "fully_modular"
      : /케이블\s*연결\s*[:：]?\s*(?:세미|반)\s*모듈러/i.test(stablePsuText)
        ? "semi_modular"
        : /케이블\s*연결\s*[:：]?\s*케이블\s*일체형/i.test(stablePsuText)
          ? "fixed"
          : undefined;
    specs.psuRailType = /\+12V[^/]{0,24}(?:싱글|단일)\s*레일/i.test(stablePsuText)
      ? "single"
      : /\+12V[^/]{0,24}(?:다중|멀티)\s*레일/i.test(stablePsuText)
        ? "multi"
        : undefined;
    const efficiency = text.match(/80\s*PLUS\s+(Standard|Bronze|Silver|Gold|Platinum|Titanium|브론즈|실버|골드|플래티넘|티타늄)/i)?.[1];
    const efficiencyMap: Record<string, string> = {
      브론즈: "Bronze",
      실버: "Silver",
      골드: "Gold",
      플래티넘: "Platinum",
      티타늄: "Titanium"
    };
    specs.efficiency = efficiency ? `80PLUS ${efficiencyMap[efficiency] ?? efficiency}` : undefined;
    specs.psuFormFactor = /SFX-L/i.test(text) ? "SFX-L" : /SFX/i.test(text) ? "SFX" : /ATX/i.test(text) ? "ATX" : undefined;
  }

  return specs;
}

const REQUIRED_FIELDS: Record<PartCategory, string[]> = {
  cpu: ["socket", "tdpW"],
  cooler: ["supportedSockets"],
  motherboard: ["socket", "memoryType", "maxMemoryGb", "memorySlots", "m2Slots"],
  memory: ["memoryType", "capacityGb", "speedMhz"],
  gpu: ["powerW", "recommendedPsuW", "lengthMm"],
  ssd: ["interface", "formFactor", "capacityGb"],
  hdd: ["formFactor", "capacityGb"],
  case: ["maxGpuLengthMm", "maxCoolerHeightMm", "hddBays"],
  psu: ["wattageW"]
};

function missingFields(category: PartCategory, specs: PartSpecs) {
  const fields = category === "cooler" && specs.coolerType === "liquid"
    ? ["supportedSockets", "radiatorSizeMm"]
    : category === "cooler"
      ? ["supportedSockets", "maxCoolerHeightMm"]
      : REQUIRED_FIELDS[category];
  return fields.filter((field) => {
    const value = specs[field as keyof PartSpecs];
    return value === undefined || (Array.isArray(value) && value.length === 0);
  });
}

export function parseDanawaProductPage(
  category: PartCategory,
  item: DanawaListItem,
  html: string,
  categoryId: string
): Part {
  const $ = cheerio.load(html);
  const title = normalizeSpace($("title").text()).replace(/\s*:\s*다나와.*$/, "");
  const description = normalizeSpace($("meta[name='description']").attr("content"));
  const priceDescription = normalizeSpace($("meta[property='og:description']").attr("content"));
  const rawSpecText = normalizeSpace($(".spec_set_wrap .spec_list .items").first().text());
  const effectiveName = title || item.name;
  const specs = parseSpecs(category, effectiveName, description, rawSpecText);
  const listingType = inferListingType({ category, name: effectiveName, rawSpecText });
  const missing = [
    ...missingFields(category, specs),
    ...(listingType === "accessory" ? ["internal storage device"] : [])
  ];
  const brand = effectiveName.split(" ")[0];
  return {
    id: `danawa-${category}-${item.sourceProductCode}`,
    category,
    name: effectiveName,
    brand,
    model: effectiveName,
    imageUrl: absoluteUrl($("meta[property='og:image']").attr("content")) ?? item.imageUrl,
    danawaUrl: item.url,
    source: "danawa",
    sourceProductCode: item.sourceProductCode,
    sourceCategoryId: categoryId,
    listingType,
    priceWon: item.priceWon ?? parseLowestPrice(priceDescription),
    rawSpecText: normalizeSpace(`${description} ${rawSpecText}`),
    specs,
    dataQuality: missing.length === 0 ? "live" : "incomplete",
    missingFields: missing,
    updatedAt: new Date().toISOString()
  };
}

export function reparseDanawaPart(part: Part): Part {
  if (part.source !== "danawa") return part;
  const parsedSpecs = parseSpecs(part.category, part.name, "", part.rawSpecText ?? "");
  const listingType = inferListingType({ category: part.category, name: part.name, rawSpecText: part.rawSpecText });
  const specs = { ...part.specs };
  delete specs.benchmarkProvenance;
  for (const [key, value] of Object.entries(parsedSpecs)) {
    if (value !== undefined) specs[key as keyof PartSpecs] = value as never;
  }
  if (["memory", "ssd", "hdd"].includes(part.category) && parsedSpecs.capacityGb === undefined) {
    delete specs.capacityGb;
  }
  if (part.category === "gpu") {
    if (parsedSpecs.gpuVendor === undefined) delete specs.gpuVendor;
    if (parsedSpecs.gpuArchitectureFamily === undefined) delete specs.gpuArchitectureFamily;
    if (parsedSpecs.gpuMemoryType === undefined) delete specs.gpuMemoryType;
    if (parsedSpecs.vramGb === undefined) delete specs.vramGb;
    if (parsedSpecs.pciePowerOptions === undefined) delete specs.pciePowerOptions;
    if (parsedSpecs.pciePowerAdapterOptions === undefined) delete specs.pciePowerAdapterOptions;
    if (parsedSpecs.gpuBoostClockMhz === undefined) delete specs.gpuBoostClockMhz;
    if (parsedSpecs.gpuStreamProcessors === undefined) delete specs.gpuStreamProcessors;
    if (parsedSpecs.gpuMemoryBandwidthGbps === undefined) delete specs.gpuMemoryBandwidthGbps;
    if (parsedSpecs.gpu3dmarkTimeSpyScore === undefined) delete specs.gpu3dmarkTimeSpyScore;
    if (parsedSpecs.gpu3dmarkPortRoyalScore === undefined) delete specs.gpu3dmarkPortRoyalScore;
  }
  if (part.category === "cpu") {
    if (parsedSpecs.cinebenchR23Single === undefined) delete specs.cinebenchR23Single;
    if (parsedSpecs.cinebenchR23Multi === undefined) delete specs.cinebenchR23Multi;
    if (parsedSpecs.maxMemorySpeedMhz === undefined) delete specs.maxMemorySpeedMhz;
  }
  if (part.category === "ssd") {
    if (parsedSpecs.ssdController === undefined) delete specs.ssdController;
    if (parsedSpecs.ssdNandType === undefined) delete specs.ssdNandType;
    if (parsedSpecs.ssdTbwTb === undefined) delete specs.ssdTbwTb;
    if (parsedSpecs.ssdReadIops === undefined) delete specs.ssdReadIops;
    if (parsedSpecs.ssdWriteIops === undefined) delete specs.ssdWriteIops;
    if (parsedSpecs.m2PcieGeneration === undefined) delete specs.m2PcieGeneration;
  }
  if (part.category === "memory" && parsedSpecs.memoryProfiles === undefined) {
    delete specs.memoryProfiles;
  }
  if (part.category === "memory") {
    if (parsedSpecs.memoryModuleCountPerKit === undefined) delete specs.memoryModuleCountPerKit;
    if (parsedSpecs.memoryTiming === undefined) delete specs.memoryTiming;
    if (parsedSpecs.memoryCasLatency === undefined) delete specs.memoryCasLatency;
    if (parsedSpecs.memoryEffectiveLatencyNs === undefined) delete specs.memoryEffectiveLatencyNs;
    if (parsedSpecs.memoryRcdLatency === undefined) delete specs.memoryRcdLatency;
    if (parsedSpecs.memoryTrpLatency === undefined) delete specs.memoryTrpLatency;
    if (parsedSpecs.memoryTrasLatency === undefined) delete specs.memoryTrasLatency;
    if (parsedSpecs.memoryVoltageV === undefined) delete specs.memoryVoltageV;
  }
  if (part.category === "psu" && parsedSpecs.pciePowerConnectors === undefined) {
    delete specs.pciePowerConnectors;
  }
  if (part.category === "psu" && parsedSpecs.psuDepthMm === undefined) {
    delete specs.psuDepthMm;
  }
  if (part.category === "psu") {
    if (parsedSpecs.psuCableType === undefined) delete specs.psuCableType;
    if (parsedSpecs.psuRailType === undefined) delete specs.psuRailType;
  }
  if (part.category === "case") {
    if (parsedSpecs.maxPsuLengthMm === undefined) delete specs.maxPsuLengthMm;
    if (parsedSpecs.supportedPsuFormFactors === undefined) delete specs.supportedPsuFormFactors;
    if (parsedSpecs.rgbDeviceVoltage === undefined) delete specs.rgbDeviceVoltage;
    if (parsedSpecs.rgbDeviceCurrentA === undefined) delete specs.rgbDeviceCurrentA;
    if (parsedSpecs.rgbDevicePowerW === undefined) delete specs.rgbDevicePowerW;
    if (parsedSpecs.rgbControllerIncluded === undefined) delete specs.rgbControllerIncluded;
    if (parsedSpecs.radiatorSupports === undefined) delete specs.radiatorSupports;
  }
  if (part.category === "cooler" && parsedSpecs.radiatorPosition === undefined) {
    delete specs.radiatorPosition;
  }
  if (part.category === "motherboard") {
    if (parsedSpecs.memoryProfiles === undefined) delete specs.memoryProfiles;
    if (parsedSpecs.m2Slots === undefined) delete specs.m2Slots;
    if (parsedSpecs.m2Interfaces === undefined) delete specs.m2Interfaces;
    if (parsedSpecs.m2PcieGenerations === undefined) delete specs.m2PcieGenerations;
    if (parsedSpecs.m2LaneSharing !== true) delete specs.m2LaneSharing;
    if (parsedSpecs.m2LaneSharingScopes === undefined) {
      delete specs.m2LaneSharingScopes;
      delete specs.m2LaneSharingNote;
    }
    if (parsedSpecs.rgb5vPortCount === undefined) delete specs.rgb5vPortCount;
    if (parsedSpecs.rgb12vPortCount === undefined) delete specs.rgb12vPortCount;
  }
  const missing = [
    ...missingFields(part.category, specs),
    ...(listingType === "accessory" ? ["internal storage device"] : [])
  ];
  return {
    ...part,
    specs,
    listingType,
    dataQuality: missing.length === 0 ? "live" : "incomplete",
    missingFields: missing
  };
}

type DanawaFetchRequest = {
  method?: "GET" | "POST";
  body?: URLSearchParams;
  referer?: string;
};

export async function fetchDanawaHtml(url: string, options: DanawaCrawlerOptions, request: DanawaFetchRequest = {}) {
  const timeoutMs = Math.max(1000, options.timeoutMs ?? Number(process.env.DANAWA_CRAWL_TIMEOUT_MS ?? 20000));
  const retries = Math.max(0, options.retries ?? Number(process.env.DANAWA_CRAWL_RETRIES ?? 2));
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (options.signal?.aborted) throw new Error("Crawler aborted");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const abortParent = () => controller.abort();
    options.signal?.addEventListener("abort", abortParent, { once: true });
    try {
      const response = await fetch(url, {
        method: request.method ?? "GET",
        signal: controller.signal,
        headers: {
          "user-agent": options.userAgent ?? DEFAULT_USER_AGENT,
          accept: "text/html,application/xhtml+xml",
          ...(request.referer
            ? {
                referer: request.referer,
                origin: "https://prod.danawa.com"
              }
            : {})
        },
        body: request.body
      });
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`Retryable Danawa request failed: ${response.status} ${url}`);
      }
      if (!response.ok) throw new Error(`Danawa request failed: ${response.status} ${url}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt >= retries || options.signal?.aborted) break;
      await sleep(Math.min(8000, 350 * (attempt + 1)), options.signal);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abortParent);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Danawa request failed: ${url}`);
}

function sleep(ms: number, signal?: AbortSignal) {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolvePromise, reject) => {
    const timer = setTimeout(resolvePromise, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("Crawler aborted"));
      },
      { once: true }
    );
  });
}

export async function crawlDanawaCategory(
  category: PartCategory,
  categoryId: string,
  options: DanawaCrawlerOptions = {}
) : Promise<DanawaCategoryCrawlResult> {
  const exhaustive = options.all === true;
  const configuredPages = exhaustive ? Number.POSITIVE_INFINITY : Math.max(1, options.pages ?? 1);
  const limit = Math.max(1, options.limitPerCategory ?? 24);
  const details = options.details ?? true;
  const enrichMissingOnly = options.enrichMissingOnly ?? false;
  const delayMs = Math.max(0, options.delayMs ?? 850);
  const listItems = new Map<string, DanawaListItem>();
  const maxSafePages = 1000;
  let pageLimit = configuredPages;
  let totalProductCount: number | undefined;
  let pageSize: number | undefined;
  let pagesVisited = 0;
  let listedProducts = 0;
  const firstPageUrl = `https://prod.danawa.com/list/?cate=${categoryId}`;
  let requestContext: DanawaListRequestContext | undefined;

  for (let page = 1; page <= pageLimit && page <= maxSafePages; page += 1) {
    const html = page === 1
      ? await fetchDanawaHtml(firstPageUrl, options)
      : requestContext
        ? await fetchDanawaHtml(DANAWA_LIST_AJAX_URL, options, {
            method: "POST",
            referer: firstPageUrl,
            body: new URLSearchParams(Object.entries(buildDanawaListAjaxParams(page, requestContext)))
          })
        : await fetchDanawaHtml(`${firstPageUrl}&page=${page}`, options);
    pagesVisited += 1;
    const pageItems = parseDanawaListPage(html);
    const pageInfo = parseDanawaListPageInfo(html);
    if (page === 1) {
      requestContext = parseDanawaListRequestContext(html);
      totalProductCount = pageInfo.totalProductCount;
      pageSize = pageInfo.pageSize ?? pageItems.length;
      if (exhaustive && totalProductCount !== undefined && pageSize) {
        pageLimit = Math.ceil(totalProductCount / pageSize);
      }
    }
    listedProducts += pageItems.length;
    const countBefore = listItems.size;
    for (const item of pageItems) {
      listItems.set(item.sourceProductCode, item);
      if (!exhaustive && listItems.size >= limit) break;
    }
    if (!exhaustive && listItems.size >= limit) break;
    if (pageItems.length === 0) break;
    if (exhaustive && totalProductCount !== undefined && listItems.size >= totalProductCount) break;
    if (exhaustive && listItems.size === countBefore) break;
    if (page < pageLimit) await sleep(delayMs, options.signal);
  }

  const parts: Part[] = [];
  let detailFetched = 0;
  let detailFailed = 0;
  for (const item of listItems.values()) {
    if (options.signal?.aborted) throw new Error("Crawler aborted");
    const listPart = partFromListItem(category, categoryId, item);
    if (!details || (enrichMissingOnly && listPart.missingFields.length === 0)) {
      parts.push(listPart);
      continue;
    }

    await sleep(delayMs, options.signal);
    try {
      const detailHtml = await fetchDanawaHtml(item.url, options);
      parts.push(parseDanawaProductPage(category, item, detailHtml, categoryId));
      detailFetched += 1;
    } catch (error) {
      detailFailed += 1;
      parts.push({
        ...listPart,
        rawSpecText: normalizeSpace(`${item.rawSpecText ?? ""} ${error instanceof Error ? error.message : "detail fetch failed"}`),
        dataQuality: "incomplete",
        missingFields: [...new Set([...listPart.missingFields, "detail page"])]
      });
    }
  }
  const pagesExpected = totalProductCount !== undefined && pageSize
    ? Math.ceil(totalProductCount / pageSize)
    : Number.isFinite(pageLimit)
      ? pageLimit
      : pagesVisited;
  const missingProducts = exhaustive && totalProductCount !== undefined
    ? Math.max(0, totalProductCount - listItems.size)
    : 0;
  const listComplete = exhaustive
    && totalProductCount !== undefined
    && listItems.size >= totalProductCount
    && pagesVisited >= pagesExpected;
  const detailsComplete = details && detailFailed === 0 && parts.length === listItems.size;
  const specComplete = parts.every((part) => part.missingFields.length === 0);
  return {
    category,
    categoryId,
    parts,
    pagesExpected,
    pagesVisited,
    listedProducts,
    uniqueProducts: listItems.size,
    detailFetched,
    detailFailed,
    missingProducts,
    incompleteSpecs: parts.filter((part) => part.missingFields.length > 0).length,
    coverage: listComplete && detailsComplete ? "complete" : "partial",
    specCoverage: specComplete ? "complete" : "partial"
  };
}

export function crawlerCategoryLabel(category: PartCategory) {
  return CATEGORY_LABELS[category];
}
