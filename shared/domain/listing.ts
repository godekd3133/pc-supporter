import type { ListingPolicy, ListingType, Part, PartCategory } from "../types";
import { isKnownPrice } from "../types";
import { seedLiveTwinsFor } from "./seed-anchor";
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

// 견적 판매 정책 — CPU·GPU는 현세대만 견적에 올린다. 다나와에 구세대 재고나
// 최저가가 남아 있어도(RTX 2060·RTX 3070 등) 단종으로 취급한다. 세대는 정규화된
// 스펙(cpuSeries·gpuArchitectureFamily)을 우선 신뢰하고, 스펙이 없으면 다나와
// 제품명 표기(라이젠-N세대·코어 울트라 시리즈N·RTX 50xx 등)로 판별한다.
// 신세대가 나오면 임계 세대 이상으로 자동 인정되며, 세대를 식별할 수 없는
// 부품은 견적에서 제외한다.
// 견적 세대 경계는 카탈로그에서 동적으로 계산한다 — 아래쪽 "카탈로그 기반 세대
// 경계" 절 참고. 이 상수들은 카탈로그 없는 단일 부품 판별의 최소 바닥으로만 쓴다.

export type QuoteGenerationLine = "amd-ryzen" | "intel-desktop" | "nvidia-geforce" | "amd-radeon" | "intel-arc" | "workstation";

export interface PartQuoteGeneration {
  line: QuoteGenerationLine;
  /** 라인 내 비교 가능한 세대 순위 — Ryzen 시리즈 번호·코어 울트라 시리즈 번호·RTX/RX 앞 두 자리·Arc 문자 순. */
  rank: number;
  /** 관리자 표시용 라벨 (예: "Ryzen 9000", "RTX 50"). */
  label: string;
}

const STATIC_GENERATION_FLOOR: Partial<Record<QuoteGenerationLine, number>> = {
  "amd-ryzen": 9000,
  "intel-desktop": 200,
  "nvidia-geforce": 50,
  "amd-radeon": 90,
  "intel-arc": 2
};

const CPU_RYZEN_GENERATION_PATTERN = /라이젠\s*[3579]?\s*-?\s*(\d+)\s*세대/i;
const CPU_ULTRA_SERIES_PATTERN = /울트라\s*[3579]?\s*시리즈\s*(\d+)/i;
const CPU_CORE_I_GENERATION_PATTERN = /코어\s*i?\s*\d+\s*-\s*(\d+)\s*세대/i;
const CPU_RYZEN_MODERN_MODEL_PATTERN = /\b[45789]\d{3}[a-z0-9]*/i;
const CPU_CORE_I_MODERN_MODEL_PATTERN = /\b1[2-4]\d{3}[a-z]*/i;
const CPU_ULTRA_MODEL_PATTERN = /\b[2-9]\d{2}[a-z]*/i;

// 다나와 표기 → 정규 세대 라벨. 모델 번호를 우선한다 — 라이젠 "5세대" 표기가
// 7000(Raphael)과 8000G(Phoenix)를 함께 덮으므로 번호가 더 정확하다.
// 세대 표기만 있으면 다나와 세대 번호를 시리즈로 환산하고, 둘 다 없으면
// 코드네임으로 한 번 더 판별한다.
const RYZEN_GENERATION_SERIES: Record<number, string> = { 1: "Ryzen 1000", 2: "Ryzen 2000", 3: "Ryzen 3000", 4: "Ryzen 5000", 5: "Ryzen 7000", 6: "Ryzen 9000" };
const CPU_CODENAME_SERIES: Array<[RegExp, string]> = [
  [/그래니트\s*릿지/i, "Ryzen 9000"],
  [/피닉스/i, "Ryzen 8000"],
  [/라파엘/i, "Ryzen 7000"],
  [/버미어|세잔/i, "Ryzen 5000"],
  [/애로우레이크/i, "Core Ultra 200"],
  [/랩터레이크\s*리프레시/i, "Core 14"],
  [/랩터레이크/i, "Core 13"],
  [/엘더레이크/i, "Core 12"]
];

