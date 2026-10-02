import type { Part } from "../types";
import { isKnownPrice } from "../types";

// seed(기준) 부품은 sourceProductCode가 없어 가격 갱신 경로를 타지 않고 정적
// 기준가가 그대로 남는다 — 같은 제품의 live/수동 매물을 "트윈"으로 연결해 seed
// 표시가격을 시장 최저가로 맞춘다(syncSeedPartPricesFromLive). 트윈은 벤더
// (한·영 별칭 정규화)와 제품 식별자가 모두 같은 부품뿐이다 — 정규화된 이름이
// 완전히 같거나, CPU는 모델 번호·GPU는 칩 모델·메모리는 용량/속도/타입
// 시그니처가 같은 경우. 어느 쪽도 맞지 않으면 건드리지 않는다 — 잘못 묶인
// 가격은 stale 가격보다 해롭다. 견적 후보에서 트윈이 있는 seed는 억제돼
// (isQuotePurchasable/isQuoteSelectable) 실구매 링크가 있는 live 매물이 대신한다.

const VENDOR_FOLDS: Array<[RegExp, string]> = [
  [/sk\s*hynix|sk\s*하이닉스|하이닉스/i, "hynix"],
  [/삼성전자|삼성|samsung/i, "samsung"],
  [/essencore|klevv|에센코어/i, "essencore"],
  [/teamgroup|팀그룹/i, "teamgroup"],
  [/micron|crucial|마이크론|크루셜/i, "crucial"],
  [/kingston|킹스톤/i, "kingston"],
  [/corsair|커세어/i, "corsair"],
  [/g\.?\s*skill|지스킬/i, "gskill"],
  [/adata|에이데이타/i, "adata"],
  [/patriot|패트리어트/i, "patriot"],
  [/pny/i, "pny"],
  [/lexar|렉사/i, "lexar"],
  [/geil|지일/i, "geil"],
  [/kioxia|키오시아/i, "kioxia"],
  [/western\s*digital|웨스턴\s*디지털|wd[_\s]?(?:black|blue|red|green|purple)?|\bwd\b/i, "wd"],
  [/seagate|씨게이트/i, "seagate"],
  [/toshiba|도시바/i, "toshiba"],
  [/micronics|마이크로닉스/i, "micronics"],
  [/seasonic|시소닉/i, "seasonic"],
  [/deepcool|딥쿨/i, "deepcool"],
  [/fractal\s*design|프랙탈/i, "fractal"],
  [/zotac|조텍/i, "zotac"],
  [/gigabyte|기가바이트/i, "gigabyte"],
  [/asrock|에즈락|애즈락/i, "asrock"],
  [/asus(?:tek)?|에이수스|아수스/i, "asus"],
  [/palit|팔릿/i, "palit"],
  [/inno3d|이노3d/i, "inno3d"],
  [/emtek|이엠텍/i, "emtek"],
  [/afox|에이폭스/i, "afox"],
  [/sapphire|사파이어/i, "sapphire"],
  [/power\s*color|파워컬러/i, "powercolor"],
  [/xfx/i, "xfx"],
  [/\bmsi\b|엠에스아이/i, "msi"],
  [/nvidia|엔비디아|지포스|geforce/i, "nvidia"],
  [/radeon|라데온|\bamd\b|라이젠|ryzen|에이엠디/i, "amd"],
  [/intel|인텔/i, "intel"]
];

function foldVendors(text: string, out: Set<string>) {
  for (const [pattern, canonical] of VENDOR_FOLDS) if (pattern.test(text)) out.add(canonical);
}

// 벤더를 정규화한 뒤 이름 전체를 영숫자·한글만 남기고 접는다 — "(16GB)"와
// "16GB"처럼 괄호 유무 차이는 소거되지만 괄호 안 용량 등 내용은 보존된다.
function normalizedProductName(name: string) {
  const folded = VENDOR_FOLDS.reduce((text, [pattern, canonical]) => text.replace(pattern, canonical), name);
  return folded.toLocaleLowerCase("ko-KR").replace(/[^\p{L}\p{N}]+/gu, "");
}

