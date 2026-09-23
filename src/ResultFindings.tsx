import { useEffect, useRef, useState, type ComponentType } from "react";
import { FiActivity, FiAlertTriangle, FiCheckCircle, FiChevronDown, FiCopy, FiDatabase, FiDownload, FiEdit3, FiExternalLink, FiInfo, FiShare2, FiTrash2, FiXCircle } from "react-icons/fi";
import type { Finding, GpuTargetEvidence, Part, PartCategory, PhysicalEvidenceSource, RecommendationTrustEvidence, SimilarityEvidence } from "../shared/types";
import type { CandidateApplicationEvidence } from "../shared/candidate-application";
import { CATEGORY_LABELS, DATA_FRESHNESS_LABELS, DATA_QUALITY_LABELS, isKnownPrice, LISTING_TYPE_LABELS } from "../shared/types";
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
function recommendationTrustText(trust: RecommendationTrustEvidence | undefined) {
  return trust ? `${recommendationTrustLabels[trust.level]} ${trust.score}점` : "산정 불가";
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

function SuggestionDetail({ suggestion, suggestionSpecRows, formatSpecValue, formatWon }: { suggestion: Suggestion; suggestionSpecRows: ResultFindingCardProps["suggestionSpecRows"]; formatSpecValue: ResultFindingCardProps["formatSpecValue"]; formatSignedPercent: ResultFindingCardProps["formatSignedPercent"]; formatWon: ResultFindingCardProps["formatWon"]; similarityEvidenceText: ResultFindingCardProps["similarityEvidenceText"] }) {
  const sourceUrl = safeExternalUrl(suggestion.part.danawaUrl);
  return <div className="suggestion-detail">
    {suggestion.physicalEvidence && suggestion.physicalEvidence.status !== "not_applicable" && <div className="suggestion-physical-evidence"><div><strong>장착 규격</strong><span>{suggestion.physicalEvidence.status === "verified" ? "규격 일치" : "사양 미등록"}</span></div><p>{suggestion.physicalEvidence.summary}</p></div>}
    {suggestion.gpuTarget && <div className="suggestion-gpu-target"><div><strong>게임 성능 목표</strong><span>{gpuTargetFitLabel(suggestion.gpuTarget.candidateFit)}</span></div><p>{suggestion.gpuTarget.summary}</p></div>}
    <div className="suggestion-detail-grid">{suggestionSpecRows(suggestion.part).map(([label, value]) => <div className="suggestion-detail-row" key={label}><span>{label}</span><strong>{formatSpecValue(value)}</strong></div>)}</div>
    {suggestion.part.missingFields.length > 0 && <p className="suggestion-detail-missing">사양 미등록 {suggestion.part.missingFields.length}개</p>}
    <div className="suggestion-detail-footer"><span>{suggestion.part.listingType && suggestion.part.listingType !== "retail" ? LISTING_TYPE_LABELS[suggestion.part.listingType] : ""}</span>{sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer">상품 페이지 보기 <FiExternalLink /></a>}</div>
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
    try { await navigator.clipboard.writeText(alternativeComparisonTextFor(exportCandidates, exportContext)); if (isCurrent()) onToast("대체 부품 비교표를 클립보드에 복사했어요."); }
    catch { if (isCurrent()) onToast("대체 부품 비교표 복사에 실패했어요. 브라우저 클립보드 권한을 확인해 주세요."); }
  }
  function downloadComparison() {
    const blob = new Blob([alternativeComparisonCsvFor(exportCandidates, exportContext)], { type: "text/csv;charset=utf-8" }); const url = window.URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `pc-supporter-suggestion-comparison-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); window.URL.revokeObjectURL(url); onToast("대체 부품 비교표 CSV를 저장했어요.");
  }
  function downloadComparisonJson() {
    const blob = new Blob([alternativeComparisonJsonFor(exportCandidates, exportContext)], { type: "application/json;charset=utf-8" }); const url = window.URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `pc-supporter-suggestion-comparison-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); window.URL.revokeObjectURL(url); onToast("대체 부품 비교표 JSON을 저장했어요.");
  }
  async function shareComparison() {
    const requestVersion = ++comparisonRequestRef.current;
    const isCurrent = () => mountedRef.current && comparisonRequestRef.current === requestVersion;
    const share = await onShare(exportCandidates, { name: currentPart ? `${currentPart.name} 대체 부품 비교` : "대체 부품 비교", category: currentPart ? CATEGORY_LABELS[currentPart.category] : undefined, currentPartName: currentPart?.name, ...(currentPart ? { currentPartSummary: props.partSummary(currentPart), currentPartPrice: currentPriceWon !== undefined ? props.formatWon(currentPriceWon) : "가격 확인 필요" } : {}) });
    if (isCurrent() && share) setSharedComparison(share);
  }
  async function revokeComparison() {
    if (!sharedComparison) return;
    const requestVersion = ++comparisonRequestRef.current;
    const isCurrent = () => mountedRef.current && comparisonRequestRef.current === requestVersion;
    if (await onRevoke(sharedComparison) && isCurrent()) setSharedComparison(null);
  }
  return <section className="suggestion-comparison" aria-label={currentPart ? "현재 부품과 대체 부품 비교" : "대체 부품 비교"}>
    <div className="suggestion-comparison-heading"><div><strong>대체 부품 비교</strong><span>선택한 {suggestions.length}개</span></div><div className="suggestion-comparison-actions">{onCompareSuggestions && <button className="text-button" type="button" onClick={() => onCompareSuggestions(suggestions, affectedPartIds)}><FiActivity /> 전체 미리 비교</button>}<button className="text-button" type="button" onClick={() => void copyComparison()}><FiCopy /> 비교 복사</button><button className="text-button" type="button" onClick={downloadComparison}><FiDownload /> CSV 저장</button><button className="text-button" type="button" onClick={downloadComparisonJson}><FiDownload /> JSON 저장</button><button className="text-button" type="button" onClick={() => void shareComparison()}><FiShare2 /> 공유 링크</button><FiActivity /></div></div>
    <div className="suggestion-comparison-table-wrap"><table><caption>{currentPart ? "현재 부품과 바꿀 수 있는 부품을 비교해요." : "서로 다른 부품 범주를 비교해요. 범주가 달라 현재 기준은 생략했어요."}</caption><thead><tr><th scope="col">비교 항목</th>{currentPart && <th className="suggestion-comparison-current" scope="col">현재 기준<br /><small>{currentHeaderLabel}</small></th>}{suggestions.map((suggestion) => <th scope="col" key={suggestion.part.id}>{suggestion.part.name}</th>)}</tr></thead><tbody>

      {hasBenchmarkEvidence && <tr data-testid="suggestion-comparison-benchmark"><th scope="row">벤치마크</th>{currentPart && <td className="suggestion-comparison-current"><ComparisonBenchmarkCell evidence={currentBenchmarkEvidence} /></td>}{suggestions.map((suggestion, index) => <td key={`${suggestion.part.id}-benchmark`}><ComparisonBenchmarkCell evidence={suggestionBenchmarkEvidence[index]} /></td>)}</tr>}

      {suggestions.some((suggestion) => suggestion.physicalEvidence && suggestion.physicalEvidence.status !== "not_applicable") && <tr><th scope="row">장착 정보</th>{currentPart && <td className="suggestion-comparison-current">현재 기준</td>}{suggestions.map((suggestion) => <td key={`${suggestion.part.id}-physical-evidence`}>{suggestion.physicalEvidence && suggestion.physicalEvidence.status !== "not_applicable" ? <><strong>{physicalEvidenceLabel(suggestion.physicalEvidence.status)}</strong><br /><small>{suggestion.physicalEvidence.summary}</small></> : "산정 불가"}</td>)}</tr>}
      {suggestions.some((suggestion) => suggestion.gpuTarget) && <tr><th scope="row">게이밍 목표</th>{currentPart && <td className="suggestion-comparison-current">현재 기준</td>}{suggestions.map((suggestion) => <td key={`${suggestion.part.id}-gpu-target`}>{suggestion.gpuTarget ? <><strong>{gpuTargetFitLabel(suggestion.gpuTarget.candidateFit)}</strong><br /><small>{suggestion.gpuTarget.summary}</small></> : "산정 불가"}</td>)}</tr>}
      <tr><th scope="row">가격</th>{currentPart && <td className="suggestion-comparison-current">{currentPriceWon !== undefined ? props.formatWon(currentPriceWon) : "가격 확인 필요"}{suggestions.some((suggestion) => suggestion.recommendedQuantity !== undefined) && <><br /><small>혼용 킷 합계</small></>}</td>}{suggestions.map((suggestion) => <td key={`${suggestion.part.id}-price`}>{props.formatWon(suggestionTotalPrice(suggestion, props.formatWon))}{suggestion.recommendedQuantity !== undefined ? <><br /><small>추천 킷 {suggestion.recommendedQuantity}개 · 1킷 {props.formatWon(suggestion.part.priceWon)}</small></> : null}</td>)}</tr>

      <tr><th scope="row">가격 변화</th>{currentPart && <td className="suggestion-comparison-current">기준</td>}{suggestions.map((suggestion) => <td key={`${suggestion.part.id}-delta`}>{props.formatPriceDelta(suggestion.priceDeltaWon)}</td>)}</tr>

      <tr><th scope="row">적용 후 남은 위험</th>{currentPart && <td className="suggestion-comparison-current">현재 기준</td>}{suggestions.map((suggestion) => <td key={`${suggestion.part.id}-full-risk`}>{suggestionFullBuildRiskText(suggestion)}</td>)}</tr>
      <tr><th scope="row">유통 조건</th>{currentPart && <td className="suggestion-comparison-current">{currentPart.listingType ? LISTING_TYPE_LABELS[currentPart.listingType] : LISTING_TYPE_LABELS.retail}</td>}{suggestions.map((suggestion) => <td key={`${suggestion.part.id}-listing`}>{suggestion.part.listingType ? LISTING_TYPE_LABELS[suggestion.part.listingType] : LISTING_TYPE_LABELS.retail}</td>)}</tr>
      <tr><th scope="row">스펙 변화</th>{currentPart && <td className="suggestion-comparison-current">현재 선택</td>}{suggestions.map((suggestion) => <td key={`${suggestion.part.id}-performance`}>{suggestion.performanceSummary}</td>)}</tr>
      {specRows.map((label) => <tr key={label}><th scope="row">{label}</th>{currentPart && <td className="suggestion-comparison-current">{props.formatSpecValue(currentSpec(label))}</td>}{suggestions.map((suggestion) => { const row = props.suggestionSpecRows(suggestion.part).find(([rowLabel]) => rowLabel === label); return <td key={`${suggestion.part.id}-${label}`}>{props.formatSpecValue(row?.[1])}</td>; })}</tr>)}
    </tbody></table></div>
    {sharedComparison && <div className="comparison-share-preview"><label><span>공유 링크{sharedComparison.expiresAt ? ` · ${new Date(sharedComparison.expiresAt).toLocaleString("ko-KR")} 만료` : ""}</span><input aria-label="대체 부품 비교 공유 링크" type="text" value={sharedComparison.url} readOnly onFocus={(event) => event.currentTarget.select()} /></label><div className="comparison-share-actions"><a className="text-button" href={sharedComparison.url}>열기</a><button className="text-button danger-text-button" type="button" onClick={() => void revokeComparison()}><FiTrash2 /> 공유 취소</button></div></div>}
    <p className="suggestion-comparison-note"><FiInfo /> 부품과 예상 금액을 비교해요. 적용하면 전체 구성의 호환성을 다시 확인해요.</p>
  </section>;
}

