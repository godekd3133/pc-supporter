import type { AlternativeComparisonBenchmarkEvidence, AlternativeComparisonBenchmarkEvidenceRow, AlternativeComparisonCandidate, AlternativeComparisonSimilarityDimension, AlternativeComparisonSimilarityEvidence, AlternativeComparisonSimilarityReference } from "../shared/alternative-comparison-export";
import { catalogPriceEvidenceFromUnknown } from "../shared/catalog-price-evidence";
import { isKnownPrice, PART_CATEGORIES, type BenchmarkScoreKey, type BenchmarkSourceKind, type DataFreshness, type PartCategory, type PhysicalEvidenceSource, type SimilarityBasis, type SimilarityConfidence, type SimilarityDimensionSource, type ValueLabel } from "../shared/types";
import { VALUE_SCORE_MAX } from "../shared/value-score";
import type { AlternativeComparisonScenario, AlternativeComparisonScenarioCheck, AlternativeComparisonScenarioPriceHistory, AlternativeComparisonScenarioTradeoff } from "../shared/alternative-comparison-scenario";
import type { AlternativeComparisonCreateInput, AlternativeComparisonSnapshot } from "../shared/alternative-comparison-share";
import { safeExternalUrl, safeHttpsUrl } from "../shared/safe-source-url";
import { physicalSourceCheckFromUnknown } from "./physical-source-check-history";
import { normalizeShareExpiryAt, shareExpiryDaysFrom, shareExpiryValueProvided, shareExpired, shareExpiresAtFor } from "./share-lifecycle";

export type SavedAlternativeComparisonRecord = AlternativeComparisonSnapshot & {
  ownerTokenHash?: string;
};

export interface AlternativeComparisonInputResult {
  name?: string;
  category?: string;
  currentPartName?: string;
  currentPartSummary?: string;
  currentPartPrice?: string;
  catalogSnapshotAt?: string;
  engineVersion?: string;
  candidates: AlternativeComparisonCandidate[];
  expiresInDays?: 7 | 30;
  errors: string[];
}

const MAX_CANDIDATES = 3;
const ANALYSIS_SCORE_LABELS = ["상위권", "균형형", "보완 권장", "계산 불가"] as const;
const ANALYSIS_CONFIDENCE = ["high", "limited", "unknown"] as const;

function textValue(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : undefined;
}

function dataFreshnessFromUnknown(value: unknown): DataFreshness | undefined {
  return value === "fresh" || value === "aging" || value === "stale" || value === "unknown" ? value : undefined;
}

const BENCHMARK_ROWS_BY_CATEGORY: Record<"cpu" | "gpu", Array<{ key: BenchmarkScoreKey; label: string }>> = {
  cpu: [
    { key: "cinebenchR23Single", label: "Cinebench R23 싱글" },
    { key: "cinebenchR23Multi", label: "Cinebench R23 멀티" }
  ],
  gpu: [
    { key: "gpu3dmarkTimeSpyScore", label: "3DMark Time Spy" },
    { key: "gpu3dmarkPortRoyalScore", label: "3DMark Port Royal" }
  ]
};

