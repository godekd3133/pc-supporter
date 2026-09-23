import { DATA_FRESHNESS_LABELS, BENCHMARK_SOURCE_KIND_LABELS, type BenchmarkScoreKey, type BenchmarkSourceKind, type CatalogPriceEvidence, type DataFreshness, type PartCategory, type PhysicalEvidenceSource, type PhysicalSourceCheck, type SimilarityBasis, type SimilarityConfidence, type SimilarityDimensionEvidence, type SimilarityEvidence, type SimilarityReferenceEvidence, type ValueLabel } from "./types";
import { CATALOG_PRICE_EVIDENCE_LABELS } from "./catalog-price-evidence";
import { valueScoreText } from "./value-score";
import type { AlternativeComparisonScenario } from "./alternative-comparison-scenario";
import { benchmarkFreshnessLabelFor, benchmarkSourceCheckLabelFor } from "./benchmark-evidence";
import type { BenchmarkEvidencePart } from "./benchmark-evidence";
import { safeHttpsUrl } from "./safe-source-url";

export interface AlternativeComparisonExportContext {
  category?: string;
  currentPartName?: string;
  currentPartSummary?: string;
  currentPartPrice?: string;
}

export type AlternativeComparisonSimilarityDimension = Pick<SimilarityDimensionEvidence, "key" | "label" | "currentValue" | "candidateValue" | "score" | "weight" | "source">;

export type AlternativeComparisonSimilarityReference = Pick<SimilarityReferenceEvidence, "partId" | "partName" | "category" | "dataQuality" | "updatedAt" | "transferredDimensions"> & {
  benchmarkSourceKind?: BenchmarkSourceKind;
};

export interface AlternativeComparisonSimilarityEvidence {
  comparedDimensions: number;
  totalDimensions: number;
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
  const dimensions = evidence.dimensions?.slice(0, 12).map((dimension) => ({
    key: dimension.key,
    label: dimension.label,
    currentValue: dimension.currentValue,
    candidateValue: dimension.candidateValue,
    score: dimension.score,
    weight: dimension.weight,
    ...(dimension.source ? { source: dimension.source } : {})
  }));
  const reference = evidence.reference
    ? {
      partId: evidence.reference.partId,
      partName: evidence.reference.partName,
      category: evidence.reference.category,
      dataQuality: evidence.reference.dataQuality,
      updatedAt: evidence.reference.updatedAt,
      transferredDimensions: evidence.reference.transferredDimensions.slice(0, 12),
      ...(evidence.reference.benchmarkSourceKind ? { benchmarkSourceKind: evidence.reference.benchmarkSourceKind } : {})
    }
    : undefined;
  return {
    comparedDimensions: evidence.comparedDimensions,
    totalDimensions: evidence.totalDimensions,
    confidence: evidence.confidence,
    ...(evidence.basis ? { basis: evidence.basis } : {}),
    ...(dimensions && dimensions.length > 0 ? { dimensions } : {}),
    ...(reference ? { reference } : {}),
    ...(evidence.notes && evidence.notes.length > 0 ? { notes: evidence.notes.slice(0, 8) } : {})
  };
}

function physicalEvidenceSourceLabel(category: PhysicalEvidenceSource["category"]) {
  return category === "gpu" ? "GPU" : category === "case" ? "케이스" : "PSU";
}

export function physicalEvidenceSourceTextFor(sources: PhysicalEvidenceSource[] | undefined) {
  return (sources ?? []).map((source) => `${physicalEvidenceSourceLabel(source.category)}${source.manufacturerModel ? ` · ${source.manufacturerModel}` : ""}${source.manufacturerRevision ? ` · ${source.manufacturerRevision}` : ""}${source.updatedAt ? ` · 확인 ${source.updatedAt}` : ""}: ${source.note}${source.url ? ` (${source.url})` : ""}`).join(" · ");
}

function valueScoreTextFor(candidate: AlternativeComparisonCandidate) {
  if (candidate.valueScore === undefined || !candidate.valueLabel) return undefined;
  return `${candidate.valueLabel} ${valueScoreText(candidate.valueScore)}`;
}

