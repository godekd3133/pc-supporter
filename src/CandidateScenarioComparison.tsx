import { useEffect, useMemo, useState } from "react";
import { FiActivity, FiCheckCircle, FiClock, FiInfo, FiLoader, FiRefreshCw, FiSave, FiShare2, FiXCircle, FiZap } from "react-icons/fi";
import type { AlternativeRisk, BuildSelection, CompatiblePartCandidate, CompatibilityResult, Part, PartCategory } from "../shared/types";
import { CATEGORY_LABELS, DATA_QUALITY_LABELS, isKnownPrice, LISTING_TYPE_LABELS } from "../shared/types";
import { catalogPriceEvidenceFor, catalogPriceEvidenceLabelFor } from "../shared/catalog-price-evidence";
import type { BuildScenarioComparison } from "../shared/build-scenario";
import { partSpecDiffFor } from "../shared/part-spec-diff";
import { alternativeComparisonBenchmarkEvidenceFor, alternativeComparisonSimilarityEvidenceFor } from "../shared/alternative-comparison-export";
import { benchmarkComparisonRowsFor, benchmarkEvidenceForPart, benchmarkFreshnessLabelFor, benchmarkSourceCheckLabelFor } from "../shared/benchmark-evidence";
import { similarityBasisLabelFor, similarityReferenceTextFor } from "../shared/similarity-evidence";
import type { AlternativeComparisonCandidate } from "../shared/alternative-comparison-export";
import type { AlternativeComparisonScenario, AlternativeComparisonScenarioCheck } from "../shared/alternative-comparison-scenario";
import { CATALOG_WATCHLIST_STORAGE_KEY, catalogWatchlistContains, catalogWatchlistFromJson, catalogWatchlistToJson, updateCatalogWatchEntry } from "../shared/catalog-watchlist";
import { candidatePurchaseDecisionFor } from "../shared/candidate-purchase-decision";
import type { CandidatePurchaseDecision, CandidatePurchasePriceHistory } from "../shared/candidate-purchase-decision";
import { CANDIDATE_COMPARISON_CRITERIA, candidateComparisonDecisionFor, candidateComparisonTradeoffsFor } from "../shared/candidate-comparison";
import type { CandidateComparisonCriterion, CandidateComparisonTradeoff } from "../shared/candidate-comparison";
import { api } from "./api";
import { recommendedTargetPriceFromHistory } from "./price-target";
import { safeExternalUrl } from "./safe-source-url";
import { useModalAccessibility } from "./use-modal-accessibility";

type CandidateScenarioPart = Part & Partial<Pick<CompatiblePartCandidate, "candidateRisk" | "candidateReasons" | "similarityScore" | "similarityLabel" | "similarityEvidence" | "performanceSummary" | "valueScore" | "valueLabel" | "recommendationTrust" | "decision" | "physicalEvidence">>;
type CandidatePriceHistoryDays = 7 | 30 | 90;
type CandidatePriceHistory = {
  kind: "part";
  itemId: string;
  windowDays: CandidatePriceHistoryDays;
  points: Array<{ changeId: string; changedAt: string; priceWon: number; deltaWon?: number }>;
  summary: {
    sampleCount: number;
    latestPriceWon?: number;
    minPriceWon?: number;
    maxPriceWon?: number;
    fromHighPercent?: number;
    currentPositionPercent?: number;
    hasDropThenRebound: boolean;
  };
};

const COMPARISON_CRITERION_LABELS: Record<CandidateComparisonCriterion, string> = {
  balanced: "균형",
  compatibility: "호환 우선",
  performance: "성능 우선",
  price: "가격 우선",
  evidence: "근거 우선"
};

type CandidateScenarioShareResult = { id: string; url: string; ownerToken: string; expiresAt?: string };
type CandidateScenarioShareHandler = (candidates: AlternativeComparisonCandidate[], context?: { name?: string; category?: string; currentPartName?: string; currentPartSummary?: string; currentPartPrice?: string }) => Promise<CandidateScenarioShareResult | undefined>;
type CandidateScenarioRevokeHandler = (share: CandidateScenarioShareResult) => Promise<boolean>;

export type CandidateScenarioCompareItem = {
  id: string;
  category: PartCategory;
  part: CandidateScenarioPart;
  currentParts: Part[];
  currentPartQuantities?: number[];
  risk?: AlternativeRisk;
  quantity?: number;
  affectedPartIds?: string[];
  nextBuild: BuildSelection;
  status: "loading" | "ready" | "error";
  result?: CompatibilityResult;
  comparison?: BuildScenarioComparison;
  error?: string;
};

export type CandidateScenarioInput = {
  category: PartCategory;
  part: CandidateScenarioPart;
  risk?: AlternativeRisk;
  quantity?: number;
  affectedPartIds?: string[];
};

export type CandidateScenarioCompareState = {
  category: PartCategory;
  items: CandidateScenarioCompareItem[];
};

function statusLabel(status: CompatibilityResult["status"]) {
  return status === "compatible" ? "호환 가능" : status === "needs_review" ? "확인 필요" : "호환 불가";
}

function riskLabel(risk: AlternativeRisk | undefined) {
  return risk === "safe" ? "후보 안전" : risk === "review" ? "후보 확인 필요" : risk === "unsafe" ? "후보 차단" : "후보 평가 완료";
}

function directionLabel(direction: BuildScenarioComparison["direction"] | undefined) {
  return direction === "improved" ? "위험 감소" : direction === "worsened" ? "위험 증가" : direction === "changed" ? "일부 변화" : "변화 없음";
}

function trustLabel(level: NonNullable<CandidateScenarioPart["recommendationTrust"]>["level"]) {
  return level === "high" ? "높음" : level === "medium" ? "보통" : "낮음";
}

function currentPartLabel(parts: Part[], quantities?: number[]) {
  return parts.length > 0 ? parts.map((part, index) => `${part.name}${(quantities?.[index] ?? 1) > 1 ? ` ×${quantities?.[index]}` : ""}`).join(" · ") : "현재 부품 미선택";
}

function priceDeltaLabel(current: CompatibilityResult, next: CompatibilityResult) {
  if (!current.priceComplete || !next.priceComplete) return "가격 확인 필요";
  const delta = next.totalPriceWon - current.totalPriceWon;
  return delta === 0 ? "현재와 동일" : `${delta > 0 ? "+" : ""}${delta.toLocaleString("ko-KR")}원`;
}