function benchmarkEvidenceFromUnknown(value: unknown, index: number): { evidence?: AlternativeComparisonBenchmarkEvidence; error?: string } {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: `${index + 1}번째 후보의 원본 성능 근거 형식이 올바르지 않습니다.` };
  const raw = value as Record<string, unknown>;
  const partId = textValue(raw.partId, 160);
  const category = raw.category === "cpu" || raw.category === "gpu" ? raw.category : undefined;
  const name = textValue(raw.name, 240);
  const dataUpdatedAt = textValue(raw.dataUpdatedAt, 80);
  const benchmarkFreshness = dataFreshnessFromUnknown(raw.benchmarkFreshness);
  const expectedRows = category ? BENCHMARK_ROWS_BY_CATEGORY[category] : undefined;
  if (!partId || !category || !name || !dataUpdatedAt || !benchmarkFreshness || !expectedRows || !Array.isArray(raw.rows) || raw.rows.length !== expectedRows.length) return { error: `${index + 1}번째 후보의 원본 성능 근거 요약이 올바르지 않습니다.` };

  const rows: AlternativeComparisonBenchmarkEvidenceRow[] = [];
  for (const [rowIndex, expected] of expectedRows.entries()) {
    const item = raw.rows[rowIndex];
    if (!item || typeof item !== "object" || Array.isArray(item)) return { error: `${index + 1}번째 후보의 원본 성능 점수 형식이 올바르지 않습니다.` };
    const row = item as Record<string, unknown>;
    const valueCandidate = row.value;
    const score = valueCandidate === undefined ? undefined : Number(valueCandidate);
    if (row.key !== expected.key || row.label !== expected.label || row.unit !== "점" || score !== undefined && (!Number.isInteger(score) || score < 1 || score > 1_000_000)) return { error: `${index + 1}번째 후보의 원본 성능 점수 값이 올바르지 않습니다.` };
    rows.push({ key: expected.key, label: expected.label, ...(score !== undefined ? { value: score } : {}), unit: "점" });
  }

  let provenance: AlternativeComparisonBenchmarkEvidence["provenance"];
  let sourceCheck: AlternativeComparisonBenchmarkEvidence["sourceCheck"];
  if (raw.provenance !== undefined) {
    if (!raw.provenance || typeof raw.provenance !== "object" || Array.isArray(raw.provenance)) return { error: `${index + 1}번째 후보의 원본 성능 출처 형식이 올바르지 않습니다.` };
    const source = raw.provenance as Record<string, unknown>;
    const sourceKind: BenchmarkSourceKind | undefined = source.sourceKind === "official" || source.sourceKind === "independent_review" || source.sourceKind === "community_measurement" || source.sourceKind === "other" ? source.sourceKind : undefined;
    const sourceNote = textValue(source.sourceNote, 500);
    const updatedAt = textValue(source.updatedAt, 80);
    const sourceUrl = typeof source.sourceUrl === "string" ? safeHttpsUrl(source.sourceUrl) : undefined;
    if (!sourceKind || !sourceNote || !updatedAt) return { error: `${index + 1}번째 후보의 원본 성능 출처 값이 올바르지 않습니다.` };
    provenance = { sourceKind, sourceNote, ...(sourceUrl ? { sourceUrl } : {}), updatedAt };
    if (source.sourceCheck !== undefined) {
      const parsedSourceCheck = physicalSourceCheckFromUnknown(source.sourceCheck);
      const requestedUrl = parsedSourceCheck ? safeHttpsUrl(parsedSourceCheck.requestedUrl) : undefined;
      const finalUrl = parsedSourceCheck?.finalUrl ? safeHttpsUrl(parsedSourceCheck.finalUrl) : undefined;
      if (!parsedSourceCheck || !requestedUrl || parsedSourceCheck.finalUrl && !finalUrl) return { error: `${index + 1}번째 후보의 원본 성능 원문 점검 값이 올바르지 않습니다.` };
      sourceCheck = { ...parsedSourceCheck, requestedUrl, ...(finalUrl ? { finalUrl } : {}) };
    }
  }
  if (raw.sourceCheck !== undefined) {
    const parsedSourceCheck = physicalSourceCheckFromUnknown(raw.sourceCheck);
    const requestedUrl = parsedSourceCheck ? safeHttpsUrl(parsedSourceCheck.requestedUrl) : undefined;
    const finalUrl = parsedSourceCheck?.finalUrl ? safeHttpsUrl(parsedSourceCheck.finalUrl) : undefined;
    if (!parsedSourceCheck || !requestedUrl || parsedSourceCheck.finalUrl && !finalUrl) return { error: `${index + 1}번째 후보의 원본 성능 원문 점검 값이 올바르지 않습니다.` };
    sourceCheck = { ...parsedSourceCheck, requestedUrl, ...(finalUrl ? { finalUrl } : {}) };
  }

  const presentCount = rows.filter((row) => row.value !== undefined).length;
  const status: AlternativeComparisonBenchmarkEvidence["status"] = presentCount === rows.length ? "complete" : presentCount > 0 ? "partial" : "missing";
  return {
    evidence: {
      partId,
      category,
      name,
      rows,
      presentCount,
      totalCount: rows.length,
      status,
      ...(provenance ? { provenance } : {}),
      ...(sourceCheck ? { sourceCheck } : {}),
      benchmarkFreshness,
      dataUpdatedAt
    }
  };
}