export function cpuSeriesLabelFor(name: string) {
  const ryzenIndex = name.search(/라이젠/i);
  if (ryzenIndex >= 0 && !/스레드리퍼|threadripper/i.test(name)) {
    const slice = name.slice(ryzenIndex);
    const model = slice.match(/(?:^|\D)(\d{4,5})[a-z0-9]*/i);
    if (model) return `Ryzen ${Math.floor(Number(model[1]) / 1000) * 1000}`;
    const generation = slice.match(CPU_RYZEN_GENERATION_PATTERN);
    if (generation) {
      const gen = Number(generation[1]);
      return RYZEN_GENERATION_SERIES[gen] ?? (gen >= 7 ? `Ryzen ${gen + 3}000` : undefined);
    }
  }
  const ultraIndex = name.search(/울트라/i);
  if (ultraIndex >= 0) {
    const slice = name.slice(ultraIndex);
    const series = slice.match(CPU_ULTRA_SERIES_PATTERN);
    if (series) return `Core Ultra ${series[1]}00`;
    const model = slice.match(/\b([2-9])\d{2}[a-z]*/i);
    if (model) return `Core Ultra ${model[1]}00`;
  }
  const coreI = name.match(CPU_CORE_I_GENERATION_PATTERN);
  if (coreI) return `Core ${coreI[1]}`;
  for (const [pattern, label] of CPU_CODENAME_SERIES) {
    if (pattern.test(name)) return label;
  }
  return undefined;
}

function cpuQuoteGenerationFor(part: Part): PartQuoteGeneration | undefined {
  // seed는 이름·모델이 제품 정체성이다 — 오래된 스냅샷은 스펙만 신제품으로
  // 갱신되고 이름이 남은 깨진 조합이 있어서 이름 유도 세대를 우선한다.
  const series = part.dataQuality === "seed"
    ? cpuSeriesLabelFor(`${part.name} ${part.model ?? ""}`) ?? part.specs.cpuSeries
    : part.specs.cpuSeries ?? cpuSeriesLabelFor(part.name);
  if (!series) return undefined;
  const normalized = normalizeQuoteBrand(series); // "ryzen9000" · "coreultra200" · "core14"
  const ryzen = normalized.match(/^ryzen(\d+)$/);
  if (ryzen) return { line: "amd-ryzen", rank: Number(ryzen[1]), label: series };
  // 울트라 시리즈 번호(200…)가 코어 i 세대 번호(14…)보다 항상 크므로 한 라인
  // 척도에서 바로 비교된다 — 코어 i 라인은 울트라로 전환된 종료 라인이다.
  const ultra = normalized.match(/^coreultra(\d+)$/);
  if (ultra) return { line: "intel-desktop", rank: Number(ultra[1]), label: series };
  const core = normalized.match(/^core(\d+)$/);
  if (core) return { line: "intel-desktop", rank: Number(core[1]), label: series };
  return undefined;
}

const GPU_LEGACY_WORKSTATION_PATTERN = /쿼드로|quadro|\bada\b|\brtx\s*a\d|radeon\s*pro|라데온\s*pro|nv\s*링크|nvlink|pro\s*sync/i;
// Blackwell 이후 워크스테이션/프로 라인(RTX PRO·AI PRO·Arc Pro)은 소비형 세대와
// 별개로 계속 판매되는 최신 제품이라 세대 경계 없이 견적에 포함한다.
const GPU_CURRENT_WORKSTATION_PATTERN = /\brtx\s*pro\b|\bai\s*pro\b|\barc\s*pro\b/i;
const GPU_NVIDIA_MODEL_PATTERN = /\b(RTX|GTX|GT)\s*(\d{3,5})\b/i;
const GPU_AMD_MODEL_PATTERN = /\bRX\s*(\d{3,5})\b/i;
const GPU_AMD_R9_PATTERN = /\bR9\s*(\d{3})\b/i;
const GPU_INTEL_ARC_PATTERN = /\bARC\s*([A-Z])\s*\d{3}\b/i;