function vendorKeysFor(part: Pick<Part, "brand" | "name" | "specs">) {
  const keys = new Set<string>();
  foldVendors(part.brand ?? "", keys);
  foldVendors(part.name ?? "", keys);
  foldVendors(part.specs?.gpuVendor ?? "", keys);
  const firstToken = (part.name ?? "").trim().split(/\s+/)[0]?.toLocaleLowerCase("ko-KR");
  if (firstToken) keys.add(firstToken);
  return keys;
}

// CPU는 모델 번호가 정체성이다 — "라이젠5-6세대 9600"과 "9600 (그래니트 릿지)
// (멀티팩 정품)"은 같은 SKU다. i5/i7 같은 등급 접두는 제거한다.
function cpuModelTokenFor(part: Part) {
  const source = `${part.model ?? ""} ${part.name}`;
  const match = source.match(/\b(?:I[3579]\s*-\s*\d{3,5}|[A-Z]\d{3,5}|\d{3,5})[A-Z0-9]{0,5}\b/i);
  return match?.[0].replace(/[\s-]/g, "").toUpperCase().replace(/^I[3579]/, "");
}

// GPU는 칩 모델이 정체성이다 — "5060"과 "5060 Ti"는 다른 SKU로 분리하고,
// VRAM은 스펙 비교(specCompatible)가 담당한다.
function gpuChipTokenFor(part: Part) {
  const source = `${part.model ?? ""} ${part.name}`;
  const nvidia = source.match(/\b(?:RTX|GTX|GT)\s*(\d{3,4})\s*(TI|SUPER)?/i);
  if (nvidia) return `n${nvidia[1]}${(nvidia[2] ?? "").toUpperCase()}`;
  const radeon = source.match(/\bRX\s*(\d{3,4})\s*(XT|XTX|GRE)?/i);
  if (radeon) return `a${radeon[1]}${(radeon[2] ?? "").toUpperCase()}`;
  const arc = source.match(/\bARC\s*(?:PRO\s*)?([AB])\s*(\d{2,3})/i);
  if (arc) return `i${arc[1].toUpperCase()}${arc[2]}`;
  return undefined;
}

// 제품 식별을 위한 그룹 키 — 시그니처 경로(cpu·gpu·memory)는 모델/스펙으로
// 묶고, ssd·hdd는 용량 버킷으로 먼저 나눠 스캔 폭을 줄인다. 그 외 범주는 범주
// 단위 버킷으로 묶은 뒤 nameIdentityCompatibleFor가 이름 토큰으로 판정한다
// — 정규 이름 완전 일치는 "SATA", 괄호 용량, 유통사 접미(STCOM·서린씨앤아이)
// 같은 표기 차이로 같은 제품을 놓친다.
function capacityBucketFor(capacityGb: number | undefined) {
  if (capacityGb === undefined || !Number.isFinite(capacityGb) || capacityGb <= 0) return "na";
  const buckets = [256, 512, 1024, 2048, 4096, 8192, 16384];
  let nearest = buckets[0];
  for (const bucket of buckets) if (Math.abs(bucket - capacityGb) < Math.abs(nearest - capacityGb)) nearest = bucket;
  return `${nearest}`;
}

function twinGroupKeyFor(part: Part) {
  switch (part.category) {
    case "cpu": {
      const model = cpuModelTokenFor(part);
      if (model) return `cpu|${model}`;
      break;
    }
    case "gpu": {
      const chip = gpuChipTokenFor(part);
      if (chip) return `gpu|${chip}`;
      break;
    }
    case "memory": {
      const { memoryType, capacityGb, speedMhz, formFactor } = part.specs;
      if (memoryType && capacityGb && speedMhz) return `memory|${memoryType}|${capacityGb}|${speedMhz}|${formFactor ?? ""}`;
      break;
    }
    case "ssd":
    case "hdd":
      return `${part.category}|${capacityBucketFor(part.specs.capacityGb)}`;
    case "motherboard":
    case "psu":
    case "cooler":
    case "case":
      return part.category;
  }
  const nameKey = normalizedProductName(part.name ?? "");
  return nameKey ? `${part.category}|name|${nameKey}` : undefined;
}

