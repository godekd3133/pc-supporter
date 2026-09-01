import { FiActivity, FiEdit3, FiInfo, FiLoader, FiRefreshCw, FiSave, FiShield, FiXCircle } from "react-icons/fi";
import { buildScenarioComparisonFor } from "../shared/build-scenario";
import type { BuildSelection, BuildAnalysis, CompatibilityResult, Part, PartCategory, RecommendationPlan, RecommendationPreferences } from "../shared/types";
import { CATEGORY_LABELS, isKnownPrice, PART_CATEGORIES } from "../shared/types";

export type RepairPlanComparisonViewState =
  | { status: "loading"; nextBuild: BuildSelection; currentResult: CompatibilityResult }
  | { status: "ready"; nextBuild: BuildSelection; currentResult: CompatibilityResult; result: CompatibilityResult }
  | { status: "error"; nextBuild: BuildSelection; currentResult: CompatibilityResult; message: string };

function selectionListFor(build: BuildSelection, category: PartCategory) {
  if (category === "memory") return build.memory;
  if (category === "ssd") return build.ssd;
  if (category === "hdd") return build.hdd;
  const selection = build[category];
  return selection ? [selection] : [];
}

function planBuildLineText(build: BuildSelection, category: PartCategory, partMap: ReadonlyMap<string, Part>) {
  const selections = selectionListFor(build, category);
  return selections.length > 0
    ? selections.map((selection) => `${partMap.get(selection.partId)?.name ?? selection.partId}${selection.quantity > 1 ? ` ×${selection.quantity}` : ""}`).join(", ")
    : "미선택";
}

function formatWon(value: number | undefined) {
  return isKnownPrice(value) ? `${value.toLocaleString("ko-KR")}원` : "가격 확인 중";
}

function formatPriceDelta(value: number | undefined) {
  if (value === undefined) return "가격 확인 필요";
  if (value === 0) return "현재와 같은 가격";
  return `${value > 0 ? "+" : ""}${value.toLocaleString("ko-KR")}원`;
}

function scenarioStatusLabel(status: CompatibilityResult["status"]) {
  return status === "compatible" ? "호환 가능" : status === "needs_review" ? "확인 필요" : "호환 불가";
}

function scenarioRiskText(result: CompatibilityResult) {
  return `차단 ${result.blockerCount}개 · 주의 ${result.warningCount}개 · 확인 필요 ${result.unknownCount}개`;
}

function analysisScoreText(analysis: BuildAnalysis) {
  return analysis.overallScore === undefined ? analysis.scoreLabel : `${analysis.overallScore}점 · ${analysis.scoreLabel}`;
}

