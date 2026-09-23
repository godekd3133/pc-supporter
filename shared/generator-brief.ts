import { RECOMMENDATION_PRIORITY_LABELS } from "./types";
import type { GamingRefreshRate, GamingResolution, ListingPolicy, RecommendationPriority, RecommendationProfile } from "./types";

export type GeneratorBriefField =
  | "profile"
  | "priority"
  | "gamingResolution"
  | "gamingRefreshRate"
  | "memoryCapacityGb"
  | "budgetWon"
  | "includeGpu"
  | "storageCapacityGb"
  | "hddCount"
  | "hddCapacityGb"
  | "listingPolicy";

export type GeneratorBriefConfig = Partial<{
  profile: RecommendationProfile;
  priority: RecommendationPriority;
  gamingResolution: GamingResolution;
  gamingRefreshRate: GamingRefreshRate;
  memoryCapacityGb: 16 | 32 | 64 | 128;
  budgetWon: number;
  includeGpu: boolean;
  storageCapacityGb: 500 | 1000 | 2000 | 4000;
  hddCount: 0 | 1 | 2 | 4;
  hddCapacityGb: 2000 | 4000 | 8000 | 16000;
  listingPolicy: ListingPolicy;
}>;

export interface GeneratorBriefMatch {
  field: GeneratorBriefField;
  label: string;
  value: string;
  source: string;
}

export interface GeneratorBriefGuidance {
  id: string;
  label: string;
  detail: string;
  phrase?: string;
}

export interface GeneratorBriefCoverage {
  matched: number;
  total: number;
  missing: string[];
}

export interface GeneratorBriefInterpretation {
  config: GeneratorBriefConfig;
  matches: GeneratorBriefMatch[];
  warnings: string[];
  confidence: "high" | "medium" | "low";
  coverage: GeneratorBriefCoverage;
  guidance: GeneratorBriefGuidance[];
}

type BudgetPattern = {
  regex: RegExp;
  multiplier: number;
};

const BUDGET_PATTERNS: BudgetPattern[] = [
  { regex: /(\d+(?:[.,]\d+)?)\s*억\s*원?/i, multiplier: 100_000_000 },
  { regex: /(\d+(?:[.,]\d+)?)\s*(?:백만원|백만)\s*원?/i, multiplier: 1_000_000 },
  { regex: /(\d+(?:[.,]\d+)?)\s*(?:만원|만)\s*원?/i, multiplier: 10_000 },
  { regex: /(\d+(?:[.,]\d+)?)\s*(?:천원|천)\s*원?/i, multiplier: 1_000 },
  { regex: /(\d[\d,]*)\s*원/i, multiplier: 1 }
];

const PROFILE_MATCHERS: Array<{ profile: RecommendationProfile; pattern: RegExp; label: string }> = [
  { profile: "development", pattern: /개발|코딩|ai|머신러닝|딥러닝/i, label: "개발·AI" },
  { profile: "creator", pattern: /크리에이터|영상\s*편집|영상\s*작업|렌더링|3d\s*작업/i, label: "작업·크리에이터" },
  { profile: "gaming", pattern: /게이밍|게임용|게임\s*PC|fps|롤|배그|스팀/i, label: "게이밍" },
  { profile: "office", pattern: /사무용|문서|웹\s*서핑|인터넷\s*용|업무용/i, label: "사무·일반" },
  { profile: "general", pattern: /일반용|범용/i, label: "일반형" }
];

const PRIORITY_MATCHERS: Array<{ priority: RecommendationPriority; pattern: RegExp; label: string }> = [
  { priority: "reliability", pattern: /확인\s*우선|신뢰\s*우선|안전\s*우선|호환\s*우선|정보\s*우선|데이터\s*확실/i, label: RECOMMENDATION_PRIORITY_LABELS.reliability },
  { priority: "budget", pattern: /가성비|저렴|절약|최저가|예산\s*우선/i, label: RECOMMENDATION_PRIORITY_LABELS.budget },
  { priority: "performance", pattern: /성능\s*우선|고사양|최고\s*성능|빠른|성능\s*중심/i, label: RECOMMENDATION_PRIORITY_LABELS.performance },
  { priority: "balanced", pattern: /균형형|균형|밸런스/i, label: RECOMMENDATION_PRIORITY_LABELS.balanced }
];

function numericValue(raw: string) {
  const value = Number(raw.replace(/,/g, ""));
  return Number.isFinite(value) ? value : undefined;
}

function budgetFromBrief(text: string) {
  for (const candidate of BUDGET_PATTERNS) {
    const match = candidate.regex.exec(text);
    if (!match) continue;
    const number = numericValue(match[1] ?? "");
    if (number === undefined) continue;
    const value = Math.round(number * candidate.multiplier);
    if (Number.isInteger(value) && value > 0 && value <= 1_000_000_000) return { value, source: match[0] };
  }
  return undefined;
}