function analysisScoreText(score: number | undefined, label: CompatibilityResult["analysis"]["scoreLabel"]) {
  return score === undefined ? label : `${score}점 · ${label}`;
}

function analysisConfidenceLabel(confidence: CompatibilityResult["analysis"]["confidence"]) {
  return confidence === "high" ? "근거 충분" : confidence === "limited" ? "일부 스펙 기준" : "계산 불가";
}

function scenarioAnalysisDetail(current: CompatibilityResult, next: CompatibilityResult) {
  if (current.analysis.overallScore !== undefined && next.analysis.overallScore !== undefined) {
    const delta = next.analysis.overallScore - current.analysis.overallScore;
    return `현재 대비 ${delta > 0 ? "+" : ""}${delta}점 · ${analysisConfidenceLabel(next.analysis.confidence)}`;
  }
  return `분석 근거 ${analysisConfidenceLabel(next.analysis.confidence)}`;
}

function scenarioAnalysisSummary(current: CompatibilityResult, next: CompatibilityResult) {
  return `후보 적용 후 성능 분석 ${analysisScoreText(next.analysis.overallScore, next.analysis.scoreLabel)} · ${scenarioAnalysisDetail(current, next)}`;
}

function candidatePurchaseDecisionForItem(item: CandidateScenarioCompareItem, currentResult: CompatibilityResult, result: CompatibilityResult, history?: CandidatePriceHistory): CandidatePurchaseDecision {
  return candidatePurchaseDecisionFor({
    name: item.part.name,
    candidateRisk: item.risk ?? item.part.candidateRisk,
    decisionStatus: item.part.decision?.status,
    nextStatus: result.status,
    remainingBlockers: result.blockerCount,
    remainingWarnings: result.warningCount,
    remainingUnknown: result.unknownCount,
    priceKnown: isKnownPrice(item.part.priceWon),
    priceEvidence: catalogPriceEvidenceFor(item.part),
    totalPriceKnown: result.priceComplete,
    priceDeltaWon: item.comparison?.priceDeltaWon,
    similarityScore: item.part.similarityScore,
    similarityConfidence: item.part.similarityEvidence?.confidence,
    benchmarkFreshness: item.part.recommendationTrust?.benchmarkFreshness,
    benchmarkSourceCheckNeedsReview: item.part.recommendationTrust?.benchmarkSourceCheckNeedsReview,
    catalogSpecSourceCheckNeedsReview: item.part.recommendationTrust?.catalogSpecSourceCheckNeedsReview,
    ...(currentResult.analysis.overallScore !== undefined && result.analysis.overallScore !== undefined ? { analysisScoreDelta: result.analysis.overallScore - currentResult.analysis.overallScore } : {}),
    analysisConfidence: result.analysis.confidence,
    recommendationTrustScore: item.part.recommendationTrust?.score,
    recommendationTrustLevel: item.part.recommendationTrust?.level,
    freshness: item.part.dataFreshness ?? item.part.recommendationTrust?.freshness,
    physicalStatus: item.part.physicalEvidence?.status,
    ...(history ? { priceHistory: history.summary satisfies CandidatePurchasePriceHistory } : {})
  });
}

function scenarioPartSummary(part: Part) {
  return [
    part.specs.socket,
    part.specs.memoryType,
    part.specs.capacityGb !== undefined ? `${part.specs.capacityGb}GB` : undefined,
    part.specs.vramGb !== undefined ? `VRAM ${part.specs.vramGb}GB` : undefined,
    part.specs.cores !== undefined ? `${part.specs.cores}코어` : undefined,
    part.specs.threads !== undefined ? `${part.specs.threads}스레드` : undefined,
    part.specs.interface
  ].filter((value): value is string => typeof value === "string" && value.length > 0).slice(0, 5).join(" · ") || "핵심 스펙 확인 필요";
}

function scenarioPriceHistoryFor(history?: CandidatePriceHistory): AlternativeComparisonScenario["priceHistory"] | undefined {
  if (!history) return undefined;
  return { windowDays: history.windowDays, ...history.summary };
}

