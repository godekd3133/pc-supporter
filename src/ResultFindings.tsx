import { useEffect, useRef, useState, type ComponentType } from "react";
import { FiActivity, FiAlertTriangle, FiCheckCircle, FiChevronDown, FiCopy, FiDatabase, FiDownload, FiEdit3, FiExternalLink, FiInfo, FiShare2, FiTrash2, FiXCircle } from "react-icons/fi";
import type { Finding, GpuTargetEvidence, Part, PartCategory, PhysicalEvidenceSource, RecommendationTrustEvidence, SimilarityEvidence } from "../shared/types";
import type { CandidateApplicationEvidence } from "../shared/candidate-application";
import { BENCHMARK_SOURCE_KIND_LABELS, CATEGORY_LABELS, DATA_FRESHNESS_LABELS, DATA_QUALITY_LABELS, isKnownPrice, LISTING_TYPE_LABELS } from "../shared/types";
import { alternativeComparisonBenchmarkEvidenceFor, alternativeComparisonCsvFor, alternativeComparisonJsonFor, alternativeComparisonSimilarityEvidenceFor, alternativeComparisonTextFor } from "../shared/alternative-comparison-export";
import { benchmarkEvidenceForPart } from "../shared/benchmark-evidence";
import type { AlternativeComparisonCandidate } from "../shared/alternative-comparison-export";
import { candidateDecisionSummaryFor } from "../shared/candidate-decision";
import { valueScoreText } from "../shared/value-score";
import { similarityReferenceTextFor, similarityReferenceUsedCategoryFor } from "../shared/similarity-evidence";
import { safeExternalUrl, safeHttpsUrl } from "./safe-source-url";
import { ComparisonBenchmarkCell } from "./ComparisonBenchmarkCell";
import { CATALOG_PRICE_EVIDENCE_LABELS, catalogPriceEvidenceDescriptionFor, catalogPriceEvidenceFor, catalogPriceEvidenceLabelFor } from "../shared/catalog-price-evidence";

export type ResultFindingSuggestion = NonNullable<Finding["suggestions"]>[number];
type Suggestion = ResultFindingSuggestion;

export type ResultComparisonShareResult = {
  id: string;
  url: string;
  ownerToken: string;
  expiresAt?: string;
};

export type ResultComparisonShareHandler = (candidates: AlternativeComparisonCandidate[], context?: { name?: string; category?: string; currentPartName?: string; currentPartSummary?: string; currentPartPrice?: string }) => Promise<ResultComparisonShareResult | undefined>;
export type ResultComparisonRevokeHandler = (share: ResultComparisonShareResult) => Promise<boolean>;
type PartWatchButtonRenderer = ComponentType<{ part: Part; onWatch: (part: Part) => boolean }>;
type PartVisualRenderer = ComponentType<{ part: Part }>;

type ResultFindingCardProps = {
  finding: Finding;
  partMap: ReadonlyMap<string, Part>;
  onOpenPicker: (category: PartCategory, findingRuleId?: string, findingTitle?: string, affectedPartIds?: string[]) => void;
  onEdit: () => void;
  onApplySuggestion: (category: PartCategory, part: Part, quantity?: number, affectedPartIds?: string[], evidence?: CandidateApplicationEvidence) => void;
  onPreviewSuggestion: (category: PartCategory, part: Part, quantity?: number, affectedPartIds?: string[], evidence?: CandidateApplicationEvidence) => void;
  onCompareSuggestions?: (suggestions: ResultFindingSuggestion[], affectedPartIds: string[]) => void;
  onFocusRepairPlans?: () => void;
  onToast: (message: string) => void;
  onWatchPart: (part: Part) => boolean;
  onShareComparison: ResultComparisonShareHandler;
  onRevokeComparison: ResultComparisonRevokeHandler;
  disabled?: boolean;
  ruleGuides: Readonly<Record<string, string>>;
  partSummary: (part: Part | undefined) => string;
  formatWon: (value: number | undefined) => string;
  formatPriceDelta: (value: number | undefined) => string;
  formatSignedPercent: (value: number) => string;
  formatSpecValue: (value: unknown) => string;
  similarityEvidenceText: (evidence?: SimilarityEvidence) => string;
  suggestionSpecRows: (part: Part) => Array<[string, unknown]>;
  PartVisual: PartVisualRenderer;
  PartWatchButton: PartWatchButtonRenderer;
};

function suggestionTotalPrice(suggestion: Suggestion, formatWon: ResultFindingCardProps["formatWon"]) {
  return suggestion.recommendedQuantity !== undefined && typeof suggestion.part.priceWon === "number" && suggestion.part.priceWon > 0
    ? suggestion.part.priceWon * suggestion.recommendedQuantity
    : suggestion.part.priceWon;
}

function suggestionCompatibilityText(suggestion: Suggestion) {
  if (suggestion.remainingBlockers > 0) return `차단 오류 ${suggestion.remainingBlockers}개`;
  if (suggestion.remainingUnknown > 0) return `확인 필요 ${suggestion.remainingUnknown}개`;
  if (suggestion.remainingWarnings > 0) return `주의 ${suggestion.remainingWarnings}개`;
  return "호환 상태 유지";
}

function suggestionFullBuildRiskText(suggestion: Suggestion) {
  return suggestion.remainingBlockers === 0 && suggestion.remainingWarnings === 0 && suggestion.remainingUnknown === 0
    ? "차단·주의·확인 필요 없음"
    : `차단 ${suggestion.remainingBlockers}개 · 주의 ${suggestion.remainingWarnings}개 · 확인 필요 ${suggestion.remainingUnknown}개`;
}

const recommendationTrustLabels: Record<RecommendationTrustEvidence["level"], string> = { high: "높음", medium: "보통", low: "낮음" };
const recommendationFreshnessLabels: Record<RecommendationTrustEvidence["freshness"], string> = { fresh: "최근 갱신", aging: "갱신 권장", stale: "오래된 데이터", unknown: "갱신 시점 불명" };

function recommendationTrustText(trust: RecommendationTrustEvidence | undefined) {
  return trust ? `${recommendationTrustLabels[trust.level]} ${trust.score}점` : "산정 불가";
}

