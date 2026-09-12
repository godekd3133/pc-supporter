import { classifyDataFreshness } from "./data-freshness";
import { DATA_FRESHNESS_LABELS, type BenchmarkAvailabilityFilter, type BenchmarkScoreKey, type DataFreshness, type Part, type PhysicalSourceCheck } from "./types";
import { physicalSourceCheckNeedsReview } from "./physical-source-check";

export interface BenchmarkEvidenceRow {
  key: BenchmarkScoreKey;
  label: string;
  value?: number;
  unit: "점";
}

export interface BenchmarkEvidencePart {
  partId: string;
  category: "cpu" | "gpu";
  name: string;
  rows: BenchmarkEvidenceRow[];
  presentCount: number;
  totalCount: number;
  status: "complete" | "partial" | "missing";
  provenance?: Part["specs"]["benchmarkProvenance"];
  sourceCheck?: PhysicalSourceCheck;
  benchmarkFreshness: DataFreshness;
  dataUpdatedAt: string;
}

export interface BenchmarkComparisonRow {
  key: BenchmarkScoreKey;
  label: string;
  currentValue?: number;
  candidateValue?: number;
  delta?: number;
  deltaPercent?: number;
}

const BENCHMARK_ROWS: Record<BenchmarkEvidencePart["category"], Array<Pick<BenchmarkEvidenceRow, "key" | "label">>> = {
  cpu: [
    { key: "cinebenchR23Single", label: "Cinebench R23 싱글" },
    { key: "cinebenchR23Multi", label: "Cinebench R23 멀티" }
  ],
  gpu: [
    { key: "gpu3dmarkTimeSpyScore", label: "3DMark Time Spy" },
    { key: "gpu3dmarkPortRoyalScore", label: "3DMark Port Royal" }
  ]
};

function validScore(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function benchmarkEvidenceForPart(part: Part | undefined, now: string | number = Date.now()): BenchmarkEvidencePart | undefined {
  if (!part || (part.category !== "cpu" && part.category !== "gpu")) return undefined;
  const rows = BENCHMARK_ROWS[part.category].map(({ key, label }) => ({ key, label, ...(validScore(part.specs[key]) ? { value: part.specs[key] } : {}), unit: "점" as const }));
  const presentCount = rows.filter((row) => row.value !== undefined).length;
  return {
    partId: part.id,
    category: part.category,
    name: part.name,
    rows,
    presentCount,
    totalCount: rows.length,
    status: presentCount === rows.length ? "complete" : presentCount > 0 ? "partial" : "missing",
    ...(part.specs.benchmarkProvenance ? { provenance: part.specs.benchmarkProvenance } : {}),
    ...(part.specs.benchmarkProvenance?.sourceCheck ? { sourceCheck: part.specs.benchmarkProvenance.sourceCheck } : {}),
    benchmarkFreshness: classifyDataFreshness(part.specs.benchmarkProvenance?.updatedAt ?? part.updatedAt, now),
    dataUpdatedAt: part.updatedAt
  };
}

export function benchmarkAvailabilityForPart(part: Part | undefined): Exclude<BenchmarkAvailabilityFilter, "all"> | undefined {
  const evidence = benchmarkEvidenceForPart(part);
  if (!evidence) return undefined;
  return evidence.status === "complete" ? "complete" : "incomplete";
}

export function benchmarkAvailabilityMatchesFilter(part: Part, filter: BenchmarkAvailabilityFilter) {
  if (filter === "all") return true;
  return benchmarkAvailabilityForPart(part) === filter;
}

export function benchmarkFreshnessLabelFor(value: DataFreshness) {
  return DATA_FRESHNESS_LABELS[value];
}

export function benchmarkSourceCheckLabelFor(value: PhysicalSourceCheck | undefined) {
  if (!value) return "원문 검증 안 함";
  return physicalSourceCheckNeedsReview(value, true) ? "원문 재확인 필요" : "원문 검증됨";
}

export function benchmarkComparisonRowsFor(current: BenchmarkEvidencePart | undefined, candidate: BenchmarkEvidencePart): BenchmarkComparisonRow[] {
  return candidate.rows.map((row) => {
    const currentValue = current?.category === candidate.category
      ? current.rows.find((currentRow) => currentRow.key === row.key)?.value
      : undefined;
    const candidateValue = row.value;
    const delta = currentValue !== undefined && candidateValue !== undefined ? candidateValue - currentValue : undefined;
    const deltaPercent = delta !== undefined && currentValue !== undefined && currentValue > 0 ? (delta / currentValue) * 100 : undefined;
    return {
      key: row.key,
      label: row.label,
      ...(currentValue !== undefined ? { currentValue } : {}),
      ...(candidateValue !== undefined ? { candidateValue } : {}),
      ...(delta !== undefined ? { delta } : {}),
      ...(deltaPercent !== undefined ? { deltaPercent } : {})
    };
  });
}

export function benchmarkEvidenceForBuild(cpu: Part | undefined, gpu: Part | undefined, now: string | number = Date.now()) {
  return [benchmarkEvidenceForPart(cpu, now), benchmarkEvidenceForPart(gpu, now)].filter((item): item is BenchmarkEvidencePart => Boolean(item));
}
