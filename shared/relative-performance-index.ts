import type { Part, PartCategory } from "./types";

/**
 * 상대 성능 지수(v1) — 외부 벤치마크가 없는 카탈로그 부품의 게임/CPU 성능을
 * 모델명 기준으로 추정한다.
 *
 * - GPU 게임 지수: RTX 5060 Ti 16GB = 100. 레스터라이제이션 평균 기준의
 *   공개 상대 성능표(TechPowerUp relative performance 등)를 5060 Ti에 맞춰
 *   재정규화한 값이다. 제품 간 실제 체감은 해상도·게임에 따라 다르다.
 * - CPU 지수: Cinebench R23 계열 공개 값을 싱글/멀티로 나눠 기록한다.
 *   specs에 실측 cinebenchR23 값이 있으면 그것을 우선 사용한다.
 *
 * 값이 바뀌거나 패턴이 추가되면 RELATIVE_PERFORMANCE_INDEX_VERSION을 올린다.
 */
export const RELATIVE_PERFORMANCE_INDEX_VERSION = "relative-index-v1";

// 표기 순서가 곧 우선순위다 — Ti/Super/XT 같은 파생형이 앞에 와야
// "RTX 5060 Ti"가 5060 규칙에 먹히지 않는다.
const GPU_GAMING_RULES: readonly { pattern: RegExp; index: number }[] = [
  // RTX 50
  { pattern: /RTX\s*5090\b/i, index: 250 },
  { pattern: /RTX\s*5080\b/i, index: 178 },
  { pattern: /RTX\s*5070\s*Ti\b/i, index: 156 },
  { pattern: /RTX\s*5070\b/i, index: 128 },
  { pattern: /RTX\s*5060\s*Ti\b/i, index: 100 },
  { pattern: /RTX\s*5060\b/i, index: 78 },
  { pattern: /RTX\s*5050\b/i, index: 57 },
  // RTX 40
  { pattern: /RTX\s*4090\b/i, index: 218 },
  { pattern: /RTX\s*4080\s*(?:S|SUPER|슈퍼)\b/i, index: 172 },
  { pattern: /RTX\s*4080\b/i, index: 168 },
  { pattern: /RTX\s*4070\s*Ti\s*S\b/i, index: 150 },
  { pattern: /RTX\s*4070\s*Ti\b/i, index: 135 },
  { pattern: /RTX\s*4070\s*(?:S|SUPER|슈퍼)\b/i, index: 128 },
  { pattern: /RTX\s*4070\b/i, index: 106 },
  { pattern: /RTX\s*4060\s*Ti\b/i, index: 87 },
  { pattern: /RTX\s*4060\b/i, index: 72 },
  // RTX 30
  { pattern: /RTX\s*3090\s*Ti\b/i, index: 150 },
  { pattern: /RTX\s*3090\b/i, index: 140 },
  { pattern: /RTX\s*3080\s*Ti\b/i, index: 135 },
  { pattern: /RTX\s*3080\b/i, index: 122 },
  { pattern: /RTX\s*3070\s*Ti\b/i, index: 100 },
  { pattern: /RTX\s*3070\b/i, index: 95 },
  { pattern: /RTX\s*3060\s*Ti\b/i, index: 85 },
  { pattern: /RTX\s*3060\b/i, index: 68 },
  { pattern: /RTX\s*3050\b/i, index: 42 },
  // RTX 20 / GTX 16·10
  { pattern: /RTX\s*2080\s*Ti\b/i, index: 100 },
  { pattern: /RTX\s*2080\s*(?:S|SUPER|슈퍼)\b/i, index: 88 },
  { pattern: /RTX\s*2080\b/i, index: 82 },
  { pattern: /RTX\s*2070\s*(?:S|SUPER|슈퍼)\b/i, index: 75 },
  { pattern: /RTX\s*2070\b/i, index: 70 },
  { pattern: /RTX\s*2060\s*(?:S|SUPER|슈퍼)\b/i, index: 63 },
  { pattern: /RTX\s*2060\b/i, index: 57 },
  { pattern: /GTX\s*1080\s*Ti\b/i, index: 68 },
  { pattern: /GTX\s*1080\b/i, index: 55 },
  { pattern: /GTX\s*1070\s*Ti\b/i, index: 48 },
  { pattern: /GTX\s*1070\b/i, index: 45 },
  { pattern: /GTX\s*1660\s*(?:S|SUPER|슈퍼)\b/i, index: 48 },
  { pattern: /GTX\s*1660\s*Ti\b/i, index: 47 },
  { pattern: /GTX\s*1660\b/i, index: 40 },
  { pattern: /GTX\s*1650\s*(?:S|SUPER|슈퍼)\b/i, index: 28 },
  { pattern: /GTX\s*1650\b/i, index: 25 },
  { pattern: /GTX\s*1060\b/i, index: 35 },
  { pattern: /GTX\s*1050\b/i, index: 18 },
  { pattern: /GT\s*1030\b/i, index: 8 },
  // RX 9000
  { pattern: /RX\s*9070\s*XT\b/i, index: 170 },
  { pattern: /RX\s*9070\b/i, index: 145 },
  { pattern: /RX\s*9060\s*XT\b/i, index: 95 },
  // RX 7000
  { pattern: /RX\s*7900\s*XTX\b/i, index: 175 },
  { pattern: /RX\s*7900\s*XT\b/i, index: 155 },
  { pattern: /RX\s*7900\s*GRE\b/i, index: 128 },
  { pattern: /RX\s*7800\s*XT\b/i, index: 112 },
  { pattern: /RX\s*7700\s*XT\b/i, index: 95 },
  { pattern: /RX\s*7600\b/i, index: 65 },
  // RX 6000
  { pattern: /RX\s*6950\s*XT\b/i, index: 118 },
  { pattern: /RX\s*6900\s*XT\b/i, index: 110 },
  { pattern: /RX\s*6800\s*XT\b/i, index: 108 },
  { pattern: /RX\s*6800\b/i, index: 100 },
  { pattern: /RX\s*6750\s*(?:XT|GRE)\b/i, index: 80 },
  { pattern: /RX\s*6700\s*XT\b/i, index: 78 },
  { pattern: /RX\s*6700\b/i, index: 68 },
  { pattern: /RX\s*6650\s*XT\b/i, index: 62 },
  { pattern: /RX\s*6600\s*XT\b/i, index: 62 },
  { pattern: /RX\s*6600\b/i, index: 55 },
  { pattern: /RX\s*6500\s*XT\b/i, index: 32 },
  { pattern: /RX\s*6400\b/i, index: 22 },
  // RX 500
  { pattern: /RX\s*580\b/i, index: 30 },
  { pattern: /RX\s*570\b/i, index: 25 },
  { pattern: /RX\s*5500\s*XT\b/i, index: 35 },
  { pattern: /RX\s*550\b/i, index: 10 },
  // Intel Arc
  { pattern: /ARC\s*B580\b/i, index: 82 },
  { pattern: /ARC\s*B570\b/i, index: 72 },
  { pattern: /ARC\s*A770\b/i, index: 62 },
  { pattern: /ARC\s*A750\b/i, index: 55 },
  { pattern: /ARC\s*A580\b/i, index: 48 },
  { pattern: /ARC\s*A380\b/i, index: 25 },
  { pattern: /ARC\s*A310\b/i, index: 20 }
];