// 시그니처가 같은 뒤에도 스펙으로 한 번 더 확인한다 — seed가 값을 가진 항목만
// 비교해 live 쪽이 누락된 스펙 때문에 트윈이 끊기지 않게 한다.
const TWIN_SPEC_KEYS: Partial<Record<Part["category"], readonly string[]>> = {
  cpu: ["socket", "cpuSeries"],
  gpu: ["vramGb"],
  memory: ["memoryType", "capacityGb", "speedMhz", "formFactor"],
  ssd: ["capacityGb"],
  hdd: ["capacityGb"],
  psu: ["wattageW"],
  motherboard: ["socket", "memoryType", "formFactor"]
};

function specCompatible(seed: Part, live: Part) {
  const keys = TWIN_SPEC_KEYS[seed.category] ?? [];
  return keys.every((key) => {
    const seedValue = (seed.specs as Record<string, unknown>)[key];
    const liveValue = (live.specs as Record<string, unknown>)[key];
    if (seedValue === undefined || liveValue === undefined) return true;
    // 저장장치 용량은 1000/1024 같은 표기 차이를 버킷으로 흡수한다.
    if ((key === "capacityGb") && (seed.category === "ssd" || seed.category === "hdd")) {
      return capacityBucketFor(Number(seedValue)) === capacityBucketFor(Number(liveValue));
    }
    return JSON.stringify(seedValue) === JSON.stringify(liveValue);
  });
}

// 이름에서 벤더(별칭 fold)와 무의미 토큰(용량·인터페이스·폼팩터·유통/포장
// 수식어)을 떼고 남는 모델 토큰 — "삼성전자 870 EVO (1TB)"와 "Samsung 870 EVO
// SATA 1TB"는 둘 다 {870, evo}가 남아 같은 제품으로 묶인다.
const NAME_NOISE_TOKENS = new Set([
  // 유통사·포장 접미
  "서린씨앤아이", "씨앤아이", "국민전자", "대원씨티에스", "stcom", "코잇", "피씨디렉트", "인텍앤컴퍼니", "웨이코스", "오름정보", "아이티엘", "디지탈그린텍", "제이웍스",
  "new", "정품", "병행수입", "멀티팩", "패키지", "국내", "유통", "정발", "정식", "벌크", "oem", "무상보증", "무상", "보증",
  // 인터페이스·폼팩터·타입 수식어
  "sata", "nvme", "pcie", "gen3", "gen4", "gen5", "m2", "2280", "22110", "atx", "matx", "e-atx", "eatx", "itx", "sfx", "sfxl", "dimm", "udimm", "so-dimm", "sodimm", "ddr3", "ddr4", "ddr5",
  // 외형·색상·쿨링 수식어
  "풀모듈러", "세미모듈러", "모듈러", "리버스", "듀얼타워", "타워형", "타워", "화이트", "블랙", "white", "black", "argb", "rgb", "gold", "platinum", "bronze", "윈도우", "강화유리", "메쉬", "mesh", "시스템", "쿨링", "팬",
]);

const CAPACITY_TOKEN_RE = /^\d+(?:tb|gb|g|t|w|va)$/;
const DIM_TOKEN_RE = /^\d{2,4}mm$/;
const FORM_FACTOR_TOKEN_RE = /^(?:atx|matx|eatx|e-atx|itx|sfx|sfxl|dtx)\d*(?:\.\d+)?$/;
const INTERFACE_TOKEN_RE = /^(?:sata|nvme|pcie|gen\d|ddr\d|d6x|g?ddr\d+|x4|x8|x16)$/;

function nameIdentityTokensFor(part: Part) {
  const folded = VENDOR_FOLDS.reduce((text, [pattern]) => text.replace(pattern, " "), part.name ?? "");
  const tokens = folded
    .toLocaleLowerCase("ko-KR")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => (token.length > 1 || /^\p{L}$/u.test(token))
      && !NAME_NOISE_TOKENS.has(token)
      && !CAPACITY_TOKEN_RE.test(token)
      && !DIM_TOKEN_RE.test(token)
      && !FORM_FACTOR_TOKEN_RE.test(token)
      && !INTERFACE_TOKEN_RE.test(token));
  return new Set(tokens);
}