const GPU_ARCH_NAME_GENERATION: Record<string, { line: QuoteGenerationLine; rank: number }> = {
  blackwell: { line: "nvidia-geforce", rank: 50 },
  adalovelace: { line: "nvidia-geforce", rank: 40 },
  ampere: { line: "nvidia-geforce", rank: 30 },
  turing: { line: "nvidia-geforce", rank: 20 },
  pascal: { line: "nvidia-geforce", rank: 10 },
  rdna4: { line: "amd-radeon", rank: 90 },
  rdna3: { line: "amd-radeon", rank: 79 },
  rdna2: { line: "amd-radeon", rank: 68 },
  battlemage: { line: "intel-arc", rank: 2 },
  alchemist: { line: "intel-arc", rank: 1 }
};

function gpuQuoteGenerationFor(part: Part): PartQuoteGeneration | undefined {
  // seed는 이름·모델이 정체성 — rawSpecText도 오래될 수 있어 seed에서는 제외.
  const text = part.dataQuality === "seed" ? `${part.name} ${part.model ?? ""}` : `${part.name} ${part.rawSpecText ?? ""}`;
  // "RTX 5000 Ada Generation" 같은 워크스테이션 명칭은 GeForce 세대 번호가
  // 아니므로 세대 패턴보다 먼저 걸러낸다.
  if (GPU_LEGACY_WORKSTATION_PATTERN.test(text)) return undefined;
  if (GPU_CURRENT_WORKSTATION_PATTERN.test(text)) return { line: "workstation", rank: 0, label: "워크스테이션" };
  const nvidia = text.match(GPU_NVIDIA_MODEL_PATTERN);
  if (nvidia) {
    const rank = Math.floor(Number(nvidia[2]) / 100);
    return { line: "nvidia-geforce", rank, label: `${nvidia[1].toUpperCase()} ${rank}` };
  }
  const radeon = text.match(GPU_AMD_MODEL_PATTERN);
  if (radeon) {
    const rank = Math.floor(Number(radeon[1]) / 100);
    return { line: "amd-radeon", rank, label: `RX ${rank}` };
  }
  const r9 = text.match(GPU_AMD_R9_PATTERN);
  if (r9) return { line: "amd-radeon", rank: Math.floor(Number(r9[1]) / 100), label: `R9 ${r9[1]}` };
  const arc = text.match(GPU_INTEL_ARC_PATTERN);
  if (arc) {
    const rank = arc[1].toUpperCase().charCodeAt(0) - 64; // A=1, B=2, …
    return { line: "intel-arc", rank, label: `Arc ${arc[1].toUpperCase()}` };
  }
  // 이름에 모델이 없는 부품은 재파싱된 아키텍처 계열로 한 번 더 판별한다.
  const family = part.specs.gpuArchitectureFamily;
  if (typeof family === "string" && family.trim()) {
    const normalized = family.trim().toLowerCase().replace(/[\s_-]+/g, "");
    const seriesMatch = normalized.match(/^(rtx|gtx|gt|rx)(\d{1,3})$/);
    if (seriesMatch) {
      const line = seriesMatch[1] === "rx" ? "amd-radeon" as const : "nvidia-geforce" as const;
      return { line, rank: Number(seriesMatch[2]), label: family.trim() };
    }
    const arcMatch = normalized.match(/^arc([a-z])/);
    if (arcMatch) return { line: "intel-arc", rank: arcMatch[1].charCodeAt(0) - 96, label: family.trim() };
    const arch = GPU_ARCH_NAME_GENERATION[normalized];
    if (arch) return { line: arch.line, rank: arch.rank, label: family.trim() };
  }
  return undefined;
}