function scenarioChecksFor(item: CandidateScenarioCompareItem, result: CompatibilityResult, decision: CandidatePurchaseDecision, history: CandidatePriceHistory | undefined, formatWon: (value: number | undefined) => string): AlternativeComparisonScenarioCheck[] {
  const checks: AlternativeComparisonScenarioCheck[] = [];
  const compatibilityStatus: AlternativeComparisonScenarioCheck["status"] = result.blockerCount > 0 || result.status === "incompatible"
    ? "blocked"
    : result.warningCount > 0 || result.unknownCount > 0 || result.status === "needs_review"
      ? "review"
      : "ready";
  checks.push({
    id: "compatibility",
    kind: "compatibility",
    status: compatibilityStatus,
    label: compatibilityStatus === "blocked" ? "가상 적용 차단 원인 해결" : compatibilityStatus === "review" ? "가상 적용 후 잔여 위험 확인" : "가상 적용 호환 판정 확인",
    detail: result.blockerCount > 0 || result.warningCount > 0 || result.unknownCount > 0
      ? `차단 ${result.blockerCount}개 · 주의 ${result.warningCount}개 · 확인 필요 ${result.unknownCount}개가 남아 있어 적용 전 원인을 확인해야 합니다.`
      : "가상 적용 후 차단·주의·확인 필요 항목이 없습니다. 실제 적용 전 변경 미리보기를 확인하세요."
  });

  const priceEvidence = catalogPriceEvidenceFor(item.part);
  const priceEvidenceNeedsReview = priceEvidence !== "live" && priceEvidence !== "manual";
  const priceStatus: AlternativeComparisonScenarioCheck["status"] = priceEvidenceNeedsReview || !result.priceComplete ? "review" : decision.state === "wait" ? "review" : "ready";
  checks.push({
    id: "price",
    kind: "price",
    status: priceStatus,
    label: priceStatus === "review" ? "가격·가격 이력 확인" : "후보·적용 후 가격 확인",
    detail: priceEvidence === "reference"
      ? "프로젝트 기준가만 기록되어 후보의 실제 판매 가격을 확정할 수 없습니다. 구매 전에 판매처 원문을 확인하세요."
      : priceEvidence === "recorded"
        ? "후보 가격은 기록되어 있지만 데이터 품질이 완전하지 않습니다. 구매 전에 판매처 원문을 확인하세요."
        : priceEvidence === "unknown" || !result.priceComplete
          ? "후보 또는 전체 견적의 가격이 확정되지 않아 구매 전 실제 판매 가격을 확인해야 합니다."
      : `${formatWon(item.part.priceWon)} 후보 · 적용 후 ${formatWon(result.totalPriceWon)} · ${history?.summary.sampleCount ? `최근 ${history.windowDays}일 ${history.summary.sampleCount}회 가격 이력` : "가격 변경 이력 없음"}`
  });

  if (["gpu", "case", "psu"].includes(item.category)) {
    const physicalStatus: AlternativeComparisonScenarioCheck["status"] = item.part.physicalEvidence?.status === "verified" ? "ready" : "review";
    checks.push({
      id: "physical",
      kind: "physical",
      status: physicalStatus,
      label: physicalStatus === "ready" ? "물리 장착 근거 확인" : "물리 장착·전원 근거 확인",
      detail: item.part.physicalEvidence?.status === "verified"
        ? "후보의 물리 장착·전원 관련 검수 근거가 확인되었습니다. 실제 케이스·케이블 배치는 조립 전에 다시 확인하세요."
        : "길이·두께·전원·케이블 또는 케이스 간섭 근거가 완전히 검수되지 않아 제조사 원문과 실제 조립 조건을 확인해야 합니다."
    });
  }

  const dataStatus: AlternativeComparisonScenarioCheck["status"] = item.part.dataQuality === "incomplete" || item.part.dataFreshness === "stale" || item.part.dataFreshness === "unknown" ? "review" : "ready";
  checks.push({
    id: "data",
    kind: "data",
    status: dataStatus,
    label: dataStatus === "review" ? "카탈로그 원문·갱신 시점 확인" : "카탈로그 근거 확인",
    detail: dataStatus === "review"
      ? "스펙 일부가 부족하거나 갱신 시점이 오래되어 구매 전에 제조사·판매처 원문을 다시 확인해야 합니다."
      : "후보의 가격·스펙·갱신 상태 근거가 현재 비교 기준에 포함되어 있습니다."
  });

  const applicationStatus: AlternativeComparisonScenarioCheck["status"] = decision.state === "hold" ? "blocked" : decision.state === "review" || decision.state === "wait" ? "review" : "ready";
  checks.push({
    id: "application",
    kind: "application",
    status: applicationStatus,
    label: applicationStatus === "blocked" ? "후보 적용 보류" : "현재 견적 적용 전 미리보기 확인",
    detail: applicationStatus === "blocked"
      ? "현재 snapshot의 차단 위험 때문에 이 후보는 실제 견적에 적용하지 않습니다."
      : "후보를 실제 견적에 적용할 때는 변경 예정 부품·가격·전체 재검사 결과를 확인한 뒤 진행하세요."
  });
  return checks;
}

