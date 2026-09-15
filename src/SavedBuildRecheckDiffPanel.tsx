import { FiAlertTriangle, FiCheckCircle, FiInfo, FiLayers, FiRefreshCw, FiSearch, FiXCircle } from "react-icons/fi";
import { catalogRefreshFindingImpactsFor } from "../shared/catalog-refresh-impact";
import { catalogRefreshValueText } from "../shared/catalog-refresh-report";
import { savedBuildCheckDiffFor, savedBuildCheckFindingDiffFor, savedBuildCheckSnapshotFor, savedBuildCheckTransitionSummaryFor } from "../shared/saved-build-check";
import type { SavedBuildCheckFindingChange, SavedBuildCheckFindingDiff } from "../shared/saved-build-check";
import { buildBenchmarkDecisionImpactText, buildBenchmarkImpactStatusText, buildBenchmarkSnapshotStatusText } from "../shared/build-benchmark-snapshot";
import { savedBuildRecheckCandidatesFor } from "../shared/saved-build-recheck-recommendation";
import { DATA_QUALITY_LABELS, isCatalogDataQualityChangeField, isKnownPrice } from "../shared/types";
import type { CatalogRefreshReport, CatalogRefreshReportItem } from "../shared/catalog-refresh-report";
import type { SavedBuildCheckSnapshot, CompatibilityResult, Finding, Part, RecommendationPlan } from "../shared/types";

function statusLabel(status: CompatibilityResult["status"]) {
  return status === "compatible" ? "호환 가능" : status === "needs_review" ? "확인 필요" : "호환 불가";
}

function directionLabel(direction: ReturnType<typeof savedBuildCheckTransitionSummaryFor>["direction"]) {
  return direction === "improved" ? "위험 감소" : direction === "regressed" ? "위험 증가" : direction === "changed" ? "일부 변경" : "변화 없음";
}

function deltaText(value: number) {
  return value === 0 ? "변화 없음" : `${value > 0 ? "+" : ""}${value}`;
}

function priceDeltaText(value: number | undefined, complete: boolean) {
  if (!complete || value === undefined) return "가격 확인 필요";
  if (value === 0) return "변화 없음";
  return `${value > 0 ? "+" : ""}${value.toLocaleString("ko-KR")}원`;
}

function analysisScoreText(score: number | undefined, label: string) {
  return score === undefined ? label : `${score}점 · ${label}`;
}

function analysisConfidenceLabel(confidence: "high" | "limited" | "unknown") {
  return confidence === "high" ? "정보 충분" : confidence === "limited" ? "일부 스펙 기준" : "계산 불가";
}

function analysisDeltaText(summary: ReturnType<typeof savedBuildCheckTransitionSummaryFor>, changed: boolean) {
  if (!changed) return "점수·라벨·정보 수준 동일";
  if (summary.analysisScoreDelta === undefined) return "점수·라벨·정보 수준 변화 확인";
  if (summary.analysisScoreDelta === 0) return "성능 점수 동일 · 라벨·정보 수준 변화 확인";
  return `성능 점수 ${summary.analysisScoreDelta > 0 ? "+" : ""}${summary.analysisScoreDelta}점 · 점수 변화 확인`;
}

function resourceHeadroomText(value: number | undefined) {
  if (value === undefined) return "확인 필요";
  return value >= 0 ? `${value}W 여유` : `${Math.abs(value)}W 부족`;
}

function resourceBudgetText(resource: SavedBuildCheckSnapshot["resourceBudget"]) {
  if (!resource) return "미적용";
  return `전력 ${resourceHeadroomText(resource.powerHeadroomW)} · 냉각 ${resourceHeadroomText(resource.coolerHeadroomW)}`;
}

function resourceBudgetDeltaText(summary: ReturnType<typeof savedBuildCheckTransitionSummaryFor>, changed: boolean) {
  if (!changed) return "저장 당시와 현재 예산 상태 동일";
  const values = [
    summary.powerHeadroomDeltaW !== undefined ? `전력 ${summary.powerHeadroomDeltaW > 0 ? "+" : ""}${summary.powerHeadroomDeltaW}W` : undefined,
    summary.coolerHeadroomDeltaW !== undefined ? `냉각 ${summary.coolerHeadroomDeltaW > 0 ? "+" : ""}${summary.coolerHeadroomDeltaW}W` : undefined
  ].filter((value): value is string => Boolean(value));
  return values.length > 0 ? values.join(" · ") : "예산 상태·정보 수준 변화 확인";
}

