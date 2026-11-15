// 견본견적 — 개발자가 직접 구성한 완성 견적. 견적 마법사는 사용자의 용도/해상도/
// 예산 등급으로 이 중 하나를 고르고, 결과 화면의 "견적 등급 바꾸기"는 이 목록을
// 순서대로 오르내린다.
//
// 부품은 카탈로그 ID가 아니라 이름 토큰으로 적는다(가격 갱신·재수집으로 ID와
// 매물이 바뀌어도 같은 제품을 다시 찾도록). 서버가 요청 시점의 카탈로그에서
// 해석한다: 각 alternatives 항목을 순서대로 시도하고, 모든 토큰이 이름에 들어간
// 부품 중 다나와 인기순위 → 최저가 순으로 하나를 고른다.
//
// 새 견본 추가/교체: SAMPLE_BUILDS에 항목을 넣고 order로 등급 순서를, gpuClass로
// 예산 버튼 매핑(GAMING_BUDGET_TIER_GPU)을 맞춘다. provisional: true는 개발자 확정
// 전 임시 구성이라는 표시다.
import type { BuildSelection, GamingResolution, Part, PartCategory, PartSelection } from "./types";
import { isKnownPrice } from "./types";

export type SampleGpuClass = "igpu" | "rx580" | "rtx5050" | "rtx5060ti" | "rtx5070" | "rtx5070ti" | "rtx5080" | "rtx5090";

export interface SampleBuildPartSpec {
  category: PartCategory;
  /** 화면에 그대로 보여 줄 견본 원문 이름. */
  label: string;
  /** 토큰 묶음 후보 — 앞에서부터 시도. 토큰은 공백 제거·소문자 이름에 포함돼야 한다. */
  alternatives: string[][];
  /** 이름에 들어가면 제외할 토큰(공백 제거·소문자). */
  exclude?: string[];
  quantity?: number;
}

export interface SampleBuild {
  id: string;
  /** 등급 순서(작을수록 저렴). 등급 바꾸기 사다리에 쓰인다. */
  order: number;
  title: string;
  gpuClass: SampleGpuClass;
  /** CPU가 7800X3D 이상 X3D인지 — 인기 온라인 게임(배그/로아/와우/아이온) 선택 시 우선. */
  x3dCpu?: boolean;
  /** 추천할 때 함께 보여 줄 견적 평가 문장. */
  evaluation: string[];
  parts: SampleBuildPartSpec[];
  /** 개발자 확정 전 임시 구성. */
  provisional?: boolean;
}

const KLEVV_DDR4_8GB: SampleBuildPartSpec = { category: "memory", label: "ESSENCORE KLEVV DDR4-3200 8GB", alternatives: [["klevv", "ddr4-3200", "(8gb)"], ["ddr4-3200", "(8gb)"]], exclude: ["노트북", "so-dimm"], quantity: 2 };
const KLEVV_DDR5_16GB: SampleBuildPartSpec = { category: "memory", label: "ESSENCORE KLEVV DDR5-5600 16GB", alternatives: [["klevv", "ddr5-5600", "(16gb)"], ["ddr5-5600", "(16gb)"]], exclude: ["노트북", "so-dimm", "cudimm"], quantity: 2 };
const PM9A1_512: SampleBuildPartSpec = { category: "ssd", label: "삼성 PM9A1 M.2 NVMe 벌크 512GB", alternatives: [["pm9a1", "벌크", "(512gb)"], ["pm9a1", "(512gb)"]] };
const PM9A1_1TB: SampleBuildPartSpec = { category: "ssd", label: "삼성 PM9A1 M.2 NVMe 벌크 1TB", alternatives: [["pm9a1", "벌크", "(1tb)"], ["pm9a1", "(1tb)"]] };
const N30_BLACK: SampleBuildPartSpec = { category: "case", label: "잘만 N30 백사십 블랙", alternatives: [["잘만", "n30백사십", "블랙"], ["n30백사십"]], exclude: ["plus"] };
const CLASSIC2 = (watt: number, grade: string): SampleBuildPartSpec => ({ category: "psu", label: `마이크로닉스 Classic II 풀체인지 ${watt}W 80PLUS ${grade} ATX 3.1`, alternatives: [["classicii풀체인지", `${watt}w`, grade, "atx3.1"], ["classicii풀체인지", `${watt}w`]], exclude: ["화이트", "230veu"] });
const PALADIN_400: SampleBuildPartSpec = { category: "cooler", label: "PCCOOLER PALADIN 400", alternatives: [["paladin400"]] };
const B650M: SampleBuildPartSpec = { category: "motherboard", label: "GIGABYTE B650M K", alternatives: [["gigabyte", "b650mk"], ["b650m"]], exclude: ["벌크"] };
const B850M: SampleBuildPartSpec = { category: "motherboard", label: "MSI PRO B850M-A WIFI", alternatives: [["pro", "b850m-a", "wifi"], ["b850m"]] };
const AK620: SampleBuildPartSpec = { category: "cooler", label: "DeepCool AK620", alternatives: [["ak620"], ["ag400"]] };