function similarityEvidenceFromUnknown(value: unknown, index: number): { evidence?: AlternativeComparisonSimilarityEvidence; error?: string } {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: `${index + 1}번째 후보의 성능 비교 근거 형식이 올바르지 않습니다.` };
  const raw = value as Record<string, unknown>;
  const comparedDimensions = Number(raw.comparedDimensions);
  const totalDimensions = Number(raw.totalDimensions);
  const confidence: SimilarityConfidence | undefined = raw.confidence === "high" || raw.confidence === "limited" || raw.confidence === "unknown" ? raw.confidence : undefined;
  const basis: SimilarityBasis | undefined = raw.basis === "benchmark" || raw.basis === "spec" || raw.basis === "mixed" ? raw.basis : undefined;
  if (!Number.isInteger(comparedDimensions) || comparedDimensions < 0 || comparedDimensions > 24 || !Number.isInteger(totalDimensions) || totalDimensions < 0 || totalDimensions > 24 || comparedDimensions > totalDimensions || !confidence || raw.basis !== undefined && !basis) return { error: `${index + 1}번째 후보의 성능 비교 근거 요약이 올바르지 않습니다.` };

  let dimensions: AlternativeComparisonSimilarityDimension[] | undefined;
  if (raw.dimensions !== undefined) {
    if (!Array.isArray(raw.dimensions) || raw.dimensions.length > 12) return { error: `${index + 1}번째 후보의 성능 비교 지표 형식이 올바르지 않습니다.` };
    const ids = new Set<string>();
    dimensions = [];
    for (const item of raw.dimensions) {
      if (!item || typeof item !== "object" || Array.isArray(item)) return { error: `${index + 1}번째 후보의 성능 비교 지표 형식이 올바르지 않습니다.` };
      const dimension = item as Record<string, unknown>;
      const key = textValue(dimension.key, 120);
      const label = textValue(dimension.label, 160);
      const currentValue = textValue(dimension.currentValue, 500);
      const candidateValue = textValue(dimension.candidateValue, 500);
      const score = Number(dimension.score);
      const weight = Number(dimension.weight);
      const source: SimilarityDimensionSource | undefined = dimension.source === "selected" || dimension.source === "model_reference" ? dimension.source : undefined;
      if (!key || ids.has(key) || !label || !currentValue || !candidateValue || !Number.isFinite(score) || score < 0 || score > 100 || !Number.isFinite(weight) || weight < 0 || weight > 100 || dimension.source !== undefined && !source) return { error: `${index + 1}번째 후보의 성능 비교 지표 값이 올바르지 않습니다.` };
      ids.add(key);
      dimensions.push({ key, label, currentValue, candidateValue, score, weight, ...(source ? { source } : {}) });
    }
    if (dimensions.length === 0) dimensions = undefined;
  }

  let reference: AlternativeComparisonSimilarityReference | undefined;
  if (raw.reference !== undefined) {
    if (!raw.reference || typeof raw.reference !== "object" || Array.isArray(raw.reference)) return { error: `${index + 1}번째 후보의 성능 참조 정보 형식이 올바르지 않습니다.` };
    const referenceValue = raw.reference as Record<string, unknown>;
    const partId = textValue(referenceValue.partId, 160);
    const partName = textValue(referenceValue.partName, 240);
    const category = referenceValue.category === "cpu" || referenceValue.category === "gpu" ? referenceValue.category : undefined;
    const dataQuality = referenceValue.dataQuality === "seed" || referenceValue.dataQuality === "live" || referenceValue.dataQuality === "manual" || referenceValue.dataQuality === "incomplete" ? referenceValue.dataQuality : undefined;
    const updatedAt = textValue(referenceValue.updatedAt, 80);
    const transferredDimensions = Array.isArray(referenceValue.transferredDimensions) && referenceValue.transferredDimensions.length <= 12
      ? referenceValue.transferredDimensions.map((item) => textValue(item, 120))
      : undefined;
    const benchmarkSourceKind: BenchmarkSourceKind | undefined = referenceValue.benchmarkSourceKind === "official" || referenceValue.benchmarkSourceKind === "independent_review" || referenceValue.benchmarkSourceKind === "community_measurement" || referenceValue.benchmarkSourceKind === "other" ? referenceValue.benchmarkSourceKind : undefined;
    if (!partId || !partName || !category || !dataQuality || !updatedAt || !transferredDimensions || transferredDimensions.some((item): item is undefined => !item) || referenceValue.benchmarkSourceKind !== undefined && !benchmarkSourceKind) return { error: `${index + 1}번째 후보의 성능 참조 정보가 올바르지 않습니다.` };
    reference = { partId, partName, category, dataQuality, updatedAt, transferredDimensions: transferredDimensions as string[], ...(benchmarkSourceKind ? { benchmarkSourceKind } : {}) };
  }

  let notes: string[] | undefined;
  if (raw.notes !== undefined) {
    if (!Array.isArray(raw.notes) || raw.notes.length > 8) return { error: `${index + 1}번째 후보의 성능 근거 메모 형식이 올바르지 않습니다.` };
    const parsedNotes = raw.notes.map((item) => textValue(item, 500));
    if (parsedNotes.some((item) => !item)) return { error: `${index + 1}번째 후보의 성능 근거 메모 값이 올바르지 않습니다.` };
    notes = parsedNotes.filter((item): item is string => Boolean(item));
    if (notes.length === 0) notes = undefined;
  }
  return { evidence: { comparedDimensions, totalDimensions, confidence, ...(basis ? { basis } : {}), ...(dimensions ? { dimensions } : {}), ...(reference ? { reference } : {}), ...(notes ? { notes: notes as string[] } : {}) } };
}