function scenarioStatusLabel(status: NonNullable<AlternativeComparisonCandidate["scenario"]>["status"]) {
  return status === "compatible" ? "호환 가능" : status === "needs_review" ? "확인 필요" : "호환 불가";
}

function scenarioAnalysisText(scenario: AlternativeComparisonCandidate["scenario"]) {
  if (!scenario || (scenario.analysisScore === undefined && !scenario.analysisScoreLabel)) return undefined;
  const confidence = scenario.analysisConfidence === "high" ? "정보 충분" : scenario.analysisConfidence === "limited" ? "일부 정보로 계산" : scenario.analysisConfidence === "unknown" ? "계산 정보 부족" : undefined;
  const score = scenario.analysisScore === undefined ? scenario.analysisScoreLabel : `${scenario.analysisScore}점 · ${scenario.analysisScoreLabel ?? "분석"}`;
  return `성능 분석 ${score}${scenario.analysisScoreDelta !== undefined ? ` · 현재 대비 ${scenario.analysisScoreDelta > 0 ? "+" : ""}${scenario.analysisScoreDelta}점` : ""}${confidence ? ` · ${confidence}` : ""}`;
}

function scenarioCheckSummaryText(scenario: AlternativeComparisonCandidate["scenario"]) {
  const checks = scenario?.checks;
  if (!checks || checks.length === 0) return undefined;
  const ready = checks.filter((check) => check.status === "ready").length;
  const review = checks.filter((check) => check.status === "review").length;
  const blocked = checks.filter((check) => check.status === "blocked").length;
  return `구매 전 확인 ${checks.length}개 · 확인됨 ${ready} · 확인 필요 ${review} · 차단 ${blocked}`;
}

function scenarioTradeoffText(scenario: AlternativeComparisonCandidate["scenario"]) {
  const tradeoff = scenario?.tradeoff;
  if (!tradeoff) return undefined;
  const status = tradeoff.eligible === false ? "비교 제외" : tradeoff.frontier ? "비교 우위" : "밀림";
  const facts = [
    tradeoff.riskScore !== undefined ? `위험 ${tradeoff.riskScore}점` : undefined,
    tradeoff.priceDeltaWon !== undefined ? `가격 변화 ${tradeoff.priceDeltaWon > 0 ? "+" : ""}${tradeoff.priceDeltaWon.toLocaleString("ko-KR")}원` : "가격 변화 확인 필요",
    tradeoff.analysisScore !== undefined ? `분석 ${tradeoff.analysisScore}점` : "분석 확인 필요",
    tradeoff.evidenceScore !== undefined ? `정보 ${tradeoff.evidenceScore}점` : undefined
  ].filter((value): value is string => Boolean(value));
  return `${status} · ${facts.join(" · ")} · ${tradeoff.reason}`;
}

function similarityConfidenceText(confidence: SimilarityConfidence) {
  return confidence === "high" ? "정보 충분" : confidence === "limited" ? "정보 제한" : "정보 확인 필요";
}

function similarityBasisText(basis: SimilarityBasis | undefined) {
  return basis === "benchmark" ? "성능 측정 자료" : basis === "mixed" ? "성능 측정·부품 정보" : basis === "spec" ? "부품 정보" : "비교 정보 확인 필요";
}

export function alternativeComparisonSimilarityEvidenceTextFor(evidence: AlternativeComparisonSimilarityEvidence | undefined) {
  if (!evidence) return undefined;
  const referenceText = evidence.reference
    ? `모델 참조 ${evidence.reference.partName} · 보완 ${evidence.reference.transferredDimensions.length > 0 ? evidence.reference.transferredDimensions.join(" · ") : "지표 확인 필요"}`
    : undefined;
  const dimensionText = evidence.dimensions && evidence.dimensions.length > 0
    ? `지표별 ${evidence.dimensions.map((dimension) => `${dimension.label} ${dimension.currentValue} → ${dimension.candidateValue}${dimension.source === "model_reference" ? " (모델 참조)" : ""}`).join(" / ")}`
    : undefined;
  return [
    `${similarityConfidenceText(evidence.confidence)} · ${similarityBasisText(evidence.basis)} · 비교 지표 ${evidence.comparedDimensions}/${evidence.totalDimensions}개`,
    referenceText,
    dimensionText
  ].filter((value): value is string => Boolean(value)).join(" · ");
}