/**
 * GPU의 상대 게임 성능 지수(RTX 5060 Ti = 100). 카탈로그 이름에서 모델을 찾아
 * 돌려준다. 알 수 없는 모델이면 undefined.
 */
export function gpuGamingIndexFor(part: Pick<Part, "name" | "model" | "category">): number | undefined {
  if (part.category !== "gpu") return undefined;
  const text = `${part.model ?? ""} ${part.name}`;
  for (const rule of GPU_GAMING_RULES) {
    if (rule.pattern.test(text)) return rule.index;
  }
  return undefined;
}

/** 내장 그래픽(Vega/RDNA iGPU) 견적용 고정 지수 — 사무·케주얼 게임 수준. */
export const INTEGRATED_GPU_GAMING_INDEX = 12;

// CPU 지수는 Cinebench R23급 공개 값. {single, multi}.
const CPU_INDEX_RULES: readonly { pattern: RegExp; single: number; multi: number }[] = [
  // AMD Zen5 (9000)
  { pattern: /9950X3D/i, single: 2220, multi: 42000 },
  { pattern: /9950X\b/i, single: 2280, multi: 43000 },
  { pattern: /9900X3D/i, single: 2200, multi: 33000 },
  { pattern: /9900X\b/i, single: 2250, multi: 34000 },
  { pattern: /9800X3D/i, single: 2150, multi: 23500 },
  { pattern: /9700X\b/i, single: 2200, multi: 23000 },
  { pattern: /9600X\b/i, single: 2160, multi: 17500 },
  // AMD Zen4 (7000/8000)
  { pattern: /7950X3D/i, single: 2050, multi: 36000 },
  { pattern: /7950X\b/i, single: 2050, multi: 38000 },
  { pattern: /7900X3D/i, single: 2000, multi: 28000 },
  { pattern: /7900X\b/i, single: 2000, multi: 30000 },
  { pattern: /7900\b/i, single: 1950, multi: 27000 },
  { pattern: /7800X3D/i, single: 1820, multi: 18000 },
  { pattern: /7700X\b/i, single: 1980, multi: 19800 },
  { pattern: /7700\b/i, single: 1950, multi: 18500 },
  { pattern: /7600X\b/i, single: 1950, multi: 15000 },
  { pattern: /7600\b/i, single: 1900, multi: 14000 },
  { pattern: /7500F\b/i, single: 1820, multi: 14000 },
  { pattern: /7400F\b/i, single: 1780, multi: 13000 },
  { pattern: /8700G\b/i, single: 1980, multi: 18500 },
  { pattern: /8600G\b/i, single: 1950, multi: 15000 },
  { pattern: /8500G\b/i, single: 1900, multi: 13000 },
  { pattern: /8300G\b/i, single: 1850, multi: 8000 },
  // AMD Zen3 (5000)
  { pattern: /5950X\b/i, single: 1600, multi: 26000 },
  { pattern: /5900X\b/i, single: 1600, multi: 20500 },
  { pattern: /5900\b/i, single: 1580, multi: 19500 },
  { pattern: /5800X3D/i, single: 1480, multi: 14500 },
  { pattern: /5800X\b/i, single: 1600, multi: 15500 },
  { pattern: /5800\b/i, single: 1580, multi: 14500 },
  { pattern: /5700X3D/i, single: 1450, multi: 14000 },
  { pattern: /5700X\b/i, single: 1500, multi: 14000 },
  { pattern: /5700\b/i, single: 1500, multi: 14000 },
  { pattern: /5700G\b/i, single: 1500, multi: 14000 },
  { pattern: /5600X3D/i, single: 1420, multi: 11500 },
  { pattern: /5600X\b/i, single: 1550, multi: 11800 },
  { pattern: /5600GT\b/i, single: 1450, multi: 10500 },
  { pattern: /5600G\b/i, single: 1480, multi: 10500 },
  { pattern: /5600\b/i, single: 1500, multi: 11000 },
  { pattern: /5500GT\b/i, single: 1400, multi: 9800 },
  { pattern: /5500\b/i, single: 1350, multi: 9800 },
  { pattern: /4500\b/i, single: 1300, multi: 7000 },
  // Intel 13/14세대
  { pattern: /14900K/i, single: 2200, multi: 39500 },
  { pattern: /14700K/i, single: 2150, multi: 35000 },
  { pattern: /14600K/i, single: 2050, multi: 25000 },
  { pattern: /14500\b/i, single: 1950, multi: 18500 },
  { pattern: /14400F\b/i, single: 1850, multi: 16500 },
  { pattern: /14400\b/i, single: 1850, multi: 16500 },
  { pattern: /13900K/i, single: 2180, multi: 39000 },
  { pattern: /13700K/i, single: 2100, multi: 32000 },
  { pattern: /13600K/i, single: 2000, multi: 24000 },
  { pattern: /13500\b/i, single: 1900, multi: 21000 },
  { pattern: /13400F\b/i, single: 1800, multi: 16000 },
  { pattern: /13400\b/i, single: 1800, multi: 16000 },
  // Intel 12세대
  { pattern: /12900K/i, single: 2000, multi: 27000 },
  { pattern: /12700K/i, single: 1950, multi: 23000 },
  { pattern: /12700F?\b/i, single: 1900, multi: 22000 },
  { pattern: /12600K/i, single: 1900, multi: 17500 },
  { pattern: /12500\b/i, single: 1850, multi: 13000 },
  { pattern: /12400F\b/i, single: 1750, multi: 12300 },
  { pattern: /12400\b/i, single: 1750, multi: 12300 },
  { pattern: /12100F\b/i, single: 1650, multi: 8500 },
  { pattern: /12100\b/i, single: 1650, multi: 8500 },
  // Intel Core Ultra
  { pattern: /Ultra\s*9\s*285/i, single: 2300, multi: 45000 },
  { pattern: /Ultra\s*7\s*265/i, single: 2250, multi: 35000 },
  { pattern: /Ultra\s*5\s*245/i, single: 2200, multi: 25000 },
  { pattern: /Ultra\s*5\s*225/i, single: 2100, multi: 19000 }
];