function valueLabelFromUnknown(value: unknown): ValueLabel | undefined {
  return value === "가성비 우수" || value === "가성비 균형" || value === "가격 대비 낮음" ? value : undefined;
}

function physicalEvidenceSourcesFromUnknown(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const sources = value.slice(0, 3).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const source = item as Record<string, unknown>;
    const category: PhysicalEvidenceSource["category"] | undefined = source.category === "gpu" || source.category === "case" || source.category === "psu" ? source.category : undefined;
    const note = textValue(source.note, 500);
    if (!category || !note) return [];
    const manufacturerModel = textValue(source.manufacturerModel, 160);
    const manufacturerRevision = textValue(source.manufacturerRevision, 120);
    const updatedAt = textValue(source.updatedAt, 80);
    const url = typeof source.url === "string" ? safeHttpsUrl(source.url) : undefined;
    return [{ category, note, ...(manufacturerModel ? { manufacturerModel } : {}), ...(manufacturerRevision ? { manufacturerRevision } : {}), ...(updatedAt ? { updatedAt } : {}), ...(url ? { url } : {}) }];
  });
  return sources.length > 0 ? sources : undefined;
}

function scenarioChecksFromUnknown(value: unknown, index: number): { checks?: AlternativeComparisonScenarioCheck[]; error?: string } {
  if (value === undefined) return {};
  if (!Array.isArray(value) || value.length > 8) return { error: `${index + 1}번째 후보의 구매 전 확인 항목 형식이 올바르지 않습니다.` };
  const ids = new Set<string>();
  const checks: AlternativeComparisonScenarioCheck[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { error: `${index + 1}번째 후보의 구매 전 확인 항목 형식이 올바르지 않습니다.` };
    const check = item as Record<string, unknown>;
    const id = textValue(check.id, 120);
    const kind = check.kind === "compatibility" || check.kind === "price" || check.kind === "physical" || check.kind === "data" || check.kind === "application" ? check.kind : undefined;
    const status = check.status === "ready" || check.status === "review" || check.status === "blocked" ? check.status : undefined;
    const label = textValue(check.label, 160);
    const detail = textValue(check.detail, 500);
    if (!id || ids.has(id) || !kind || !status || !label || !detail) return { error: `${index + 1}번째 후보의 구매 전 확인 항목 값이 올바르지 않습니다.` };
    ids.add(id);
    checks.push({ id, kind, status, label, detail });
  }
  return checks.length > 0 ? { checks } : {};
}

function scenarioTradeoffFromUnknown(value: unknown, index: number): { tradeoff?: AlternativeComparisonScenarioTradeoff; error?: string } {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: `${index + 1}번째 후보의 효율 경계 형식이 올바르지 않습니다.` };
  const raw = value as Record<string, unknown>;
  const frontier = raw.frontier;
  const eligible = raw.eligible;
  const reason = textValue(raw.reason, 500);
  const riskScore = raw.riskScore === undefined ? undefined : Number(raw.riskScore);
  const priceDeltaWon = raw.priceDeltaWon === undefined ? undefined : Number(raw.priceDeltaWon);
  const analysisScore = raw.analysisScore === undefined ? undefined : Number(raw.analysisScore);
  const evidenceScore = raw.evidenceScore === undefined ? undefined : Number(raw.evidenceScore);
  const dominatedByCandidateId = raw.dominatedByCandidateId === undefined ? undefined : textValue(raw.dominatedByCandidateId, 160);
  if (typeof frontier !== "boolean" || (eligible !== undefined && typeof eligible !== "boolean") || !reason
    || (riskScore !== undefined && (!Number.isInteger(riskScore) || riskScore < 0))
    || (priceDeltaWon !== undefined && (!Number.isInteger(priceDeltaWon) || !Number.isFinite(priceDeltaWon)))
    || (analysisScore !== undefined && (!Number.isInteger(analysisScore) || analysisScore < 0 || analysisScore > 100))
    || (evidenceScore !== undefined && (!Number.isInteger(evidenceScore) || evidenceScore < 0 || evidenceScore > 100))
    || (raw.dominatedByCandidateId !== undefined && !dominatedByCandidateId)) return { error: `${index + 1}번째 후보의 효율 경계 값이 올바르지 않습니다.` };
  return { tradeoff: { frontier, ...(eligible !== undefined ? { eligible } : {}), ...(riskScore !== undefined ? { riskScore } : {}), ...(priceDeltaWon !== undefined ? { priceDeltaWon } : {}), ...(analysisScore !== undefined ? { analysisScore } : {}), ...(evidenceScore !== undefined ? { evidenceScore } : {}), ...(dominatedByCandidateId ? { dominatedByCandidateId } : {}), reason } };
}

