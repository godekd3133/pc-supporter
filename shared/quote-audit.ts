import type { Part, PartCategory } from "./types";
import {
  catalogSeedMappingCandidatesFor,
  catalogSeedMappingIdentityCompatibleFor,
  type CatalogSeedMappingCandidate,
  type CatalogSeedMappingReason
} from "./catalog-seed-mapping";

// 견적서 텍스트 라인 파싱 + 근사 매칭 어댑터 (Phase 3 진입 조건).
// 커널(catalogSeedMappingCandidatesFor)은 seed↔danawa 매핑 검수용으로 엄격하게 유지하고,
// 견적 입력 경로는 유통사 접미사 정규화·근사 이름·카테고리별 모델 토큰 규칙을 얇게 얹는다.
// 안전 원칙: "모르면 남기는" — 근사 매칭은 review까지만 허용하고, high는 유통사 제거 후
// 이름이 완전 일치(compact-equal)하는 경우에만 부여한다.

const QUOTE_VENDOR_SUFFIXES = [
  "대원씨티에스", "인텍앤컴퍼니", "피씨디렉트", "오메이정보통신", "컴퓨터코리아", "컴클리닉",
  "제이씨현", "이엠텍", "파인인포", "에즈윈", "코잇", "stcom", "디지털헤븐", "아이코다",
  "가이드컴", "시스기어", "서린", "웨이코스", "엠앤웍스"
];

// \b는 한국어 글자 뒤에서 작동하지 않으므로 라벨은 전체 일치($)로 검사한다.
const CATEGORY_LABEL_PATTERNS: Array<[RegExp, PartCategory]> = [
  [/^(cpu|씨피유|프로세서)$/i, "cpu"],
  [/^(쿨러|cpu\s*쿨러|쿨러\s*\/\s*튜닝|cooler)$/i, "cooler"],
  [/^(메인\s*보드|메인보드|마더보드|m\/b|mainboard|보드)$/i, "motherboard"],
  [/^(메모리|램|ram|memory)$/i, "memory"],
  [/^(그래픽\s*카드|그래픽카드|vga|비디오\s*카드|gpu|그래픽|비디오)$/i, "gpu"],
  [/^(ssd|m\.?2|m\.?2\s*ssd|에스에스디)$/i, "ssd"],
  [/^(hdd|하드디스크|하드)$/i, "hdd"],
  [/^(케이스|case|본체\s*케이스)$/i, "case"],
  [/^(파워\s*서플라이|파워|psu|power)$/i, "psu"]
];

const SKIP_LABEL_PATTERN = /^(조립비|공임|운영체제|운영 체제|os|케이블|사은품|소프트웨어|기타|합계|총\s*견적|총\s*합계|서비스|키보드|마우스|모니터|스피커|헤드셋|랜카드|랜\s*카드|장패드|보험|배송|분류|상품명|총\s*견적\s*합계|설치비|출장)\s*$/i;
const SKIP_VALUE_PATTERN = /^(별도구매|별도\s*구매|추가선택가능|추가\s*선택|미포함|없음|선택\s*안\s*함)/i;

const INFER_CATEGORY_PATTERNS: Array<[RegExp, PartCategory]> = [
  [/라이젠|ryzen|코어\s*i|core\s*i|i[3579][\s-]?\d{4,5}|울트라\s*\d|펜티엄|셀러론|athlon|스레드리퍼/i, "cpu"],
  [/rtx|gtx|rx[\s-]?\d{3,4}|지포스|라데온|geforce|radeon|그래픽/i, "gpu"],
  [/ddr[345]|램|메모리|\bram\b/i, "memory"],
  [/\bssd\b|nvme|\bm\.?2\b/i, "ssd"],
  [/\bhdd\b|하드디스크|하드/i, "hdd"],
  [/메인보드|마더보드|^[abhxz]\d{3}[a-z]?\b/i, "motherboard"],
  [/케이스|미들타워|빅타워|미니타워|풀타워/i, "case"],
  [/파워|\d{3,4}\s?w\b|psu/i, "psu"],
  [/쿨러|공랭|수냉/i, "cooler"]
];