const gpuSpec = (label: string, token: string, exclude: string[] = []): SampleBuildPartSpec => ({ category: "gpu", label, alternatives: [[token]], exclude });

export const SAMPLE_BUILDS: readonly SampleBuild[] = [
  {
    id: "s1-office",
    order: 1,
    title: "사무용 및 저예산 저사양 게임(롤)",
    gpuClass: "igpu",
    evaluation: [
      "사무용으로 사용하거나 바둑, 포커, 롤 같은 저사양 게임에 적합한 견적입니다.",
      "쾌적하진 않지만 오버워치 최하옵을 60fps 정도로 돌릴 수 있습니다."
    ],
    parts: [
      { category: "cpu", label: "AMD Ryzen 5 5500GT 멀티팩", alternatives: [["5500gt", "멀티팩"], ["5500gt"]] },
      { category: "motherboard", label: "ASUS PRIME A520M-A II", alternatives: [["prime", "a520m-aii"], ["a520m-aii"]] },
      KLEVV_DDR4_8GB,
      PM9A1_512,
      { category: "case", label: "ED20 A0", alternatives: [["ed20", "a0"], ["ed20"], ["잘만", "n30백사십", "블랙"]] },
      CLASSIC2(500, "실버")
    ]
  },
  {
    id: "s2-budget-gaming",
    order: 2,
    title: "저예산 게이밍 견적",
    gpuClass: "rx580",
    evaluation: ["오버워치 최상옵, 배틀그라운드 국민 옵션을 100fps 정도로 돌릴 수 있는 저예산 게이밍 견적입니다."],
    parts: [
      { category: "cpu", label: "AMD Ryzen 5 5600", alternatives: [["5600(버미어)", "멀티팩"], ["5600(버미어)"]] },
      PALADIN_400,
      { category: "motherboard", label: "ASUS PRIME A520M-A II", alternatives: [["prime", "a520m-aii"], ["a520m-aii"]] },
      KLEVV_DDR4_8GB,
      { category: "gpu", label: "액슬 RX 580", alternatives: [["액슬", "rx580"], ["rx580"]] },
      PM9A1_512,
      N30_BLACK,
      CLASSIC2(500, "실버")
    ]
  },
  {
    id: "s3-fhd-entry",
    order: 3,
    title: "FHD 입문 게이밍 견적",
    gpuClass: "rtx5050",
    evaluation: ["콘솔 게임 입문용 FHD 게이밍 견적입니다. 검은신화 오공을 상옵에서 60fps 정도로 돌릴 수 있습니다."],
    parts: [
      { category: "cpu", label: "인텔 Core i5-14400F 벌크", alternatives: [["14400f", "벌크"], ["14400f"]] },
      { category: "cooler", label: "잘만 CNPS9X OPTIMA II RGB", alternatives: [["cnps9xoptimaii", "rgb"], ["cnps9xoptimaii"], ["paladin400"]], exclude: ["argb"] },
      { category: "motherboard", label: "GIGABYTE B760M DS3H D4", alternatives: [["b760mds3hd4"]], exclude: ["gen5"] },
      KLEVV_DDR4_8GB,
      gpuSpec("NVIDIA GeForce RTX 5050", "rtx5050"),
      PM9A1_1TB,
      N30_BLACK,
      CLASSIC2(500, "실버")
    ]
  },
  // ── 아래는 개발자 확정 전 임시 구성(provisional). 견본견적이 확정되면 교체한다. ──
  {
    id: "s4-fhd-value",
    order: 4,
    title: "FHD 가성비 게이밍 견적",
    gpuClass: "rtx5060ti",
    provisional: true,
    evaluation: ["FHD 대부분의 게임을 높은 옵션으로 즐길 수 있는 가성비 게이밍 견적입니다. QHD에서도 옵션을 조금 낮추면 쾌적합니다."],
    parts: [
      { category: "cpu", label: "AMD Ryzen 5 7500F", alternatives: [["7500f", "멀티팩"], ["7500f"]] },
      PALADIN_400,
      B650M,
      KLEVV_DDR5_16GB,
      gpuSpec("NVIDIA GeForce RTX 5060 Ti", "rtx5060ti"),
      PM9A1_1TB,
      N30_BLACK,
      CLASSIC2(600, "실버")
    ]
  },
  {
    id: "s4x-fhd-value-x3d",
    order: 4,
    title: "FHD 가성비 게이밍 견적 (X3D)",
    gpuClass: "rtx5060ti",
    x3dCpu: true,
    provisional: true,
    evaluation: ["배그·로스트아크 같은 CPU 부담이 큰 온라인 게임에 강한 7800X3D를 넣은 FHD 게이밍 견적입니다."],
    parts: [
      { category: "cpu", label: "AMD Ryzen 7 7800X3D", alternatives: [["7800x3d", "멀티팩"], ["7800x3d"]] },
      AK620,
      B650M,
      KLEVV_DDR5_16GB,
      gpuSpec("NVIDIA GeForce RTX 5060 Ti", "rtx5060ti"),
      PM9A1_1TB,
      N30_BLACK,
      CLASSIC2(700, "실버")
    ]
  },
  {
    id: "s5-qhd-value",
    order: 5,
    title: "QHD 가성비 게이밍 견적",
    gpuClass: "rtx5070",
    provisional: true,
    evaluation: ["FHD 고주사율과 QHD 높은 옵션을 함께 노릴 수 있는 견적입니다."],
    parts: [
      { category: "cpu", label: "AMD Ryzen 5 9600X", alternatives: [["9600x", "멀티팩"], ["9600x"]] },
      PALADIN_400,
      B650M,
      KLEVV_DDR5_16GB,
      gpuSpec("NVIDIA GeForce RTX 5070", "rtx5070", ["rtx5070ti"]),
      PM9A1_1TB,
      N30_BLACK,
      CLASSIC2(700, "실버")
    ]
  },
  {
    id: "s5x-qhd-value-x3d",
    order: 5,
    title: "QHD 가성비 게이밍 견적 (X3D)",
    gpuClass: "rtx5070",
    x3dCpu: true,
    provisional: true,
    evaluation: ["7800X3D와 RTX 5070 조합으로 온라인 게임 프레임 안정성과 QHD 그래픽을 함께 챙긴 견적입니다."],
    parts: [
      { category: "cpu", label: "AMD Ryzen 7 7800X3D", alternatives: [["7800x3d", "멀티팩"], ["7800x3d"]] },
      AK620,
      B650M,
      KLEVV_DDR5_16GB,
      gpuSpec("NVIDIA GeForce RTX 5070", "rtx5070", ["rtx5070ti"]),
      PM9A1_1TB,
      N30_BLACK,
      CLASSIC2(700, "실버")
    ]
  },
  {
    id: "s6-high",
    order: 6,
    title: "QHD 고성능 / 4K 입문 게이밍 견적",
    gpuClass: "rtx5070ti",
    x3dCpu: true,
    provisional: true,
    evaluation: ["QHD 최고 옵션과 4K 입문을 노리는 고성능 게이밍 견적입니다."],
    parts: [
      { category: "cpu", label: "AMD Ryzen 7 7800X3D", alternatives: [["7800x3d", "멀티팩"], ["7800x3d"]] },
      AK620,
      B850M,
      KLEVV_DDR5_16GB,
      gpuSpec("NVIDIA GeForce RTX 5070 Ti", "rtx5070ti"),
      PM9A1_1TB,
      N30_BLACK,
      CLASSIC2(800, "실버")
    ]
  },
  {
    id: "s7-enthusiast",
    order: 7,
    title: "QHD 최상급 / 4K 게이밍 견적",
    gpuClass: "rtx5080",
    x3dCpu: true,
    provisional: true,
    evaluation: ["QHD 고주사율과 4K 높은 옵션을 함께 노리는 상급 게이밍 견적입니다."],
    parts: [
      { category: "cpu", label: "AMD Ryzen 7 9800X3D", alternatives: [["9800x3d", "멀티팩"], ["9800x3d"]] },
      AK620,
      B850M,
      KLEVV_DDR5_16GB,
      gpuSpec("NVIDIA GeForce RTX 5080", "rtx5080"),
      PM9A1_1TB,
      { category: "case", label: "리안리 LANCOOL 216", alternatives: [["lancool216"], ["lancool"]] },
      CLASSIC2(900, "실버")
    ]
  },
  {
    id: "s8-flagship",
    order: 8,
    title: "4K 최상급 게이밍 견적",
    gpuClass: "rtx5090",
    x3dCpu: true,
    provisional: true,
    evaluation: ["4K 최고 옵션을 목표로 하는 최상급 게이밍 견적입니다."],
    parts: [
      { category: "cpu", label: "AMD Ryzen 7 9800X3D", alternatives: [["9800x3d", "멀티팩"], ["9800x3d"]] },
      { category: "cooler", label: "ARCTIC Liquid Freezer III PRO 360", alternatives: [["liquidfreezeriii", "360"], ["ak620"]] },
      { category: "motherboard", label: "X870 메인보드", alternatives: [["x870", "wifi"], ["x870"]], exclude: ["x870e"] },
      { category: "memory", label: "DDR5-6000 32GB", alternatives: [["ddr5-6000", "(32gb)"], ["ddr5-6000", "(16gb)"]], exclude: ["노트북", "so-dimm"], quantity: 2 },
      gpuSpec("NVIDIA GeForce RTX 5090", "rtx5090"),
      { category: "ssd", label: "삼성 990 PRO 2TB", alternatives: [["990pro", "(2tb)"], ["pm9a1", "(1tb)"]] },
      { category: "case", label: "리안리 LANCOOL 216", alternatives: [["lancool216"], ["lancool"]] },
      { category: "psu", label: "1200W 80PLUS 골드 ATX 3.1", alternatives: [["1200w", "골드", "atx3.1"], ["1000w", "골드", "atx3.1"], ["1000w", "골드"]] }
    ]
  }
];