// 모델 식별에 도움이 되는 토큰 — 숫자를 포함하거나 4자 이상의 토큰. "870"·"evo"
// 같은 식별 토큰이 없는 지나치게 일반적인 이름의 비교를 막는다.
function isModelLikeToken(token: string) {
  return /\d/.test(token) || token.length >= 4;
}

// 토큰 범주(ssd·hdd·mb·psu·cooler·case)의 정체성 판정 — 한쪽이 다른 쪽의
// 부분집합이어도 같은 제품으로 본다("AK620" ⊂ "AK620 듀얼타워"). 단, 큰 쪽에만
// 있는 추가 토큰은 모두 무의미 토큰에서 이미 걸러져 있으므로 남은 토큰은 전부
// 식별 토큰이다 — "870 EVO" ⊂ "870 EVO PLUS"처럼 판별 토큰(plus)이 남으면
// 부분집합이어도 다른 제품으로 본다.
const DISCRIMINATING_TOKENS = new Set(["pro", "plus", "max", "ultra", "lite", "mini", "xtx", "xt", "gre", "se", "ti", "super", "hx", "kf", "v2", "v3", "mk2", "ii", "iii", "rev", "sn", "signature", "viper", "venom", "trident", "lancer", "elite", "pro4", "evo", "play", "classic"]);

function nameIdentityCompatibleFor(seed: Part, live: Part) {
  const seedTokens = nameIdentityTokensFor(seed);
  const liveTokens = nameIdentityTokensFor(live);
  if (seedTokens.size === 0 || liveTokens.size === 0) return false;
  const seedModelTokens = [...seedTokens].filter(isModelLikeToken);
  const liveModelTokens = [...liveTokens].filter(isModelLikeToken);
  if (seedModelTokens.length === 0 || liveModelTokens.length === 0) return false;
  const seedInLive = [...seedTokens].every((token) => liveTokens.has(token));
  const liveInSeed = [...liveTokens].every((token) => seedTokens.has(token));
  if (seedInLive && liveInSeed) return true;
  // 부분집합 허용: 큰 쪽의 추가 토큰이 판별 토큰이면 다른 SKU다.
  if (seedInLive) {
    const extras = [...liveTokens].filter((token) => !seedTokens.has(token));
    return extras.every((token) => !isModelLikeToken(token) && !DISCRIMINATING_TOKENS.has(token));
  }
  if (liveInSeed) {
    const extras = [...seedTokens].filter((token) => !liveTokens.has(token));
    return extras.every((token) => !isModelLikeToken(token) && !DISCRIMINATING_TOKENS.has(token));
  }
  return false;
}

const TOKEN_MATCH_CATEGORIES = new Set<Part["category"]>(["ssd", "hdd", "motherboard", "psu", "cooler", "case"]);

function intersects(left: Set<string>, right: Set<string>) {
  for (const value of left) if (right.has(value)) return true;
  return false;
}

// 칩 벤더 키(nvidia·amd·intel)는 보드 파트너가 다른 제품을 연결해 주지만,
// seed가 파트너 벤더를 들고 있으면 파트너끼리만 묶어야 가격이 안 섞인다 —
// ZOTAC 5060 seed에 MSI 5060의 더 싼 가격이 붙는 사고 방지.
const CHIP_VENDOR_KEYS = new Set(["nvidia", "amd", "intel"]);

function vendorsMatch(seedKeys: Set<string>, liveKeys: Set<string>) {
  const partnerKeys = [...seedKeys].filter((key) => !CHIP_VENDOR_KEYS.has(key));
  if (partnerKeys.length === 0) return intersects(seedKeys, liveKeys);
  return partnerKeys.some((key) => liveKeys.has(key));
}

export type SeedLiveTwinIndex = Map<string, Part[]>;

const twinIndexCache = new WeakMap<readonly Part[], SeedLiveTwinIndex>();