function RepairPlanComparisonPanel({ plan, state, currentBuild, currentResult, partMap, onApply, onSavePlan, onRetry, onClose }: { plan: RecommendationPlan; state: RepairPlanComparisonViewState; currentBuild: BuildSelection; currentResult: CompatibilityResult; partMap: ReadonlyMap<string, Part>; onApply: () => void; onSavePlan: (build: BuildSelection, preferences: RecommendationPreferences, label: string) => void; onRetry: () => void; onClose: () => void }) {
  if (state.status === "loading") return <section className="repair-plan-comparison loading" aria-label="수리 플랜 전체 비교" data-testid="repair-plan-comparison" role="status"><div className="repair-plan-comparison-heading"><div><p className="eyebrow">PLAN COMPARISON</p><h2>플랜 적용 후 전체 견적을 계산 중...</h2><p>{plan.title}</p></div><FiLoader className="spin" /></div><p className="repair-plan-comparison-loading"><FiActivity /> 현재 부품·수량을 바꾸지 않고 플랜 적용 후 전체 규칙을 다시 검사합니다.</p></section>;
  if (state.status === "error") return <section className="repair-plan-comparison error" aria-label="수리 플랜 전체 비교" data-testid="repair-plan-comparison" role="alert"><div className="repair-plan-comparison-heading"><div><p className="eyebrow">PLAN COMPARISON</p><h2>플랜 비교에 실패했습니다.</h2><p>{state.message}</p></div><FiXCircle /></div><div className="repair-plan-comparison-actions"><button className="button button-light" type="button" onClick={onRetry}><FiRefreshCw /> 다시 비교</button><button className="button button-light" type="button" onClick={onClose}>닫기</button></div></section>;
  const nextResult = state.result;
  const comparisonBaseResult = state.currentResult;
  const comparison = buildScenarioComparisonFor(comparisonBaseResult, nextResult);
  const remainingFindings = nextResult.findings.filter((finding) => finding.severity !== "info");
  const currentCorePriceComplete = comparisonBaseResult.corePriceComplete ?? comparisonBaseResult.priceComplete;
  const currentCoreTotalPriceWon = comparisonBaseResult.coreTotalPriceWon ?? Math.max(0, comparisonBaseResult.totalPriceWon - (comparisonBaseResult.accessoryTotalPriceWon ?? 0));
  const currentAccessoryPriceComplete = comparisonBaseResult.accessoryPriceComplete ?? true;
  const currentAccessoryTotalPriceWon = comparisonBaseResult.accessoryTotalPriceWon ?? 0;
  const nextCorePriceComplete = nextResult.corePriceComplete ?? nextResult.priceComplete;
  const nextCoreTotalPriceWon = nextResult.coreTotalPriceWon ?? Math.max(0, nextResult.totalPriceWon - (nextResult.accessoryTotalPriceWon ?? 0));
  const nextAccessoryPriceComplete = nextResult.accessoryPriceComplete ?? true;
  const nextAccessoryTotalPriceWon = nextResult.accessoryTotalPriceWon ?? 0;
  const comparisonPartMap = new Map(partMap);
  plan.changes.forEach((change) => comparisonPartMap.set(change.toPart.id, change.toPart));
  const accessoryPriceText = (complete: boolean, total: number) => complete ? total > 0 ? formatWon(total) : "없음" : "가격 확인 필요";
  const directionLabel = comparison.direction === "improved" ? "위험 감소" : comparison.direction === "worsened" ? "위험 증가" : comparison.direction === "changed" ? "일부 변화" : "변화 없음";
  const savePreferences: RecommendationPreferences = comparisonBaseResult.recommendationPreferences ?? { priority: "balanced", profile: "general", listingPolicy: "retail_only" };
  return <section className={`repair-plan-comparison ${comparison.direction}`} aria-label="수리 플랜 전체 비교" data-testid="repair-plan-comparison">
    <div className="repair-plan-comparison-heading"><div><p className="eyebrow">PLAN COMPARISON</p><h2>현재 견적과 플랜 적용 후 비교</h2><p>{plan.title}을 전체 부품 조합에 적용한 결과입니다. 실제 편집기 값은 아직 바뀌지 않았습니다.</p></div><div className="repair-plan-comparison-heading-actions"><span className={`repair-plan-comparison-direction ${comparison.direction}`}>{directionLabel}</span><button className="icon-button" type="button" onClick={onClose} aria-label="수리 플랜 비교 닫기"><FiXCircle /></button></div></div>
    <div className="repair-plan-comparison-summary"><div><span>현재 견적</span><strong>{scenarioStatusLabel(comparison.currentStatus)}</strong><small>{scenarioRiskText(comparisonBaseResult)}</small><small>{analysisScoreText(comparisonBaseResult.analysis)}</small>{comparisonBaseResult.priceComplete ? <small>전체 {formatWon(comparisonBaseResult.totalPriceWon)}</small> : <small>전체 가격 확인 필요</small>}</div><b>→</b><div className="after"><span>플랜 적용 후</span><strong>{scenarioStatusLabel(comparison.nextStatus)}</strong><small>{scenarioRiskText(nextResult)}</small><small>{analysisScoreText(nextResult.analysis)}</small>{nextResult.priceComplete ? <small>전체 {formatWon(nextResult.totalPriceWon)}</small> : <small>전체 가격 확인 필요</small>}</div></div>
    <div className="repair-plan-comparison-table-wrap"><table><caption>수리 플랜 적용 전후의 전체 부품·수량과 검사 결과를 비교합니다.</caption><thead><tr><th scope="col">비교 항목</th><th scope="col">현재 견적</th><th scope="col">플랜 적용 후</th></tr></thead><tbody><tr><th scope="row">핵심 부품 금액</th><td>{currentCorePriceComplete ? formatWon(currentCoreTotalPriceWon) : "가격 확인 필요"}</td><td>{nextCorePriceComplete ? formatWon(nextCoreTotalPriceWon) : "가격 확인 필요"}</td></tr><tr><th scope="row">주변 부품 금액</th><td>{accessoryPriceText(currentAccessoryPriceComplete, currentAccessoryTotalPriceWon)}</td><td>{accessoryPriceText(nextAccessoryPriceComplete, nextAccessoryTotalPriceWon)}</td></tr><tr><th scope="row">총액 변화</th><td>기준</td><td>{comparison.priceDeltaWon !== undefined ? formatPriceDelta(comparison.priceDeltaWon) : "가격 확인 필요"}</td></tr>{PART_CATEGORIES.map((category) => <tr key={category}><th scope="row">{CATEGORY_LABELS[category]}</th><td>{planBuildLineText(currentBuild, category, comparisonPartMap)}</td><td>{planBuildLineText(state.nextBuild, category, comparisonPartMap)}</td></tr>)}</tbody></table></div>
    <div className="repair-plan-comparison-findings"><div><strong>플랜 적용 후 남는 확인 항목</strong><span>{remainingFindings.length > 0 ? `${remainingFindings.length}개` : "없음"}</span></div>{remainingFindings.length > 0 && <ul>{remainingFindings.slice(0, 5).map((finding) => <li key={finding.id}><b>{finding.severity === "blocker" ? "차단" : finding.severity === "warning" ? "주의" : "확인"}</b>{finding.title}</li>)}</ul>}</div>
    <p className="repair-plan-comparison-reason"><FiInfo /> {plan.reason}</p>
    <div className="repair-plan-comparison-actions"><button className="button button-light" type="button" onClick={onClose}>계속 비교</button><button className="button button-secondary" type="button" onClick={() => onSavePlan(state.nextBuild, savePreferences, plan.title)}><FiSave /> 이 플랜을 새 견적으로 저장</button><button className="button button-primary" type="button" onClick={onApply}><FiEdit3 /> 이 플랜을 적용하고 다시 검사</button></div>
    <p className="repair-plan-comparison-note"><FiShield /> 비교만으로는 현재 견적을 바꾸지 않습니다. 적용하면 기존 변경 미리보기에서 최종 확인 후 편집기와 검사 결과를 갱신합니다.</p>
  </section>;
}

export { RepairPlanComparisonPanel };
