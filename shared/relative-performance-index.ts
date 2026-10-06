import type { Part, PartCategory } from "./types";

/**
 * 상대 성능 지수 — 영상에서 직접 확인한 값과 기존 모델 추정을 구분한다.
 *
 * - RTX 50 GPU 게임 지수: 사장님이 지정한 영상의 QHD 평균 게임 성능 표.
 *   RTX 5060 Ti 16GB = 100. 8GB 모델은 QHD에서 97.4로 구분한다.
 * - 나머지 GPU/내장 그래픽은 기존 추정값이며 해당 영상에서 검증하지 않았다.
 * - CPU 지수: Cinebench R23 계열 공개 값을 싱글/멀티로 나눠 기록한다.
 *   specs에 실측 cinebenchR23 값이 있으면 그것을 우선 사용한다.
 *
 * 값이 바뀌거나 패턴이 추가되면 RELATIVE_PERFORMANCE_INDEX_VERSION을 올린다.
 */
export const RELATIVE_PERFORMANCE_INDEX_VERSION = "relative-index-v3-video-qhd-amd-2026-10-05";

export const GPU_VIDEO_PERFORMANCE_SOURCE = {
  kind: "video_table" as const,
  url: "https://youtu.be/iVL3KqqzlhM?t=500",
  referenceModel: "RTX 5060 Ti 16GB",
  referencePercent: 100,
  resolution: "QHD" as const,
  reviewedAt: "2026-10-04",
  screenshotPath: "artifacts/phase1-evidence/gpu-video-500s.png",
  screenshotPaths: ["artifacts/phase1-evidence/gpu-video-251s.png", "artifacts/phase1-evidence/gpu-video-500s.png", "artifacts/phase1-evidence/gpu-video-725s.png"]
};

export const GPU_VIDEO_PERFORMANCE_ROWS = [
  { model: "RTX 5090", fhd: 223.0, qhd: 265.5, uhd: 315.2 },
  { model: "RTX 5080", fhd: 174.5, qhd: 191.7, uhd: 208.2 },
  { model: "RTX 5070 Ti", fhd: 159.4, qhd: 171.1, uhd: 179.9 },
  { model: "RTX 5070", fhd: 135.2, qhd: 139.3, uhd: 143.0 },
  { model: "RTX 5060 Ti 16GB", fhd: 100.0, qhd: 100.0, uhd: 100.0 },
  { model: "RTX 5060 Ti 8GB", fhd: 100.0, qhd: 97.4, uhd: 88.5 },
  { model: "RTX 5060", fhd: 87.4, qhd: 84.3, uhd: 76.0 },
  { model: "RTX 5050", fhd: 68.5, qhd: 71.1, uhd: 64.3 },
  { model: "RTX 3050 6GB", fhd: 35.0, qhd: 34.4, uhd: 31.3 },
  { model: "RX 580 2048SP", fhd: 28.2, qhd: 27.7, uhd: 24.3 },
  { model: "RX 9070 XT", fhd: 152.2, qhd: 161.3, uhd: 168.6 },
  { model: "RX 9070", fhd: 140.9, qhd: 146.9, uhd: 151.8 },
  { model: "RX 9060 XT 16GB", fhd: 92.0, qhd: 94.7, uhd: 88.6 },
  { model: "RX 9060 XT 8GB", fhd: 87.6, qhd: 89.8, uhd: 81.3 },
  { model: "RX 9060", fhd: 78.9, qhd: 80.5, uhd: 71.5 }
] as const;

export const CPU_VIDEO_PERFORMANCE_SOURCE = {
  kind: "video_table" as const,
  url: "https://youtu.be/6NoegO2rlkE?t=180",
  benchmark: "Cinebench R23",
  referenceLabel: "싱글코어: Core i5-13600K = 100%, 멀티코어: Core i5-14600K = 100%",
  singleReferenceModel: "Core i5-13600K",
  multiReferenceModel: "Core i5-14600K",
  reviewedAt: "2026-10-04",
  screenshotPaths: ["artifacts/phase1-evidence/cpu-video-181s.png", "artifacts/phase1-evidence/cpu-video-851s.png", "artifacts/phase1-evidence/cpu-video-839s.png"]
};