/**
 * CPU의 싱글/멀티 코어 상대 지수(R23급 기준값).
 * 실측 specs.cinebenchR23*가 있으면 우선, 없으면 모델 표를 찾고, 둘 다 없으면
 * 클럭·코어 스펙으로 추정한다.
 */
export function cpuRelativeIndexFor(part: Pick<Part, "name" | "model" | "category" | "specs">): { single: number; multi: number } | undefined {
  if (part.category !== "cpu") return undefined;
  const measuredSingle = part.specs.cinebenchR23Single;
  const measuredMulti = part.specs.cinebenchR23Multi;
  const text = `${part.model ?? ""} ${part.name}`;
  const table = CPU_INDEX_RULES.find((rule) => rule.pattern.test(text));
  const single = measuredSingle ?? table?.single ?? estimatedSingleIndex(part);
  const multi = measuredMulti ?? table?.multi ?? estimatedMultiIndex(part);
  if (single === undefined || multi === undefined) return undefined;
  return { single, multi };
}

function estimatedSingleIndex(part: Pick<Part, "specs" | "name">): number | undefined {
  const boost = part.specs.boostClockGhz;
  if (boost === undefined || boost <= 0) return undefined;
  // 세대를 알 수 없으면 클럭 기반 보수 추정(Zen4급 IPC 기준).
  const generational = /라이젠.*6세대|그래니트/i.test(part.name) ? 400
    : /라이젠.*5세대|라파엘|코어\s*울트라|Ultra/i.test(part.name) ? 390
      : /라이젠.*4세대|버미어|세잔/i.test(part.name) ? 340
        : /1[2-4]세대|엘더|랩터|LGA1700/i.test(part.name) ? 370
          : 360;
  return Math.round(boost * generational);
}