function recommendationTrustDetail(trust: RecommendationTrustEvidence) {
  const compatibility = trust.compatibility === "verified" ? "후보 호환 확인됨" : "후보 호환 추가 확인";
  const comparison = trust.totalDimensions > 0 ? `비교 ${trust.comparedDimensions}/${trust.totalDimensions}` : "성능 비교 없음";
  const price = trust.priceEvidence ? CATALOG_PRICE_EVIDENCE_LABELS[trust.priceEvidence] : trust.priceKnown ? "가격 기록 있음" : "가격 미기록";
  const fullBuild = trust.fullBuildStatus === "clean" ? "전체 견적 정리됨" : `전체 견적 잔여 차단 ${trust.remainingBlockerCount}개·주의 ${trust.remainingWarningCount}개·확인 필요 ${trust.remainingUnknownCount}개`;
  const benchmark = trust.benchmarkBacked ? `벤치마크 ${trust.benchmarkSourceKind ? BENCHMARK_SOURCE_KIND_LABELS[trust.benchmarkSourceKind] : "출처 확인 필요"}` : undefined;
  const benchmarkFreshness = benchmark && trust.benchmarkFreshness ? ` · 자료 ${DATA_FRESHNESS_LABELS[trust.benchmarkFreshness]}` : "";
  const catalogSpecSource = trust.catalogSpecSourceCheckNeedsReview === undefined ? "" : trust.catalogSpecSourceCheckNeedsReview ? " · 제조사 정보 다시 확인 필요" : " · 제조사 정보 확인됨";
  return `${compatibility} · ${comparison} · ${recommendationFreshnessLabels[trust.freshness]} · ${price}${benchmark ? ` · ${benchmark}${benchmarkFreshness}` : ""}${catalogSpecSource} · ${fullBuild}`;
}

function physicalEvidenceLabel(status: NonNullable<Suggestion["physicalEvidence"]>["status"]) {
  return status === "verified" ? "확인됨" : status === "review" ? "확인 필요" : "미적용";
}

function gpuTargetFitLabel(fit: GpuTargetEvidence["candidateFit"] | undefined) {
  return fit === "met" ? "권장 기준 충족" : fit === "partial" ? "권장 기준 미달" : "VRAM 확인 필요";
}

function physicalEvidenceSourceLabel(category: PhysicalEvidenceSource["category"]) {
  return category === "gpu" ? "GPU" : category === "case" ? "케이스" : "PSU";
}

function safePhysicalEvidenceSources(sources: PhysicalEvidenceSource[] | undefined) {
  return (sources ?? []).flatMap((source) => {
    const note = typeof source.note === "string" && source.note.trim() ? source.note.trim() : undefined;
    if (!note || !["gpu", "case", "psu"].includes(source.category)) return [];
    const manufacturerModel = source.manufacturerModel?.trim();
    const manufacturerRevision = source.manufacturerRevision?.trim();
    const updatedAt = typeof source.updatedAt === "string" && source.updatedAt.trim() ? source.updatedAt.trim() : undefined;
    const url = safeHttpsUrl(source.url);
    return [{ category: source.category, note, ...(manufacturerModel ? { manufacturerModel } : {}), ...(manufacturerRevision ? { manufacturerRevision } : {}), ...(updatedAt ? { updatedAt } : {}), ...(url ? { url } : {}) } satisfies PhysicalEvidenceSource];
  });
}

function physicalEvidenceSourceIdentity(source: PhysicalEvidenceSource) {
  return `${physicalEvidenceSourceLabel(source.category)}${source.manufacturerModel ? ` · ${source.manufacturerModel}` : ""}${source.manufacturerRevision ? ` · ${source.manufacturerRevision}` : ""}`;
}

function PhysicalEvidenceSourceList({ sources, compact = false }: { sources: PhysicalEvidenceSource[] | undefined; compact?: boolean }) {
  const safeSources = safePhysicalEvidenceSources(sources);
  if (safeSources.length === 0) return <small className="physical-evidence-sources-empty">출처 메모가 없어요 · 제조사 페이지에서 확인해 주세요</small>;
  return <div className={compact ? "physical-evidence-sources compact" : "physical-evidence-sources"} aria-label="장착 정보 출처"><strong>{compact ? "출처" : "확인된 정보 출처"}</strong>{safeSources.map((source) => <span key={`${source.category}-${source.note}-${source.url ?? ""}`}><b>{physicalEvidenceSourceIdentity(source)}</b> {source.note}{source.updatedAt ? ` · 정보 갱신 ${new Date(source.updatedAt).toLocaleDateString("ko-KR")}` : ""}{source.url && <a href={source.url} target="_blank" rel="noreferrer">원문 <FiExternalLink /></a>}</span>)}</div>;
}