function capacityFromBrief(text: string, labelPattern: string) {
  const beforePattern = new RegExp(`(?:${labelPattern})[^\\d]{0,14}(\\d{1,5}(?:[.,]\\d+)?)\\s*(tb|테라|gb|기가)`, "i");
  const afterPattern = new RegExp(`(\\d{1,5}(?:[.,]\\d+)?)\\s*(tb|테라|gb|기가)\\s{1,8}(?:${labelPattern})`, "i");
  const beforeMatch = beforePattern.exec(text);
  const afterMatch = beforeMatch ? undefined : afterPattern.exec(text);
  const match = beforeMatch ?? afterMatch;
  if (!match) return undefined;
  const rawNumber = match[1];
  const unit = (match[2] ?? "").toLowerCase();
  const number = numericValue(rawNumber ?? "");
  if (number === undefined) return undefined;
  const value = Math.round(number * (unit === "tb" || unit === "테라" ? 1000 : 1));
  return { value, source: match[0] };
}

function memoryFromBrief(text: string) {
  const pattern = /(?:ram|램|메모리)[^\d]{0,14}(\d{1,3})\s*(?:gb|기가)?|(\d{1,3})\s*(?:gb|기가)[^\d]{0,8}(?:ram|램|메모리)/i;
  const match = pattern.exec(text);
  if (!match) return undefined;
  const rawNumber = match[1] ?? match[2];
  const value = numericValue(rawNumber ?? "");
  return value === undefined ? undefined : { value, source: match[0] };
}

function hddCapacityFromBrief(text: string) {
  const beforePattern = /(?:hdd|하드디스크|하드)[\s\S]{0,26}?(\d{1,5}(?:[.,]\d+)?)\s*(tb|테라|gb|기가)/i;
  const afterPattern = /(\d{1,5}(?:[.,]\d+)?)\s*(tb|테라|gb|기가)\s{1,8}(?:hdd|하드디스크|하드)/i;
  const beforeMatch = beforePattern.exec(text);
  const afterMatch = beforeMatch ? undefined : afterPattern.exec(text);
  const match = beforeMatch ?? afterMatch;
  if (!match) return undefined;
  const rawNumber = match[1];
  const unit = (match[2] ?? "").toLowerCase();
  const number = numericValue(rawNumber ?? "");
  if (number === undefined) return undefined;
  return { value: Math.round(number * (unit === "tb" || unit === "테라" ? 1000 : 1)), source: match[0] };
}

function hddCountFromBrief(text: string) {
  const patterns = [
    /(?:hdd|하드디스크|하드)[^\d]{0,14}(\d+)\s*(?:개|대)/i,
    /(\d+)\s*(?:개|대)[^\n]{0,10}(?:hdd|하드디스크|하드)/i
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const value = numericValue(match[1] ?? "");
    if (value !== undefined) return { value, source: match[0] };
  }
  return undefined;
}

function addMatch<K extends GeneratorBriefField>(config: GeneratorBriefConfig, matches: GeneratorBriefMatch[], field: K, value: GeneratorBriefConfig[K], label: string, source: string, displayValue = label) {
  if (value === undefined || config[field] !== undefined) return;
  (config as Record<string, unknown>)[field] = value;
  matches.push({ field, label, value: displayValue, source });
}

function firstMatcher<T extends { pattern: RegExp }>(text: string, matchers: T[]) {
  return matchers.find((matcher) => matcher.pattern.test(text));
}

function allMatchers<T extends { pattern: RegExp }>(text: string, matchers: T[]) {
  return matchers.filter((matcher) => matcher.pattern.test(text));
}

function supportedCapacity(value: number, values: readonly number[]) {
  return values.includes(value);
}

function briefCoverageFor(config: GeneratorBriefConfig): GeneratorBriefCoverage {
  const required: Array<{ field: keyof GeneratorBriefConfig; label: string }> = [
    { field: "profile", label: "사용 목적" },
    { field: "budgetWon", label: "목표 예산" },
    { field: "memoryCapacityGb", label: "RAM 목표" },
    { field: "storageCapacityGb", label: "SSD 목표" },
    { field: "includeGpu", label: "그래픽카드" }
  ];
  if (config.profile === "gaming") {
    required.push(
      { field: "gamingResolution", label: "게임 해상도" },
      { field: "gamingRefreshRate", label: "목표 주사율" }
    );
  }
  const missing = required.filter(({ field }) => config[field] === undefined).map(({ label }) => label);
  return { matched: required.length - missing.length, total: required.length, missing };
}