// live·manual 매물을 제품 그룹 키로 인덱싱한다 — 트윈 후보는 판매 중(가격
// 확인·미단종)이고 액세서리가 아닌 부품뿐이다. seed 자신은 인덱스에 들어가지
// 않는다. 카탈로그 배열 참조를 키로 캐시해 로드마다 한 번만 만든다.
export function seedLiveTwinIndexFor(catalog: readonly Part[]): SeedLiveTwinIndex {
  const cached = twinIndexCache.get(catalog);
  if (cached) return cached;
  const index: SeedLiveTwinIndex = new Map();
  for (const part of catalog) {
    if (part.dataQuality === "seed" || part.delistedAt || part.listingType === "accessory" || !isKnownPrice(part.priceWon)) continue;
    const key = twinGroupKeyFor(part);
    if (!key) continue;
    const bucket = index.get(key);
    if (bucket) bucket.push(part);
    else index.set(key, [part]);
  }
  twinIndexCache.set(catalog, index);
  return index;
}

export function seedLiveTwinsFor(seed: Part, catalogOrIndex: readonly Part[] | SeedLiveTwinIndex): Part[] {
  if (seed.dataQuality !== "seed") return [];
  const key = twinGroupKeyFor(seed);
  if (!key) return [];
  const index = catalogOrIndex instanceof Map ? catalogOrIndex : seedLiveTwinIndexFor(catalogOrIndex);
  const seedVendors = vendorKeysFor(seed);
  const needsNameTokens = TOKEN_MATCH_CATEGORIES.has(seed.category);
  // 메모리는 타입·용량·속도 시그니처로 먼저 묶지만, 양쪽에 시리즈 토큰이 있으면
  // 한 번 더 비교한다 — 같은 벤더의 다른 라인(VIPER VENOM vs SIGNATURE)이
  // 스펙만 같다고 서로의 가격을 물려받으면 안 된다. 시리즈 없는 제네릭 이름
  // ("삼성전자 DDR5-5600 (16GB)")은 토큰이 비어 시그니처로만 판정한다.
  const seedHasModelTokens = seed.category === "memory" && [...nameIdentityTokensFor(seed)].some(isModelLikeToken);
  return (index.get(key) ?? []).filter(
    (live: Part) => vendorsMatch(seedVendors, vendorKeysFor(live))
      && specCompatible(seed, live)
      && (!needsNameTokens || nameIdentityCompatibleFor(seed, live))
      && (!seedHasModelTokens
        || ![...nameIdentityTokensFor(live)].some(isModelLikeToken)
        || nameIdentityCompatibleFor(seed, live))
  );
}

// 같은 제품의 판매 중인 매물 중 가장 싼 것 — 다나와 "최저가" 의미론과 맞춘다.
export function seedLiveTwinFor(seed: Part, catalogOrIndex: readonly Part[] | SeedLiveTwinIndex): Part | undefined {
  let cheapest: Part | undefined;
  for (const twin of seedLiveTwinsFor(seed, catalogOrIndex)) {
    if (!cheapest || (twin.priceWon ?? Number.MAX_SAFE_INTEGER) < (cheapest.priceWon ?? Number.MAX_SAFE_INTEGER)) cheapest = twin;
  }
  return cheapest;
}

// 카탈로그의 seed 부품 가격을 live 트윈의 최저가로 동기화한 사본을 돌려준다.
// 트윈이 없거나 가격이 이미 같으면 원본 부품 객체를 그대로 유지한다. 저장
// 레코드는 건드리지 않는다 — live 매물이 사라지면 seed는 다시 기준가로 보인다.
export function syncSeedPartPricesFromLive(catalog: readonly Part[]): Part[] {
  const index = seedLiveTwinIndexFor(catalog);
  if (index.size === 0) return [...catalog];
  return catalog.map((part) => {
    if (part.dataQuality !== "seed") return part;
    const twin = seedLiveTwinFor(part, index);
    if (!twin || twin.priceWon === part.priceWon) return part;
    return { ...part, priceWon: twin.priceWon, priceCheckedAt: twin.priceCheckedAt ?? part.priceCheckedAt };
  });
}