function scenarioShareCandidateFor(item: CandidateScenarioCompareItem, currentResult: CompatibilityResult, result: CompatibilityResult, decision: CandidatePurchaseDecision, history: CandidatePriceHistory | undefined, formatWon: (value: number | undefined) => string, tradeoff?: CandidateComparisonTradeoff): AlternativeComparisonCandidate {
  const sourceUrl = safeExternalUrl(item.part.danawaUrl);
  const priceEvidence = catalogPriceEvidenceFor(item.part);
  const benchmarkEvidence = alternativeComparisonBenchmarkEvidenceFor(benchmarkEvidenceForPart(item.part));
  const scenarioTradeoff = tradeoff ? {
    frontier: tradeoff.frontier,
    ...(tradeoff.eligible !== undefined ? { eligible: tradeoff.eligible } : {}),
    ...(tradeoff.riskScore !== undefined ? { riskScore: tradeoff.riskScore } : {}),
    ...(tradeoff.priceDeltaWon !== undefined ? { priceDeltaWon: tradeoff.priceDeltaWon } : {}),
    ...(tradeoff.analysisScore !== undefined ? { analysisScore: tradeoff.analysisScore } : {}),
    ...(tradeoff.evidenceScore !== undefined ? { evidenceScore: tradeoff.evidenceScore } : {}),
    ...(tradeoff.dominatedByCandidateId ? { dominatedByCandidateId: tradeoff.dominatedByCandidateId } : {}),
    reason: tradeoff.reason
  } as const : undefined;
  return {
    name: item.part.name,
    category: item.category,
    partId: item.part.id,
    summary: scenarioPartSummary(item.part),
    price: isKnownPrice(item.part.priceWon) ? formatWon(item.part.priceWon) : "가격 확인 필요",
    ...(isKnownPrice(item.part.priceWon) ? { priceWon: item.part.priceWon } : {}),
    priceEvidence,
    purchaseCondition: `${catalogPriceEvidenceLabelFor(item.part)} · ${item.part.listingType ? LISTING_TYPE_LABELS[item.part.listingType] : LISTING_TYPE_LABELS.retail}`,
    similarity: item.part.similarityScore !== undefined ? `${item.part.similarityLabel ?? "비교"} ${item.part.similarityScore}점` : "계산 불가",
    ...(item.part.valueScore !== undefined && item.part.valueLabel ? { valueScore: item.part.valueScore, valueLabel: item.part.valueLabel, valueScoreScale: 200 as const } : {}),
    ...(item.part.recommendationTrust ? { recommendationTrust: `${item.part.recommendationTrust.level === "high" ? "높음" : item.part.recommendationTrust.level === "medium" ? "보통" : "낮음"} ${item.part.recommendationTrust.score}점` } : {}),
    performance: [item.part.performanceSummary, scenarioAnalysisSummary(currentResult, result)].filter((value): value is string => Boolean(value)).join(" · "),
    compatibility: `${statusLabel(result.status)} · 차단 ${result.blockerCount} · 주의 ${result.warningCount} · 확인 필요 ${result.unknownCount}`,
    ...(benchmarkEvidence ? { benchmarkEvidence } : {}),
    ...(alternativeComparisonSimilarityEvidenceFor(item.part.similarityEvidence) ? { similarityEvidence: alternativeComparisonSimilarityEvidenceFor(item.part.similarityEvidence) } : {}),
    ...(item.part.decision ? { decisionSummary: `${item.part.decision.label} · ${item.part.decision.summary}` } : {}),
    ...(item.part.physicalEvidence ? { physicalEvidence: item.part.physicalEvidence.summary } : {}),
    dataQuality: DATA_QUALITY_LABELS[item.part.dataQuality],
    ...(item.part.dataFreshness ? { dataFreshness: item.part.dataFreshness } : {}),
    ...(item.part.updatedAt ? { updatedAt: new Date(item.part.updatedAt).toLocaleDateString("ko-KR") } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    scenario: {
      status: result.status,
      blockerCount: result.blockerCount,
      warningCount: result.warningCount,
      unknownCount: result.unknownCount,
      ...(result.analysis.overallScore !== undefined ? { analysisScore: result.analysis.overallScore } : {}),
      analysisScoreLabel: result.analysis.scoreLabel,
      analysisConfidence: result.analysis.confidence,
      ...(currentResult.analysis.overallScore !== undefined && result.analysis.overallScore !== undefined ? { analysisScoreDelta: result.analysis.overallScore - currentResult.analysis.overallScore } : {}),
      ...(item.comparison?.priceDeltaWon !== undefined ? { priceDeltaWon: item.comparison.priceDeltaWon } : {}),
      purchaseDecision: decision.label,
      purchaseDecisionSummary: decision.summary,
      ...(scenarioPriceHistoryFor(history) ? { priceHistory: scenarioPriceHistoryFor(history) } : {}),
      ...(scenarioTradeoff ? { tradeoff: scenarioTradeoff } : {}),
      checks: scenarioChecksFor(item, result, decision, history, formatWon)
    }
  };
}

function benchmarkScoreText(value: number | undefined) {
  return value === undefined ? "확인 필요" : `${value.toLocaleString("ko-KR")}점`;
}

function benchmarkDeltaText(delta: number | undefined, deltaPercent: number | undefined) {
  if (delta === undefined) return "비교 불가";
  return `${delta > 0 ? "+" : ""}${delta.toLocaleString("ko-KR")}점${deltaPercent === undefined ? "" : ` · ${deltaPercent > 0 ? "+" : ""}${deltaPercent.toFixed(1)}%`}`;
}

function CandidateBenchmarkEvidence({ currentParts, candidate, similarityEvidence }: { currentParts: Part[]; candidate: Part; similarityEvidence?: CandidateScenarioPart["similarityEvidence"] }) {
  if (candidate.category !== "cpu" && candidate.category !== "gpu") return null;
  const currentPart = currentParts.find((part) => part.category === candidate.category);
  const currentEvidence = benchmarkEvidenceForPart(currentPart);
  const candidateEvidence = benchmarkEvidenceForPart(candidate);
  if (!candidateEvidence) return null;
  const comparisonRows = benchmarkComparisonRowsFor(currentEvidence, candidateEvidence);
  const currentStatus = currentEvidence ? `${currentEvidence.presentCount}/${currentEvidence.totalCount}개 · ${benchmarkFreshnessLabelFor(currentEvidence.benchmarkFreshness)}` : "점수 미기록";
  const candidateStatus = `${candidateEvidence.presentCount}/${candidateEvidence.totalCount}개 · ${benchmarkFreshnessLabelFor(candidateEvidence.benchmarkFreshness)}`;
  const sourceCheck = benchmarkSourceCheckLabelFor(candidateEvidence.sourceCheck);
  return <div className={`candidate-scenario-benchmark ${candidateEvidence.status}`} data-testid="candidate-scenario-benchmark"><div className="candidate-scenario-benchmark-heading"><strong>원본 benchmark 비교</strong><small>{currentStatus} → 후보 {candidateStatus}</small></div><div className="candidate-scenario-benchmark-list">{comparisonRows.map((row) => { const delta = benchmarkDeltaText(row.delta, row.deltaPercent); return <div key={row.key}><span>{row.label}</span><em>{benchmarkScoreText(row.currentValue)}</em><b>→</b><em>{benchmarkScoreText(row.candidateValue)}</em><small className={delta === "비교 불가" ? "review" : row.delta !== undefined && row.delta >= 0 ? "positive" : "negative"}>{delta}</small></div>; })}</div><small className="candidate-scenario-benchmark-note">후보 원문 점검 · {sourceCheck} · 자료 {benchmarkFreshnessLabelFor(candidateEvidence.benchmarkFreshness)} · 유사도 {similarityBasisLabelFor(similarityEvidence)}. 원본 점수 변화는 성능 참고 근거이며 실제 FPS·작업 시간·절대 순위를 보장하지 않습니다.</small>{similarityEvidence?.reference && <small className="candidate-scenario-benchmark-reference" data-testid="candidate-scenario-benchmark-reference"><FiInfo /> {similarityReferenceTextFor(similarityEvidence)}. 후보 원본 점수와 동일한 측정값으로 간주하지 않습니다.</small>}</div>;
}

function priceHistoryBarHeight(history: CandidatePriceHistory, priceWon: number) {
  const prices = history.points.map((point) => point.priceWon);
  if (prices.length === 0) return 52;
  const minPriceWon = Math.min(...prices);
  const maxPriceWon = Math.max(...prices);
  if (maxPriceWon === minPriceWon) return 52;
  return 18 + ((priceWon - minPriceWon) / (maxPriceWon - minPriceWon)) * 82;
}

function CandidatePriceHistoryPanel({ history, days, loading, error }: { history?: CandidatePriceHistory; days: CandidatePriceHistoryDays; loading: boolean; error: string | null }) {
  if (loading && !history) return <div className="candidate-scenario-price-history loading"><FiClock className="spin" /> 가격 이력을 불러오는 중...</div>;
  if (error && !history) return <div className="candidate-scenario-price-history error"><FiInfo /> 가격 이력을 확인하지 못했습니다.</div>;
  if (!history || history.summary.sampleCount === 0) return <div className="candidate-scenario-price-history empty"><FiClock /> 최근 {days}일 가격 변경 이력이 없습니다.</div>;
  const summary = history.summary;
  const summaryText = `최근 ${history.windowDays}일 ${summary.sampleCount}회${summary.latestPriceWon !== undefined ? ` · 최근 ${summary.latestPriceWon.toLocaleString("ko-KR")}원` : ""}${summary.minPriceWon !== undefined ? ` · 최저 ${summary.minPriceWon.toLocaleString("ko-KR")}원` : ""}${summary.fromHighPercent !== undefined && summary.fromHighPercent < -0.05 ? ` · 최고가 대비 ${summary.fromHighPercent.toFixed(1)}%` : ""}`;
  return <div className="candidate-scenario-price-history"><div className="candidate-scenario-price-history-heading"><strong><FiClock /> 가격 이력</strong><small>{summaryText}</small></div>{history.points.length >= 2 ? <div className="candidate-scenario-price-sparkline" role="img" aria-label={`${history.windowDays}일 가격 추세`}>{history.points.map((point) => <span key={point.changeId} style={{ height: `${priceHistoryBarHeight(history, point.priceWon)}%` }} title={`${new Date(point.changedAt).toLocaleDateString("ko-KR")} · ${point.priceWon.toLocaleString("ko-KR")}원`} />)}</div> : <small className="candidate-scenario-price-history-insufficient">가격 변화 추세를 계산하기 위한 기록이 부족합니다.</small>}</div>;
}

function scenarioCheckStatusLabel(status: AlternativeComparisonScenarioCheck["status"]) {
  return status === "ready" ? "확인됨" : status === "review" ? "확인 필요" : "차단";
}

function CandidateScenarioChecks({ checks }: { checks: AlternativeComparisonScenarioCheck[] }) {
  if (checks.length === 0) return null;
  return <div className="candidate-scenario-checks" aria-label="구매 전 확인 항목"><div className="candidate-scenario-checks-heading"><strong>구매 전 확인 항목</strong><small>공유 시에도 같은 확인 항목이 보존됩니다.</small></div><div className="candidate-scenario-check-list">{checks.map((check) => <div className={`candidate-scenario-check ${check.status}`} key={check.id}><span><b>{check.label}</b><small>{check.detail}</small></span><em>{scenarioCheckStatusLabel(check.status)}</em></div>)}</div></div>;
}

function candidateWatchStateFor(part: Part, raw = typeof window === "undefined" ? null : window.localStorage.getItem(CATALOG_WATCHLIST_STORAGE_KEY)) {
  if (typeof window === "undefined") return { watching: false, targetPriceWon: undefined as number | undefined };
  const entry = catalogWatchlistFromJson(raw).find((item) => item.kind === "part" && item.itemId === part.id);
  return { watching: Boolean(entry), targetPriceWon: entry?.targetPriceWon };
}

function setCandidateWatchTarget(part: Part, targetPriceWon: number | undefined, onToast?: (message: string) => void) {
  try {
    const current = catalogWatchlistFromJson(window.localStorage.getItem(CATALOG_WATCHLIST_STORAGE_KEY));
    if (!catalogWatchlistContains(current, { kind: "part", itemId: part.id })) {
      onToast?.("먼저 가격 추적을 등록한 뒤 목표가를 설정해 주세요.");
      return false;
    }
    const next = updateCatalogWatchEntry(current, { kind: "part", itemId: part.id }, { targetPriceWon });
    window.localStorage.setItem(CATALOG_WATCHLIST_STORAGE_KEY, catalogWatchlistToJson(next));
    onToast?.(targetPriceWon === undefined
      ? `${part.name} 목표가를 해제했습니다.`
      : `${part.name} 목표가를 ${targetPriceWon.toLocaleString("ko-KR")}원으로 설정했습니다.`);
    return true;
  } catch {
    onToast?.("목표가를 저장하지 못했습니다.");
    return false;
  }
}

function CandidateWatchControl({ part, history, onWatch, onToast }: { part: Part; history?: CandidatePriceHistory; onWatch: (part: Part) => boolean; onToast?: (message: string) => void }) {
  const [watching, setWatching] = useState(() => candidateWatchStateFor(part).watching);
  const [targetText, setTargetText] = useState(() => {
    const target = candidateWatchStateFor(part).targetPriceWon;
    return target === undefined ? "" : String(target);
  });
  useEffect(() => {
    const state = candidateWatchStateFor(part);
    setWatching(state.watching);
    setTargetText(state.targetPriceWon === undefined ? "" : String(state.targetPriceWon));
  }, [part.id]);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== CATALOG_WATCHLIST_STORAGE_KEY) return;
      const state = candidateWatchStateFor(part, event.newValue);
      setWatching(state.watching);
      setTargetText(state.targetPriceWon === undefined ? "" : String(state.targetPriceWon));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [part.id]);
  function register() {
    if (onWatch(part)) setWatching(true);
  }
  function saveTarget() {
    if (!watching) {
      onToast?.("먼저 가격 추적을 등록한 뒤 목표가를 설정해 주세요.");
      return;
    }
    const value = targetText.trim() === "" ? undefined : Number(targetText);
    if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
      onToast?.("목표가는 1원 이상의 정수여야 합니다.");
      return;
    }
    setCandidateWatchTarget(part, value, onToast);
  }
  const recommendedTarget = history ? recommendedTargetPriceFromHistory(history.summary) : undefined;
  function useRecommendedTarget() {
    if (recommendedTarget === undefined) return;
    setTargetText(String(recommendedTarget));
  }
  return <div className="candidate-scenario-watch-control"><button className={watching ? "text-button part-watch-button watched" : "text-button part-watch-button"} type="button" data-item-id={part.id} onClick={register} disabled={watching} aria-label={`${part.name} 가격 추적 ${watching ? "등록됨" : "등록"}`}><FiClock /> {watching ? "추적 중" : "가격 추적"}</button>{watching && <div className="candidate-scenario-target"><label><span>목표가</span><input aria-label={`${part.name} 후보 목표가`} type="number" min="1" step="1000" value={targetText} placeholder="미설정" onChange={(event) => setTargetText(event.target.value)} /></label><button className="text-button" type="button" onClick={saveTarget}>목표가 저장</button>{recommendedTarget !== undefined && <button className="candidate-scenario-target-suggest" type="button" onClick={useRecommendedTarget}>최근 최저가 {recommendedTarget.toLocaleString("ko-KR")}원 입력</button>}</div>}</div>;
}

