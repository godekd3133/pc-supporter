import { DATA_FRESHNESS_LABELS, DATA_QUALITY_LABELS, type BenchmarkScoreKey, type BenchmarkSourceKind, type CatalogPriceEvidence, type DataFreshness, type DataQuality, type PartCategory, type PhysicalEvidenceSource, type PhysicalSourceCheck, type SimilarityBasis, type SimilarityConfidence, type SimilarityDimensionEvidence, type SimilarityEvidence, type SimilarityReferenceEvidence, type ValueLabel } from "./types";
import { CATALOG_PRICE_EVIDENCE_LABELS } from "./catalog-price-evidence";
import type { AlternativeComparisonScenario } from "./alternative-comparison-scenario";
import type { BenchmarkEvidencePart } from "./benchmark-evidence";
import { OBJECTIVE_BENCHMARK_DIMENSION_KEYS } from "./objective-score";
import { safeHttpsUrl } from "./safe-source-url";

export interface AlternativeComparisonExportContext {
  category?: string;
  currentPartName?: string;
  currentPartSummary?: string;
  currentPartPrice?: string;
}

export type AlternativeComparisonSimilarityDimension = Pick<SimilarityDimensionEvidence, "key" | "label" | "currentValue" | "candidateValue" | "source"> & Partial<Pick<SimilarityDimensionEvidence, "score" | "weight">>;

export type AlternativeComparisonSimilarityReference = Pick<SimilarityReferenceEvidence, "partId" | "partName" | "category" | "dataQuality" | "updatedAt" | "transferredDimensions"> & {
  /** Accepted on legacy/internal inputs, omitted from all public projections. */
  benchmarkSourceKind?: BenchmarkSourceKind;
};

export interface AlternativeComparisonSimilarityEvidence {
  comparedDimensions?: number;
  totalDimensions?: number;
  confidence: SimilarityConfidence;
  basis?: SimilarityBasis;
  dimensions?: AlternativeComparisonSimilarityDimension[];
  reference?: AlternativeComparisonSimilarityReference;
  notes?: string[];
}

export interface AlternativeComparisonBenchmarkEvidenceRow {
  key: BenchmarkScoreKey;
  label: string;
  value?: number;
  unit: "점";
}

export interface AlternativeComparisonBenchmarkEvidence {
  partId: string;
  category: "cpu" | "gpu";
  name: string;
  rows: AlternativeComparisonBenchmarkEvidenceRow[];
  presentCount: number;
  totalCount: number;
  status: "complete" | "partial" | "missing";
  provenance?: {
    sourceKind: BenchmarkSourceKind;
    sourceNote: string;
    sourceUrl?: string;
    updatedAt: string;
  };
  sourceCheck?: PhysicalSourceCheck;
  benchmarkFreshness: DataFreshness;
  dataUpdatedAt: string;
}

export interface AlternativeComparisonCandidate {
  name: string;
  category?: PartCategory;
  partId?: string;
  priceWon?: number;
  priceEvidence?: CatalogPriceEvidence;
  summary: string;
  price: string;
  purchaseCondition?: string;
  recommendedQuantity?: number;
  similarity: string;
  gpuTarget?: string;
  valueScore?: number;
  valueLabel?: ValueLabel;
  valueScoreScale?: 200;
  recommendationTrust?: string;
  performance: string;
  compatibility: string;
  similarityEvidence?: AlternativeComparisonSimilarityEvidence;
  benchmarkEvidence?: AlternativeComparisonBenchmarkEvidence;
  decisionSummary?: string;
  physicalEvidence?: string;
  physicalEvidenceSources?: PhysicalEvidenceSource[];
  dataQuality: string;
  dataFreshness?: DataFreshness;
  updatedAt?: string;
  sourceUrl?: string;
  scenario?: AlternativeComparisonScenario;
}