/** 해상도별 예산 버튼(저예산/가성비/고성능)이 고르는 견본의 GPU 등급. */
export const GAMING_BUDGET_TIER_GPU: Record<GamingResolution, Record<SampleBudgetTier, SampleGpuClass>> = {
  "1080p": { low: "rtx5050", value: "rtx5060ti", high: "rtx5070" },
  "1440p": { low: "rtx5060ti", value: "rtx5070", high: "rtx5080" },
  "4k": { low: "rtx5070ti", value: "rtx5080", high: "rtx5090" }
};

export type SampleBudgetTier = "low" | "value" | "high";
export const SAMPLE_BUDGET_TIERS: readonly SampleBudgetTier[] = ["low", "value", "high"];
export const SAMPLE_BUDGET_TIER_LABELS: Record<SampleBudgetTier, string> = { low: "저예산", value: "가성비", high: "고성능" };

export const SAMPLE_GPU_CLASS_LABELS: Record<SampleGpuClass, string> = {
  igpu: "내장 그래픽",
  rx580: "RX 580",
  rtx5050: "RTX 5050",
  rtx5060ti: "RTX 5060 Ti",
  rtx5070: "RTX 5070",
  rtx5070ti: "RTX 5070 Ti",
  rtx5080: "RTX 5080",
  rtx5090: "RTX 5090"
};