export function CandidateScenarioComparisonPanel({ state, currentResult, onApply, onSave, onRetry, onClose, onWatchPart, onShareComparison, onRevokeComparison, onToast, formatWon }: { state: CandidateScenarioCompareState; currentResult: CompatibilityResult; onApply: (item: CandidateScenarioCompareItem) => void; onSave?: (item: CandidateScenarioCompareItem) => void; onRetry: (itemId: string) => void; onClose: () => void; onWatchPart?: (part: Part) => boolean; onShareComparison?: CandidateScenarioShareHandler; onRevokeComparison?: CandidateScenarioRevokeHandler; onToast?: (message: string) => void; formatWon: (value: number | undefined) => string }) {
  const modalRef = useModalAccessibility({ onClose });
  const readyCount = state.items.filter((item) => item.status === "ready").length;
  const [comparisonCriterion, setComparisonCriterion] = useState<CandidateComparisonCriterion>("balanced");
  const [sharedComparison, setSharedComparison] = useState<CandidateScenarioShareResult | null>(null);
  const [sharingComparison, setSharingComparison] = useState(false);
  const [priceHistoryDays, setPriceHistoryDays] = useState<CandidatePriceHistoryDays>(30);
  const [priceHistories, setPriceHistories] = useState<Record<string, CandidatePriceHistory>>({});
  const [priceHistoryLoading, setPriceHistoryLoading] = useState(false);
  const [priceHistoryError, setPriceHistoryError] = useState<string | null>(null);
  const historyIds = useMemo(() => state.items.filter((item) => item.status === "ready").map((item) => `part:${item.part.id}`).join(","), [state.items]);

  useEffect(() => {
    if (!historyIds) {
      setPriceHistories({});
      setPriceHistoryError(null);
      setPriceHistoryLoading(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setPriceHistoryLoading(true);
    setPriceHistoryError(null);
    void api<{ items: CandidatePriceHistory[] }>(`/api/price-history?ids=${encodeURIComponent(historyIds)}&days=${priceHistoryDays}`, { retry: 1, signal: controller.signal })
      .then((payload) => {
        if (!cancelled) setPriceHistories(Object.fromEntries(payload.items.map((item) => [`${item.kind}:${item.itemId}`, item])));
      })
      .catch((error: unknown) => {
        if (!cancelled) setPriceHistoryError(error instanceof Error ? error.message : "가격 이력을 확인하지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setPriceHistoryLoading(false);
      });
    return () => { cancelled = true; controller.abort(); };
  }, [historyIds, priceHistoryDays]);

  const purchaseDecisions = useMemo(() => state.items
    .filter((item): item is CandidateScenarioCompareItem & { status: "ready"; result: CompatibilityResult } => item.status === "ready" && Boolean(item.result))
    .map((item) => ({
      item,
      decision: candidatePurchaseDecisionForItem(item, currentResult, item.result, priceHistories[`part:${item.part.id}`])
    })), [currentResult, priceHistories, state.items]);
  const decisionCountFor = (state: CandidatePurchaseDecision["state"]) => purchaseDecisions.filter((entry) => entry.decision.state === state).length;
  const comparisonItems = useMemo(() => purchaseDecisions.map(({ item }) => ({
    id: item.id,
    name: item.part.name,
    priceWon: item.part.priceWon,
    priceEvidence: catalogPriceEvidenceFor(item.part),
    priceDeltaWon: item.comparison?.priceDeltaWon,
    similarityScore: item.part.similarityScore,
    similarityEvidence: item.part.similarityEvidence,
    analysisScore: item.result?.analysis.overallScore,
    ...(item.result?.analysis.overallScore !== undefined && currentResult.analysis.overallScore !== undefined ? { analysisScoreDelta: item.result.analysis.overallScore - currentResult.analysis.overallScore } : {}),
    analysisConfidence: item.result?.analysis.confidence,
    recommendationTrustScore: item.part.recommendationTrust?.score,
    recommendationTrustLevel: item.part.recommendationTrust?.level,
    candidateRisk: item.risk ?? item.part.candidateRisk,
    decisionStatus: item.part.decision?.status,
    freshness: item.part.dataFreshness ?? item.part.recommendationTrust?.freshness,
    physicalStatus: item.part.physicalEvidence?.status,
    remainingBlockers: item.result?.blockerCount,
    remainingWarnings: item.result?.warningCount,
    remainingUnknown: item.result?.unknownCount
  })), [currentResult.analysis.overallScore, purchaseDecisions]);
  const comparisonDecision = useMemo(() => comparisonItems.length === 0 ? null : candidateComparisonDecisionFor(comparisonItems, comparisonCriterion), [comparisonCriterion, comparisonItems]);
  const tradeoffs = useMemo(() => candidateComparisonTradeoffsFor(comparisonItems), [comparisonItems]);

  const shareCandidates = useMemo(() => purchaseDecisions.map(({ item, decision }) => scenarioShareCandidateFor(item, currentResult, item.result, decision, priceHistories[`part:${item.part.id}`], formatWon, tradeoffs.find((tradeoff) => tradeoff.id === item.id))), [currentResult, formatWon, priceHistories, purchaseDecisions, tradeoffs]);

  async function shareComparison() {
    if (!onShareComparison || shareCandidates.length < 2 || sharingComparison) return;
    setSharingComparison(true);
    try {
      const currentParts = purchaseDecisions[0]?.item.currentParts ?? [];
      const currentPartQuantities = purchaseDecisions[0]?.item.currentPartQuantities;
      const currentPartSummary = currentParts.length > 0 ? currentParts.map((part) => scenarioPartSummary(part)).join(" / ") : undefined;
      const currentPartPriceKnown = currentParts.length > 0 && currentParts.every((part) => isKnownPrice(part.priceWon));
      const currentPartPriceWon = currentPartPriceKnown ? currentParts.reduce((total, part, index) => total + (part.priceWon ?? 0) * (currentPartQuantities?.[index] ?? 1), 0) : undefined;
      const shared = await onShareComparison(shareCandidates, {
        name: `${CATEGORY_LABELS[state.category]} 후보 전체 가상 비교`,
        category: CATEGORY_LABELS[state.category],
        currentPartName: currentPartLabel(currentParts, currentPartQuantities),
        ...(currentPartSummary ? { currentPartSummary } : {}),
        ...(currentParts.length > 0 ? { currentPartPrice: currentPartPriceWon !== undefined ? formatWon(currentPartPriceWon) : "가격 확인 필요" } : {})
      });
      if (shared) setSharedComparison(shared);
    } finally {
      setSharingComparison(false);
    }
  }

  async function revokeComparison() {
    if (!sharedComparison || !onRevokeComparison) return;
    if (await onRevokeComparison(sharedComparison)) setSharedComparison(null);
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={modalRef} tabIndex={-1} className="candidate-scenario-dialog" role="dialog" aria-modal="true" aria-labelledby="candidate-scenario-title">
      <div className="modal-header"><div><p className="eyebrow">MULTI CANDIDATE WHAT-IF</p><h2 id="candidate-scenario-title">선택 후보 전체 가상 비교</h2><p>현재 견적은 바꾸지 않고 선택한 {state.items.length}개 후보를 각각 전체 규칙 엔진에 대입합니다.</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="후보 가상 비교 닫기"><FiXCircle /></button></div>
      <div className="candidate-scenario-baseline"><span><FiActivity /> 현재 기준</span><strong>{statusLabel(currentResult.status)}</strong><small>차단 {currentResult.blockerCount}개 · 주의 {currentResult.warningCount}개 · 확인 필요 {currentResult.unknownCount}개 · {currentResult.priceComplete ? formatWon(currentResult.totalPriceWon) : "가격 확인 필요"}</small></div>
      <div className="candidate-scenario-history-toolbar"><div><strong><FiClock /> 후보 가격 이력</strong><small>공개된 카탈로그 변경 로그만 읽어오며, 현재 견적과 후보 적용 상태에는 영향을 주지 않습니다.</small></div><label><span>기간</span><select aria-label="후보 비교 가격 이력 기간" value={priceHistoryDays} onChange={(event) => setPriceHistoryDays(Number(event.target.value) as CandidatePriceHistoryDays)}><option value={7}>7일</option><option value={30}>30일</option><option value={90}>90일</option></select></label></div>
      <section className="candidate-scenario-purchase-summary" aria-label="후보 구매 판단 요약" data-testid="candidate-purchase-summary"><div className="candidate-scenario-purchase-summary-heading"><div><strong>구매 판단 요약</strong><small>엔진의 실제 판정을 우선하고 가격·성능·근거·이력은 보조 기준으로 해석합니다.</small></div><label><span>빠른 선택 기준</span><select aria-label="가상 비교 빠른 선택 기준" value={comparisonCriterion} onChange={(event) => setComparisonCriterion(event.target.value as CandidateComparisonCriterion)}>{CANDIDATE_COMPARISON_CRITERIA.map((criterion) => <option value={criterion} key={criterion}>{COMPARISON_CRITERION_LABELS[criterion]}</option>)}</select></label><span>{purchaseDecisions.length} / {state.items.length}개 계산</span></div><div className="candidate-scenario-purchase-counts"><span className="buy">구매 추천 <b>{decisionCountFor("buy")}</b></span><span className="performance">성능 우선 <b>{decisionCountFor("performance")}</b></span><span className="wait">가격 대기 <b>{decisionCountFor("wait")}</b></span><span className="review">확인 후 구매 <b>{decisionCountFor("review")}</b></span><span className="hold">적용 보류 <b>{decisionCountFor("hold")}</b></span></div>{comparisonDecision && <div className="candidate-scenario-ranking"><strong>{comparisonDecision.label} 기준 1순위</strong><small>{comparisonDecision.summary}</small><div>{comparisonDecision.eligibleRanking.slice(0, 3).map((rank, index) => <span className={index === 0 ? "top" : ""} key={rank.id} title={rank.reason} aria-label={`${index + 1}위 ${rank.name}, ${rank.score}점. ${rank.reason}`}><b>{index + 1}</b> {rank.name} · {rank.score}점<small>{rank.reason}</small></span>)}{comparisonDecision.excludedIds.length > 0 && <em>차단 후보 {comparisonDecision.excludedIds.length}개 제외</em>}</div></div>}{purchaseDecisions.length === 0 && <p className="candidate-scenario-purchase-pending">후보별 전체 가상 검사가 끝나면 구매 판단을 계산합니다.</p>} {onShareComparison && <div className="candidate-scenario-share"><button className="button button-small button-light" type="button" onClick={() => void shareComparison()} disabled={shareCandidates.length < 2 || sharingComparison}>{sharingComparison ? "공유 준비 중..." : <><FiShare2 /> 비교 결과 공유</>}</button>{sharedComparison && <div className="candidate-scenario-share-preview"><input aria-label="가상 비교 공유 링크" type="text" value={sharedComparison.url} readOnly onFocus={(event) => event.currentTarget.select()} /><a className="text-button" href={sharedComparison.url}>열기</a>{onRevokeComparison && <button className="text-button danger-text-button" type="button" onClick={() => void revokeComparison()}>공유 취소</button>}</div>}</div>}</section>
      {purchaseDecisions.length >= 2 && tradeoffs.length >= 2 && <section className="candidate-scenario-tradeoff" data-testid="candidate-tradeoff-frontier" aria-label="후보 비교 효율 경계"><div className="candidate-scenario-tradeoff-heading"><div><strong>호환·가격·분석·근거의 효율 경계</strong><small>전체 가상 적용 결과에서 다른 후보가 모든 기준에서 앞서는 경우만 열세로 표시합니다.</small></div><span>{tradeoffs.filter((tradeoff) => tradeoff.frontier && tradeoff.eligible !== false).length}개 경계</span></div><div className="candidate-scenario-tradeoff-list">{tradeoffs.map((tradeoff) => <article className={tradeoff.eligible === false ? "excluded" : tradeoff.frontier ? "frontier" : "dominated"} key={tradeoff.id}><div><span>{tradeoff.eligible === false ? "비교 제외" : tradeoff.frontier ? "효율 경계" : "열세"}</span><strong>{tradeoff.name}</strong></div><small>{tradeoff.riskScore === undefined ? "위험 확인 필요" : `위험 ${tradeoff.riskScore}점`} · 가격 변화 {tradeoff.priceDeltaWon === undefined ? "확인 필요" : `${tradeoff.priceDeltaWon > 0 ? "+" : ""}${tradeoff.priceDeltaWon.toLocaleString("ko-KR")}원`} · 분석 {tradeoff.analysisScore === undefined ? "확인 필요" : `${tradeoff.analysisScore}점`} · 근거 {tradeoff.evidenceScore ?? "확인 필요"}점</small><p>{tradeoff.reason}</p></article>)}</div><p className="candidate-scenario-tradeoff-note"><FiInfo /> 가격·분석 근거가 한쪽만 없는 후보 사이에는 우열을 만들지 않습니다. 효율 경계는 구매 확정이 아니라 상세 확인을 시작할 후보군입니다.</p></section>}
      <div className="candidate-scenario-list">
        {state.items.map((item) => {
          const result = item.result;
          const issues = result?.findings.filter((finding) => finding.severity !== "info").slice(0, 3) ?? [];
          const blocked = item.risk === "unsafe" || (!item.risk && result?.blockerCount !== 0);
          const specDiff = item.status === "ready" ? partSpecDiffFor(item.category, item.currentParts, item.part) : [];
          const priceHistory = priceHistories[`part:${item.part.id}`];
          const purchaseDecision = item.status === "ready" && result ? candidatePurchaseDecisionForItem(item, currentResult, result, priceHistory) : undefined;
          const purchaseChecks = item.status === "ready" && result && purchaseDecision ? scenarioChecksFor(item, result, purchaseDecision, priceHistory, formatWon) : [];
          const evidence = [
            item.part.similarityScore !== undefined ? `성능 유사도 ${item.part.similarityLabel ?? "비교"} ${item.part.similarityScore}점` : undefined,
            item.part.performanceSummary ? `성능 · ${item.part.performanceSummary}` : undefined,
            `가격 근거 · ${catalogPriceEvidenceLabelFor(item.part)}`,
            item.part.valueScore !== undefined && item.part.valueLabel ? `${item.part.valueLabel} ${item.part.valueScore}점` : undefined,
            item.part.recommendationTrust ? `추천 근거 ${trustLabel(item.part.recommendationTrust.level)} ${item.part.recommendationTrust.score}점` : undefined
          ].filter((value): value is string => Boolean(value));
          return <article className={`candidate-scenario-card ${item.status} ${item.comparison?.direction ?? ""}`} key={item.id}>
            <div className="candidate-scenario-card-heading"><div><span className="category-badge">{CATEGORY_LABELS[item.category]}</span><strong>{item.part.name}</strong><small>{riskLabel(item.risk)}{item.quantity && item.quantity > 1 ? ` · 수량 ${item.quantity}개` : ""}</small></div>{item.status === "loading" ? <span className="candidate-scenario-status loading"><FiLoader className="spin" /> 검사 중</span> : item.status === "error" ? <span className="candidate-scenario-status error"><FiXCircle /> 실패</span> : <span className={`candidate-scenario-status ${item.comparison?.direction ?? "unchanged"}`}>{item.comparison ? directionLabel(item.comparison.direction) : "검사 완료"}</span>}</div>
            <div className="candidate-scenario-current-part"><span>교체 전 기준</span><strong>{currentPartLabel(item.currentParts)}</strong></div>
            {item.status === "loading" && <div className="candidate-scenario-loading"><FiClock className="spin" /> 후보를 전체 구성에 대입해 호환성·가격·잔여 finding을 계산하는 중입니다.</div>}
            {item.status === "error" && <div className="candidate-scenario-error"><FiXCircle /><span>{item.error ?? "가상 비교에 실패했습니다."}</span><button className="text-button" type="button" onClick={() => onRetry(item.id)}><FiRefreshCw /> 다시 검사</button></div>}
            {item.status === "ready" && result && <div className="candidate-scenario-analysis" data-testid="candidate-scenario-analysis"><div><span>후보 적용 후 성능 분석</span><strong>{analysisScoreText(currentResult.analysis.overallScore, currentResult.analysis.scoreLabel)} → {analysisScoreText(result.analysis.overallScore, result.analysis.scoreLabel)}</strong><small>{scenarioAnalysisDetail(currentResult, result)}</small></div></div>}
            {item.status === "ready" && <CandidateBenchmarkEvidence currentParts={item.currentParts} candidate={item.part} similarityEvidence={item.part.similarityEvidence} />}
            {item.status === "ready" && result && <>{purchaseDecision && <div className={`candidate-scenario-purchase-decision ${purchaseDecision.state}`}><strong>{purchaseDecision.label}</strong><span>{purchaseDecision.summary}</span><small>{purchaseDecision.reasons.slice(0, 2).join(" · ")}</small></div>}<div className="candidate-scenario-result"><div><span>전체 판정</span><strong>{statusLabel(result.status)}</strong></div><div><span>차단</span><strong>{result.blockerCount}개</strong></div><div><span>주의</span><strong>{result.warningCount}개</strong></div><div><span>확인 필요</span><strong>{result.unknownCount}개</strong></div><div><span>적용 후 합계</span><strong>{result.priceComplete ? formatWon(result.totalPriceWon) : "확인 필요"}</strong></div><div><span>가격 변화</span><strong>{priceDeltaLabel(currentResult, result)}</strong></div></div><p className="candidate-scenario-delta"><FiActivity /> {item.comparison?.summary ?? "현재 구성과 비교할 변화가 없습니다."}</p>{(specDiff.length > 0 || evidence.length > 0) && <div className="candidate-scenario-evidence">{evidence.length > 0 && <div className="candidate-scenario-evidence-lines"><strong>후보 근거</strong>{evidence.map((line) => <span key={line}>{line}</span>)}</div>}<div className="candidate-scenario-spec-diff"><strong>핵심 스펙 변화</strong>{specDiff.length > 0 ? specDiff.map((row) => <div key={row.key}><span>{row.label}</span><em>{row.before}</em><b>→</b><em>{row.after}</em></div>) : <small>현재 부품이 없거나 비교 가능한 핵심 스펙 변화가 없습니다.</small>}</div></div>}<CandidatePriceHistoryPanel history={priceHistory} days={priceHistoryDays} loading={priceHistoryLoading} error={priceHistoryError} /><CandidateScenarioChecks checks={purchaseChecks} />{issues.length > 0 && <div className="candidate-scenario-findings"><strong>적용 후 남는 finding</strong><ul>{issues.map((finding) => <li key={finding.id}><b>{finding.severity === "blocker" ? "차단" : finding.severity === "warning" ? "주의" : "확인"}</b>{finding.title}</li>)}</ul></div>}{issues.length === 0 && <p className="candidate-scenario-clean"><FiCheckCircle /> 차단·주의·확인 필요 finding이 없습니다.</p>}<div className="candidate-scenario-actions">{onWatchPart && <CandidateWatchControl part={item.part} history={priceHistory} onWatch={onWatchPart} onToast={onToast} />}<button className="button button-small button-fix" type="button" disabled={blocked} onClick={() => onApply(item)}>{blocked ? <><FiXCircle /> 적용 불가</> : <><FiZap /> 이 후보 적용 전 미리보기</>}</button>{onSave && <button className="button button-small button-light" type="button" disabled={blocked} onClick={() => onSave(item)}><FiSave /> 새 견적으로 저장</button>}</div></>}
          </article>;
        })}
      </div>
      <p className="candidate-scenario-note"><FiInfo /> 가상 비교는 현재 견적을 바꾸지 않습니다. 실제 적용은 후보별 전체 판정 후 변경 예정·가격을 다시 확인하는 미리보기를 거칩니다. {readyCount} / {state.items.length}개 후보 검사 완료</p>
      <div className="candidate-scenario-footer"><button className="button button-light" type="button" onClick={onClose}>비교 닫기</button></div>
    </section>
  </div>;
}
