import type { SimilarityBasis, SimilarityEvidence } from "./types";

const CPU_BENCHMARK_KEYS = new Set(["cinebenchR23Single", "cinebenchR23Multi"]);
const GPU_BENCHMARK_KEYS = new Set(["gpu3dmarkTimeSpyScore", "gpu3dmarkPortRoyalScore"]);
const BENCHMARK_KEYS = new Set([...CPU_BENCHMARK_KEYS, ...GPU_BENCHMARK_KEYS]);

export type SimilarityReferenceCategory = "cpu" | "gpu";

/**
 * Returns the component family represented by a similarity evidence payload.
 * The structured reference is authoritative; the dimension/legacy note fallback
 * keeps old snapshots readable after the evidence contract changed.
 */
export function similarityReferenceCategoryFor(evidence: SimilarityEvidence | undefined): SimilarityReferenceCategory | undefined {
  if (!evidence) return undefined;
  if (evidence.reference?.category === "cpu" || evidence.reference?.category === "gpu") return evidence.reference.category;
  const dimensions = evidence.dimensions ?? [];
  if (dimensions.some((dimension) => GPU_BENCHMARK_KEYS.has(dimension.key))) return "gpu";
  if (dimensions.some((dimension) => CPU_BENCHMARK_KEYS.has(dimension.key))) return "cpu";
  if (evidence.notes?.some((note) => note.includes("동일 GPU 모델 계열"))) return "gpu";
  if (evidence.notes?.some((note) => note.includes("동일 CPU 모델 계열"))) return "cpu";
  return undefined;
}

/**
 * Returns a category only when a model-family reference was actually used.
 * Benchmark dimensions alone identify the comparison family, not reference transfer.
 */
export function similarityReferenceUsedCategoryFor(evidence: SimilarityEvidence | undefined): SimilarityReferenceCategory | undefined {
  if (!evidence) return undefined;
  if (evidence.reference?.category === "cpu" || evidence.reference?.category === "gpu") return evidence.reference.category;
  if (evidence.notes?.some((note) => note.includes("동일 GPU 모델 계열"))) return "gpu";
  if (evidence.notes?.some((note) => note.includes("동일 CPU 모델 계열"))) return "cpu";
  return undefined;
}

export function similarityBasisLabelFor(evidence: SimilarityEvidence | undefined) {
  if (!evidence) return "비교 정보 확인 필요";
  const dimensions = evidence.dimensions ?? [];
  const basis = evidence.basis ?? similarityBasisForDimensions(dimensions);
  if (basis === "benchmark") {
    const category = similarityReferenceCategoryFor(evidence);
    return category === "cpu" ? "Cinebench R23 기반" : category === "gpu" ? "3DMark 기반" : "벤치마크 기반";
  }
  if (basis === "mixed") return "벤치마크·확인 스펙 기반";
  if (basis === "spec") return "확인 스펙 기반";
  return "비교 정보 확인 필요";
}

function similarityBasisForDimensions(dimensions: SimilarityEvidence["dimensions"]): SimilarityBasis | undefined {
  const usableDimensions = dimensions ?? [];
  const hasBenchmark = usableDimensions.some((dimension) => BENCHMARK_KEYS.has(dimension.key));
  const hasSpec = usableDimensions.some((dimension) => !BENCHMARK_KEYS.has(dimension.key));
  if (hasBenchmark && hasSpec) return "mixed";
  if (hasBenchmark) return "benchmark";
  if (hasSpec) return "spec";
  return undefined;
}

const DIMENSION_LABELS: Record<string, string> = {
  cinebenchR23Single: "R23 싱글",
  cinebenchR23Multi: "R23 멀티",
  gpu3dmarkTimeSpyScore: "3DMark Time Spy",
  gpu3dmarkPortRoyalScore: "3DMark Port Royal",
  gpuStreamProcessors: "스트림 프로세서",
  gpuMemoryBandwidthGbps: "VRAM 대역폭",
  gpuBoostClockMhz: "GPU 부스트",
  vramGb: "VRAM",
  cores: "코어",
  threads: "스레드",
  boostClockGhz: "부스트 클럭"
};

export function similarityDimensionLabelFor(key: string) {
  return DIMENSION_LABELS[key] ?? key;
}

export function similarityReferenceTextFor(evidence: SimilarityEvidence | undefined) {
  const reference = evidence?.reference;
  if (!reference) return undefined;
  const categoryLabel = reference.category === "gpu" ? "GPU" : "CPU";
  const dimensions = reference.transferredDimensions.map(similarityDimensionLabelFor);
  return `동일 ${categoryLabel} 모델 계열 참조 · ${reference.partName}${dimensions.length > 0 ? ` · 보완 지표 ${dimensions.join(" · ")}` : ""}`;
}