export function partQuoteGenerationFor(part: Part): PartQuoteGeneration | undefined {
  if (part.category === "cpu") return cpuQuoteGenerationFor(part);
  if (part.category === "gpu") return gpuQuoteGenerationFor(part);
  return undefined;
}

// ---------- 카탈로그 기반 세대 경계 ----------

// 한 세대가 "시장에 출시됐다"고 인정하려면 판매 중 상품이 이 수 이상이어야 한다.
// 잘못 분류된 단일 상품이 전체 경계를 끌어올리는 것을 막는다.
const QUOTE_GENERATION_MIN_MARKET_COUNT = 2;

export interface QuoteGenerationBoundaryEntry {
  /** 라인에서 확인된 최신 세대. */
  topRank: number;
  topLabel: string;
  topCount: number;
  /** 견적 허용 하한 세대 — topRank부터 generationDepth만큼 내려온 값. */
  thresholdRank: number;
  thresholdLabel: string;
  /** 판매 중으로 인정된 세대 수(임계 수 이상인 세대). */
  activeGenerations: number;
}

export type QuoteGenerationBoundary = Map<string, QuoteGenerationBoundaryEntry>;

function countsTowardGenerationBoundary(part: Part) {
  return isKnownPrice(part.priceWon) && !part.delistedAt && inferListingType(part) !== "accessory";
}

// 카탈로그 배열 참조를 키로 한 WeakMap — 카탈로그가 재로드돼 새 배열로 교체되면
// 자동으로 무효화된다(catalogIndexFor와 같은 규약). 허용 깊이는 캐시 키에 포함한다.
const generationBoundaryCache = new WeakMap<readonly Part[], Map<number, QuoteGenerationBoundary>>();

export function quoteGenerationBoundaryFor(catalog: readonly Part[], generationDepth = 1): QuoteGenerationBoundary {
  const depth = Math.max(1, Math.floor(generationDepth));
  let byDepth = generationBoundaryCache.get(catalog);
  const cached = byDepth?.get(depth);
  if (cached) return cached;
  const counts = new Map<string, Map<number, { count: number; label: string }>>();
  for (const part of catalog) {
    if (part.category !== "cpu" && part.category !== "gpu") continue;
    if (!countsTowardGenerationBoundary(part)) continue;
    const generation = partQuoteGenerationFor(part);
    if (!generation || generation.line === "workstation") continue;
    let byRank = counts.get(generation.line);
    if (!byRank) {
      byRank = new Map();
      counts.set(generation.line, byRank);
    }
    const entry = byRank.get(generation.rank) ?? { count: 0, label: generation.label };
    entry.count += 1;
    entry.label = generation.label;
    byRank.set(generation.rank, entry);
  }
  const boundary: QuoteGenerationBoundary = new Map();
  for (const [line, byRank] of counts) {
    const ranks = [...byRank.keys()].sort((a, b) => b - a);
    const topRank = ranks[0];
    const topEntry = byRank.get(topRank)!;
    // 판매 중(임계 수 이상)인 세대만 허용 깊이 계산에 쓴다. 어느 세대도 임계
    // 수에 못 미치면(소량 카탈로그) 경계를 세우지 않고 전부 허용한다.
    const qualifying = ranks.filter((rank) => (byRank.get(rank)?.count ?? 0) >= QUOTE_GENERATION_MIN_MARKET_COUNT);
    const thresholdRank = qualifying.length > 0 ? qualifying[Math.min(depth, qualifying.length) - 1] : ranks[ranks.length - 1];
    boundary.set(line, {
      topRank,
      topLabel: topEntry.label,
      topCount: topEntry.count,
      thresholdRank,
      thresholdLabel: byRank.get(thresholdRank)!.label,
      activeGenerations: qualifying.length
    });
  }
  if (!byDepth) {
    byDepth = new Map();
    generationBoundaryCache.set(catalog, byDepth);
  }
  byDepth.set(depth, boundary);
  return boundary;
}