export interface SamplePreference {
  /** 배그/로아/와우/아이온 같은 CPU 부담 큰 인기 온라인 게임 — 가능하면 X3D 견적. */
  preferX3d?: boolean;
}

export function sampleBuildById(id: string | undefined): SampleBuild | undefined {
  return id ? SAMPLE_BUILDS.find((sample) => sample.id === id) : undefined;
}

/** 같은 GPU 등급 안에서 선호(X3D 여부)에 맞는 견본. 선호에 맞는 견본이 없으면 다른 쪽을 쓴다. */
export function sampleForGpuClass(gpuClass: SampleGpuClass, preference: SamplePreference = {}): SampleBuild | undefined {
  const candidates = SAMPLE_BUILDS.filter((sample) => sample.gpuClass === gpuClass);
  if (candidates.length === 0) return undefined;
  const wantX3d = preference.preferX3d === true;
  return candidates.find((sample) => Boolean(sample.x3dCpu) === wantX3d)
    ?? (wantX3d ? candidates.find((sample) => sample.x3dCpu) : undefined)
    ?? candidates[0];
}

export function sampleForBudgetTier(resolution: GamingResolution, tier: SampleBudgetTier, preference: SamplePreference = {}): SampleBuild | undefined {
  return sampleForGpuClass(GAMING_BUDGET_TIER_GPU[resolution][tier], preference);
}