function benchmarkSnapshotText(snapshot: SavedBuildCheckSnapshot["benchmarkSnapshot"]) {
  if (!snapshot) return "기록 없음";
  return `${buildBenchmarkSnapshotStatusText(snapshot.status)} · ${snapshot.presentScoreCount}/${snapshot.expectedScoreCount}개 점수`;
}

function benchmarkImpactDetail(impact: ReturnType<typeof savedBuildCheckTransitionSummaryFor>["benchmarkImpact"]) {
  if (impact.status === "not_recorded") return "저장 당시와 현재 모두 벤치마크 저장본이 없습니다.";
  if (impact.status === "unverified") return "저장 당시 또는 현재 정보가 부족해 성능 판단 영향을 확정할 수 없습니다.";
  if (impact.changedScoreCount > 0) return `점수 ${impact.changedScoreCount}개 변경 · ${impact.changedPartCount}개 부품 영향`;
  if (impact.sourceChanged) return "점수 출처 또는 출처 메모가 변경되었습니다.";
  if (impact.benchmarkDateChanged) return "벤치마크 자료 시점이 변경되었습니다.";
  return "저장 당시와 현재의 점수·출처·자료 시점이 같습니다.";
}

function refreshPriceTransition(item: CatalogRefreshReportItem) {
  const beforeKnown = isKnownPrice(item.previousPriceWon);
  const afterKnown = isKnownPrice(item.nextPriceWon);
  if (!beforeKnown && !afterKnown) return "확인 필요 → 확인 필요";
  if (!beforeKnown) return `확인 필요 → ${item.nextPriceWon!.toLocaleString("ko-KR")}원`;
  if (!afterKnown) return `${item.previousPriceWon!.toLocaleString("ko-KR")}원 → 확인 필요`;
  if (item.previousPriceWon === item.nextPriceWon) return `${item.nextPriceWon!.toLocaleString("ko-KR")}원 · 변화 없음`;
  const delta = item.nextPriceWon! - item.previousPriceWon!;
  return `${item.previousPriceWon!.toLocaleString("ko-KR")}원 → ${item.nextPriceWon!.toLocaleString("ko-KR")}원 · ${delta > 0 ? "+" : ""}${delta.toLocaleString("ko-KR")}원`;
}

function refreshDataQualityTransition(item: CatalogRefreshReportItem) {
  return item.previousDataQuality === item.nextDataQuality
    ? DATA_QUALITY_LABELS[item.nextDataQuality]
    : `${DATA_QUALITY_LABELS[item.previousDataQuality]} → ${DATA_QUALITY_LABELS[item.nextDataQuality]}`;
}

function refreshDateText(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
}

function refreshNextActionsFor(item: CatalogRefreshReportItem) {
  const actions: Array<{ id: string; label: string }> = [];
  if (item.changedFields.includes("가격")) actions.push({ id: "purchase-list-panel", label: "구매 목록에서 가격 확인" });
  if (item.changedFields.some((field) => field === "원문 스펙" || field === "정규화 스펙" || isCatalogDataQualityChangeField(field) || field === "누락 필드")) actions.push({ id: "result-findings", label: "현재 결과 다시 확인" });
  return actions;
}

function findingChangeLabel(change: SavedBuildCheckFindingChange) {
  return change === "resolved" ? "해결됨" : change === "new" ? "신규" : change === "severity_changed" ? "중요도 변경" : change === "details_changed" ? "내용 변경" : "변화 없음";
}

function findingChangeTone(change: SavedBuildCheckFindingChange) {
  return change === "resolved" ? "resolved" : change === "new" ? "new" : "changed";
}

type FindingPlanResolution = "resolved" | "remaining" | "unknown";

function findingPlanResolutionFor(plan: RecommendationPlan, finding: Finding): FindingPlanResolution {
  if (Array.isArray(plan.remainingFindingRuleIds)) return plan.remainingFindingRuleIds.includes(finding.ruleId) ? "remaining" : "resolved";
  if (plan.resolvedFindingTitles.includes(finding.title)) return "resolved";
  if (plan.remainingFindingTitles?.includes(finding.title)) return "remaining";
  return "unknown";
}