export function quoteGenerationSummaryFor(catalog: readonly Part[], generationDepth?: number) {
  return [...quoteGenerationBoundaryFor(catalog, generationDepth).entries()].map(([line, entry]) => ({ line, ...entry }));
}

// 관리자 킬 스위치 — 서버의 견적 생성 옵션(latestGenerationOnly/generationDepth)으로 조정한다.
let quoteGenerationGateEnabled = true;
let quoteGenerationGateDepth = 1;
export function configureQuoteGenerationGate(options: { enabled?: boolean; depth?: number }) {
  quoteGenerationGateEnabled = options.enabled !== false;
  if (typeof options.depth === "number" && Number.isFinite(options.depth)) {
    quoteGenerationGateDepth = Math.max(1, Math.floor(options.depth));
  }
}

export function isCurrentGenerationPart(part: Part, catalog?: readonly Part[]) {
  if (part.category !== "cpu" && part.category !== "gpu") return true;
  if (!quoteGenerationGateEnabled) return true;
  const generation = partQuoteGenerationFor(part);
  if (!generation) return false;
  if (generation.line === "workstation") return true;
  if (catalog === undefined) {
    const floor = STATIC_GENERATION_FLOOR[generation.line];
    return floor === undefined ? true : generation.rank >= floor;
  }
  const boundary = quoteGenerationBoundaryFor(catalog, quoteGenerationGateDepth).get(generation.line);
  if (!boundary) return true;
  return generation.rank >= boundary.thresholdRank;
}

// 견적에는 가격이 확인되고 호환 판단에 필요한 사양이 모두 등록된 부품만 올린다.
// 스펙이 덜 채워진 부품(incomplete, missingFields)은 호환 검증이 불가능하고
// 가격이 없는 부품은 합계를 계산할 수 없으며, 다나와 목록에서 사라진 부품
// (delistedAt)은 구할 수 없고, 구세대 CPU·GPU는 단종 취급이므로 견적 후보에서
// 모두 제외한다.
export function isQuoteSelectable(part: Part, catalog?: readonly Part[]) {
  return isKnownPrice(part.priceWon) && part.dataQuality !== "incomplete" && !part.delistedAt && isCurrentGenerationPart(part, catalog)
    && !seedSupersededByLiveTwin(part, catalog);
}

// 같은 제품의 retail live 매물이 팔리고 있으면 seed 참고행은 견적에서 숨긴다 —
// 실구매 링크·가격 이력이 있는 live 매물이 그 제품을 대신한다. 벌크·병행수입
// 매물만 남은 제품은 seed가 기준 부품으로 계속 서며(sync된 시장가로 표시).
// 라이브 트윈이 아예 없는데 같은 범주에 다나와 매물이 충분히 쌓여 있다면
// 다나와에서 빠진 제품으로 보고(단종 추정) seed도 견적에서 제외한다 — 범주
// 커버리지가 얇으면 크롤 미비일 수 있으므로 폴백으로 남겨둔다.
const SEED_OFF_MARKET_MIN_LIVE_COVERAGE = 20;
const quoteSeedCategoryLiveCoverage = new WeakMap<readonly Part[], Map<string, number>>();

function liveCoverageByCategoryFor(catalog: readonly Part[]) {
  let counts = quoteSeedCategoryLiveCoverage.get(catalog);
  if (!counts) {
    counts = new Map<string, number>();
    for (const part of catalog) {
      // "범주에 실매물이 있는가" 판정 — 스펙이 덜 채워진 live 레코드도 크롤된
      // 매물이므로 시장 존재로 센다. 단종(delistedAt)·무가격은 시장 부재다.
      if (part.source === "seed" || part.delistedAt || !isKnownPrice(part.priceWon)) continue;
      counts.set(part.category, (counts.get(part.category) ?? 0) + 1);
    }
    quoteSeedCategoryLiveCoverage.set(catalog, counts);
  }
  return counts;
}

