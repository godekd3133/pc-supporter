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
// 묶고, 나머지 범주는 벤더 접힌 정규 이름 일치로만 묶는다(보수적).
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
    return seedValue === undefined || liveValue === undefined || JSON.stringify(seedValue) === JSON.stringify(liveValue);
  });
}

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
  return (index.get(key) ?? []).filter(
    (live: Part) => vendorsMatch(seedVendors, vendorKeysFor(live)) && specCompatible(seed, live)
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