function scenarioFromUnknown(value: unknown, index: number): { scenario?: AlternativeComparisonScenario; error?: string } {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: `${index + 1}번째 후보의 가상 적용 판단 형식이 올바르지 않습니다.` };
  const scenario = value as Record<string, unknown>;
  const status = scenario.status === "compatible" || scenario.status === "needs_review" || scenario.status === "incompatible" ? scenario.status : undefined;
  const blockerCount = Number(scenario.blockerCount);
  const warningCount = Number(scenario.warningCount);
  const unknownCount = Number(scenario.unknownCount);
  if (!status || !Number.isInteger(blockerCount) || blockerCount < 0 || !Number.isInteger(warningCount) || warningCount < 0 || !Number.isInteger(unknownCount) || unknownCount < 0) return { error: `${index + 1}번째 후보의 가상 적용 위험 수가 올바르지 않습니다.` };
  const rawPriceDelta = scenario.priceDeltaWon;
  const priceDeltaWon = rawPriceDelta === undefined ? undefined : Number(rawPriceDelta);
  if (priceDeltaWon !== undefined && (!Number.isFinite(priceDeltaWon) || !Number.isInteger(priceDeltaWon))) return { error: `${index + 1}번째 후보의 가상 적용 가격 변화가 올바르지 않습니다.` };
  const rawAnalysisScore = scenario.analysisScore;
  const analysisScore = rawAnalysisScore === undefined ? undefined : Number(rawAnalysisScore);
  const analysisScoreLabel = scenario.analysisScoreLabel === undefined
    ? undefined
    : ANALYSIS_SCORE_LABELS.includes(scenario.analysisScoreLabel as typeof ANALYSIS_SCORE_LABELS[number])
      ? scenario.analysisScoreLabel as typeof ANALYSIS_SCORE_LABELS[number]
      : undefined;
  const analysisConfidence = scenario.analysisConfidence === undefined
    ? undefined
    : ANALYSIS_CONFIDENCE.includes(scenario.analysisConfidence as typeof ANALYSIS_CONFIDENCE[number])
      ? scenario.analysisConfidence as typeof ANALYSIS_CONFIDENCE[number]
      : undefined;
  const rawAnalysisScoreDelta = scenario.analysisScoreDelta;
  const analysisScoreDelta = rawAnalysisScoreDelta === undefined ? undefined : Number(rawAnalysisScoreDelta);
  const hasAnalysisMetadata = rawAnalysisScore !== undefined || scenario.analysisScoreLabel !== undefined || scenario.analysisConfidence !== undefined || rawAnalysisScoreDelta !== undefined;
  if ((rawAnalysisScore !== undefined && (analysisScore === undefined || !Number.isFinite(analysisScore) || analysisScore < 0 || analysisScore > 100))
    || (scenario.analysisScoreLabel !== undefined && !analysisScoreLabel)
    || (scenario.analysisConfidence !== undefined && !analysisConfidence)
    || (hasAnalysisMetadata && (!analysisScoreLabel || !analysisConfidence))
    || (analysisScoreDelta !== undefined && (!Number.isFinite(analysisScoreDelta) || analysisScoreDelta < -100 || analysisScoreDelta > 100))) return { error: `${index + 1}번째 후보의 가상 적용 성능 분석 값이 올바르지 않습니다.` };
  const purchaseDecision = textValue(scenario.purchaseDecision, 80);
  const purchaseDecisionSummary = textValue(scenario.purchaseDecisionSummary, 500);
  const rawHistory = scenario.priceHistory;
  let priceHistory: AlternativeComparisonScenarioPriceHistory | undefined;
  if (rawHistory !== undefined) {
    if (!rawHistory || typeof rawHistory !== "object" || Array.isArray(rawHistory)) return { error: `${index + 1}번째 후보의 가격 이력 형식이 올바르지 않습니다.` };
    const history = rawHistory as Record<string, unknown>;
    const windowDays = Number(history.windowDays);
    const sampleCount = Number(history.sampleCount);
    const latestPriceWon = history.latestPriceWon === undefined ? undefined : Number(history.latestPriceWon);
    const minPriceWon = history.minPriceWon === undefined ? undefined : Number(history.minPriceWon);
    const maxPriceWon = history.maxPriceWon === undefined ? undefined : Number(history.maxPriceWon);
    const fromHighPercent = history.fromHighPercent === undefined ? undefined : Number(history.fromHighPercent);
    const currentPositionPercent = history.currentPositionPercent === undefined ? undefined : Number(history.currentPositionPercent);
    if (![7, 30, 90].includes(windowDays) || !Number.isInteger(sampleCount) || sampleCount < 0 || sampleCount > 10000 || [latestPriceWon, minPriceWon, maxPriceWon].some((number) => number !== undefined && (!Number.isFinite(number) || number <= 0)) || [fromHighPercent].some((number) => number !== undefined && !Number.isFinite(number)) || (currentPositionPercent !== undefined && (!Number.isFinite(currentPositionPercent) || currentPositionPercent < 0 || currentPositionPercent > 100)) || typeof history.hasDropThenRebound !== "boolean") return { error: `${index + 1}번째 후보의 가격 이력 값이 올바르지 않습니다.` };
    priceHistory = { windowDays: windowDays as 7 | 30 | 90, sampleCount, ...(latestPriceWon !== undefined ? { latestPriceWon } : {}), ...(minPriceWon !== undefined ? { minPriceWon } : {}), ...(maxPriceWon !== undefined ? { maxPriceWon } : {}), ...(fromHighPercent !== undefined ? { fromHighPercent } : {}), ...(currentPositionPercent !== undefined ? { currentPositionPercent } : {}), hasDropThenRebound: history.hasDropThenRebound };
  }
  const checksResult = scenarioChecksFromUnknown(scenario.checks, index);
  if (checksResult.error) return { error: checksResult.error };
  const tradeoffResult = scenarioTradeoffFromUnknown(scenario.tradeoff, index);
  if (tradeoffResult.error) return { error: tradeoffResult.error };
  return { scenario: { status, blockerCount, warningCount, unknownCount, ...(analysisScore !== undefined ? { analysisScore } : {}), ...(analysisScoreLabel ? { analysisScoreLabel } : {}), ...(analysisConfidence ? { analysisConfidence } : {}), ...(analysisScoreDelta !== undefined ? { analysisScoreDelta } : {}), ...(priceDeltaWon !== undefined ? { priceDeltaWon } : {}), ...(purchaseDecision ? { purchaseDecision } : {}), ...(purchaseDecisionSummary ? { purchaseDecisionSummary } : {}), ...(priceHistory ? { priceHistory } : {}), ...(tradeoffResult.tradeoff ? { tradeoff: tradeoffResult.tradeoff } : {}), ...(checksResult.checks ? { checks: checksResult.checks } : {}) } };
}