/**
 * 예산으로 고르는 견본 — 작업 용도처럼 예산을 직접 정한 흐름에서 쓴다. 기본 등급 사다리
 * 가운데 현재가가 예산 이하인 가장 높은 등급을 고르고, 예산 안에 드는 견본이 없으면 가장 저렴한 견본을 쓴다.
 */
export function resolvedSampleForBudget(samples: readonly ResolvedSampleBuild[], budgetWon: number): ResolvedSampleBuild | undefined {
  const ladderIds = new Set(sampleLadder().map((sample) => sample.id));
  const ladder = samples.filter((sample) => ladderIds.has(sample.id) && sample.totalPriceWon > 0).sort((a, b) => a.order - b.order);
  const withinBudget = ladder.filter((sample) => sample.totalPriceWon <= budgetWon);
  return withinBudget[withinBudget.length - 1] ?? ladder[0];
}

/** 사무용 — 가장 저렴한(등급 순서가 가장 낮은) 견본. */
export function cheapestSample(): SampleBuild {
  return [...SAMPLE_BUILDS].sort((a, b) => a.order - b.order)[0];
}

/** 등급 바꾸기 사다리 — 등급(order)마다 선호에 맞는 견본 하나. */
export function sampleLadder(preference: SamplePreference = {}): SampleBuild[] {
  const orders = [...new Set(SAMPLE_BUILDS.map((sample) => sample.order))].sort((a, b) => a - b);
  return orders.flatMap((order) => {
    const candidates = SAMPLE_BUILDS.filter((sample) => sample.order === order);
    const wantX3d = preference.preferX3d === true;
    const picked = candidates.find((sample) => Boolean(sample.x3dCpu) === wantX3d) ?? candidates[0];
    return picked ? [picked] : [];
  });
}

export interface SampleBuildsPayload {
  samples: ResolvedSampleBuild[];
  /** 견본 해석에 쓰인 부품 레코드(클라이언트 partMap에 바로 담는다). */
  parts: Part[];
  catalogUpdatedAt: string;
}

// ── 카탈로그 해석 ──────────────────────────────────────────────────────────

export interface ResolvedSampleLine {
  category: PartCategory;
  label: string;
  quantity: number;
  partId?: string;
  /** 첫 번째 후보가 아니라 대체 후보로 찾았는지. */
  substituted?: boolean;
}

export interface ResolvedSampleBuild {
  id: string;
  order: number;
  title: string;
  gpuClass: SampleGpuClass;
  x3dCpu: boolean;
  provisional: boolean;
  evaluation: string[];
  lines: ResolvedSampleLine[];
  selection: BuildSelection;
  totalPriceWon: number;
  priceComplete: boolean;
  /** 카탈로그에서 찾지 못한 부품 이름. */
  unresolved: string[];
}

function normalizedName(name: string) {
  return name.toLocaleLowerCase("ko-KR").replace(/\s+/g, "");
}

function isSellable(part: Part) {
  return part.source !== "seed" && part.dataQuality !== "seed" && isKnownPrice(part.priceWon) && !part.delistedAt && part.listingType !== "accessory" && part.listingType !== "used";
}