export function alternativeComparisonScenarioTextFor(scenario: AlternativeComparisonCandidate["scenario"]) {
  if (!scenario) return undefined;
  const parts = [
    scenarioStatusLabel(scenario.status),
    `차단 ${scenario.blockerCount} · 주의 ${scenario.warningCount} · 확인 필요 ${scenario.unknownCount}`,
    scenarioAnalysisText(scenario),
    scenario.priceDeltaWon !== undefined ? `가격 변화 ${scenario.priceDeltaWon > 0 ? "+" : ""}${scenario.priceDeltaWon.toLocaleString("ko-KR")}원` : undefined,
    scenarioTradeoffText(scenario),
    scenario.purchaseDecision,
    scenario.priceHistory && scenario.priceHistory.sampleCount > 0 ? `가격 이력 ${scenario.priceHistory.windowDays}일 ${scenario.priceHistory.sampleCount}회${scenario.priceHistory.minPriceWon !== undefined ? ` · 최저 ${scenario.priceHistory.minPriceWon.toLocaleString("ko-KR")}원` : ""}` : "가격 이력 없음",
    scenarioCheckSummaryText(scenario)
  ].filter((value): value is string => Boolean(value));
  return `${parts.join(" · ")}${scenario.purchaseDecisionSummary ? ` · ${scenario.purchaseDecisionSummary}` : ""}`;
}

function csvCell(value: string | number | undefined) {
  const raw = value === undefined ? "" : String(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function benchmarkEvidenceStatusText(status: AlternativeComparisonBenchmarkEvidence["status"]) {
  return status === "complete" ? "완전 자료" : status === "partial" ? "부분 자료" : "점수 없음";
}

export function alternativeComparisonBenchmarkEvidenceTextFor(evidence: AlternativeComparisonBenchmarkEvidence | undefined) {
  if (!evidence) return undefined;
  const scoreText = evidence.rows.map((row) => `${row.label} ${row.value === undefined ? "확인 필요" : `${row.value.toLocaleString("ko-KR")}${row.unit}`}`).join(" · ");
  const sourceText = evidence.provenance
    ? `${BENCHMARK_SOURCE_KIND_LABELS[evidence.provenance.sourceKind]} · ${evidence.provenance.sourceNote}${evidence.provenance.sourceUrl ? ` · 출처 ${evidence.provenance.sourceUrl}` : ""}`
    : "출처 없음";
  const sourceCheckText = `${benchmarkSourceCheckLabelFor(evidence.sourceCheck)}${evidence.sourceCheck?.detail ? ` · ${evidence.sourceCheck.detail}` : ""}`;
  return `${benchmarkEvidenceStatusText(evidence.status)} · ${evidence.presentCount}/${evidence.totalCount}개 · ${scoreText} · 출처 ${sourceText} · 점검 ${sourceCheckText} · 자료 ${benchmarkFreshnessLabelFor(evidence.benchmarkFreshness)} · 데이터 갱신 ${evidence.dataUpdatedAt}`;
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
    candidate.similarity,
    alternativeComparisonSimilarityEvidenceTextFor(candidate.similarityEvidence),
    candidate.gpuTarget,
    valueScoreTextFor(candidate),
    candidate.recommendationTrust,
    candidate.performance,
    candidate.compatibility,
    candidate.decisionSummary,
    alternativeComparisonScenarioTextFor(candidate.scenario),
    candidate.physicalEvidence,
    physicalEvidenceSourceTextFor(candidate.physicalEvidenceSources),
    candidate.dataQuality,
    candidate.dataFreshness ? DATA_FRESHNESS_LABELS[candidate.dataFreshness] : undefined,
    candidate.updatedAt,
    candidate.sourceUrl,
    alternativeComparisonBenchmarkEvidenceTextFor(candidate.benchmarkEvidence),
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
    lines.push(`- 가격: ${candidate.price}${candidate.recommendedQuantity !== undefined ? ` · 추천 킷 ${candidate.recommendedQuantity}개` : ""}`);
    if (candidate.priceEvidence) lines.push(`- 가격 출처: ${CATALOG_PRICE_EVIDENCE_LABELS[candidate.priceEvidence]}`);
    if (candidate.purchaseCondition) lines.push(`- 구매 조건: ${candidate.purchaseCondition}`);
    lines.push(`- 성능 유사도: ${candidate.similarity}`);
    const similarityEvidence = alternativeComparisonSimilarityEvidenceTextFor(candidate.similarityEvidence);
    if (similarityEvidence) lines.push(`- 성능 비교 정보: ${similarityEvidence}`);
    if (candidate.gpuTarget) lines.push(`- 게이밍 목표 정보: ${candidate.gpuTarget}`);
    const valueScore = valueScoreTextFor(candidate);
    if (valueScore) lines.push(`- 가격 대비 유사도: ${valueScore}`);
    if (candidate.recommendationTrust) lines.push(`- 추천 점수: ${candidate.recommendationTrust}`);
    lines.push(`- 성능 변화: ${candidate.performance}`);
    lines.push(`- 호환 상태: ${candidate.compatibility}`);
    if (candidate.decisionSummary) lines.push(`- 판단 요약: ${candidate.decisionSummary}`);
    const scenario = alternativeComparisonScenarioTextFor(candidate.scenario);
    if (scenario) lines.push(`- 미리 적용 판단: ${scenario}`);
    if (candidate.physicalEvidence) lines.push(`- 장착 정보: ${candidate.physicalEvidence}`);
    const physicalEvidenceSources = physicalEvidenceSourceTextFor(candidate.physicalEvidenceSources);
    if (physicalEvidenceSources) lines.push(`- 장착 정보 출처: ${physicalEvidenceSources}`);
    lines.push(`- 데이터: ${candidate.dataQuality}${candidate.dataFreshness ? ` · ${DATA_FRESHNESS_LABELS[candidate.dataFreshness]}` : ""}${candidate.updatedAt ? ` · 갱신 ${candidate.updatedAt}` : ""}`);
    if (candidate.sourceUrl) lines.push(`- 출처: ${candidate.sourceUrl}`);
    const benchmarkEvidence = alternativeComparisonBenchmarkEvidenceTextFor(candidate.benchmarkEvidence);
    if (benchmarkEvidence) lines.push(`- 성능 정보: ${benchmarkEvidence}`);
    lines.push("");
  });
  return lines.join("\n");
}