function candidateFromUnknown(value: unknown, index: number) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: `${index + 1}번째 후보 형식이 올바르지 않습니다.` };
  const candidate = value as Record<string, unknown>;
  const name = textValue(candidate.name, 240);
  const summary = textValue(candidate.summary, 500);
  const price = textValue(candidate.price, 120);
  const rawPriceWon = candidate.priceWon;
  const priceWon = rawPriceWon === undefined ? undefined : Number(rawPriceWon);
  const priceEvidence = candidate.priceEvidence === undefined ? undefined : catalogPriceEvidenceFromUnknown(candidate.priceEvidence);
  const purchaseCondition = textValue(candidate.purchaseCondition, 240);
  const similarity = textValue(candidate.similarity, 240);
  const rawValueScore = candidate.valueScore;
  const valueScore = rawValueScore === undefined ? undefined : Number(rawValueScore);
  const valueLabel = valueLabelFromUnknown(candidate.valueLabel);
  const rawValueScoreScale = candidate.valueScoreScale;
  const valueScoreScale = rawValueScoreScale === undefined ? undefined : Number(rawValueScoreScale);
  const recommendationTrust = textValue(candidate.recommendationTrust, 120);
  const performance = textValue(candidate.performance, 1_000);
  const compatibility = textValue(candidate.compatibility, 240);
  const decisionSummary = textValue(candidate.decisionSummary, 500);
  const physicalEvidence = textValue(candidate.physicalEvidence, 500);
  const physicalEvidenceSources = physicalEvidenceSourcesFromUnknown(candidate.physicalEvidenceSources);
  const similarityEvidenceResult = similarityEvidenceFromUnknown(candidate.similarityEvidence, index);
  if (similarityEvidenceResult.error) return { error: similarityEvidenceResult.error };
  const benchmarkEvidenceResult = benchmarkEvidenceFromUnknown(candidate.benchmarkEvidence, index);
  if (benchmarkEvidenceResult.error) return { error: benchmarkEvidenceResult.error };
  const scenarioResult = scenarioFromUnknown(candidate.scenario, index);
  if (scenarioResult.error) return { error: scenarioResult.error };
  const category: PartCategory | undefined = PART_CATEGORIES.includes(candidate.category as PartCategory) ? candidate.category as PartCategory : undefined;
  const partId = candidate.partId === undefined ? undefined : textValue(candidate.partId, 160);
  if ((candidate.category !== undefined && category === undefined) || (candidate.partId !== undefined && !partId) || (category === undefined) !== (partId === undefined)) return { error: `${index + 1}번째 후보의 카탈로그 식별자가 올바르지 않습니다.` };
  const dataQuality = textValue(candidate.dataQuality, 80);
  if (!name || !summary || !price || !similarity || !performance || !compatibility || !dataQuality) return { error: `${index + 1}번째 후보의 비교 정보가 부족합니다.` };
  if (benchmarkEvidenceResult.evidence && (!category || !partId || benchmarkEvidenceResult.evidence.category !== category || benchmarkEvidenceResult.evidence.partId !== partId)) return { error: `${index + 1}번째 후보의 원본 성능 근거와 카탈로그 식별자가 일치하지 않습니다.` };
  if (priceWon !== undefined && (!Number.isInteger(priceWon) || !isKnownPrice(priceWon))) return { error: `${index + 1}번째 후보의 현재 가격 값이 올바르지 않습니다.` };
  if (candidate.priceEvidence !== undefined && !priceEvidence) return { error: `${index + 1}번째 후보의 가격 근거 값이 올바르지 않습니다.` };
  if (valueScore !== undefined && (!Number.isInteger(valueScore) || valueScore < 0 || valueScore > VALUE_SCORE_MAX || !valueLabel)) return { error: `${index + 1}번째 후보의 가격 대비 유사도 점수가 올바르지 않습니다.` };
  if (valueLabel && valueScore === undefined) return { error: `${index + 1}번째 후보의 가격 대비 유사도 점수가 필요합니다.` };
  if (valueScoreScale !== undefined && valueScoreScale !== VALUE_SCORE_MAX) return { error: `${index + 1}번째 후보의 가격 대비 유사도 점수 스케일이 올바르지 않습니다.` };
  const recommendedQuantity = candidate.recommendedQuantity === undefined ? undefined : Number(candidate.recommendedQuantity);
  if (recommendedQuantity !== undefined && (!Number.isInteger(recommendedQuantity) || recommendedQuantity <= 0 || recommendedQuantity > 99)) return { error: `${index + 1}번째 후보의 추천 수량이 올바르지 않습니다.` };
  const gpuTarget = textValue(candidate.gpuTarget, 1_000);
  const updatedAt = textValue(candidate.updatedAt, 80);
  const dataFreshness = dataFreshnessFromUnknown(candidate.dataFreshness);
  const sourceUrl = typeof candidate.sourceUrl === "string" ? safeExternalUrl(candidate.sourceUrl) : undefined;
  return {
    candidate: {
      name,
      summary,
      price,
      ...(priceWon !== undefined ? { priceWon } : {}),
      ...(priceEvidence ? { priceEvidence } : {}),
      ...(purchaseCondition ? { purchaseCondition } : {}),
      ...(recommendedQuantity !== undefined ? { recommendedQuantity } : {}),
      similarity,
      ...(gpuTarget ? { gpuTarget } : {}),
      ...(valueScore !== undefined && valueLabel ? { valueScore, valueLabel, valueScoreScale: VALUE_SCORE_MAX as 200 } : {}),
      ...(recommendationTrust ? { recommendationTrust } : {}),
      performance,
      compatibility,
      ...(similarityEvidenceResult.evidence ? { similarityEvidence: similarityEvidenceResult.evidence } : {}),
      ...(benchmarkEvidenceResult.evidence ? { benchmarkEvidence: benchmarkEvidenceResult.evidence } : {}),
      ...(category && partId ? { category, partId } : {}),
      ...(decisionSummary ? { decisionSummary } : {}),
      ...(physicalEvidence ? { physicalEvidence } : {}),
      ...(physicalEvidenceSources ? { physicalEvidenceSources } : {}),
      ...(scenarioResult.scenario ? { scenario: scenarioResult.scenario } : {}),
      dataQuality,
      ...(dataFreshness ? { dataFreshness } : {}),
      ...(updatedAt ? { updatedAt } : {}),
      ...(sourceUrl ? { sourceUrl } : {})
    } satisfies AlternativeComparisonCandidate
  };
}