function suggestionComparisonCandidatesFor(suggestions: Suggestion[], props: Pick<ResultFindingCardProps, "partSummary" | "formatWon" | "similarityEvidenceText">): AlternativeComparisonCandidate[] {
  return suggestions.map((suggestion) => {
    const sourceUrl = safeExternalUrl(suggestion.part.danawaUrl);
    const physicalEvidenceSources = safePhysicalEvidenceSources(suggestion.physicalEvidence?.sources);
    const benchmarkEvidence = alternativeComparisonBenchmarkEvidenceFor(benchmarkEvidenceForPart(suggestion.part));
    const decision = candidateDecisionSummaryFor({
      risk: suggestion.candidateRisk ?? "safe",
      reasons: suggestion.candidateReasons,
      resolvesTarget: suggestion.fixesCurrentIssue,
      physicalStatus: suggestion.physicalEvidence?.status,
      recommendationTrustLevel: suggestion.recommendationTrust?.level,
      catalogSpecSourceCheckNeedsReview: suggestion.recommendationTrust?.catalogSpecSourceCheckNeedsReview,
      freshness: suggestion.recommendationTrust?.freshness
    });
    return {
      name: suggestion.part.name,
      category: suggestion.part.category,
      partId: suggestion.part.id,
      summary: props.partSummary(suggestion.part),
      price: props.formatWon(suggestionTotalPrice(suggestion, props.formatWon)),
      ...(isKnownPrice(suggestion.part.priceWon) ? { priceWon: suggestion.part.priceWon } : {}),
      priceEvidence: catalogPriceEvidenceFor(suggestion.part),
      purchaseCondition: `${catalogPriceEvidenceLabelFor(suggestion.part)} · ${suggestion.part.listingType ? LISTING_TYPE_LABELS[suggestion.part.listingType] : LISTING_TYPE_LABELS.retail}`,
      ...(suggestion.recommendedQuantity !== undefined ? { recommendedQuantity: suggestion.recommendedQuantity } : {}),
      similarity: `${suggestion.similarityLabel} ${suggestion.similarityScore}점 · ${props.similarityEvidenceText(suggestion.similarityEvidence)}`,
      ...(suggestion.gpuTarget ? { gpuTarget: suggestion.gpuTarget.summary } : {}),
      ...(suggestion.valueScore !== undefined && suggestion.valueLabel ? { valueScore: suggestion.valueScore, valueLabel: suggestion.valueLabel, valueScoreScale: suggestion.valueEvidence?.scoreScale ?? 200 } : {}),
      ...(suggestion.recommendationTrust ? { recommendationTrust: recommendationTrustText(suggestion.recommendationTrust) } : {}),
      performance: suggestion.performanceSummary,
      compatibility: suggestionCompatibilityText(suggestion),
      ...(benchmarkEvidence ? { benchmarkEvidence } : {}),
      ...(alternativeComparisonSimilarityEvidenceFor(suggestion.similarityEvidence) ? { similarityEvidence: alternativeComparisonSimilarityEvidenceFor(suggestion.similarityEvidence) } : {}),
      decisionSummary: `${decision.label} · ${decision.summary}${suggestion.candidateReasons && suggestion.candidateReasons.length > 0 ? ` · ${suggestion.candidateReasons.join(" · ")}` : ""}`,
      ...(suggestion.physicalEvidence && suggestion.physicalEvidence.status !== "not_applicable" ? { physicalEvidence: `${physicalEvidenceLabel(suggestion.physicalEvidence.status)} · ${suggestion.physicalEvidence.summary}` } : {}),
      ...(physicalEvidenceSources.length > 0 ? { physicalEvidenceSources } : {}),
      dataQuality: DATA_QUALITY_LABELS[suggestion.part.dataQuality],
      ...(suggestion.recommendationTrust ? { dataFreshness: suggestion.recommendationTrust.freshness } : {}),
      ...(suggestion.part.updatedAt ? { updatedAt: new Date(suggestion.part.updatedAt).toLocaleDateString("ko-KR") } : {}),
      ...(sourceUrl ? { sourceUrl } : {})
    };
  });
}

function SuggestionDecisionLine({ suggestion }: { suggestion: Suggestion }) {
  const decision = candidateDecisionSummaryFor({
    risk: suggestion.candidateRisk ?? "safe",
    reasons: suggestion.candidateReasons,
    resolvesTarget: suggestion.fixesCurrentIssue,
    physicalStatus: suggestion.physicalEvidence?.status,
    recommendationTrustLevel: suggestion.recommendationTrust?.level,
    catalogSpecSourceCheckNeedsReview: suggestion.recommendationTrust?.catalogSpecSourceCheckNeedsReview,
    freshness: suggestion.recommendationTrust?.freshness
  });
  return <em className={`suggestion-decision-line ${decision.status}`}>판단 · {decision.label} · {decision.summary}</em>;
}

function suggestionApplicationEvidenceFor(suggestion: Suggestion): CandidateApplicationEvidence {
  const decision = candidateDecisionSummaryFor({
    risk: suggestion.candidateRisk ?? "safe",
    reasons: suggestion.candidateReasons,
    resolvesTarget: suggestion.fixesCurrentIssue,
    physicalStatus: suggestion.physicalEvidence?.status,
    recommendationTrustLevel: suggestion.recommendationTrust?.level,
    catalogSpecSourceCheckNeedsReview: suggestion.recommendationTrust?.catalogSpecSourceCheckNeedsReview,
    freshness: suggestion.recommendationTrust?.freshness
  });
  return {
    risk: suggestion.candidateRisk ?? "safe",
    decision,
    ...(suggestion.candidateReasons ? { reasons: suggestion.candidateReasons } : {}),
    ...(suggestion.candidateBlockerCount !== undefined ? { candidateBlockerCount: suggestion.candidateBlockerCount } : {}),
    ...(suggestion.candidateWarningCount !== undefined ? { candidateWarningCount: suggestion.candidateWarningCount } : {}),
    ...(suggestion.candidateUnknownCount !== undefined ? { candidateUnknownCount: suggestion.candidateUnknownCount } : {}),
    remainingBlockers: suggestion.remainingBlockers,
    remainingWarnings: suggestion.remainingWarnings,
    remainingUnknown: suggestion.remainingUnknown
  };
}