/** Percentages transcribed from the supplied video, not inferred R23 scores. */
export const CPU_VIDEO_PERFORMANCE_ROWS = [
  { model: "9950X3D2", single: 115.8, multi: 179.3 },
  { model: "9850X3D", single: 115.6, multi: 95.0 },
  { model: "9800X3D", single: 107.1, multi: 94.4 },
  { model: "9950X3D", single: 116.2, multi: 173.0 },
  { model: "9900X3D", single: 111.9, multi: 132.6 },
  { model: "7800X3D", single: 91.8, multi: 74.9 },
  { model: "7700X3D", single: 88.4, multi: 71.9 },
  { model: "7950X3D", single: 99.1, multi: 148.8 },
  { model: "7900X3D", single: 97.5, multi: 114.1 },
  { model: "7500X3D", single: 80.8, multi: 53.7 },
  { model: "7950X", single: 101.7, multi: 160.0 },
  { model: "7900X", single: 100.5, multi: 119.5 },
  { model: "7700X", single: 97.3, multi: 82.6 },
  { model: "7900", single: 97.4, multi: 104.3 },
  { model: "7700", single: 93.9, multi: 77.5 },
  { model: "7600X", single: 97.4, multi: 63.6 },
  { model: "7600", single: 92.4, multi: 60.0 },
  { model: "5700X3D", single: 66.4, multi: 57.0 },
  { model: "9500F", single: 99.9, multi: 64.8 },
  { model: "9700X", single: 109.7, multi: 92.7 },
  { model: "9950X", single: 112.6, multi: 175.2 },
  { model: "9900X", single: 110.8, multi: 138.4 },
  { model: "9600X", single: 107.9, multi: 70.1 },
  { model: "9600", single: 103.9, multi: 67.4 },
  { model: "5600", single: 75.2, multi: 45.8 },
  { model: "5500GT", single: 73.4, multi: 45.7 },
  { model: "5600GT", single: 77.7, multi: 46.7 },
  { model: "5600G", single: 74.1, multi: 46.2 },
  { model: "5700G", single: 78.4, multi: 62.2 },
  { model: "5800X3D", single: 73.5, multi: 60.7 },
  { model: "5500", single: 70.6, multi: 45.2 },
  { model: "5300G", single: 72.4, multi: 32.1 }
] as const;

export function cpuVideoPerformanceRowFor(part: Pick<Part, "name" | "model" | "category">) {
  if (part.category !== "cpu") return undefined;
  const text = `${part.model ?? ""} ${part.name}`;
  // Complete model boundaries distinguish 9950X3D2, 9950X3D, 9950X and 9950.
  return CPU_VIDEO_PERFORMANCE_ROWS.find((row) => new RegExp(`\\b${row.model}\\b`, "i").test(text));
}

type GpuPerformancePart = Pick<Part, "name" | "model" | "category"> & { specs?: Pick<Part["specs"], "vramGb"> };

export function gpuVideoPerformanceRowFor(part: GpuPerformancePart) {
  if (part.category !== "gpu") return undefined;
  const text = `${part.model ?? ""} ${part.name}`;
  if (/RX\s*90\d{2}\s*(?:GRE|XTX)\b/i.test(text)) return undefined;
  const radeon = text.match(/\bRX\s*(90\d{2})(?:\s*(XT))?\b/i);
  if (radeon) {
    const vram = part.specs?.vramGb ?? Number(text.match(/\b(8|16)\s*GB\b/i)?.[1]);
    const model = `RX ${radeon[1]}${radeon[2] ? " XT" : ""}${radeon[1] === "9060" && radeon[2] ? ` ${vram}GB` : ""}`;
    return GPU_VIDEO_PERFORMANCE_ROWS.find((row) => row.model === model);
  }
  if (/RTX\s*3050\b/i.test(text) && (part.specs?.vramGb === 6 || /\b6\s*GB\b/i.test(text))) return GPU_VIDEO_PERFORMANCE_ROWS[8];
  if (/RX\s*580\s*2048\s*SP\b/i.test(text)) return GPU_VIDEO_PERFORMANCE_ROWS[9];
  const match = /RTX\s*(5090|5080|5070\s*Ti|5070|5060\s*Ti|5060|5050)\b/i.exec(text);
  if (!match) return undefined;
  const model = match[1].replace(/\s*/g, "").toUpperCase();
  if (model === "5060TI") {
    const vram = part.specs?.vramGb ?? (/\b8\s*GB\b/i.test(text) ? 8 : /\b16\s*GB\b/i.test(text) ? 16 : undefined);
    if (vram === 8) return GPU_VIDEO_PERFORMANCE_ROWS[5];
    if (vram === 16) return GPU_VIDEO_PERFORMANCE_ROWS[4];
    return undefined;
  }
  return GPU_VIDEO_PERFORMANCE_ROWS.find((row) => row.model.replace(/RTX|\s/g, "").toUpperCase() === model);
}