function briefGuidanceFor(config: GeneratorBriefConfig): GeneratorBriefGuidance[] {
  const guidance: GeneratorBriefGuidance[] = [];
  const add = (item: GeneratorBriefGuidance) => guidance.push(item);

  if (config.profile === undefined) {
    add({ id: "profile", label: "사용 목적", detail: "게임·영상 작업·개발·사무 중 주로 할 일을 적어 주세요." });
  }
  if (config.budgetWon === undefined) {
    add({ id: "budget", label: "예산", detail: "예: 200만 원" });
  }
  if (config.profile === "gaming") {
    if (config.gamingResolution === undefined) {
      add({ id: "gaming-resolution", label: "게임 해상도", phrase: "QHD", detail: "FHD·QHD·4K 중 골라 주세요." });
    }
    if (config.gamingRefreshRate === undefined) {
      add({ id: "gaming-refresh", label: "목표 주사율", phrase: "144Hz", detail: "60·144·240Hz 중 골라 주세요." });
    }
  }
  if (config.memoryCapacityGb === undefined) {
    add({ id: "memory", label: "RAM", phrase: "RAM 32GB", detail: "16·32·64·128GB 중 골라 주세요." });
  }
  if (config.storageCapacityGb === undefined) {
    add({ id: "storage", label: "SSD", phrase: "SSD 1TB", detail: "500GB·1TB·2TB·4TB 중 골라 주세요." });
  }
  if (config.includeGpu === undefined) {
    add({ id: "gpu", label: "그래픽카드", detail: "외장 그래픽 포함 또는 내장 그래픽만이라고 적어 주세요." });
  }
  return guidance.slice(0, 6);
}