export function ResultFindingCard({ finding, partMap, onOpenPicker, onEdit, onApplySuggestion, onPreviewSuggestion, onCompareSuggestions, onFocusRepairPlans, onToast, onWatchPart, onShareComparison, onRevokeComparison, disabled = false, ruleGuides, partSummary, formatWon, formatPriceDelta, formatSignedPercent, formatSpecValue, similarityEvidenceText, suggestionSpecRows, PartVisual, PartWatchButton }: ResultFindingCardProps) {
  const [expandedSuggestionId, setExpandedSuggestionId] = useState<string | null>(null);
  const [compareSuggestionIds, setCompareSuggestionIds] = useState<string[]>([]);
  const [ruleOpen, setRuleOpen] = useState(false);
  const severityLabel = finding.severity === "blocker" ? "차단 오류" : finding.severity === "warning" ? "주의" : finding.severity === "unknown" ? "정보 부족" : "정보";
  const displayTitle = finding.ruleId === "memory-profile" ? "RAM 설정 호환 정보가 없어요." : finding.title;
  const displayMessage = finding.ruleId === "memory-profile" ? "메인보드가 이 RAM의 EXPO/XMP 설정을 지원하는지 알 수 없어요." : finding.message;
  const SeverityIcon = finding.severity === "blocker" ? FiXCircle : finding.severity === "warning" ? FiAlertTriangle : finding.severity === "unknown" ? FiInfo : FiCheckCircle;
  const ruleGuide = ruleGuides[finding.ruleId] ?? "부품 사양을 현재 견적과 비교합니다.";
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
    ? "일부 부품은 사양이 부족해 적용 전에 호환성을 확인해야 해요."
    : "가격과 주요 사양을 비교해 문제를 줄일 부품을 골랐어요.";
  function toggleCompareSuggestion(partId: string) {
    setCompareSuggestionIds((current) => current.includes(partId) ? current.filter((id) => id !== partId) : current.length >= 3 ? current : [...current, partId]);
  }
  const suggestionProps = { partSummary, formatWon, formatPriceDelta, formatSpecValue, similarityEvidenceText, suggestionSpecRows };
  return <article id={`finding-${finding.ruleId}`} className={`finding-card ${finding.severity}${ruleOpen ? " rule-open" : ""}`} tabIndex={-1}>
    <div className="finding-card-heading"><span className="finding-severity"><SeverityIcon /> {severityLabel}</span><div className="finding-card-heading-actions"><button className="rule-explanation-toggle" type="button" aria-expanded={ruleOpen} onClick={() => setRuleOpen((current) => !current)}>상세 사양 <FiChevronDown /></button></div></div>
    <h3>{displayTitle}</h3><p className="finding-message">{displayMessage}</p>
    {ruleOpen && <div className="rule-explanation" role="region" aria-label={`${displayTitle} 상세`}><div><span>관련 사양</span><p>{ruleGuide}</p></div><div><span>결과</span><p>{severityLabel} · {displayTitle}</p></div></div>}
    {finding.facts.length > 0 && <div className="facts-grid">{finding.facts.map((fact, index) => <div className="fact" key={`${fact.label}-${index}`}><span>{fact.label}</span><strong>{fact.actual ?? fact.expected ?? "확인 필요"}</strong>{fact.actual && fact.expected && <small>기대: {fact.expected}</small>}</div>)}</div>}
    <div className="finding-actions">{finding.actions.map((action, index) => { const target = action.targetCategory; if (action.type === "replace_part" && target) return <button className="button button-small button-fix" key={`${action.label}-${index}`} disabled={disabled} onClick={() => onOpenPicker(target, finding.ruleId, finding.title, finding.affectedPartIds)}><FiEdit3 /> {action.label}</button>; if (action.type === "change_quantity") return <button className="button button-small button-fix" key={`${action.label}-${index}`} disabled={disabled} onClick={onEdit}><FiEdit3 /> {action.label}</button>; return <button className="button button-small button-light" key={`${action.label}-${index}`} disabled={disabled} onClick={onEdit}><FiInfo /> {action.label}</button>; })}</div>
    {finding.suggestions && finding.suggestions.length > 0 && <div className="suggestions"><div className="suggestion-heading"><FiActivity /><span>이 문제를 줄이는 대체 부품</span><small>{suggestionHeadingNote}</small></div><div className="suggestion-list">{finding.suggestions.map((suggestion) => { const target = suggestion.part.category; const expanded = expandedSuggestionId === suggestion.part.id; const sourceUrl = safeExternalUrl(suggestion.part.danawaUrl); const applicationEvidence = suggestionApplicationEvidenceFor(suggestion); return <article className={expanded ? "suggestion-card expanded" : "suggestion-card"} key={suggestion.part.id}><button className="suggestion-apply" type="button" aria-label={`${suggestion.part.name} 적용`} disabled={disabled} onClick={() => onApplySuggestion(target, suggestion.part, suggestion.recommendedQuantity, finding.affectedPartIds, applicationEvidence)}><span className="suggestion-icon"><PartVisual part={suggestion.part} /></span><span className="suggestion-content"><span className="category-badge suggestion-category-badge">{CATEGORY_LABELS[target]}</span>{suggestion.candidateRisk === "review" && <em className="decision-badge review suggestion-candidate-risk-badge">확인 후 적용</em>}<strong>{suggestion.part.name}</strong><small>{suggestion.recommendedQuantity !== undefined ? `추천 킷 ${suggestion.recommendedQuantity}개 · ` : ""}{partSummary(suggestion.part)} · 이 문제 해결{suggestion.part.listingType && suggestion.part.listingType !== "retail" ? ` · ${LISTING_TYPE_LABELS[suggestion.part.listingType]}` : ""}</small><em>{suggestion.performanceSummary}</em><em>{suggestion.profileSummary}</em>{suggestion.physicalEvidence && suggestion.physicalEvidence.status !== "not_applicable" && <em className="suggestion-physical-evidence-line">장착 규격 · {suggestion.physicalEvidence.summary}</em>}{suggestion.gpuTarget && <em className={`suggestion-gpu-target-line ${suggestion.gpuTarget.candidateFit ?? "unknown"}`}>GPU 목표 · {gpuTargetFitLabel(suggestion.gpuTarget.candidateFit)} · {suggestion.gpuTarget.summary}</em>}<SuggestionDecisionLine suggestion={suggestion} /><em>{suggestion.reason}</em></span><span className="suggestion-price"><strong>{formatWon(suggestionTotalPrice(suggestion, formatWon))}</strong><small>{suggestion.recommendedQuantity !== undefined ? `킷 ${suggestion.recommendedQuantity}개 · 1킷 ${formatWon(suggestion.part.priceWon)}` : formatPriceDelta(suggestion.priceDeltaWon)}</small>{suggestion.recommendedQuantity !== undefined && <small>{formatPriceDelta(suggestion.priceDeltaWon)}</small>}<FiExternalLink /></span></button><div className="suggestion-card-actions"><PartWatchButton part={suggestion.part} onWatch={onWatchPart} />{sourceUrl && <a className="suggestion-source-link" href={sourceUrl} target="_blank" rel="noreferrer" aria-label={`${suggestion.part.name} 다나와 상품 페이지 보기`}>다나와 보기 <FiExternalLink /></a>}<button className={compareSuggestionIds.includes(suggestion.part.id) ? "suggestion-compare-toggle selected" : "suggestion-compare-toggle"} type="button" aria-pressed={compareSuggestionIds.includes(suggestion.part.id)} onClick={() => toggleCompareSuggestion(suggestion.part.id)}>{compareSuggestionIds.includes(suggestion.part.id) ? "비교 중" : "비교"}</button><button className="suggestion-preview-button" type="button" onClick={() => onPreviewSuggestion(target, suggestion.part, suggestion.recommendedQuantity, finding.affectedPartIds, applicationEvidence)} disabled={disabled}>미리 적용</button><button className="suggestion-detail-toggle" type="button" aria-expanded={expanded} onClick={() => setExpandedSuggestionId(expanded ? null : suggestion.part.id)}><span>자세히</span><FiChevronDown /></button></div>{expanded && <SuggestionDetail suggestion={suggestion} suggestionSpecRows={suggestionSpecRows} formatSpecValue={formatSpecValue} formatSignedPercent={formatSignedPercent} formatWon={formatWon} similarityEvidenceText={similarityEvidenceText} />}</article>; })}</div>{compareSuggestions.length >= 2 && <SuggestionComparison suggestions={compareSuggestions} currentPart={currentSuggestionPart} affectedPartIds={finding.affectedPartIds} onCompareSuggestions={disabled ? undefined : onCompareSuggestions} onToast={onToast} onShare={onShareComparison} onRevoke={onRevokeComparison} props={suggestionProps} />}</div>}
    {hasReplacementAction && !hasQuantityAction && (!finding.suggestions || finding.suggestions.length === 0) && <div className="suggestion-empty"><FiInfo /><div><strong>안전한 대체 부품을 찾지 못했어요.</strong><p>지금 카탈로그에서 이 문제를 해결하면서 새 문제를 만들지 않는 부품이 없었어요. 제조사 페이지를 확인하거나 검색 조건을 넓혀 직접 골라 주세요.</p></div></div>}
    {hasQuantityAction && (!finding.suggestions || finding.suggestions.length === 0) && <div className="suggestion-empty quantity-guidance" data-testid="quantity-guidance"><FiInfo /><div><strong>이 문제는 수량·구성 조정 플랜으로 해결합니다.</strong><p>부품 성능이 아니라 메인보드 슬롯·저장장치 포트·케이스 자리가 부족한 문제입니다. 수리 플랜에서 수량을 줄이거나 부품을 바꾸면 바뀐 결과를 미리 비교할 수 있어요.</p><button className="text-button" type="button" onClick={onFocusRepairPlans ?? onEdit}>추천 수리 플랜 보기 <FiExternalLink /></button></div></div>}
    {finding.affectedPartIds.length > 0 && <p className="affected-parts"><FiInfo /> 영향받은 부품: {finding.affectedPartIds.map((id) => partMap.get(id)?.name ?? id).join(", ")}</p>}
  </article>;
}
