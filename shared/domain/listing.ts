import type { ListingPolicy, ListingType, Part, PartCategory } from "../types";
import { isKnownPrice } from "../types";
import { catalogCategoryMismatchFor } from "../catalog-category-integrity";

const STORAGE_ACCESSORY_PATTERN = /(컨버터|변환|어댑터|케이블|도킹|리더기|복제기|하드랙|브라켓|외장\s*케이스|디스크\s*케이스|보관(?:함|케이스)?|보호케이스|하드\s*케이스|USB\s*(?:3|2)\.0\s*to\s*SATA)/i;
const USED_PATTERN = /(중고|리퍼비시|리퍼브|리퍼|전시|반품)/i;
const OVERSEAS_PATTERN = /(해외구매|해외직구|직구)/i;
const PARALLEL_IMPORT_PATTERN = /병행수입/i;
const BULK_PATTERN = /(벌크|OEM)/i;
const CORE_ACCESSORY_NAME_PATTERN = /(?:라이저\s*케이블|(?:수직\s*)?(?:GPU\s*)?(?:브라켓|지지대)|파워업\s*키트|Universal\s*Screen|(?:PCIe|PCI-E)\s*(?:라이저|브라켓))/i;
const CASE_DRIVE_CAGE_ACCESSORY_PATTERN = /\bHDD\s*CAGE\b|\b(?:HARD\s*DRIVE|HARD\s*DISK)\s*CAGE\b|(?:HDD|하드디스크)\s*(?:케이지|랙)/i;
const CASE_GPU_BRACKET_ACCESSORY_PATTERN = /\b(?:VERTICAL\s+)?GPU\s+BRACKET\b/i;
const ACCESSORY_PREFIX_PATTERN = /^\s*(?:전용\s*)?액세서리\s*(?:\/|$)/i;

export function inferListingType(input: Pick<Part, "category" | "name" | "rawSpecText" | "listingType">): ListingType {
  const rawSpecText = input.rawSpecText ?? "";
  const text = `${input.name} ${rawSpecText}`;
  if ((input.category === "ssd" || input.category === "hdd") && STORAGE_ACCESSORY_PATTERN.test(text)) return "accessory";
  if (input.category === "case" && CASE_DRIVE_CAGE_ACCESSORY_PATTERN.test(input.name)) return "accessory";
  if (input.category === "case" && CASE_GPU_BRACKET_ACCESSORY_PATTERN.test(input.name)) return "accessory";
  if (CORE_ACCESSORY_NAME_PATTERN.test(input.name) || ACCESSORY_PREFIX_PATTERN.test(rawSpecText)) return "accessory";
  if (USED_PATTERN.test(text)) return "used";
  if (PARALLEL_IMPORT_PATTERN.test(text)) return "parallel_import";
  if (OVERSEAS_PATTERN.test(text)) return "overseas";
  if (BULK_PATTERN.test(text)) return "bulk";
  if (input.listingType && input.listingType !== "unknown") return input.listingType;
  return "retail";
}

export function isListingAllowed(part: Part, policy: ListingPolicy) {
  if (catalogCategoryMismatchFor(part)) return false;
  const listingType = inferListingType(part);
  if (listingType === "accessory") return false;
  if (policy === "all") return true;
  if (policy === "include_bulk") return listingType === "retail" || listingType === "bulk";
  return listingType === "retail";
}

// 견적 판매 정책 — SSD·메모리는 삼성전자·SK하이닉스, 파워는 시소닉·마이크로닉스
// 제품만 견적에 올린다. 크롤링 카탈로그에는 다른 브랜드도 남아 있으므로 부품을
// 고르는 모든 경로(자동 구성·호환 후보·카탈로그 목록)에서 같은 기준으로 걸러낸다.
const QUOTE_ALLOWED_BRANDS: Partial<Record<PartCategory, readonly string[]>> = {
  ssd: ["삼성전자", "Samsung", "SK하이닉스", "SK hynix"],
  memory: ["삼성전자", "Samsung", "SK하이닉스", "SK hynix"],
  psu: ["시소닉", "Seasonic", "마이크로닉스", "Micronics"]
};

const QUOTE_ALLOWED_BRAND_LABELS: Partial<Record<PartCategory, string>> = {
  ssd: "삼성전자·SK하이닉스",
  memory: "삼성전자·SK하이닉스",
  psu: "시소닉·마이크로닉스"
};

function normalizeQuoteBrand(brand: string | undefined) {
  return (brand ?? "").trim().toLocaleLowerCase("ko-KR").replace(/\s+/g, "");
}

export function isQuoteBrandRestrictedCategory(category: PartCategory) {
  return QUOTE_ALLOWED_BRANDS[category] !== undefined;
}

export function isQuoteBrandAllowed(category: PartCategory, brand: string | undefined) {
  const allowed = QUOTE_ALLOWED_BRANDS[category];
  if (!allowed) return true;
  const normalized = normalizeQuoteBrand(brand);
  return allowed.some((entry) => normalizeQuoteBrand(entry) === normalized);
}

export function quoteBrandPolicyLabelFor(category: PartCategory) {
  return QUOTE_ALLOWED_BRAND_LABELS[category];
}

export function quoteBrandOptionsFor<T extends { brand: string }>(category: PartCategory, options: readonly T[]): T[] {
  return QUOTE_ALLOWED_BRANDS[category] === undefined ? [...options] : options.filter((option) => isQuoteBrandAllowed(category, option.brand));
}

// 견적에는 가격이 확인되고 호환 판단에 필요한 사양이 모두 등록된 부품만 올린다.
// 스펙이 덜 채워진 부품(incomplete, missingFields)은 호환 검증이 불가능하고
// 가격이 없는 부품은 합계를 계산할 수 없어 견적 후보에서 모두 제외한다.
export function isQuoteSelectable(part: Part) {
  return isKnownPrice(part.priceWon) && part.dataQuality !== "incomplete";
}