// 표기 순서가 곧 우선순위다 — Ti/Super/XT 같은 파생형이 앞에 와야
// "RTX 5060 Ti"가 5060 규칙에 먹히지 않는다.
const GPU_GAMING_RULES: readonly { pattern: RegExp; index: number }[] = [
  // RTX 50 values are read from the verified QHD video table above.
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
export function gpuGamingIndexFor(part: GpuPerformancePart): number | undefined {
  if (part.category !== "gpu") return undefined;
  const verified = gpuVideoPerformanceRowFor(part);
  if (verified) return verified.qhd;
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
  { pattern: /9600\b/i, single: 2050, multi: 15500 },
  { pattern: /9500F\b/i, single: 1950, multi: 15000 },
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

/** Fallback estimates use the model-table 13600K single score as 100%. */
export const CPU_SINGLE_REFERENCE = 2000;
/** Fallback estimates use the model-table 14600K multi score as 100%. */
export const CPU_MULTI_REFERENCE = 25000;

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
  if (single >= 1750 && cores >= 6) return "high";
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
  /** 싱글코어 % (13600K = 100); 영상 직접 수치와 모델 추정을 구분한다. */
  singleCorePercent?: number;
  /** 멀티코어 % (14600K = 100); 영상 직접 수치와 모델 추정을 구분한다. */
  multiCorePercent?: number;
  modelVersion: typeof RELATIVE_PERFORMANCE_INDEX_VERSION;
  gamingSource?: string;
  gamingEvidenceKind?: "video_table" | "model_estimate";
  cpuSource?: string;
  cpuEvidenceKind?: "video_table" | "model_estimate";
}

/** 선택된 부품들로 표시용 상대 성능 보고서를 만든다. 측정값이 아닌 추정치다. */
export function buildPerformanceReportFor(parts: Partial<Record<PartCategory, Part | undefined>>): BuildPerformanceReport {
  const cpu = parts.cpu;
  const gpu = parts.gpu;
  const cpuIndex = cpu ? cpuRelativeIndexFor(cpu) : undefined;
  const cpuVideo = cpu ? cpuVideoPerformanceRowFor(cpu) : undefined;
  return {
    modelVersion: RELATIVE_PERFORMANCE_INDEX_VERSION,
    gamingSource: gpu && gpuVideoPerformanceRowFor(gpu) ? GPU_VIDEO_PERFORMANCE_SOURCE.url : undefined,
    gamingEvidenceKind: gpu && gpuVideoPerformanceRowFor(gpu) ? "video_table" : gpu ? gpuGamingIndexFor(gpu) === undefined ? undefined : "model_estimate" : cpu ? "model_estimate" : undefined,
    cpuSource: cpuVideo ? CPU_VIDEO_PERFORMANCE_SOURCE.url : undefined,
    cpuEvidenceKind: cpuVideo ? "video_table" : cpuIndex ? "model_estimate" : undefined,
    gamingIndex: gpu ? gpuGamingIndexFor(gpu) : cpu ? integratedGpuIndexFor(cpu) : undefined,
    frameStability: cpu ? frameStabilityLevelFor(cpu) : undefined,
    singleCorePercent: cpuVideo?.single ?? (cpuIndex ? Math.round((cpuIndex.single / CPU_SINGLE_REFERENCE) * 100) : undefined),
    multiCorePercent: cpuVideo?.multi ?? (cpuIndex ? Math.round((cpuIndex.multi / CPU_MULTI_REFERENCE) * 100) : undefined)
  };
}