export function alternativeComparisonBenchmarkEvidenceFor(evidence: BenchmarkEvidencePart | undefined): AlternativeComparisonBenchmarkEvidence | undefined {
  if (!evidence) return undefined;
  const sourceUrl = safeHttpsUrl(evidence.provenance?.sourceUrl);
  const provenance = evidence.provenance
    ? {
      sourceKind: evidence.provenance.sourceKind,
      sourceNote: evidence.provenance.sourceNote,
      ...(sourceUrl ? { sourceUrl } : {}),
      updatedAt: evidence.provenance.updatedAt
    }
    : undefined;
  return {
    partId: evidence.partId,
    category: evidence.category,
    name: evidence.name,
    rows: evidence.rows.map((row) => ({ key: row.key, label: row.label, ...(row.value !== undefined ? { value: row.value } : {}), unit: row.unit })),
    presentCount: evidence.presentCount,
    totalCount: evidence.totalCount,
    status: evidence.status,
    ...(provenance ? { provenance } : {}),
    ...(evidence.sourceCheck ? { sourceCheck: evidence.sourceCheck } : {}),
    benchmarkFreshness: evidence.benchmarkFreshness,
    dataUpdatedAt: evidence.dataUpdatedAt
  };
}

export function alternativeComparisonSimilarityEvidenceFor(evidence: SimilarityEvidence | undefined): AlternativeComparisonSimilarityEvidence | undefined {
  if (!evidence) return undefined;
  const dimensions = evidence.dimensions?.filter((dimension) => !OBJECTIVE_BENCHMARK_DIMENSION_KEYS.has(dimension.key)).slice(0, 12).map((dimension) => ({
    key: dimension.key,
    label: dimension.label,
    currentValue: dimension.currentValue,
    candidateValue: dimension.candidateValue,
    ...(dimension.source ? { source: dimension.source } : {})
  }));
  const reference = evidence.reference
    ? {
      partId: evidence.reference.partId,
      partName: evidence.reference.partName,
      category: evidence.reference.category,
      dataQuality: evidence.reference.dataQuality,
      updatedAt: evidence.reference.updatedAt,
      transferredDimensions: evidence.reference.transferredDimensions.filter((key) => !OBJECTIVE_BENCHMARK_DIMENSION_KEYS.has(key)).slice(0, 12)
    }
    : undefined;
  const safeDimensionCount = Math.max(dimensions?.length ?? 0, reference?.transferredDimensions.length ?? 0);
  if (safeDimensionCount === 0) return undefined;
  return {
    comparedDimensions: safeDimensionCount,
    totalDimensions: safeDimensionCount,
    confidence: evidence.confidence,
    basis: "spec",
    ...(dimensions && dimensions.length > 0 ? { dimensions } : {}),
    ...(reference ? { reference } : {}),
  };
}

function selectedSpecDifferencesFor(evidence: AlternativeComparisonCandidate["similarityEvidence"]) {
  return (evidence?.dimensions ?? [])
    .filter((dimension) => !OBJECTIVE_BENCHMARK_DIMENSION_KEYS.has(dimension.key) && dimension.source !== "model_reference")
    .slice(0, 12)
    .map((dimension) => ({ key: dimension.key, label: dimension.label, currentValue: dimension.currentValue, candidateValue: dimension.candidateValue }));
}

function physicalEvidenceSourceLabel(category: PhysicalEvidenceSource["category"]) {
  return category === "gpu" ? "GPU" : category === "case" ? "케이스" : "PSU";
}

export function physicalEvidenceSourceTextFor(sources: PhysicalEvidenceSource[] | undefined) {
  return (sources ?? []).map((source) => `${physicalEvidenceSourceLabel(source.category)}${source.manufacturerModel ? ` · ${source.manufacturerModel}` : ""}${source.manufacturerRevision ? ` · ${source.manufacturerRevision}` : ""}${source.updatedAt ? ` · 확인 ${source.updatedAt}` : ""}: ${source.note}${source.url ? ` (${source.url})` : ""}`).join(" · ");
}

function scenarioStatusLabel(status: NonNullable<AlternativeComparisonCandidate["scenario"]>["status"]) {
  return status === "compatible" ? "호환 가능" : status === "needs_review" ? "구매 전 확인 필요" : "호환되지 않음";
}