export function parseAlternativeComparisonInput(input: unknown): AlternativeComparisonInputResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { candidates: [], errors: ["후보 비교 저장 형식이 올바르지 않습니다."] };
  const candidate = input as AlternativeComparisonCreateInput;
  const name = textValue(candidate.name, 60) ?? "대체 후보 비교";
  const category = textValue(candidate.category, 80);
  const currentPartName = textValue(candidate.currentPartName, 240);
  const currentPartSummary = textValue(candidate.currentPartSummary, 500);
  const currentPartPrice = textValue(candidate.currentPartPrice, 120);
  const catalogSnapshotAt = candidate.catalogSnapshotAt === undefined ? undefined : textValue(candidate.catalogSnapshotAt, 80);
  const engineVersion = candidate.engineVersion === undefined ? undefined : textValue(candidate.engineVersion, 120);
  const context = { name, ...(category ? { category } : {}), ...(currentPartName ? { currentPartName } : {}), ...(currentPartSummary ? { currentPartSummary } : {}), ...(currentPartPrice ? { currentPartPrice } : {}), ...(catalogSnapshotAt ? { catalogSnapshotAt } : {}), ...(engineVersion ? { engineVersion } : {}) };
  if (candidate.catalogSnapshotAt !== undefined && (!catalogSnapshotAt || !Number.isFinite(Date.parse(catalogSnapshotAt)))) return { ...context, candidates: [], errors: ["비교 snapshot의 카탈로그 기준 시점이 올바르지 않습니다."] };
  if (candidate.engineVersion !== undefined && !engineVersion) return { ...context, candidates: [], errors: ["비교 snapshot의 엔진 버전이 올바르지 않습니다."] };
  const expiresInDays = shareExpiryDaysFrom(candidate.expiresInDays);
  if (shareExpiryValueProvided(candidate.expiresInDays) && expiresInDays === undefined) return { ...context, candidates: [], errors: ["비교 링크 유효기간은 무기한, 7일, 30일 중 하나여야 합니다."] };
  if (!Array.isArray(candidate.candidates) || candidate.candidates.length < 2 || candidate.candidates.length > MAX_CANDIDATES) return { ...context, candidates: [], errors: [`후보 비교는 2개 이상 ${MAX_CANDIDATES}개 이하로 저장할 수 있습니다.`] };
  const parsed = candidate.candidates.map(candidateFromUnknown);
  const errors = parsed.flatMap((value) => value.error ? [value.error] : []);
  if (errors.length > 0) return { ...context, candidates: [], errors };
  return {
    ...context,
    candidates: parsed.map((value) => value.candidate!).filter((value): value is AlternativeComparisonCandidate => Boolean(value)),
    ...(expiresInDays !== undefined ? { expiresInDays } : {}),
    errors: []
  };
}