export function generatorBriefInterpretationFor(input: string): GeneratorBriefInterpretation {
  const text = input.trim().replace(/\s+/g, " ");
  const config: GeneratorBriefConfig = {};
  const matches: GeneratorBriefMatch[] = [];
  const warnings: string[] = [];
  if (!text) {
    return { config, matches, warnings: ["원하는 조건을 한 줄로 입력해 주세요. 예: QHD 게이밍 220만원, RAM 32GB, SSD 2TB"], confidence: "low", coverage: { matched: 0, total: 5, missing: ["사용 목적", "목표 예산", "RAM 목표", "SSD 목표", "그래픽카드"] }, guidance: [] };
  }

  const profiles = allMatchers(text, PROFILE_MATCHERS);
  const profile = firstMatcher(text, PROFILE_MATCHERS);
  if (profiles.length > 1) warnings.push(`주로 할 일이 여러 개 적혀 있어 ${profile?.label ?? "첫 번째 항목"}만 반영했어요.`);
  if (profile) addMatch(config, matches, "profile", profile.profile, "사용 목적", profile.label, profile.label);

  const priorities = allMatchers(text, PRIORITY_MATCHERS);
  const priority = firstMatcher(text, PRIORITY_MATCHERS);
  if (priorities.length > 1) warnings.push(`우선순위가 여러 개 적혀 있어 ${priority?.label ?? "첫 번째 항목"}만 반영했어요.`);
  if (priority) addMatch(config, matches, "priority", priority.priority, "우선순위", priority.label, priority.label);

  const resolutionMatch = text.match(/(?:4k|2160p|2160\s*(?:해상도)?)/i) ?? text.match(/(?:qhd|1440p|1440\s*(?:해상도)?)/i) ?? text.match(/(?:fhd|1080p|1080\s*(?:해상도)?)/i);
  if (resolutionMatch) {
    const raw = resolutionMatch[0].toLowerCase();
    const resolution: GamingResolution = raw.includes("4k") || raw.includes("2160") ? "4k" : raw.includes("qhd") || raw.includes("1440") ? "1440p" : "1080p";
    addMatch(config, matches, "gamingResolution", resolution, "게임 해상도", resolution === "4k" ? "4K" : resolution === "1440p" ? "QHD" : "FHD", resolutionMatch[0]);
    if (config.profile === undefined) addMatch(config, matches, "profile", "gaming", "사용 목적", "게임용으로 분류", "게이밍");
  }

  const refreshMatch = text.match(/(240|144|60)\s*(?:hz|헤르츠|주사율)/i);
  if (refreshMatch) {
    const refreshRate = Number(refreshMatch[1]) as GamingRefreshRate;
    addMatch(config, matches, "gamingRefreshRate", refreshRate, "목표 주사율", `${refreshRate}Hz`, refreshMatch[0]);
    if (config.profile === undefined) addMatch(config, matches, "profile", "gaming", "사용 목적", "게임용으로 분류", "게이밍");
  }

  const budget = budgetFromBrief(text);
  if (budget) addMatch(config, matches, "budgetWon", budget.value, "목표 예산", `${budget.value.toLocaleString("ko-KR")}원`, budget.source);

  const memory = memoryFromBrief(text);
  if (memory) {
    if (supportedCapacity(memory.value, [16, 32, 64, 128])) addMatch(config, matches, "memoryCapacityGb", memory.value as 16 | 32 | 64 | 128, "RAM 목표", `${memory.value}GB 이상`, memory.source);
    else warnings.push(`자동 견적에서는 RAM ${memory.value}GB를 고를 수 없어요. 16·32·64·128GB 중 하나를 적어 주세요.`);
  }

  const storage = capacityFromBrief(text, "ssd|nvme|스토리지|저장장치|저장공간");
  if (storage) {
    if (supportedCapacity(storage.value, [500, 1000, 2000, 4000])) addMatch(config, matches, "storageCapacityGb", storage.value as 500 | 1000 | 2000 | 4000, "SSD 목표", `${storage.value >= 1000 ? `${storage.value / 1000}TB` : `${storage.value}GB`} 이상`, storage.source);
    else warnings.push(`자동 견적에서는 SSD ${storage.value >= 1000 ? `${storage.value / 1000}TB` : `${storage.value}GB`}를 고를 수 없어요. 500GB·1TB·2TB·4TB 중 하나를 적어 주세요.`);
  }

  const hddCount = hddCountFromBrief(text);
  if (hddCount) {
    if (supportedCapacity(hddCount.value, [0, 1, 2, 4])) addMatch(config, matches, "hddCount", hddCount.value as 0 | 1 | 2 | 4, "HDD 개수", `HDD ${hddCount.value}개`, hddCount.source);
    else warnings.push(`자동 견적에서는 HDD ${hddCount.value}개를 고를 수 없어요. 0·1·2·4개 중 하나를 적어 주세요.`);
  }

  const hddCapacity = hddCapacityFromBrief(text);
  if (hddCapacity) {
    if (supportedCapacity(hddCapacity.value, [2000, 4000, 8000, 16000])) addMatch(config, matches, "hddCapacityGb", hddCapacity.value as 2000 | 4000 | 8000 | 16000, "HDD 용량", `HDD ${hddCapacity.value >= 1000 ? `${hddCapacity.value / 1000}TB` : `${hddCapacity.value}GB`} 이상`, hddCapacity.source);
    else warnings.push(`자동 견적에서는 HDD ${hddCapacity.value >= 1000 ? `${hddCapacity.value / 1000}TB` : `${hddCapacity.value}GB`}를 고를 수 없어요. 2·4·8·16TB 중 하나를 적어 주세요.`);
  }

  const noGpu = /내장\s*그래픽|내장만|외장\s*그래픽\s*(?:없|미포함)|그래픽카드\s*(?:없이|미포함)|gpu\s*없/i.test(text);
  const hasGpu = /외장\s*그래픽|그래픽카드\s*(?:포함|필요)|gpu\s*(?:포함|필요)|게이밍|게임용|fps|롤|배그|스팀/i.test(text);
  if (noGpu && hasGpu) warnings.push("내장 그래픽과 외장 그래픽 조건이 함께 감지되어 GPU 포함 여부는 현재 값을 유지합니다.");
  else if (noGpu) addMatch(config, matches, "includeGpu", false, "그래픽카드", "내장 그래픽 우선", "내장 그래픽만");
  else if (hasGpu) addMatch(config, matches, "includeGpu", true, "그래픽카드", "외장 그래픽 포함", "외장 그래픽 포함");

  if (/병행수입|해외구매|해외|중고|리퍼|모든\s*유통|전체\s*조건/i.test(text)) addMatch(config, matches, "listingPolicy", "all", "구매 조건", "전체 유통 조건", "전체 조건");
  else if (/벌크/i.test(text)) addMatch(config, matches, "listingPolicy", "include_bulk", "구매 조건", "벌크 포함", "벌크 포함");
  else if (/신품|정식\s*유통|정품/i.test(text)) addMatch(config, matches, "listingPolicy", "retail_only", "구매 조건", "신품·정식 유통", "신품·정식 유통");

  if (matches.length === 0) warnings.push("해석할 수 있는 조건이 없습니다. 예: QHD 게이밍 220만원, RAM 32GB, SSD 2TB");
  const hasHardConflict = warnings.some((warning) => warning.includes("조건이 함께 감지"));
  const confidence = hasHardConflict ? "low" : matches.length >= 4 && warnings.length === 0 ? "high" : matches.length >= 1 && warnings.length <= 1 ? "medium" : "low";
  return { config, matches, warnings, confidence, coverage: briefCoverageFor(config), guidance: briefGuidanceFor(config) };
}