function dataQualityLabel(value: string) {
  return DATA_QUALITY_LABELS[value as DataQuality] ?? value;
}

function scenarioCheckSummaryText(scenario: AlternativeComparisonCandidate["scenario"]) {
  const checks = scenario?.checks;
  if (!checks || checks.length === 0) return undefined;
  const ready = checks.filter((check) => check.status === "ready").length;
  const review = checks.filter((check) => check.status === "review").length;
  const blocked = checks.filter((check) => check.status === "blocked").length;
  return `구매 전 확인 항목 ${checks.length}개 · 완료 ${ready} · 추가 확인 ${review} · 진행 보류 ${blocked}`;
}

export function alternativeComparisonSimilarityEvidenceTextFor(evidence: AlternativeComparisonSimilarityEvidence | undefined) {
  if (!evidence) return undefined;
  const dimensions = selectedSpecDifferencesFor(evidence);
  return dimensions.length > 0
    ? dimensions.map((dimension) => `${dimension.label} ${dimension.currentValue} → ${dimension.candidateValue}`).join(" / ")
    : undefined;
}

export function alternativeComparisonScenarioTextFor(scenario: AlternativeComparisonCandidate["scenario"]) {
  if (!scenario) return undefined;
  const purchaseDecision = publicComparisonCopyText(scenario.purchaseDecision);
  const purchaseDecisionSummary = publicComparisonCopyText(scenario.purchaseDecisionSummary);
  const purchaseDecisionText = purchaseDecision
    ? `구매 안내: ${purchaseDecision}${purchaseDecisionSummary ? ` · ${purchaseDecisionSummary}` : ""}`
    : purchaseDecisionSummary ? `구매 안내: ${purchaseDecisionSummary}` : undefined;
  const parts = [
    `호환 결과: ${scenarioStatusLabel(scenario.status)} · 호환 불가 ${scenario.blockerCount} · 주의 ${scenario.warningCount} · 확인 필요 ${scenario.unknownCount}`,
    scenario.priceDeltaWon !== undefined ? `가격 변화 ${scenario.priceDeltaWon > 0 ? "+" : ""}${scenario.priceDeltaWon.toLocaleString("ko-KR")}원` : undefined,
    purchaseDecisionText,
    scenario.priceHistory && scenario.priceHistory.sampleCount > 0 ? `가격 이력 ${scenario.priceHistory.windowDays}일 ${scenario.priceHistory.sampleCount}회${scenario.priceHistory.minPriceWon !== undefined ? ` · 최저 ${scenario.priceHistory.minPriceWon.toLocaleString("ko-KR")}원` : ""}` : "가격 이력 없음",
    scenarioCheckSummaryText(scenario)
  ].filter((value): value is string => Boolean(value));
  return parts.join(" · ");
}

function csvCell(value: string | number | undefined) {
  const raw = value === undefined ? "" : String(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

export function alternativeComparisonBenchmarkEvidenceTextFor(evidence: AlternativeComparisonBenchmarkEvidence | undefined) {
  void evidence;
  return undefined;
}

function publicComparisonCopyText(value: string | undefined) {
  if (!value) return undefined;
  return /cinebench|time\s*spy|port\s*royal|benchmark|벤치마크|recommendation.?trust|trust\s*score|추천\s*신뢰|신뢰도|(?:카탈로그|성능)\s*(?:추정\s*)?분석(?:\s*점수)?\s*[:：]?\s*\d+|\bfps\b|초당\s*프레임/i.test(value) ? undefined : value;
}

function publicScenarioFor(scenario: AlternativeComparisonCandidate["scenario"]) {
  if (!scenario) return undefined;
  const { analysisScore: _analysisScore, analysisScoreLabel: _analysisScoreLabel, analysisScoreDelta: _analysisScoreDelta, analysisConfidence: _analysisConfidence, tradeoff: _tradeoff, ...safeScenario } = scenario;
  return publicScenarioValue(safeScenario);
}

function publicScenarioValue(value: unknown, key = ""): unknown {
  if (/benchmark|fps|trust|score/i.test(key)) return undefined;
  if (typeof value === "string") return publicComparisonCopyText(value);
  if (Array.isArray(value)) return value.map((item) => publicScenarioValue(item)).filter((item) => item !== undefined);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([childKey, child]) => {
      const safeValue = publicScenarioValue(child, childKey);
      return safeValue === undefined ? [] : [[childKey, safeValue]];
    }));
  }
  return value;
}