function SuggestionDetail({ suggestion, suggestionSpecRows, formatSpecValue, formatSignedPercent, formatWon, similarityEvidenceText }: { suggestion: Suggestion; suggestionSpecRows: ResultFindingCardProps["suggestionSpecRows"]; formatSpecValue: ResultFindingCardProps["formatSpecValue"]; formatSignedPercent: ResultFindingCardProps["formatSignedPercent"]; formatWon: ResultFindingCardProps["formatWon"]; similarityEvidenceText: ResultFindingCardProps["similarityEvidenceText"] }) {
  const sourceUrl = safeExternalUrl(suggestion.part.danawaUrl);
  const qualityLabel = DATA_QUALITY_LABELS[suggestion.part.dataQuality];
  const priceEvidence = catalogPriceEvidenceFor(suggestion.part);
  return <div className="suggestion-detail">
    {suggestion.recommendationTrust && <div className={`recommendation-trust ${suggestion.recommendationTrust.level}`} aria-label="추천 점수"><div className="recommendation-trust-heading"><strong>추천 점수</strong><span>{recommendationTrustText(suggestion.recommendationTrust)}</span></div><p>{recommendationTrustDetail(suggestion.recommendationTrust)}</p><ul>{suggestion.recommendationTrust.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul><small>현재 카탈로그에서 확인된 정보가 얼마나 충분한지 보여주는 점수입니다. 성능·호환성 보장은 아니에요.</small></div>}
    <p className={`suggestion-price-evidence-detail ${priceEvidence}`} data-testid="suggestion-price-evidence" title={catalogPriceEvidenceDescriptionFor(suggestion.part)}><FiInfo /> 가격 출처 · <strong>{catalogPriceEvidenceLabelFor(suggestion.part)}</strong> · {catalogPriceEvidenceDescriptionFor(suggestion.part)}</p>
    {suggestion.physicalEvidence && suggestion.physicalEvidence.status !== "not_applicable" && <div className={`suggestion-physical-evidence ${suggestion.physicalEvidence.status}`} aria-label="후보 장착 정보"><div><strong>장착 정보</strong><span>{physicalEvidenceLabel(suggestion.physicalEvidence.status)}</span></div><p>{suggestion.physicalEvidence.summary}</p><PhysicalEvidenceSourceList sources={suggestion.physicalEvidence.sources} /><small>규칙상 맞는 후보와 제조사 장착 정보 확인은 별개 기준입니다.</small></div>}
    {suggestion.gpuTarget && <div className={`suggestion-gpu-target ${suggestion.gpuTarget.candidateFit ?? "unknown"}`} aria-label="게이밍 목표"><div><strong>게이밍 목표</strong><span>{gpuTargetFitLabel(suggestion.gpuTarget.candidateFit)}</span></div><p>{suggestion.gpuTarget.summary}</p><small>권장 VRAM은 해상도별 안전 기준이라 실제 FPS와 다를 수 있어요.</small></div>}
    {suggestion.valueScore !== undefined && suggestion.valueLabel && suggestion.valueEvidence && <div className="suggestion-value-summary" aria-label="가격 대비 유사도"><div><strong>가격 대비 유사도</strong><span>{suggestion.valueLabel} {valueScoreText(suggestion.valueScore)}</span></div><small>현재 {formatWon(suggestion.valueEvidence.currentPriceWon)} → 후보 {formatWon(suggestion.valueEvidence.candidatePriceWon)} · 가격 {formatSignedPercent(suggestion.valueEvidence.priceChangePercent)} · 유사도 {suggestion.valueEvidence.similarityScore}점 기준</small></div>}
    <div className="suggestion-detail-grid">{suggestionSpecRows(suggestion.part).map(([label, value]) => <div className="suggestion-detail-row" key={label}><span>{label}</span><strong>{formatSpecValue(value)}</strong></div>)}</div>
    {suggestion.similarityEvidence.dimensions && suggestion.similarityEvidence.dimensions.length > 0 && <div className="similarity-breakdown" aria-label="유사도 점수 내역"><div className="similarity-breakdown-heading"><strong>유사도 점수 내역</strong><span>항목 점수 · 가중치</span></div><div className="similarity-breakdown-list">{suggestion.similarityEvidence.dimensions.map((dimension) => <div className="similarity-breakdown-row" key={dimension.key}><div><span>{dimension.label}</span><strong>{dimension.currentValue} → {dimension.candidateValue}</strong></div><em>{dimension.score}점 · ×{dimension.weight}</em></div>)}</div></div>}
    {suggestion.similarityEvidence.reference && <p className="similarity-breakdown-note similarity-reference-note" data-testid="suggestion-similarity-reference"><FiInfo /> {similarityReferenceTextFor(suggestion.similarityEvidence)}. 선택 부품에 직접 확인된 값은 유지하고, 비어 있던 모델 공통 지표만 참조값으로 보완했습니다.</p>}
    {suggestion.similarityEvidence.notes?.filter((note) => !(suggestion.similarityEvidence.reference && note.startsWith("현재 선택 부품에 없는"))).map((note) => <p className="similarity-breakdown-note" key={note}><FiInfo /> {note}</p>)}
    <div className="suggestion-detail-footer"><span><FiDatabase /> {qualityLabel}{suggestion.part.missingFields.length > 0 ? ` · 누락 ${suggestion.part.missingFields.length}개` : " · 필수 스펙 확인"} · {similarityEvidenceText(suggestion.similarityEvidence)}{suggestion.part.listingType && suggestion.part.listingType !== "retail" ? ` · ${LISTING_TYPE_LABELS[suggestion.part.listingType]}` : ""}</span>{sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer">다나와 원문 보기 <FiExternalLink /></a>}</div>
  </div>;
}

function SuggestionComparison({ suggestions, currentPart, affectedPartIds, onCompareSuggestions, onToast, onShare, onRevoke, props }: { suggestions: Suggestion[]; currentPart?: Part; affectedPartIds: string[]; onCompareSuggestions?: ResultFindingCardProps["onCompareSuggestions"]; onToast: (message: string) => void; onShare: ResultComparisonShareHandler; onRevoke: ResultComparisonRevokeHandler; props: Pick<ResultFindingCardProps, "partSummary" | "formatWon" | "formatPriceDelta" | "formatSpecValue" | "similarityEvidenceText" | "suggestionSpecRows"> }) {
  const specRows = [...new Set(suggestions.flatMap((suggestion) => props.suggestionSpecRows(suggestion.part).map(([label]) => label)))];
  const currentSpec = (label: string) => currentPart ? props.suggestionSpecRows(currentPart).find(([rowLabel]) => rowLabel === label)?.[1] : undefined;
  const currentPriceWon = suggestions.find((suggestion) => suggestion.currentPriceWon !== undefined)?.currentPriceWon ?? currentPart?.priceWon;
  const currentPriceEvidenceLabel = currentPart ? catalogPriceEvidenceLabelFor({ ...currentPart, priceWon: currentPriceWon }) : "가격 확인 필요";
  const currentHeaderLabel = currentPart?.name;
  const currentBenchmarkEvidence = benchmarkEvidenceForPart(currentPart);
  const suggestionBenchmarkEvidence = suggestions.map((suggestion) => benchmarkEvidenceForPart(suggestion.part));
  const hasBenchmarkEvidence = Boolean(currentBenchmarkEvidence) || suggestionBenchmarkEvidence.some((evidence) => Boolean(evidence));
  const exportCandidates = suggestionComparisonCandidatesFor(suggestions, props);
  const exportContext = { ...(currentPart ? { category: CATEGORY_LABELS[currentPart.category], currentPartName: currentPart.name, currentPartSummary: props.partSummary(currentPart), currentPartPrice: currentPriceWon !== undefined ? props.formatWon(currentPriceWon) : "가격 확인 필요" } : {}) };
  const [sharedComparison, setSharedComparison] = useState<ResultComparisonShareResult | null>(null);
  const mountedRef = useRef(true);
  const comparisonRequestRef = useRef(0);
  const comparisonContextKey = `${currentPart?.id ?? ""}|${suggestions.map((suggestion) => suggestion.part.id).join(",")}|${affectedPartIds.join(",")}`;
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => {
    comparisonRequestRef.current += 1;
    setSharedComparison(null);
  }, [comparisonContextKey]);
  useEffect(() => () => { comparisonRequestRef.current += 1; }, []);
  async function copyComparison() {
    const requestVersion = comparisonRequestRef.current;
    const isCurrent = () => mountedRef.current && comparisonRequestRef.current === requestVersion;
    try { await navigator.clipboard.writeText(alternativeComparisonTextFor(exportCandidates, exportContext)); if (isCurrent()) onToast("대체 후보 비교표를 클립보드에 복사했습니다."); }
    catch { if (isCurrent()) onToast("대체 후보 비교표 복사에 실패했습니다. 브라우저 클립보드 권한을 확인해 주세요."); }
  }
  function downloadComparison() {
    const blob = new Blob([alternativeComparisonCsvFor(exportCandidates, exportContext)], { type: "text/csv;charset=utf-8" }); const url = window.URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `pc-supporter-suggestion-comparison-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); window.URL.revokeObjectURL(url); onToast("대체 후보 비교표 CSV를 저장했습니다.");
  }
  function downloadComparisonJson() {
    const blob = new Blob([alternativeComparisonJsonFor(exportCandidates, exportContext)], { type: "application/json;charset=utf-8" }); const url = window.URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `pc-supporter-suggestion-comparison-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); window.URL.revokeObjectURL(url); onToast("대체 후보 비교표 JSON을 저장했습니다.");
  }
  async function shareComparison() {
    const requestVersion = ++comparisonRequestRef.current;
    const isCurrent = () => mountedRef.current && comparisonRequestRef.current === requestVersion;
    const share = await onShare(exportCandidates, { name: currentPart ? `${currentPart.name} 대체 후보 비교` : "대체 후보 비교", category: currentPart ? CATEGORY_LABELS[currentPart.category] : undefined, currentPartName: currentPart?.name, ...(currentPart ? { currentPartSummary: props.partSummary(currentPart), currentPartPrice: currentPriceWon !== undefined ? props.formatWon(currentPriceWon) : "가격 확인 필요" } : {}) });
    if (isCurrent() && share) setSharedComparison(share);
  }
  async function revokeComparison() {
    if (!sharedComparison) return;
    const requestVersion = ++comparisonRequestRef.current;
    const isCurrent = () => mountedRef.current && comparisonRequestRef.current === requestVersion;
    if (await onRevoke(sharedComparison) && isCurrent()) setSharedComparison(null);
  }
  return <section className="suggestion-comparison" aria-label={currentPart ? "현재 부품과 대체 부품 비교" : "대체 부품 비교"}>
    <div className="suggestion-comparison-heading"><div><strong>대체 후보 비교</strong><span>선택한 {suggestions.length}개</span></div><div className="suggestion-comparison-actions">{onCompareSuggestions && <button className="text-button" type="button" onClick={() => onCompareSuggestions(suggestions, affectedPartIds)}><FiActivity /> 전체 미리 비교</button>}<button className="text-button" type="button" onClick={() => void copyComparison()}><FiCopy /> 비교 복사</button><button className="text-button" type="button" onClick={downloadComparison}><FiDownload /> CSV 저장</button><button className="text-button" type="button" onClick={downloadComparisonJson}><FiDownload /> JSON 저장</button><button className="text-button" type="button" onClick={() => void shareComparison()}><FiShare2 /> 공유 링크</button><FiActivity /></div></div>
    <div className="suggestion-comparison-table-wrap"><table><caption>{currentPart ? "현재 부품과 바꿀 수 있는 후보를 비교합니다." : "서로 다른 부품 범주의 후보를 비교합니다. 범주가 달라 현재 기준은 생략했어요."}</caption><thead><tr><th scope="col">비교 항목</th>{currentPart && <th className="suggestion-comparison-current" scope="col">현재 기준<br /><small>{currentHeaderLabel}</small></th>}{suggestions.map((suggestion) => <th scope="col" key={suggestion.part.id}>{suggestion.part.name}</th>)}</tr></thead><tbody>
      <tr><th scope="row">유사도</th>{currentPart && <td className="suggestion-comparison-current">현재 기준</td>}{suggestions.map((suggestion) => <td key={`${suggestion.part.id}-similarity`}>{suggestion.similarityLabel} {suggestion.similarityScore}점<br /><small>{props.similarityEvidenceText(suggestion.similarityEvidence)}</small></td>)}</tr>
      {hasBenchmarkEvidence && <tr data-testid="suggestion-comparison-benchmark"><th scope="row">벤치마크</th>{currentPart && <td className="suggestion-comparison-current"><ComparisonBenchmarkCell evidence={currentBenchmarkEvidence} /></td>}{suggestions.map((suggestion, index) => <td key={`${suggestion.part.id}-benchmark`}><ComparisonBenchmarkCell evidence={suggestionBenchmarkEvidence[index]} /></td>)}</tr>}
      {suggestions.some((suggestion) => suggestion.recommendationTrust) && <tr><th scope="row">추천 점수</th>{currentPart && <td className="suggestion-comparison-current">현재 기준</td>}{suggestions.map((suggestion) => <td key={`${suggestion.part.id}-trust`}>{suggestion.recommendationTrust ? <><strong>{recommendationTrustText(suggestion.recommendationTrust)}</strong><br /><small>{recommendationTrustDetail(suggestion.recommendationTrust)}</small></> : "산정 불가"}</td>)}</tr>}
      {suggestions.some((suggestion) => suggestion.physicalEvidence && suggestion.physicalEvidence.status !== "not_applicable") && <tr><th scope="row">장착 정보</th>{currentPart && <td className="suggestion-comparison-current">현재 기준</td>}{suggestions.map((suggestion) => <td key={`${suggestion.part.id}-physical-evidence`}>{suggestion.physicalEvidence && suggestion.physicalEvidence.status !== "not_applicable" ? <><strong>{physicalEvidenceLabel(suggestion.physicalEvidence.status)}</strong><br /><small>{suggestion.physicalEvidence.summary}</small><PhysicalEvidenceSourceList sources={suggestion.physicalEvidence.sources} compact /></> : "산정 불가"}</td>)}</tr>}
      {suggestions.some((suggestion) => suggestion.gpuTarget) && <tr><th scope="row">게이밍 목표</th>{currentPart && <td className="suggestion-comparison-current">현재 기준</td>}{suggestions.map((suggestion) => <td key={`${suggestion.part.id}-gpu-target`}>{suggestion.gpuTarget ? <><strong>{gpuTargetFitLabel(suggestion.gpuTarget.candidateFit)}</strong><br /><small>{suggestion.gpuTarget.summary}</small></> : "산정 불가"}</td>)}</tr>}
      <tr><th scope="row">가격</th>{currentPart && <td className="suggestion-comparison-current">{currentPriceWon !== undefined ? props.formatWon(currentPriceWon) : "가격 확인 필요"}{suggestions.some((suggestion) => suggestion.recommendedQuantity !== undefined) && <><br /><small>혼용 킷 합계</small></>}</td>}{suggestions.map((suggestion) => <td key={`${suggestion.part.id}-price`}>{props.formatWon(suggestionTotalPrice(suggestion, props.formatWon))}{suggestion.recommendedQuantity !== undefined ? <><br /><small>추천 킷 {suggestion.recommendedQuantity}개 · 1킷 {props.formatWon(suggestion.part.priceWon)}</small></> : null}</td>)}</tr>
      <tr><th scope="row">가격 출처</th>{currentPart && <td className="suggestion-comparison-current" title={catalogPriceEvidenceDescriptionFor({ ...currentPart, priceWon: currentPriceWon })}>{currentPriceEvidenceLabel}</td>}{suggestions.map((suggestion) => <td key={`${suggestion.part.id}-price-status`} title={catalogPriceEvidenceDescriptionFor(suggestion.part)}>{catalogPriceEvidenceLabelFor(suggestion.part)}</td>)}</tr>
      <tr><th scope="row">가격 변화</th>{currentPart && <td className="suggestion-comparison-current">기준</td>}{suggestions.map((suggestion) => <td key={`${suggestion.part.id}-delta`}>{props.formatPriceDelta(suggestion.priceDeltaWon)}</td>)}</tr>
      {suggestions.some((suggestion) => suggestion.valueScore !== undefined && suggestion.valueLabel) && <tr><th scope="row">가격 대비 유사도</th>{currentPart && <td className="suggestion-comparison-current">현재 기준</td>}{suggestions.map((suggestion) => <td key={`${suggestion.part.id}-value`}>{suggestion.valueScore !== undefined && suggestion.valueLabel ? `${suggestion.valueLabel} ${valueScoreText(suggestion.valueScore)}` : "산정 불가"}</td>)}</tr>}
      <tr><th scope="row">적용 후 남은 위험</th>{currentPart && <td className="suggestion-comparison-current">현재 기준</td>}{suggestions.map((suggestion) => <td key={`${suggestion.part.id}-full-risk`}>{suggestionFullBuildRiskText(suggestion)}</td>)}</tr>
      <tr><th scope="row">유통 조건</th>{currentPart && <td className="suggestion-comparison-current">{currentPart.listingType ? LISTING_TYPE_LABELS[currentPart.listingType] : LISTING_TYPE_LABELS.retail}</td>}{suggestions.map((suggestion) => <td key={`${suggestion.part.id}-listing`}>{suggestion.part.listingType ? LISTING_TYPE_LABELS[suggestion.part.listingType] : LISTING_TYPE_LABELS.retail}</td>)}</tr>
      <tr><th scope="row">스펙 변화</th>{currentPart && <td className="suggestion-comparison-current">현재 선택</td>}{suggestions.map((suggestion) => <td key={`${suggestion.part.id}-performance`}>{suggestion.performanceSummary}</td>)}</tr>
      {specRows.map((label) => <tr key={label}><th scope="row">{label}</th>{currentPart && <td className="suggestion-comparison-current">{props.formatSpecValue(currentSpec(label))}</td>}{suggestions.map((suggestion) => { const row = props.suggestionSpecRows(suggestion.part).find(([rowLabel]) => rowLabel === label); return <td key={`${suggestion.part.id}-${label}`}>{props.formatSpecValue(row?.[1])}</td>; })}</tr>)}
    </tbody></table></div>
    {sharedComparison && <div className="comparison-share-preview"><label><span>공유 링크{sharedComparison.expiresAt ? ` · ${new Date(sharedComparison.expiresAt).toLocaleString("ko-KR")} 만료` : ""}</span><input aria-label="대체 후보 비교 공유 링크" type="text" value={sharedComparison.url} readOnly onFocus={(event) => event.currentTarget.select()} /></label><div className="comparison-share-actions"><a className="text-button" href={sharedComparison.url}>열기</a><button className="text-button danger-text-button" type="button" onClick={() => void revokeComparison()}><FiTrash2 /> 공유 취소</button></div></div>}
    <p className="suggestion-comparison-note"><FiInfo /> 표의 수치는 현재 카탈로그에서 확인한 값입니다. 적용하면 견적 전체를 다시 검사해요.</p>
  </section>;
}