function planChangesForFinding(plan: RecommendationPlan, finding: Finding) {
  const targetCategories = new Set(finding.actions.map((action) => action.targetCategory).filter((category): category is Part["category"] => Boolean(category)));
  return plan.changes.filter((change) => targetCategories.has(change.category) || (change.fromPartId ? finding.affectedPartIds.includes(change.fromPartId) : false) || finding.affectedPartIds.includes(change.toPart.id));
}

function findingPlanResolutionLabel(resolution: FindingPlanResolution) {
  return resolution === "resolved" ? "해결" : resolution === "remaining" ? "남음" : "정보 확인 필요";
}

function SavedBuildRecheckRefreshImpactPanel({ report, findingChanges, result, onFocusFinding, onFocusSection }: { report: CatalogRefreshReport; findingChanges: ReadonlyArray<SavedBuildCheckFindingDiff>; result: CompatibilityResult; onFocusFinding?: (ruleId: string) => void; onFocusSection?: (targetId: string) => void }) {
  const impacts = catalogRefreshFindingImpactsFor(report, findingChanges);
  const linkedCount = impacts.reduce((total, impact) => total + impact.findingChanges.length, 0);
  return <section className={`saved-build-recheck-refresh-impact ${report.status}`} aria-label="원문 재확인과 현재 재검사 연결" data-testid="saved-build-recheck-refresh-impact">
    <div className="saved-build-recheck-refresh-impact-heading"><div><p className="eyebrow">REFRESH → CURRENT CHECK</p><strong>원문 재확인과 현재 결과 연결</strong><small>저장 당시 입력에 대해 확인한 부품과 현재 재검사 항목의 부품 ID가 겹치는 관측만 연결합니다.</small></div><span>{linkedCount}개 연결</span></div>
    {report.failures.length > 0 && <p className="saved-build-recheck-refresh-impact-failure"><FiAlertTriangle /> 원문 확인 실패 {report.failures.length}개는 현재 결과와 연결할 수 없습니다.</p>}
    {impacts.length > 0 ? <div className="saved-build-recheck-refresh-impact-list">{impacts.slice(0, 6).map(({ item, findingChanges: linkedChanges }) => {
      const focusableFinding = linkedChanges.map((change) => change.after ? result.findings.find((finding) => finding.ruleId === change.after?.ruleId || finding.id === change.after?.id) : undefined).find((finding): finding is Finding => Boolean(finding));
      const nextActions = refreshNextActionsFor(item);
      return <article className={linkedChanges.length > 0 ? "linked" : "unlinked"} key={`${item.target.kind}-${item.target.id}`}>
        <div className="saved-build-recheck-refresh-impact-item-heading"><strong>{item.name}</strong><span>{linkedChanges.length > 0 ? `결과 변화 ${linkedChanges.length}개` : "결과 연결 없음"}</span></div>
        <small>{item.target.kind === "part" ? "핵심 부품" : "주변 부품"} · 확인 {refreshDateText(item.refreshedAt)} · 변경 {item.changedFields.length > 0 ? item.changedFields.join(" · ") : "변경된 영역 없음"}</small>
        <div className="saved-build-recheck-refresh-impact-facts"><span><b>가격</b>{refreshPriceTransition(item)}</span><span><b>데이터</b>{refreshDataQualityTransition(item)}</span><span><b>누락</b>{item.previousMissingCount}개 → {item.nextMissingCount}개</span></div>
        {item.valueDiffs && item.valueDiffs.length > 0 && <div className="saved-build-recheck-refresh-impact-values"><strong>확인된 실제 값</strong>{item.valueDiffs.slice(0, 4).map((diff) => <div key={diff.field}><span>{diff.field}</span><small><em>{catalogRefreshValueText(diff.previous)}</em><b>→</b><em>{catalogRefreshValueText(diff.next)}</em></small></div>)}{item.valueDiffs.length > 4 && <small>그 외 값 변화 {item.valueDiffs.length - 4}건</small>}</div>}
        {linkedChanges.length > 0 ? <ul>{linkedChanges.slice(0, 4).map((change) => <li key={`${change.key}-${change.change}`}><b>{findingChangeLabel(change.change)}</b><span>{(change.after ?? change.before)?.title ?? change.key}</span></li>)}</ul> : <p>현재 재검사에서 이 부품과 겹치는 항목 변화는 관측되지 않았습니다. 원문 변경이 결과 원인이라고 단정하지 않습니다.</p>}
        {onFocusSection && nextActions.length > 0 && <div className="saved-build-recheck-refresh-impact-actions">{nextActions.map((action) => <button className="text-button" type="button" data-testid={`saved-build-recheck-refresh-action-${action.id}`} onClick={() => onFocusSection(action.id)} key={action.id}><FiSearch /> {action.label}</button>)}</div>}
        {focusableFinding && onFocusFinding && <button className="text-button" type="button" onClick={() => onFocusFinding(focusableFinding.ruleId)}><FiSearch /> 연결된 현재 항목 보기</button>}
      </article>;
    })}</div> : report.failures.length === 0 && <p className="saved-build-recheck-refresh-impact-empty"><FiInfo /> 성공한 원문 확인 항목이 없어 현재 결과 연결을 계산할 수 없습니다.</p>}
    {report.items.length > 6 && <small className="saved-build-recheck-refresh-impact-more">그 외 확인 항목 {report.items.length - 6}건은 구매 목록의 원문 재확인 결과에서 확인할 수 있습니다.</small>}
    <p className="saved-build-recheck-refresh-impact-note"><FiInfo /> 이 연결은 대상 부품 ID와 항목 영향 부품 ID가 겹친다는 참고 정보입니다. 원문 변경과 결과 사이의 인과관계를 확정하지 않습니다.</p>
  </section>;
}