/** 인기순위(작을수록 인기) → 최저가. 인기순위가 없는 매물은 뒤로. */
export function comparePopularThenPrice(a: Part, b: Part) {
  const rankA = a.popularityRank ?? Number.POSITIVE_INFINITY;
  const rankB = b.popularityRank ?? Number.POSITIVE_INFINITY;
  if (rankA !== rankB) return rankA - rankB;
  return (a.priceWon ?? Number.POSITIVE_INFINITY) - (b.priceWon ?? Number.POSITIVE_INFINITY);
}

export function resolveSamplePart(spec: SampleBuildPartSpec, partsByCategory: ReadonlyMap<PartCategory, readonly Part[]>): { part?: Part; substituted: boolean } {
  const pool = (partsByCategory.get(spec.category) ?? []).filter(isSellable);
  const exclude = (spec.exclude ?? []).map(normalizedName);
  for (const [index, tokens] of spec.alternatives.entries()) {
    const wanted = tokens.map(normalizedName);
    const matches = pool.filter((part) => {
      const name = normalizedName(part.name);
      return wanted.every((token) => name.includes(token)) && !exclude.some((token) => name.includes(token));
    });
    if (matches.length > 0) return { part: [...matches].sort(comparePopularThenPrice)[0], substituted: index > 0 && !sameTokenFamily(spec.alternatives[0], tokens) };
  }
  return { substituted: false };
}

// 앞 후보에서 '벌크'/'멀티팩' 같은 유통 표기만 뺀 후보는 같은 제품이므로 대체로 보지 않는다.
const DISTRIBUTION_TOKENS = new Set(["벌크", "멀티팩", "정품"]);
function sameTokenFamily(primary: readonly string[], fallback: readonly string[]) {
  const core = (tokens: readonly string[]) => tokens.filter((token) => !DISTRIBUTION_TOKENS.has(token));
  const primaryCore = core(primary);
  const fallbackCore = core(fallback);
  return fallbackCore.every((token) => primaryCore.includes(token)) && fallbackCore.length >= Math.max(1, primaryCore.length - 1);
}

export function resolveSampleBuild(sample: SampleBuild, catalog: readonly Part[]): { resolved: ResolvedSampleBuild; parts: Part[] } {
  const partsByCategory = new Map<PartCategory, Part[]>();
  for (const part of catalog) {
    const list = partsByCategory.get(part.category);
    if (list) list.push(part);
    else partsByCategory.set(part.category, [part]);
  }
  return resolveSampleBuildFromIndex(sample, partsByCategory);
}

export function resolveSampleBuildFromIndex(sample: SampleBuild, partsByCategory: ReadonlyMap<PartCategory, readonly Part[]>): { resolved: ResolvedSampleBuild; parts: Part[] } {
  const selection: BuildSelection = { memory: [], ssd: [], hdd: [], useIntegratedGraphics: sample.gpuClass === "igpu" };
  const lines: ResolvedSampleLine[] = [];
  const parts: Part[] = [];
  const unresolved: string[] = [];
  let totalPriceWon = 0;
  let priceComplete = true;
  for (const spec of sample.parts) {
    const quantity = spec.quantity ?? 1;
    const { part, substituted } = resolveSamplePart(spec, partsByCategory);
    lines.push({ category: spec.category, label: spec.label, quantity, ...(part ? { partId: part.id } : {}), ...(substituted ? { substituted: true } : {}) });
    if (!part) {
      unresolved.push(spec.label);
      priceComplete = false;
      continue;
    }
    parts.push(part);
    if (isKnownPrice(part.priceWon)) totalPriceWon += part.priceWon * quantity;
    else priceComplete = false;
    const entry: PartSelection = { partId: part.id, quantity };
    if (spec.category === "memory" || spec.category === "ssd" || spec.category === "hdd") selection[spec.category].push(entry);
    else (selection as unknown as Record<string, PartSelection>)[spec.category] = entry;
  }
  return {
    resolved: {
      id: sample.id,
      order: sample.order,
      title: sample.title,
      gpuClass: sample.gpuClass,
      x3dCpu: sample.x3dCpu === true,
      provisional: sample.provisional === true,
      evaluation: sample.evaluation,
      lines,
      selection,
      totalPriceWon,
      priceComplete,
      unresolved
    },
    parts
  };
}