function estimatedMultiIndex(part: Pick<Part, "specs" | "name" | "model" | "category">): number | undefined {
  const cores = part.specs.cores;
  const single = estimatedSingleIndex(part);
  if (cores === undefined || cores <= 0 || single === undefined) return undefined;
  const threads = part.specs.threads ?? cores;
  // SMT 효율 ~30%, 올코어 하락 ~10% 감안.
  return Math.round(single * cores * (1 + Math.max(0, threads - cores) / cores * 0.3) * 0.88);
}

/** 싱글코어 지수가 몇 %인지(최상급 데스크탑 = 100). */
export const CPU_SINGLE_REFERENCE = 2300;
/** 멀티코어 지수가 몇 %인지(플래그십 24코어급 = 100). */
export const CPU_MULTI_REFERENCE = 45000;

export type FrameStabilityLevel = "low" | "medium" | "high" | "very_high";

export const FRAME_STABILITY_LABELS: Record<FrameStabilityLevel, string> = {
  low: "낮음",
  medium: "중간",
  high: "높음",
  very_high: "매우 높음"
};

/**
 * 프레임 안정성(1% low 체감) 등급 — CPU 싱글코어 지수와 X3D급 캐시 여부로
 * 판정한다. 대용량 L3 캐시는 프레임 하한선을 끌어올리는 가장 강한 요인이다.
 */