export function SavedBuildRecheckDiffPanel({ snapshot, result, partMap, onFocusFinding, onPreviewSuggestion, onFocusRepairPlans, onFocusSection }: { snapshot: SavedBuildCheckSnapshot; result: CompatibilityResult; partMap: ReadonlyMap<string, Part>; onFocusFinding?: (ruleId: string) => void; onPreviewSuggestion?: (category: Part["category"], part: Part, quantity?: number, affectedPartIds?: string[]) => void; onFocusRepairPlans?: () => void; onFocusSection?: (targetId: string) => void }) {
  const currentSnapshot = savedBuildCheckSnapshotFor(result);
  const diff = savedBuildCheckDiffFor(snapshot, result);
  const summary = savedBuildCheckTransitionSummaryFor(snapshot, currentSnapshot);
  const findingDiff = savedBuildCheckFindingDiffFor(snapshot, currentSnapshot);
  const changedFindings = findingDiff.changes.filter((change) => change.change !== "unchanged");
  const strategyPlans = (result.repairPlans ?? []).slice(0, 3);
  const DirectionIcon = summary.direction === "improved" ? FiCheckCircle : summary.direction === "regressed" ? FiXCircle : summary.direction === "changed" ? FiAlertTriangle : FiCheckCircle;
  const riskChanged = diff.riskChanged;
  const priceChanged = diff.priceChanged || diff.priceCompletenessChanged;
  const analysisChanged = diff.analysisChanged;
  const resourceBudgetChanged = diff.resourceBudgetChanged;
  const benchmarkChanged = diff.benchmarkChanged || diff.benchmarkNeedsReview;
  const metadataChanged = diff.catalogChanged || diff.engineChanged;
  return <section className={`saved-build-recheck-diff-panel ${summary.direction}`} aria-label="저장 당시와 현재 재검사 비교" data-testid="saved-build-recheck-diff" tabIndex={-1}>
    <div className="saved-build-recheck-diff-heading"><div><p className="eyebrow">SAVED → CURRENT RECHECK</p><h2>저장 당시와 현재 재검사 비교</h2><p>저장 저장본과 현재 카탈로그·검사 규칙으로 다시 계산한 결과를 분리해 보여줍니다.</p></div><strong><DirectionIcon /> {directionLabel(summary.direction)}</strong></div>
    <div className="saved-build-recheck-diff-grid">
      <article className={diff.statusChanged ? "changed" : undefined}><span>결과</span><strong>{statusLabel(snapshot.status)} → {statusLabel(result.status)}</strong><small>{diff.statusChanged ? "결과가 달라졌습니다." : "저장 당시와 현재 결과가 같습니다."}</small></article>
      <article className={riskChanged ? "changed" : undefined}><span>위험 카운트</span><strong>차단 {snapshot.blockerCount} → {result.blockerCount} · 주의 {snapshot.warningCount} → {result.warningCount} · 확인 {snapshot.unknownCount} → {result.unknownCount}</strong><small>{riskChanged ? `차단 ${deltaText(summary.blockerDelta)} · 주의 ${deltaText(summary.warningDelta)} · 확인 ${deltaText(summary.unknownDelta)}` : "핵심·주변 부품 위험 카운트 변화 없음"}</small></article>
      <article className={priceChanged ? "changed" : undefined}><span>가격</span><strong>{priceDeltaText(summary.priceDeltaWon, snapshot.priceComplete && result.priceComplete)}</strong><small>{diff.priceCompletenessChanged ? `가격 확정 상태 ${snapshot.priceComplete ? "확정" : "확인 필요"} → ${result.priceComplete ? "확정" : "확인 필요"}` : "저장 당시와 현재 총액 비교"}</small></article>
      <article className={analysisChanged ? "changed" : undefined}><span>성능 분석</span><strong>{analysisScoreText(snapshot.analysisScore, snapshot.analysisScoreLabel)} → {analysisScoreText(result.analysis.overallScore, result.analysis.scoreLabel)}</strong><small>{analysisDeltaText(summary, analysisChanged)}{analysisChanged ? ` · ${analysisConfidenceLabel(snapshot.analysisConfidence)} → ${analysisConfidenceLabel(result.analysis.confidence)}` : ""}</small></article>
      <article className={resourceBudgetChanged ? "changed" : undefined}><span>전력·냉각 예산</span><strong>{resourceBudgetText(snapshot.resourceBudget)} → {resourceBudgetText(currentSnapshot.resourceBudget)}</strong><small>{resourceBudgetDeltaText(summary, resourceBudgetChanged)}</small></article>
      <article className={benchmarkChanged ? "changed" : undefined} data-testid="saved-build-recheck-benchmark"><span>CPU·GPU 정보</span><strong>{buildBenchmarkImpactStatusText(diff.benchmarkImpact.status)} · {buildBenchmarkDecisionImpactText(diff.benchmarkImpact.decisionImpact)}</strong><small>{benchmarkSnapshotText(snapshot.benchmarkSnapshot)} → {benchmarkSnapshotText(result.benchmarkSnapshot)} · {benchmarkImpactDetail(diff.benchmarkImpact)}</small></article>
      <article className={metadataChanged ? "changed" : undefined}><span>검사 기준</span><strong>{diff.catalogChanged ? "카탈로그 기준 변경" : "카탈로그 기준 동일"}</strong><small>{diff.engineChanged ? `검사 버전 ${snapshot.engineVersion} → ${result.engineVersion}` : `검사 버전 ${result.engineVersion}`}</small></article>
    </div>
    <div className="saved-build-recheck-diff-facts"><span>저장 당시 <b>{new Date(snapshot.checkedAt).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}</b></span><span>현재 재검사 <b>{new Date(result.checkedAt).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}</b></span><span>{summary.findingDiffAvailable ? `항목 해결 ${summary.resolvedFindingCount}개 · 신규 ${summary.newFindingCount}개` : "구버전 저장본 · 항목 상세 비교 불가"}</span></div>
    {(riskChanged || priceChanged || analysisChanged || resourceBudgetChanged || benchmarkChanged || metadataChanged || diff.statusChanged) && <p className="saved-build-recheck-diff-warning"><FiInfo /> 저장 당시 결과와 현재 결과가 달라졌거나 벤치마크 정보를 확정할 수 없습니다. 현재 카탈로그 기준 결과를 우선 참고하되, 구매 전 변경된 항목·성능 분석·전력·냉각 예산·벤치마크 원문을 다시 확인하세요.</p>}
    {!diff.hasChanges && <p className="saved-build-recheck-diff-same"><FiCheckCircle /> 저장 당시 저장본과 현재 재검사에서 결과·위험·가격·성능 분석·전력·냉각 예산·벤치마크 정보·검사 기준의 변화가 확인되지 않았습니다.</p>}
    {snapshot.catalogRefreshReport && <SavedBuildRecheckRefreshImpactPanel report={snapshot.catalogRefreshReport} findingChanges={findingDiff.changes} result={result} onFocusFinding={onFocusFinding} onFocusSection={onFocusSection} />}
    <div className="saved-build-recheck-diff-findings" data-testid="saved-build-recheck-diff-findings">
      <div className="saved-build-recheck-diff-findings-heading"><strong>변경된 항목</strong><span>{findingDiff.available ? `${changedFindings.length}개` : "비교 불가"}</span></div>
      {!findingDiff.available ? <p className="saved-build-recheck-diff-findings-empty"><FiInfo /> 구버전 저장본에는 항목 상세가 없어 규칙별 비교를 제공하지 않습니다.</p> : changedFindings.length === 0 ? <p className="saved-build-recheck-diff-findings-empty"><FiCheckCircle /> 저장 당시와 현재 재검사 사이에 변경된 항목이 없습니다.</p> : <div className="saved-build-recheck-diff-findings-list">{changedFindings.slice(0, 4).map((change) => {
        const beforeFinding = change.before;
        const afterFinding = change.after;
        const currentFinding = afterFinding ? result.findings.find((finding) => finding.ruleId === afterFinding.ruleId || finding.id === afterFinding.id) : undefined;
        const recommendation = currentFinding ? savedBuildRecheckCandidatesFor(currentFinding, result)[0] : undefined;
        const affectedPartIds = [...new Set([...(beforeFinding?.affectedPartIds ?? []), ...(afterFinding?.affectedPartIds ?? [])])];
        const affectedParts = affectedPartIds.slice(0, 4).map((partId) => partMap.get(partId)?.name ?? partId);
        return <article className={`saved-build-recheck-diff-finding ${findingChangeTone(change.change)}`} key={`${change.key}-${change.change}`}>
          <div className="saved-build-recheck-diff-finding-heading"><span>{findingChangeLabel(change.change)}</span><strong>{afterFinding?.title ?? beforeFinding?.title ?? change.key}</strong></div>
          <div className="saved-build-recheck-diff-finding-versions"><div><small>저장 당시</small><p>{beforeFinding ? beforeFinding.message : "이 검사에는 기록되지 않았습니다."}</p></div><b aria-hidden="true">→</b><div><small>현재 재검사</small><p>{afterFinding ? afterFinding.message : "현재 검사에서 해결되었습니다."}</p></div></div>
          {affectedParts.length > 0 && <small className="saved-build-recheck-diff-finding-parts">영향 부품 · {affectedParts.join(", ")}{affectedPartIds.length > affectedParts.length ? ` 외 ${affectedPartIds.length - affectedParts.length}개` : ""}</small>}
          {recommendation && <div className="saved-build-recheck-recommendation" data-testid={`saved-build-recheck-recommendation-${change.key}`}>
            <div className="saved-build-recheck-recommendation-heading"><span>우선 검토 후보</span><strong>{recommendation.suggestion.part.name}</strong><em className={recommendation.decision.state}>{recommendation.decision.label}</em></div>
            <p>{recommendation.decision.summary}</p>
            <small>{recommendation.suggestion.similarityLabel} {recommendation.suggestion.similarityScore}점 · 미리 적용 후 차단 {recommendation.suggestion.remainingBlockers}개 · 주의 {recommendation.suggestion.remainingWarnings}개 · 확인 {recommendation.suggestion.remainingUnknown}개{recommendation.suggestion.priceDeltaWon !== undefined ? ` · 가격 ${recommendation.suggestion.priceDeltaWon > 0 ? "+" : ""}${recommendation.suggestion.priceDeltaWon.toLocaleString("ko-KR")}원` : " · 가격 확인 필요"}</small>
            <div className="saved-build-recheck-recommendation-actions">{onPreviewSuggestion && recommendation.decision.state !== "hold" && <button className="text-button" type="button" onClick={() => onPreviewSuggestion(recommendation.suggestion.part.category, recommendation.suggestion.part, recommendation.suggestion.recommendedQuantity, currentFinding?.affectedPartIds)}><FiRefreshCw /> 미리 적용</button>}{currentFinding && onFocusFinding && <button className="text-button" type="button" onClick={() => onFocusFinding(currentFinding.ruleId)}><FiSearch /> 후보 전체 보기</button>}</div>
          </div>}
          {currentFinding && strategyPlans.length > 0 && <div className="saved-build-recheck-finding-strategies" data-testid={`saved-build-recheck-finding-strategies-${change.key}`}>
            <div className="saved-build-recheck-finding-strategies-heading"><strong>이 항목 기준 전략</strong><span>현재 플랜 연결</span></div>
            <div className="saved-build-recheck-finding-strategies-list">{strategyPlans.map((plan) => {
              const resolution = findingPlanResolutionFor(plan, currentFinding);
              const changes = planChangesForFinding(plan, currentFinding);
              return <article className={resolution} key={`${change.key}-${plan.label}`}><div><strong>{plan.label}</strong><span>{findingPlanResolutionLabel(resolution)}</span></div><small>잔여 차단 {plan.remainingBlockers}개 · 가격 {priceDeltaText(plan.priceDeltaWon, plan.priceComplete)}</small>{changes.length > 0 ? <p>{changes.slice(0, 2).map((item) => item.kind === "change_quantity" ? `${item.fromQuantity ?? "?"}개 → ${item.toQuantity ?? "?"}개` : `${item.fromPartName ?? "현재 선택"} → ${item.toPart.name}`).join(" · ")}{changes.length > 2 ? ` 외 ${changes.length - 2}개` : ""}</p> : <p>{resolution === "resolved" ? "이 플랜의 해결 범위에 포함됩니다." : resolution === "remaining" ? "플랜 적용 후에도 이 항목이 남습니다." : "플랜의 항목 연결 정보를 확인하세요."}</p>}</article>;
            })}</div>
          </div>}
          {currentFinding && !recommendation && onFocusFinding && <button className="text-button" type="button" onClick={() => onFocusFinding(currentFinding.ruleId)}><FiSearch /> 현재 항목 보기</button>}
        </article>;
      })}</div>}
      {changedFindings.length > 4 && <small className="saved-build-recheck-diff-findings-more">그 외 변경된 항목 {changedFindings.length - 4}개는 현재 상세 결과에서 확인하세요.</small>}
    </div>
    {strategyPlans.length > 0 && <div className="saved-build-recheck-strategies" data-testid="saved-build-recheck-strategies">
      <div className="saved-build-recheck-strategies-heading"><div><strong>현재 결과 해결 전략 비교</strong><small>변경된 항목을 줄이는 세 가지 방향을 같은 현재 재검사 기준으로 비교합니다.</small></div><span>{strategyPlans.length}안</span></div>
      <div className="saved-build-recheck-strategies-list">{strategyPlans.map((plan, index) => <article className={index === 0 ? "recommended" : undefined} key={`${plan.label}-${plan.title}`}>
        <div className="saved-build-recheck-strategy-heading"><span>{index === 0 ? "우선 검토" : plan.label}</span><strong>{plan.title}</strong></div>
        <div className="saved-build-recheck-strategy-stats"><span>변경 <b>{plan.changes.length}개</b></span><span>차단 해결 <b>{plan.resolvedBlockers}개</b></span><span>잔여 위험 <b>{plan.remainingBlockers}/{plan.remainingWarnings}/{plan.remainingUnknown}</b></span><span>가격 <b>{priceDeltaText(plan.priceDeltaWon, plan.priceComplete)}</b></span><span>적용 후 <b>{plan.priceComplete ? `${plan.afterTotalPriceWon.toLocaleString("ko-KR")}원` : "확인 필요"}</b></span></div>
        <p>{plan.reason}</p>
        <div className="saved-build-recheck-strategy-changes">{plan.changes.slice(0, 3).map((change) => <span key={`${change.category}-${change.kind}-${change.toPart.id}-${change.toQuantity ?? ""}`}>{change.kind === "change_quantity" ? `${change.fromQuantity ?? "?"}개 → ${change.toQuantity ?? "?"}개` : `${change.fromPartName ?? "현재 선택"} → ${change.toPart.name}`}</span>)}{plan.changes.length > 3 && <span>외 {plan.changes.length - 3}개 변경</span>}</div>
        {onFocusRepairPlans && <button className="text-button" type="button" onClick={onFocusRepairPlans}><FiLayers /> 플랜 상세 보기</button>}
      </article>)}</div>
    </div>}
    {onFocusSection && <div className="saved-build-recheck-diff-actions"><button className="button button-light" type="button" onClick={() => onFocusSection("result-findings")}><FiSearch /> 현재 상세 결과 보기</button><button className="text-button" type="button" onClick={() => onFocusSection("saved-build-check-timeline")}><FiRefreshCw /> 검사 타임라인 보기</button></div>}
    <p className="saved-build-recheck-diff-note"><FiInfo /> 이 비교는 저장 시점과 현재 카탈로그 기준의 차이를 설명하는 기능입니다. 실제 조립 성공·BIOS·QVL·배송·판매자 조건을 대신하지 않습니다.</p>
  </section>;
}