const CAPACITY_TOKEN_PATTERN = /^\d{2,5}(gb|tb)$/;
const INTERFACE_TOKEN_SET = new Set(["nvme", "sata", "pcie", "m2", "atx", "gen3", "gen4", "gen5", "dimm", "udimm", "sodimm", "ddr"]);

export interface ParsedQuoteLine {
  skipped: boolean;
  skipReason?: string;
  category?: PartCategory;
  name?: string;
  model?: string;
  priceWon?: number;
}

// 한국어 변형 표기를 영문 토큰으로 통일해 이름·모델 비교가 같은 축에서 이뤄지게 한다.
const QUOTE_VARIANT_SPELLINGS: Array<[RegExp, string]> = [
  [/슈퍼/g, "super"],
  [/울트라/g, "ultra"]
];

function canonicalizeQuoteText(value: string | undefined) {
  let result = (value ?? "").normalize("NFKC").toLocaleLowerCase("ko-KR");
  for (const [pattern, replacement] of QUOTE_VARIANT_SPELLINGS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function normalizedQuoteCompact(value: string | undefined) {
  return canonicalizeQuoteText(value).replace(/[^0-9a-z가-힣]/g, "");
}

export function stripQuoteVendorSuffixes(name: string) {
  // 유통사명은 상품 모델의 일부가 아니므로 위치와 무관하게 제거한다 (단어 경계 근사).
  let result = name;
  for (const vendor of QUOTE_VENDOR_SUFFIXES) {
    result = result.replace(new RegExp(`(^|[\\s(])${vendor}($|[\\s)])`, "gi"), "$1 $2");
  }
  return result.replace(/\s{2,}/g, " ").trim();
}

function extractPriceWon(text: string) {
  const manMatch = /(\d+(?:\.\d+)?)\s*만\s*원?\s*$/.exec(text);
  if (manMatch) return Math.round(Number.parseFloat(manMatch[1]) * 10_000);
  const wonMatch = /([\d,]{4,})\s*원?\s*$/.exec(text);
  if (wonMatch) return Number.parseInt(wonMatch[1].replace(/,/g, ""), 10);
  return undefined;
}

function productModelToken(name: string) {
  // 용량·인터페이스 토큰을 모델로 오선택하지 않도록 문자+숫자 혼합 토큰을 우선한다.
  const tokens = name
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .split(/[^0-9a-z가-힣]+/i)
    .map((token) => token.trim())
    .filter((token) => /[a-z가-힣]/.test(token) && /\d/.test(token) && !CAPACITY_TOKEN_PATTERN.test(token) && !INTERFACE_TOKEN_SET.has(token));
  return tokens[0];
}

function guessQuoteLineModel(name: string, category: PartCategory | undefined) {
  const lower = name.normalize("NFKC").toLocaleLowerCase("ko-KR");
  if (category === "gpu") {
    const match = /(rtx|gtx|rx)\s*(\d{3,4})\s*(ti|super|슈퍼|xt|xtx)?/i.exec(lower);
    if (match) return normalizedQuoteCompact(`${match[2]}${match[3] === "슈퍼" ? "super" : match[3] ?? ""}`);
    const bare = /\b(\d{4})\s*(ti|super|슈퍼|xt|xtx)?/i.exec(lower);
    if (bare) return normalizedQuoteCompact(`${bare[1]}${bare[2] === "슈퍼" ? "super" : bare[2] ?? ""}`);
  }
  if (category === "cpu") {
    const match = /(i[3579][\s-]?|라이젠\s*\d[\s-]?\d세대\s*|울트라\s*\d\s*)?(\d{4,5}[a-z]*)\b/i.exec(lower);
    if (match) return normalizedQuoteCompact(match[2]);
  }
  if (category === "motherboard") {
    // 칩셋 + 폼팩터/변형 문자까지 함께 잡아 "B650M-K" → b650mk처럼 붙여 비교한다.
    const match = /\b([abhxz]\d{3}(?:[\s-]?[a-z]){0,3})\b/i.exec(lower);
    if (match) return normalizedQuoteCompact(match[1]);
  }
  if (category === "memory") {
    const match = /ddr([345])[\s-]?(\d{4})/i.exec(lower);
    if (match) return normalizedQuoteCompact(`ddr${match[1]}${match[2]}`);
  }
  if (category === "psu") {
    const match = /(\d{3,4})\s*w\b/i.exec(lower);
    if (match) return normalizedQuoteCompact(`${match[1]}w`);
  }
  if (category === "ssd" || category === "hdd") {
    const product = productModelToken(name);
    if (product) return normalizedQuoteCompact(product);
  }
  const tokens = lower
    .split(/[^0-9a-z가-힣]+/i)
    .map((token) => token.trim())
    .filter((token) => /\d/.test(token) && token.length >= 3)
    .sort((a, b) => b.length - a.length);
  return tokens[0];
}

export function parseQuoteLine(raw: string): ParsedQuoteLine {
  const trimmed = raw.trim();
  if (!trimmed) return { skipped: true, skipReason: "empty" };

  // 라벨 분리: "A | B", "A: B", "A  B"(2칸+ 공백) 형식
  const labelMatch = /^([가-힣A-Za-z\s/.()]{1,14}?)\s*(?:\||：|\t|:| {2,})\s*(.+)$/.exec(trimmed);
  let category: PartCategory | undefined;
  let body = trimmed;
  if (labelMatch) {
    const label = labelMatch[1].trim();
    const rest = labelMatch[2].trim();
    if (SKIP_LABEL_PATTERN.test(label)) return { skipped: true, skipReason: `label:${label}` };
    const categoryEntry = CATEGORY_LABEL_PATTERNS.find(([pattern]) => pattern.test(label));
    if (categoryEntry) {
      category = categoryEntry[1];
      body = rest;
    }
  }
  if (SKIP_LABEL_PATTERN.test(body)) return { skipped: true, skipReason: "body-label" };
  if (SKIP_VALUE_PATTERN.test(body)) return { skipped: true, skipReason: "value" };

  // 가격 추출 후 꼬리에서 제거
  let priceWon: number | undefined;
  const priceMatch = /(.*?)([\d,]{4,}\s*원|\d+(?:\.\d+)?\s*만\s*원?)\s*$/.exec(body);
  if (priceMatch) {
    priceWon = extractPriceWon(priceMatch[2]);
    body = priceMatch[1].trim();
  }
  // "55만" 처럼 '원' 없이 만 단위만 있는 꼬리 가격
  if (priceWon === undefined) {
    const bareMan = /(.*?)(\d+)\s*만\s*$/.exec(body);
    if (bareMan) {
      priceWon = Number.parseInt(bareMan[2], 10) * 10_000;
      body = bareMan[1].trim();
    }
  }

  // 장식 제거: 대괄호 그룹, ▶◀ 마커, 테이블 잔여 파이프, 수량 꼬리
  let name = body
    .replace(/▶/g, " ")
    .replace(/◀/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\|+\s*$/, " ")
    .replace(/^\s*\|+/, " ")
    .replace(/\s+x\s?\d+\s*$/i, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  name = stripQuoteVendorSuffixes(name);
  if (SKIP_VALUE_PATTERN.test(name)) return { skipped: true, skipReason: "value-after-strip" };
  if (!name) return { skipped: true, skipReason: "empty-after-strip" };

  if (!category) {
    category = INFER_CATEGORY_PATTERNS.find(([pattern]) => pattern.test(name))?.[1];
  }

  const model = guessQuoteLineModel(name, category);
  return { skipped: false, category, name, model, priceWon };
}

// ---- 근사 매칭 어댑터 ----

// SKU 단계(변형) 토큰: 숫자로 끝나는 needle 뒤에 붙으면 다른 제품으로 판정한다.
const NEAR_VARIANT_SUFFIXES = ["super", "xtx", "xt", "ti", "ks", "k", "f", "g", "e", "a", "x"];

// 앵커에서 제외하는 범주어·마케팅어·스펙 단어. 숫자 포함 토큰은 별도 규칙으로 전부 제외한다.
const QUOTE_ANCHOR_STOP_TOKENS = new Set([
  "ssd", "hdd", "ram", "cpu", "gpu", "vga", "psu", "oc", "rgb", "argb", "pwm", "wifi", "atx",
  "nvme", "sata", "pcie", "m2", "gddr", "xmp", "expo", "plus", "pro", "max", "ultra", "super",
  "ti", "xt", "xtx", "ks",
  "gaming", "edition", "dual", "triple", "mini", "itx", "matx", "eatx", "mesh", "lcd", "se",
  "정품", "벌크", "멀티팩", "패키지", "블랙", "화이트", "리퍼", "병행", "국내", "정발", "해외",
  "미들타워", "빅타워", "미니타워", "풀타워", "공랭", "수냉", "듀얼타워", "싱글타워", "가성비",
  "초고속", "슬림", "저소음", "모듈러", "풀모듈러", "세미모듈러", "풀체인지", "골드", "실버",
  "그래픽", "그래픽카드", "메인보드", "마더보드", "메모리", "파워", "쿨러", "케이스", "램",
  "지포스", "라데온", "엔비디아", "인텔", "코어", "라이젠", "geforce", "radeon", "nvidia",
  "intel", "core", "ryzen", "rtx", "gtx", "rx", "arc"
]);

// 세대·규격 토큰: 양쪽 모두에 있으면서 집합이 다르면 다른 제품으로 본다.
const VERSION_TOKEN_PATTERN = /^(ddr\d|pcie\d|gen\d|cl\d|wifi\d[a-z0-9]*|gddr\dx?|atx\d(?:\.\d+)?|d\d|x\d)$/;

// 제조사 토큰: 브랜드만 같은 제품(MAG 박격포 ↔ PRO 라인업 같은 다른 라인)은 붙지 않는다.
// 규격품 카테고리(memory/ssd/hdd)는 브랜드+스펙이 곧 제품 식별이라 예외로 둔다.
const QUOTE_BRAND_TOKENS = new Set([
  "msi", "asus", "asrock", "gigabyte", "colorful", "palit", "zotac", "inno3d", "emtek", "이엠텍",
  "samsung", "삼성", "삼성전자", "micron", "마이크론", "crucial", "essencore", "klevv", "teamgroup",
  "patriot", "gskill", "corsair", "adata", "kingston", "wd", "seagate", "toshiba", "transcend",
  "하이닉스", "sk하이닉스", "키오시아", "kioxia", "superflower", "micronics", "마이크로닉스", "fsp",
  "시소닉", "seasonic", "antec", "deepcool", "thermalright", "써멀라이트", "리안리", "lianli", "nzxt",
  "bequiet", "darkflash", "앱코", "abko", "아이구주", "잘만", "zalman", "쿨러마스터", "coolermaster",
  "intel", "amd", "nvidia", "인텔", "엔비디아", "기가바이트", "애즈락", "에이수스", "아수스"
]);

const COMMODITY_ANCHOR_CATEGORIES = new Set<PartCategory>(["memory", "ssd", "hdd"]);

function quoteTokens(value: string | undefined) {
  return canonicalizeQuoteText(value)
    .split(/[^0-9a-z가-힣]+/i)
    .map((token) => token.trim())
    .filter(Boolean);
}

function anchorTokenSet(part: Part) {
  const tokens = quoteTokens([part.name, part.model, part.brand].filter(Boolean).join(" "));
  return new Set(tokens.filter((token) => token.length >= 2 && !/\d/.test(token) && !QUOTE_ANCHOR_STOP_TOKENS.has(token)));
}

function versionTokenSet(part: Part) {
  const tokens = quoteTokens([part.name, part.model].filter(Boolean).join(" "));
  return new Set(tokens.filter((token) => VERSION_TOKEN_PATTERN.test(token)));
}

function capacityTokenSet(part: Part) {
  const compact = normalizedQuoteCompact(`${part.name} ${part.model ?? ""}`);
  return new Set([...compact.matchAll(/(\d{2,5})(gb|tb)/g)].map((match) => `${match[1]}${match[2]}`));
}

function sharedAnchorPairs(left: Set<string>, right: Set<string>) {
  const pairs: Array<[string, string]> = [];
  for (const token of left) {
    for (const other of right) {
      // "삼성" ↔ "삼성전자"처럼 브랜드 축약은 prefix 관계로도 앵커로 인정한다.
      if (token === other || (token.length >= 2 && other.startsWith(token)) || (other.length >= 2 && token.startsWith(other))) {
        pairs.push([token, other]);
      }
    }
  }
  return pairs;
}

function setsConflict(left: Set<string>, right: Set<string>) {
  return left.size > 0 && right.size > 0 && ![...left].every((token) => right.has(token));
}

// needle이 haystack에 포함되되, needle이 숫자로 끝나면서 바로 뒤에 SKU 변형 토큰이
// 붙는 위치는 다른 제품으로 보고 허용하지 않는다 ("5060"→"5060ti" 오매칭 방지).
function containsCompactToken(haystack: string, needle: string) {
  if (!haystack || !needle || needle.length < 2) return false;
  let index = haystack.indexOf(needle);
  while (index >= 0) {
    const rest = haystack.slice(index + needle.length);
    const variantBlocked = /[0-9]$/.test(needle) && NEAR_VARIANT_SUFFIXES.some((variant) => rest.startsWith(variant));
    if (!variantBlocked) return true;
    index = haystack.indexOf(needle, index + 1);
  }
  return false;
}

function activeHaystack(part: Part) {
  return normalizedQuoteCompact(stripQuoteVendorSuffixes(`${part.name} ${part.model ?? ""} ${part.brand ?? ""}`));
}

function rounded(value: number) {
  return Math.round(value * 10) / 10;
}

function nearCandidateFor(quote: Part, active: Part): CatalogSeedMappingCandidate | undefined {
  if (!catalogSeedMappingIdentityCompatibleFor(quote, active)) return undefined;
  if (active.source !== "danawa" || !active.sourceProductCode) return undefined;

  const quoteName = normalizedQuoteCompact(stripQuoteVendorSuffixes(quote.name));
  const quoteModel = normalizedQuoteCompact(quote.model);
  const haystack = activeHaystack(active);
  const activeName = normalizedQuoteCompact(stripQuoteVendorSuffixes(active.name));
  if (!quoteName || quoteName.length < 6) return undefined;

  // 버전 토큰 충돌(wifi7≠wifi6e, d6≠d7, ddr4≠ddr5 등)은 근사 매칭을 허용하지 않는다.
  if (setsConflict(versionTokenSet(quote), versionTokenSet(active))) return undefined;

  const compactEqual = Boolean(quoteName && activeName && quoteName === activeName);
  const contained = !compactEqual && (containsCompactToken(haystack, quoteName) || containsCompactToken(quoteName, activeName));
  const modelNear = Boolean(quoteModel && containsCompactToken(haystack, quoteModel));
  const anchorPairs = sharedAnchorPairs(anchorTokenSet(quote), anchorTokenSet(active));
  // 브랜드만 겹치는 근사 매칭은 다른 라인업 제품을 억지로 붙일 수 있어 비브랜드 앵커를 요구한다.
  // 규격품 카테고리는 브랜드+스펙이 곧 제품 식별이라 브랜드 앵커만으로도 허용한다.
  const anchorOk = COMMODITY_ANCHOR_CATEGORIES.has(quote.category)
    ? anchorPairs.length > 0
    : anchorPairs.some(([left, right]) => !QUOTE_BRAND_TOKENS.has(left) && !QUOTE_BRAND_TOKENS.has(right));
  const anchored = modelNear && anchorOk;
  if (!compactEqual && !contained && !anchored) return undefined;

  const reasons: CatalogSeedMappingReason[] = [];
  let score = 0;
  if (compactEqual) {
    // 커널의 name_exact+identity_tokens 조합과 동일한 가중치 — 유통사 접미사만 다른 완전 일치.
    score += 0.82 + 0.12;
    reasons.push("name_exact", "identity_tokens");
  } else if (contained) {
    score += 0.68;
    reasons.push("identity_tokens");
  }
  if (anchored) {
    score += 0.6;
    reasons.push("model_match", "identity_tokens");
  }
  const brandMatch = Boolean(quote.brand && active.brand && normalizedQuoteCompact(quote.brand) === normalizedQuoteCompact(active.brand));
  if (brandMatch) {
    score += 0.12;
    reasons.push("brand_match");
  }

  let priceDeltaPercent: number | undefined;
  if (quote.priceWon !== undefined && quote.priceWon > 0 && active.priceWon !== undefined && active.priceWon > 0) {
    priceDeltaPercent = rounded(Math.abs(active.priceWon - quote.priceWon) / quote.priceWon * 100);
    if (priceDeltaPercent <= 15) {
      score += 0.04;
      reasons.push("price_near");
    }
  }

  // 용량 토큰이 양쪽 모두 있으면서 다르면 같은 제품군의 다른 용량 변형일 수 있어 감점한다.
  const quoteCapacities = capacityTokenSet(quote);
  const activeCapacities = capacityTokenSet(active);
  if (quoteCapacities.size > 0 && activeCapacities.size > 0 && setsConflict(quoteCapacities, activeCapacities)) {
    score -= 0.04;
  }

  score = Math.min(0.99, rounded(score));
  if (score < 0.55) return undefined;
  return {
    activePartId: active.id,
    activeSourceProductCode: active.sourceProductCode,
    activeName: active.name,
    ...(active.brand ? { activeBrand: active.brand } : {}),
    ...(active.model ? { activeModel: active.model } : {}),
    activeSource: active.source,
    activeDataQuality: active.dataQuality,
    ...(active.priceWon !== undefined ? { activePriceWon: active.priceWon } : {}),
    ...(active.danawaUrl ? { activeUrl: active.danawaUrl } : {}),
    score,
    // high는 이름이 유통사 제거 후 완전 일치하는 경우에만 — 근사 일치는 전부 review.
    confidence: score >= 0.86 && compactEqual ? "high" : "review",
    reasons,
    ...(priceDeltaPercent !== undefined ? { priceDeltaPercent } : {})
  };
}

// 커널 매칭을 먼저 유지하고, 커널이 놓친 라인을 근사 매칭으로 채운다.
// 커널 결과가 항상 우선하며 근사 후보는 중복을 제거한 뒤 점수순으로 병합한다.
export function quoteLineMappingCandidatesFor(quote: Part, activeCatalog: Part[], options: { limit?: number } = {}) {
  const limit = Math.min(5, Math.max(1, Math.floor(options.limit ?? 3)));
  const kernel = catalogSeedMappingCandidatesFor(quote, activeCatalog, { limit });
  if (kernel.length >= limit) return kernel;
  const seen = new Set(kernel.map((candidate) => candidate.activePartId));
  const near = activeCatalog
    .map((active) => nearCandidateFor(quote, active))
    .filter((candidate): candidate is CatalogSeedMappingCandidate => Boolean(candidate))
    .filter((candidate) => !seen.has(candidate.activePartId));
  return [...kernel, ...near]
    .sort((left, right) => right.score - left.score || left.activeName.localeCompare(right.activeName, "ko-KR"))
    .slice(0, limit);
}