export function frameStabilityLevelFor(cpu: Pick<Part, "name" | "model" | "category" | "specs"> | undefined): FrameStabilityLevel | undefined {
  if (!cpu) return undefined;
  const index = cpuRelativeIndexFor(cpu);
  const single = index?.single;
  const cores = cpu.specs.cores ?? 0;
  const cacheMb = cpu.specs.l3CacheMb ?? 0;
  if (single === undefined) return undefined;
  if (/X3D/i.test(`${cpu.model ?? ""} ${cpu.name}`) || cacheMb >= 64) return "very_high";
  if (single >= 1900 && cores >= 6) return "high";
  if (single >= 1450 && cores >= 6) return "medium";
  if (single >= 1200 && cores >= 4) return "medium";
  return "low";
}

/** CPU가 외장 GPU 없는 내장 그래픽 견적에서 게임을 어느 정도 소화하는지. */
export function integratedGpuIndexFor(cpu: Pick<Part, "name" | "model" | "specs"> | undefined): number {
  if (!cpu) return INTEGRATED_GPU_GAMING_INDEX;
  const text = `${cpu.model ?? ""} ${cpu.name}`;
  if (/8700G|8600G|8500G|8300G|5600GT|5500GT|5600G|5700G|4600G/i.test(text)) return INTEGRATED_GPU_GAMING_INDEX + 6;
  return INTEGRATED_GPU_GAMING_INDEX;
}

export interface BuildPerformanceReport {
  /** 외장 GPU 상대 게임 지수(RTX 5060 Ti = 100) 또는 내장 그래픽 지수. */
  gamingIndex?: number;
  frameStability?: FrameStabilityLevel;
  /** 싱글코어 % (2300급 최상급 = 100). */
  singleCorePercent?: number;
  /** 멀티코어 % (45000급 플래그십 = 100). */
  multiCorePercent?: number;
  modelVersion: typeof RELATIVE_PERFORMANCE_INDEX_VERSION;
}

/** 선택된 부품들로 표시용 상대 성능 보고서를 만든다. 측정값이 아닌 추정치다. */
export function buildPerformanceReportFor(parts: Partial<Record<PartCategory, Part | undefined>>): BuildPerformanceReport {
  const cpu = parts.cpu;
  const gpu = parts.gpu;
  const cpuIndex = cpu ? cpuRelativeIndexFor(cpu) : undefined;
  return {
    modelVersion: RELATIVE_PERFORMANCE_INDEX_VERSION,
    gamingIndex: gpu ? gpuGamingIndexFor(gpu) : cpu ? integratedGpuIndexFor(cpu) : undefined,
    frameStability: cpu ? frameStabilityLevelFor(cpu) : undefined,
    singleCorePercent: cpuIndex ? Math.round((cpuIndex.single / CPU_SINGLE_REFERENCE) * 100) : undefined,
    multiCorePercent: cpuIndex ? Math.round((cpuIndex.multi / CPU_MULTI_REFERENCE) * 100) : undefined
  };
}
