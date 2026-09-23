import { FiAlertTriangle, FiCheckCircle, FiCopy, FiDownload, FiExternalLink, FiInfo, FiSave, FiXCircle } from "react-icons/fi";
import type { CompatibilityResult } from "../shared/types";
import type { BuildChangeResultComparison } from "../shared/build-change-result";
import { savedBuildCheckFindingDiffFor, savedBuildCheckSnapshotFor, savedBuildCheckTransitionSummaryFor } from "../shared/saved-build-check";
import type { SavedBuildCheckFindingChange } from "../shared/saved-build-check";

function statusLabel(status: CompatibilityResult["status"]) {
  return status === "compatible" ? "호환 가능" : status === "needs_review" ? "확인 필요" : "호환 불가";
}

function directionLabel(direction: ReturnType<typeof savedBuildCheckTransitionSummaryFor>["direction"]) {
  return direction === "improved" ? "위험 감소" : direction === "regressed" ? "위험 증가" : direction === "changed" ? "일부 변경" : "변화 없음";
}

function directionIcon(direction: ReturnType<typeof savedBuildCheckTransitionSummaryFor>["direction"]) {
  return direction === "improved" ? FiCheckCircle : direction === "regressed" ? FiXCircle : direction === "changed" ? FiAlertTriangle : FiCheckCircle;
}

function signedCount(value: number) {
  return value === 0 ? "변화 없음" : `${value > 0 ? "+" : ""}${value}`;
}

function priceText(result: CompatibilityResult) {
  return result.priceComplete ? `${result.totalPriceWon.toLocaleString("ko-KR")}원` : "가격 확인 필요";
}

function priceTransition(before: CompatibilityResult, after: CompatibilityResult, delta?: number) {
  if (!before.priceComplete || !after.priceComplete || delta === undefined) return `${priceText(before)} → ${priceText(after)}`;
  return `${priceText(before)} → ${priceText(after)} · ${delta === 0 ? "변화 없음" : `${delta > 0 ? "+" : ""}${delta.toLocaleString("ko-KR")}원`}`;
}

function resourceText(result: CompatibilityResult) {
  const metrics = result.metrics;
  const power = metrics.powerHeadroomW === undefined ? "전력 확인 필요" : `전력 ${metrics.powerHeadroomW >= 0 ? `${metrics.powerHeadroomW}W 여유` : `${Math.abs(metrics.powerHeadroomW)}W 부족`}`;
  const cooling = metrics.coolerHeadroomW === undefined ? "냉각 확인 필요" : `냉각 ${metrics.coolerHeadroomW >= 0 ? `${metrics.coolerHeadroomW}W 여유` : `${Math.abs(metrics.coolerHeadroomW)}W 부족`}`;
  return `${power} · ${cooling}`;
}

function findingChangeLabel(change: SavedBuildCheckFindingChange) {
  return change === "resolved" ? "해결됨" : change === "new" ? "신규" : change === "severity_changed" ? "중요도 변경" : change === "details_changed" ? "내용 변경" : "변화 없음";
}

function findingChangeTone(change: SavedBuildCheckFindingChange) {
  return change === "resolved" ? "resolved" : change === "new" ? "new" : "changed";
}