export function alternativeComparisonExpired(comparison: Pick<AlternativeComparisonSnapshot, "expiresAt">, now = Date.now()) {
  return shareExpired(comparison.expiresAt, now);
}

export function savedAlternativeComparisonFromUnknown(value: unknown): SavedAlternativeComparisonRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const parsed = parseAlternativeComparisonInput(candidate);
  const expiresAt = normalizeShareExpiryAt(candidate.expiresAt);
  const ownerTokenHash = typeof candidate.ownerTokenHash === "string" && /^[0-9a-f]{64}$/.test(candidate.ownerTokenHash) ? candidate.ownerTokenHash : undefined;
  if (parsed.errors.length > 0 || typeof candidate.id !== "string" || !candidate.id || typeof candidate.createdAt !== "string" || typeof candidate.updatedAt !== "string" || !expiresAt.valid) return undefined;
  return {
    id: candidate.id,
    name: parsed.name ?? "대체 후보 비교",
    ...(parsed.category ? { category: parsed.category } : {}),
    ...(parsed.currentPartName ? { currentPartName: parsed.currentPartName } : {}),
    ...(parsed.currentPartSummary ? { currentPartSummary: parsed.currentPartSummary } : {}),
    ...(parsed.currentPartPrice ? { currentPartPrice: parsed.currentPartPrice } : {}),
    ...(parsed.catalogSnapshotAt ? { catalogSnapshotAt: parsed.catalogSnapshotAt } : {}),
    ...(parsed.engineVersion ? { engineVersion: parsed.engineVersion } : {}),
    candidates: parsed.candidates,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    ...(expiresAt.value ? { expiresAt: expiresAt.value } : {}),
    ...(ownerTokenHash ? { ownerTokenHash } : {})
  };
}

export function publicAlternativeComparison(record: SavedAlternativeComparisonRecord): AlternativeComparisonSnapshot {
  const { ownerTokenHash: _ownerTokenHash, ...comparison } = record;
  return comparison;
}

export function alternativeComparisonExpiresAtFor(expiresInDays: 7 | 30 | undefined, now: number | Date = Date.now()) {
  return shareExpiresAtFor(expiresInDays, now);
}