export function alternativeComparisonCsvFor(candidates: AlternativeComparisonCandidate[], context: AlternativeComparisonExportContext = {}) {
  const contextColumns = context.category || context.currentPartName || context.currentPartSummary || context.currentPartPrice
    ? ["비교 범주", "현재 부품", "현재 부품 정보", "현재 부품 가격"]
    : [];
  const header = ["부품명", "범주", "부품 ID", "핵심 스펙", "가격", "공유 당시 가격(원)", "가격 출처", "구매 조건", "추천 킷 수량", "성능 유사도", "성능 비교 정보", "게이밍 목표 정보", "가격 대비 유사도", "추천 점수", "성능 변화", "호환 상태", "판단 요약", "미리 적용 판단", "장착 정보", "장착 정보 출처", "부품 정보 상태", "갱신 상태", "갱신일", "상품 링크", "성능 정보", ...contextColumns];
  return `\uFEFF${[header, ...comparisonRows(candidates, context)].map((row) => row.map((value) => csvCell(value)).join(",")).join("\r\n")}`;
}

export function alternativeComparisonJsonFor(candidates: AlternativeComparisonCandidate[], context: AlternativeComparisonExportContext = {}) {
  return JSON.stringify({
    type: "pc-supporter-alternative-comparison",
    version: 1,
    exportedAt: new Date().toISOString(),
    ...(context.category || context.currentPartName || context.currentPartSummary || context.currentPartPrice ? { context: { ...(context.category ? { category: context.category } : {}), ...(context.currentPartName ? { currentPartName: context.currentPartName } : {}), ...(context.currentPartSummary ? { currentPartSummary: context.currentPartSummary } : {}), ...(context.currentPartPrice ? { currentPartPrice: context.currentPartPrice } : {}) } } : {}),
    items: candidates
  }, null, 2);
}