function seedSupersededByLiveTwin(part: Part, catalog: readonly Part[] | undefined): boolean {
  if (part.dataQuality !== "seed" || catalog === undefined) return false;
  const twins = seedLiveTwinsFor(part, catalog);
  if (twins.length > 0) return twins.some((twin) => inferListingType(twin) === "retail" && isQuotePurchasable(twin));
  return (liveCoverageByCategoryFor(catalog).get(part.category) ?? 0) >= SEED_OFF_MARKET_MIN_LIVE_COVERAGE;
}

/**
 * 내장그래픽 여부 — 스펙 텍스트에 명시가 없으면 모델 번호로 추론한다.
 * 다나와 목록 페이지는 iGPU 유무를 자주 빼먹어서 라이브 CPU 대부분이
 * undefined가 되고, 그러면 iGPU 폴백 견적이 시드 부품만 쓰게 된다.
 * - AMD G/GT 접미(5600G·5700G·5500GT·8600G 등) → 내장 있음
 * - AMD Zen4(라이젠 5세대)/Zen5(6세대) 비-F 모델 → RDNA 내장 있음
 * - AMD F 접미(7500F·9500F) → 없음
 * - Intel F/KF 접미(12400F·225F·14700KF) → 없음, 그 외 코어 i/울트라 → 있음
 */
export function cpuHasIntegratedGraphics(part: Pick<Part, "name" | "specs" | "category">): boolean | undefined {
  if (part.specs.integratedGraphics !== undefined) return part.specs.integratedGraphics;
  const name = part.name ?? "";
  const suffixMatch = name.match(/\b(\d{3,5})\s*([A-Z]{1,3})(?=[\s(]|$)/);
  const suffix = (suffixMatch?.[2] ?? "").toUpperCase();
  if (suffix === "F" || suffix === "KF" || suffix === "FL") return false;
  if (suffix.startsWith("G")) return true; // G·GT·GE 라인은 내장그래픽 전제
  const ryzen = name.match(CPU_RYZEN_GENERATION_PATTERN);
  if (ryzen) return Number(ryzen[1]) >= 5; // Zen4(라이젠5세대)부터 전원 RDNA iGPU
  const ultra = name.match(CPU_ULTRA_SERIES_PATTERN);
  if (ultra) return true; // 데스크톱 울트라는 전원 iGPU
  const coreI = name.match(CPU_CORE_I_GENERATION_PATTERN);
  if (coreI) return Number(coreI[1]) >= 2; // 2세대부터 iGPU 일반 탑재
  // 세대 표기가 없는 이름은 모델 번호 첫 자리로 추론한다. 라이젠 7/8/9천대는
  // Zen4+라 비-F 모델 전원 RDNA iGPU이고, 4~6천대는 G 접미만 iGPU다(위에서 처리).
  if (/라이젠/i.test(name) && /\b[789]\d{3}[a-z0-9]*/i.test(name)) return true;
  if (/라이젠/i.test(name) && /\b[456]\d{3}[a-z0-9]*/i.test(name)) return false;
  if (CPU_CORE_I_MODERN_MODEL_PATTERN.test(name) && /코어|i[3579]-/i.test(name)) return true;
  return undefined;
}

/**
 * 세대 판정 없는 구매가능성 체크 — 관리자가 이름 패턴으로 부품을 직접 지명한
 * 테스트 베드/허용목록은 세대 규칙이 아니라 목록이 기준이다(RTX 3050·RX 580
 * 같은 지정 구형 부품을 세대 게이트가 다시 걸러내지 않게 한다).
 * 가격 확인·미완료 스펙·단종(delistedAt) 제외는 그대로 적용한다.
 */
export function isQuotePurchasable(part: Part, catalog?: readonly Part[]): boolean {
  return isKnownPrice(part.priceWon) && part.dataQuality !== "incomplete" && !part.delistedAt
    && !seedSupersededByLiveTwin(part, catalog);
}