export function ResultFindingCard({ finding, partMap, onOpenPicker, onEdit, onApplySuggestion, onPreviewSuggestion, onCompareSuggestions, onFocusRepairPlans, onToast, onWatchPart, onShareComparison, onRevokeComparison, disabled = false, ruleGuides, partSummary, formatWon, formatPriceDelta, formatSignedPercent, formatSpecValue, similarityEvidenceText, suggestionSpecRows, PartVisual, PartWatchButton }: ResultFindingCardProps) {
  const [expandedSuggestionId, setExpandedSuggestionId] = useState<string | null>(null);
  const [compareSuggestionIds, setCompareSuggestionIds] = useState<string[]>([]);
  const [ruleOpen, setRuleOpen] = useState(false);
  const severityLabel = finding.severity === "blocker" ? "차단 오류" : finding.severity === "warning" ? "주의" : finding.severity === "unknown" ? "확인 필요" : "정보";
  const SeverityIcon = finding.severity === "blocker" ? FiXCircle : finding.severity === "warning" ? FiAlertTriangle : finding.severity === "unknown" ? FiInfo : FiCheckCircle;
  const ruleGuide = ruleGuides[finding.ruleId] ?? "카탈로그에 확인된 스펙과 지금 견적이 필요로 하는 조건을 비교합니다.";
  const ruleBoundary = finding.severity === "unknown" ? "필수 스펙이 빠진 부품은 호환 불가로 단정하지 않고 '확인 필요'로 표시해요." : "표시된 값은 현재 카탈로그에서 확인한 것이고, 제조사 안내와 실제 조립 환경이 더 정확해요.";
  const compareSuggestions = (finding.suggestions ?? []).filter((suggestion) => compareSuggestionIds.includes(suggestion.part.id));
  const suggestionCategories = new Set((finding.suggestions ?? []).map((suggestion) => suggestion.part.category));
  const suggestionCategory = suggestionCategories.size === 1 ? [...suggestionCategories][0] : undefined;
  const currentSuggestionPart = suggestionCategory ? finding.affectedPartIds.map((id) => partMap.get(id)).find((part) => part?.category === suggestionCategory) : undefined;
  const hasReplacementAction = finding.actions.some((action) => action.type === "replace_part" && action.targetCategory);
  const hasQuantityAction = finding.actions.some((action) => action.type === "change_quantity" && action.targetCategory);
  const performanceReferenceCategories = (finding.suggestions ?? []).map((suggestion) => similarityReferenceUsedCategoryFor(suggestion.similarityEvidence)).filter((category): category is "cpu" | "gpu" => Boolean(category));
  const performanceReferenceCategory = performanceReferenceCategories.includes("gpu") ? "GPU" : performanceReferenceCategories.includes("cpu") ? "CPU" : undefined;
  const usesPerformanceReference = performanceReferenceCategories.length > 0;
  const hasComparablePerformanceSuggestion = (finding.suggestions ?? []).some((suggestion) => suggestion.similarityLabel === "동급" || suggestion.similarityLabel === "유사");
  const hasReviewSuggestion = (finding.suggestions ?? []).some((suggestion) => suggestion.candidateRisk === "review");
  const suggestionHeadingNote = hasReviewSuggestion
    ? "안전한 후보를 찾지 못한 범주에는 새 오류 없이 이 문제를 해결하지만 한 번 더 확인할 후보를 보여드립니다. '확인 후 적용' 표시가 있는 카드는 사기 전에 내용을 확인해 주세요."
    : usesPerformanceReference && !hasComparablePerformanceSuggestion
      ? `확인된 같은 ${performanceReferenceCategory} 계열을 기준으로 비교했지만 성능이 비슷한 후보를 찾지 못해 호환되는 대안을 보여드립니다.`
      : usesPerformanceReference
        ? `확인된 같은 ${performanceReferenceCategory} 계열을 기준으로 유사도를 계산해 비슷한 성능의 후보부터 보여드립니다.`
        : "카탈로그 확인 점수·스펙 유사도 기준이고 전체 벤치 순위는 아니에요. 이유를 펼쳐 보거나 후보 2개를 골라 비교할 수 있어요.";
  function toggleCompareSuggestion(partId: string) {
    setCompareSuggestionIds((current) => current.includes(partId) ? current.filter((id) => id !== partId) : current.length >= 3 ? current : [...current, partId]);
  }
  const suggestionProps = { partSummary, formatWon, formatPriceDelta, formatSpecValue, similarityEvidenceText, suggestionSpecRows };
  return <article id={`finding-${finding.ruleId}`} className={`finding-card ${finding.severity}${ruleOpen ? " rule-open" : ""}`} tabIndex={-1}>
    <div className="finding-card-heading"><span className="finding-severity"><SeverityIcon /> {severityLabel}</span><div className="finding-card-heading-actions"><span className="rule-id">{finding.ruleId}</span><button className="rule-explanation-toggle" type="button" aria-expanded={ruleOpen} onClick={() => setRuleOpen((current) => !current)}>왜 이런 결과인지 <FiChevronDown /></button></div></div>
    <h3>{finding.title}</h3><p className="finding-message">{finding.message}</p>
    {ruleOpen && <div className="rule-explanation" role="region" aria-label={`${finding.ruleId} 결과 이유`}><div><span>확인한 규칙</span><p>{ruleGuide}</p></div><div><span>결과</span><p>{severityLabel} · {finding.title}</p></div><div><span>확인할 수 있는 범위</span><p>{ruleBoundary}</p></div></div>}
    {finding.facts.length > 0 && <div className="facts-grid">{finding.facts.map((fact, index) => <div className="fact" key={`${fact.label}-${index}`}><span>{fact.label}</span><strong>{fact.actual ?? fact.expected ?? "확인 필요"}</strong>{fact.actual && fact.expected && <small>기대: {fact.expected}</small>}</div>)}</div>}
    <div className="finding-actions">{finding.actions.map((action, index) => { const target = action.targetCategory; if (action.type === "replace_part" && target) return <button className="button button-small button-fix" key={`${action.label}-${index}`} disabled={disabled} onClick={() => onOpenPicker(target, finding.ruleId, finding.title, finding.affectedPartIds)}><FiEdit3 /> {action.label}</button>; if (action.type === "change_quantity") return <button className="button button-small button-fix" key={`${action.label}-${index}`} disabled={disabled} onClick={onEdit}><FiEdit3 /> {action.label}</button>; return <button className="button button-small button-light" key={`${action.label}-${index}`} disabled={disabled} onClick={onEdit}><FiInfo /> {action.label}</button>; })}</div>
    {finding.suggestions && finding.suggestions.length > 0 && <div className="suggestions"><div className="suggestion-heading"><FiActivity /><span>이 문제를 줄이는 대체 부품</span><small>{suggestionHeadingNote}</small></div><div className="suggestion-list">{finding.suggestions.map((suggestion) => { const target = suggestion.part.category; const expanded = expandedSuggestionId === suggestion.part.id; const physicalSourceCount = suggestion.physicalEvidence?.sources?.length ?? 0; const sourceUrl = safeExternalUrl(suggestion.part.danawaUrl); const applicationEvidence = suggestionApplicationEvidenceFor(suggestion); return <article className={expanded ? "suggestion-card expanded" : "suggestion-card"} key={suggestion.part.id}><button className="suggestion-apply" type="button" aria-label={`${suggestion.part.name} 적용`} disabled={disabled} onClick={() => onApplySuggestion(target, suggestion.part, suggestion.recommendedQuantity, finding.affectedPartIds, applicationEvidence)}><span className="suggestion-icon"><PartVisual part={suggestion.part} /></span><span className="suggestion-content"><span className="category-badge suggestion-category-badge">{CATEGORY_LABELS[target]}</span>{suggestion.candidateRisk === "review" && <em className="decision-badge review suggestion-candidate-risk-badge">확인 후 적용</em>}<strong>{suggestion.part.name}</strong><small>{suggestion.recommendedQuantity !== undefined ? `추천 킷 ${suggestion.recommendedQuantity}개 · ` : ""}{partSummary(suggestion.part)} · {suggestion.similarityLabel} {suggestion.similarityScore}점 · {similarityEvidenceText(suggestion.similarityEvidence)}{suggestion.recommendationTrust ? ` · 추천 ${recommendationTrustText(suggestion.recommendationTrust)}` : ""}{suggestion.valueScore !== undefined && suggestion.valueLabel ? ` · ${suggestion.valueLabel} ${valueScoreText(suggestion.valueScore)}` : ""} · 이 문제 해결{suggestion.part.listingType && suggestion.part.listingType !== "retail" ? ` · ${LISTING_TYPE_LABELS[suggestion.part.listingType]}` : ""}</small><em>{suggestion.performanceSummary}</em><em>{suggestion.profileSummary}</em>{suggestion.physicalEvidence && suggestion.physicalEvidence.status !== "not_applicable" && <em className={`suggestion-physical-evidence-line ${suggestion.physicalEvidence.status}`}>장착 정보 · {physicalEvidenceLabel(suggestion.physicalEvidence.status)}{physicalSourceCount > 0 ? ` · 출처 ${physicalSourceCount}건` : " · 출처 메모 없음"} · {suggestion.physicalEvidence.summary}</em>}{suggestion.gpuTarget && <em className={`suggestion-gpu-target-line ${suggestion.gpuTarget.candidateFit ?? "unknown"}`}>GPU 목표 · {gpuTargetFitLabel(suggestion.gpuTarget.candidateFit)} · {suggestion.gpuTarget.summary}</em>}<SuggestionDecisionLine suggestion={suggestion} /><em>{suggestion.reason}</em></span><span className="suggestion-price"><strong>{formatWon(suggestionTotalPrice(suggestion, formatWon))}</strong><small>{suggestion.recommendedQuantity !== undefined ? `킷 ${suggestion.recommendedQuantity}개 · 1킷 ${formatWon(suggestion.part.priceWon)}` : formatPriceDelta(suggestion.priceDeltaWon)}</small>{suggestion.recommendedQuantity !== undefined && <small>{formatPriceDelta(suggestion.priceDeltaWon)}</small>}<FiExternalLink /></span></button><div className="suggestion-card-actions"><PartWatchButton part={suggestion.part} onWatch={onWatchPart} />{sourceUrl && <a className="suggestion-source-link" href={sourceUrl} target="_blank" rel="noreferrer" aria-label={`${suggestion.part.name} 다나와 원문 보기`}>다나와 원문 <FiExternalLink /></a>}<button className={compareSuggestionIds.includes(suggestion.part.id) ? "suggestion-compare-toggle selected" : "suggestion-compare-toggle"} type="button" aria-pressed={compareSuggestionIds.includes(suggestion.part.id)} onClick={() => toggleCompareSuggestion(suggestion.part.id)}>{compareSuggestionIds.includes(suggestion.part.id) ? "비교 중" : "비교"}</button><button className="suggestion-preview-button" type="button" onClick={() => onPreviewSuggestion(target, suggestion.part, suggestion.recommendedQuantity, finding.affectedPartIds, applicationEvidence)} disabled={disabled}>미리 적용</button><button className="suggestion-detail-toggle" type="button" aria-expanded={expanded} onClick={() => setExpandedSuggestionId(expanded ? null : suggestion.part.id)}><span>자세히</span><FiChevronDown /></button></div>{expanded && <SuggestionDetail suggestion={suggestion} suggestionSpecRows={suggestionSpecRows} formatSpecValue={formatSpecValue} formatSignedPercent={formatSignedPercent} formatWon={formatWon} similarityEvidenceText={similarityEvidenceText} />}</article>; })}</div>{compareSuggestions.length >= 2 && <SuggestionComparison suggestions={compareSuggestions} currentPart={currentSuggestionPart} affectedPartIds={finding.affectedPartIds} onCompareSuggestions={disabled ? undefined : onCompareSuggestions} onToast={onToast} onShare={onShareComparison} onRevoke={onRevokeComparison} props={suggestionProps} />}</div>}
    {hasReplacementAction && !hasQuantityAction && (!finding.suggestions || finding.suggestions.length === 0) && <div className="suggestion-empty"><FiInfo /><div><strong>안전한 대체 후보를 찾지 못했어요.</strong><p>지금 카탈로그에서 이 문제를 해결하면서 새 문제를 만들지 않는 후보가 없었어요. 제조사 페이지를 확인하거나 검색 조건을 넓혀 직접 골라 주세요.</p></div></div>}
    {hasQuantityAction && (!finding.suggestions || finding.suggestions.length === 0) && <div className="suggestion-empty quantity-guidance" data-testid="quantity-guidance"><FiInfo /><div><strong>이 문제는 수량·구성 조정 플랜으로 해결합니다.</strong><p>부품 성능이 아니라 메인보드 슬롯·저장장치 포트·케이스 자리가 부족한 문제입니다. 수리 플랜에서 수량을 줄이거나 부품을 바꾸면 바뀐 결과를 미리 비교할 수 있어요.</p><button className="text-button" type="button" onClick={onFocusRepairPlans ?? onEdit}>추천 수리 플랜 보기 <FiExternalLink /></button></div></div>}
    {finding.affectedPartIds.length > 0 && <p className="affected-parts"><FiInfo /> 영향받은 부품: {finding.affectedPartIds.map((id) => partMap.get(id)?.name ?? id).join(", ")}</p>}
  </article>;
}