function publicCandidateFor(candidate: AlternativeComparisonCandidate) {
  const { recommendationTrust: _recommendationTrust, benchmarkEvidence: _benchmarkEvidence, valueScore: _valueScore, valueLabel: _valueLabel, valueScoreScale: _valueScoreScale, scenario, similarityEvidence, performance, similarity: _similarity, gpuTarget: _gpuTarget, decisionSummary, ...safeCandidate } = candidate;
  const specSummary = publicComparisonCopyText(performance);
  const specDifferences = selectedSpecDifferencesFor(similarityEvidence);
  return {
    ...safeCandidate,
    ...(specSummary ? { specSummary } : {}),
    ...(specDifferences.length > 0 ? { specDifferences } : {}),
    ...(publicComparisonCopyText(decisionSummary) ? { decisionSummary: publicComparisonCopyText(decisionSummary) } : {}),
    ...(publicScenarioFor(scenario) ? { scenario: publicScenarioFor(scenario) } : {})
  };
}

function specComparisonTextFor(candidate: AlternativeComparisonCandidate) {
  const summary = publicComparisonCopyText(candidate.performance);
  const dimensions = alternativeComparisonSimilarityEvidenceTextFor(candidate.similarityEvidence);
  return [summary, dimensions].filter((value): value is string => Boolean(value)).join(" / ") || undefined;
}

function comparisonRows(candidates: AlternativeComparisonCandidate[], context: AlternativeComparisonExportContext = {}) {
  const contextValues = context.category || context.currentPartName || context.currentPartSummary || context.currentPartPrice
    ? [context.category, context.currentPartName, context.currentPartSummary, context.currentPartPrice]
    : [];
  return candidates.map((candidate) => [
    candidate.name,
    candidate.category,
    candidate.partId,
    candidate.summary,
    candidate.price,
    candidate.priceWon,
    candidate.priceEvidence ? CATALOG_PRICE_EVIDENCE_LABELS[candidate.priceEvidence] : undefined,
    candidate.purchaseCondition,
    candidate.recommendedQuantity,
    specComparisonTextFor(candidate),
    candidate.compatibility,
    publicComparisonCopyText(candidate.decisionSummary),
    alternativeComparisonScenarioTextFor(candidate.scenario),
    candidate.physicalEvidence,
    physicalEvidenceSourceTextFor(candidate.physicalEvidenceSources),
    dataQualityLabel(candidate.dataQuality),
    candidate.dataFreshness ? DATA_FRESHNESS_LABELS[candidate.dataFreshness] : undefined,
    candidate.updatedAt,
    candidate.sourceUrl,
    ...contextValues
  ]);
}