export function BuildChangeResultSummary({ comparison, onDismiss, onCopy, onDownloadJson, onSaveWithDecisionNote, onFocusFinding, decisionSaveLabel = "선택 이유에 첨부해 저장" }: { comparison: BuildChangeResultComparison; onDismiss: () => void; onCopy: () => void; onDownloadJson: () => void; onSaveWithDecisionNote?: () => void; onFocusFinding?: (ruleId: string) => void; decisionSaveLabel?: string }) {
  const beforeSnapshot = savedBuildCheckSnapshotFor(comparison.beforeResult);
  const afterSnapshot = savedBuildCheckSnapshotFor(comparison.afterResult);
  const transition = savedBuildCheckTransitionSummaryFor(beforeSnapshot, afterSnapshot);
  const findingDiff = savedBuildCheckFindingDiffFor(beforeSnapshot, afterSnapshot);
  const changedFindings = findingDiff.changes.filter((change) => change.change !== "unchanged");
  const DirectionIcon = directionIcon(transition.direction);
  return <section className={`build-change-result-summary ${transition.direction}`} aria-label="변경 전후 견적 비교" data-testid="build-change-result-summary" tabIndex={-1}>
    <div className="build-change-result-summary-heading"><div><h2>변경 전후 견적 비교</h2><p><strong>{comparison.title}</strong> · {comparison.summary}</p><small>부품을 바꾸기 전과 후의 호환성 결과와 예상 금액을 비교해요.</small></div><div className="build-change-result-summary-heading-side"><strong><DirectionIcon /> {directionLabel(transition.direction)}</strong><div className="build-change-result-summary-heading-actions"><button className="text-button" type="button" onClick={onCopy}><FiCopy /> 비교 복사</button><button className="text-button" type="button" onClick={onDownloadJson}><FiDownload /> JSON 저장</button>{onSaveWithDecisionNote && <button className="text-button" type="button" onClick={onSaveWithDecisionNote}><FiSave /> {decisionSaveLabel}</button>}<button className="icon-button" type="button" onClick={onDismiss} aria-label="변경 전후 견적 비교 닫기"><FiXCircle /></button></div></div></div>
    <div className="build-change-result-summary-grid">
      <article className={transition.statusChanged ? "changed" : undefined}><span>결과</span><strong>{statusLabel(comparison.beforeResult.status)} → {statusLabel(comparison.afterResult.status)}</strong><small>{transition.statusChanged ? "전체 결과가 달라졌습니다." : "전체 결과는 유지되었습니다."}</small></article>
      <article className={transition.blockerDelta !== 0 || transition.warningDelta !== 0 || transition.unknownDelta !== 0 ? "changed" : undefined} data-testid="build-change-result-summary-risk"><span>호환 항목</span><strong>호환 불가 {comparison.beforeResult.blockerCount} → {comparison.afterResult.blockerCount} · 주의 {comparison.beforeResult.warningCount} → {comparison.afterResult.warningCount} · 정보 부족 {comparison.beforeResult.unknownCount} → {comparison.afterResult.unknownCount}</strong><small>호환 불가 {signedCount(transition.blockerDelta)} · 주의 {signedCount(transition.warningDelta)} · 정보 부족 {signedCount(transition.unknownDelta)}</small></article>
      <article className={transition.priceDeltaWon !== undefined || transition.priceCompletenessChanged ? "changed" : undefined}><span>구매 금액</span><strong>{priceTransition(comparison.beforeResult, comparison.afterResult, transition.priceDeltaWon)}</strong><small>{transition.priceCompletenessChanged ? `가격 상태 ${comparison.beforeResult.priceComplete ? "가격 정보 있음" : "가격 정보 없음"} → ${comparison.afterResult.priceComplete ? "가격 정보 있음" : "가격 정보 없음"}` : "전체 견적 합계 기준"}</small></article>

      <article className={transition.resourceBudgetChanged ? "changed" : undefined}><span>전력·냉각 여유</span><strong>{resourceText(comparison.afterResult)}</strong><small>{transition.resourceRiskIncreased ? "적용 후 여유가 줄거나 확인 필요 상태가 되었습니다." : transition.resourceRiskDecreased ? "적용 후 자원 여유가 개선되었습니다." : "적용 전후 자원 상태 비교"}</small></article>
      <article className={transition.benchmarkChanged || transition.benchmarkNeedsReview ? "changed" : undefined}><span>항목 변화</span><strong>{findingDiff.available ? `해결 ${transition.resolvedFindingCount}개 · 신규 ${transition.newFindingCount}개` : "상세 비교 확인 필요"}</strong><small>{findingDiff.available ? `중요도 변경 ${transition.severityChangedFindingCount}개 · 내용 변경 ${transition.detailsChangedFindingCount}개` : "저장된 상세 결과가 없어 항목별 차이를 비교할 수 없어요."}</small></article>
    </div>
    <div className="build-change-result-summary-columns">
      <section className="build-change-result-summary-changes" aria-label="적용한 변경 부품"><div className="build-change-result-summary-subheading"><strong>적용한 변경</strong><span>{comparison.rows.length}개 항목</span></div><div className="build-change-result-summary-change-list">{comparison.rows.slice(0, 8).map((row) => <div key={row.id}><span>{row.label}</span><small><em>{row.before}</em><b>→</b><em>{row.after}</em></small></div>)}</div>{comparison.rows.length > 8 && <small>그 외 변경 {comparison.rows.length - 8}개는 변경 미리보기에서 확인했습니다.</small>}</section>
      <section className="build-change-result-summary-findings" aria-label="변경된 호환성 결과"><div className="build-change-result-summary-subheading"><strong>변경된 호환성 결과</strong><span>{changedFindings.length}개</span></div>{changedFindings.length > 0 ? <ul>{changedFindings.slice(0, 6).map((change) => <li key={`${change.key}-${change.change}`} className={findingChangeTone(change.change)}><span>{findingChangeLabel(change.change)}</span><strong>{(change.after ?? change.before)?.title ?? change.key}</strong>{change.after && onFocusFinding && <button className="text-button" type="button" data-testid={`build-change-result-finding-${change.after.ruleId}`} onClick={() => onFocusFinding(change.after!.ruleId)}>현재 결과 <FiExternalLink /></button>}</li>)}</ul> : <p><FiCheckCircle /> 항목 변화 없음 · 전체 위험 수치와 결과가 유지되었습니다.</p>}{changedFindings.length > 6 && <small>그 외 항목 변화 {changedFindings.length - 6}개는 검사 결과 상세에서 확인하세요.</small>}</section>
    </div>
    {(transition.direction === "regressed" || transition.benchmarkNeedsReview) && <p className="build-change-result-summary-warning"><FiAlertTriangle /> 호환 정보가 부족하거나 주의 항목이 늘었어요. 변경된 부품과 가격을 살펴봐 주세요.</p>}
    {transition.direction === "improved" && <p className="build-change-result-summary-success"><FiCheckCircle /> 호환 상태가 나아졌어요. 예상 금액과 교체 부품을 확인해 주세요.</p>}
  </section>;
}