export function alternativeComparisonTextFor(candidates: AlternativeComparisonCandidate[], context: AlternativeComparisonExportContext = {}) {
  const lines = ["PC Supporter 부품 비교"];
  if (context.category) lines.push(`비교 범주: ${context.category}`);
  if (context.currentPartName) lines.push(`현재 부품: ${context.currentPartName}`);
  if (context.currentPartSummary) lines.push(`현재 부품 정보: ${context.currentPartSummary}`);
  if (context.currentPartPrice) lines.push(`현재 부품 가격: ${context.currentPartPrice}`);
  lines.push("");
  candidates.forEach((candidate, index) => {
    lines.push(`[부품 ${index + 1}] ${candidate.name}`);
    if (candidate.category || candidate.partId) lines.push(`- 부품 분류: ${candidate.category ?? "분류 확인 필요"}${candidate.partId ? ` · ${candidate.partId}` : ""}`);
    lines.push(`- 핵심 스펙: ${candidate.summary}`);
    lines.push(`- 가격: ${candidate.price}${candidate.recommendedQuantity !== undefined ? ` · 추천 수량 ${candidate.recommendedQuantity}개` : ""}`);
    if (candidate.priceEvidence) lines.push(`- 가격 출처: ${CATALOG_PRICE_EVIDENCE_LABELS[candidate.priceEvidence]}`);
    if (candidate.purchaseCondition) lines.push(`- 구매 조건: ${candidate.purchaseCondition}`);
    const performance = publicComparisonCopyText(candidate.performance);
    const specEvidence = alternativeComparisonSimilarityEvidenceTextFor(candidate.similarityEvidence);
    const specComparison = [performance, specEvidence].filter((value): value is string => Boolean(value)).join(" / ");
    if (specComparison) lines.push(`- 사양 차이: ${specComparison}`);
    lines.push(`- 호환 상태: ${candidate.compatibility}`);
    const decisionSummary = publicComparisonCopyText(candidate.decisionSummary);
    if (decisionSummary) lines.push(`- 비교 결론: ${decisionSummary}`);
    const scenario = alternativeComparisonScenarioTextFor(candidate.scenario);
    if (scenario) lines.push(`- 부품을 교체할 경우: ${scenario}`);
    if (candidate.physicalEvidence) lines.push(`- 설치 공간 확인: ${candidate.physicalEvidence}`);
    const physicalEvidenceSources = physicalEvidenceSourceTextFor(candidate.physicalEvidenceSources);
    if (physicalEvidenceSources) lines.push(`- 설치 안내: ${physicalEvidenceSources}`);
    lines.push(`- 부품 정보: ${dataQualityLabel(candidate.dataQuality)}${candidate.dataFreshness ? ` · ${DATA_FRESHNESS_LABELS[candidate.dataFreshness]}` : ""}${candidate.updatedAt ? ` · 갱신 ${candidate.updatedAt}` : ""}`);
    if (candidate.sourceUrl) lines.push(`- 상품 페이지: ${candidate.sourceUrl}`);
    lines.push("");
  });
  return lines.join("\n");
}

export function alternativeComparisonCsvFor(candidates: AlternativeComparisonCandidate[], context: AlternativeComparisonExportContext = {}) {
  const contextColumns = context.category || context.currentPartName || context.currentPartSummary || context.currentPartPrice
    ? ["비교 범주", "현재 부품", "현재 부품 정보", "현재 부품 가격"]
    : [];
  const header = ["부품명", "범주", "부품 ID", "핵심 스펙", "가격", "공유 당시 가격(원)", "가격 출처", "구매 조건", "추천 수량", "사양 차이", "호환 상태", "비교 결론", "부품 교체 시", "설치 공간 확인", "설치 안내", "부품 정보 상태", "갱신 상태", "갱신일", "상품 페이지", ...contextColumns];
  return `\uFEFF${[header, ...comparisonRows(candidates, context)].map((row) => row.map((value) => csvCell(value)).join(",")).join("\r\n")}`;
}

export function alternativeComparisonJsonFor(candidates: AlternativeComparisonCandidate[], context: AlternativeComparisonExportContext = {}) {
  return JSON.stringify({
    type: "pc-supporter-alternative-comparison",
    version: 1,
    exportedAt: new Date().toISOString(),
    ...(context.category || context.currentPartName || context.currentPartSummary || context.currentPartPrice ? { context: { ...(context.category ? { category: context.category } : {}), ...(context.currentPartName ? { currentPartName: context.currentPartName } : {}), ...(context.currentPartSummary ? { currentPartSummary: context.currentPartSummary } : {}), ...(context.currentPartPrice ? { currentPartPrice: context.currentPartPrice } : {}) } } : {}),
    items: candidates.map(publicCandidateFor)
  }, null, 2);
}
