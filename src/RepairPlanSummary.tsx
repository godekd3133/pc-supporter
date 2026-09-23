import type { RecommendationPlan } from "../shared/types";

function formatWon(value: number) {
  return `${value.toLocaleString("ko-KR")}원`;
}

function formatPriceDelta(value: number | undefined) {
  if (value === undefined) return "가격 정보 없음";
  return `${value > 0 ? "+" : ""}${formatWon(value)}`;
}

function remainingIssueText(plan: RecommendationPlan) {
  const titles = plan.remainingFindingTitles ?? [];
  if (titles.length === 0) return "없음";
  const visible = titles.slice(0, 2);
  return `${visible.join(" · ")}${titles.length > visible.length ? ` 외 ${titles.length - visible.length}개` : ""}`;
}

function budgetText(plan: RecommendationPlan) {
  if (plan.budgetWon === undefined) return "미설정";
  if (!plan.priceComplete) return "가격 정보 없음";
  return plan.withinBudget ? "예산 내" : `${formatPriceDelta(plan.budgetDeltaWon)} 초과`;
}

export function RepairPlanSummaryTable({ plans, onFocusPlan }: { plans: RecommendationPlan[]; onFocusPlan: (index: number) => void }) {
  if (plans.length < 2) return null;
  return <div className="repair-plan-summary" data-testid="repair-plan-summary">
    <div className="repair-plan-summary-heading"><div><p className="eyebrow">플랜 요약</p><h3>{plans.length}가지 플랜 비교</h3><p>남은 호환 문제와 비용을 확인해 보세요.</p></div><span>{plans.length}안 비교</span></div>
    <div className="repair-plan-summary-table-wrap"><table><caption>구성별 변경 부품·호환·가격 비교</caption><thead><tr><th scope="col">비교 항목</th>{plans.map((plan, index) => <th scope="col" key={`${plan.label}-${index}`}><span>{plan.label}</span><strong>{plan.title}</strong><button className="text-button" type="button" onClick={() => onFocusPlan(index)}>플랜 보기</button></th>)}</tr></thead><tbody>
      <tr><th scope="row">변경 항목</th>{plans.map((plan) => <td key={`${plan.label}-changes`}>{plan.changes.length}개</td>)}</tr>
      <tr><th scope="row">호환 불가</th>{plans.map((plan) => <td className={plan.remainingBlockers > 0 ? "risk" : "clear"} key={`${plan.label}-blockers`}>{plan.remainingBlockers}개</td>)}</tr>
      <tr><th scope="row">남은 주의</th>{plans.map((plan) => <td className={plan.remainingWarnings > 0 ? "risk" : "clear"} key={`${plan.label}-warnings`}>{plan.remainingWarnings}개</td>)}</tr>
      <tr><th scope="row">정보 부족</th>{plans.map((plan) => <td className={plan.remainingUnknown > 0 ? "risk" : "clear"} key={`${plan.label}-unknown`}>{plan.remainingUnknown}개</td>)}</tr>
      <tr><th scope="row">적용 후 남는 문제</th>{plans.map((plan) => <td className="repair-plan-summary-issues" key={`${plan.label}-issues`}>{remainingIssueText(plan)}</td>)}</tr>
      <tr><th scope="row">가격 변화</th>{plans.map((plan) => <td key={`${plan.label}-price`}>{formatPriceDelta(plan.priceDeltaWon)}</td>)}</tr>
      <tr><th scope="row">적용 후 합계</th>{plans.map((plan) => <td key={`${plan.label}-total`}>{plan.priceComplete ? formatWon(plan.afterTotalPriceWon) : "가격 정보 없음"}</td>)}</tr>
      <tr><th scope="row">목표 예산</th>{plans.map((plan) => <td key={`${plan.label}-budget`}>{budgetText(plan)}</td>)}</tr>
    </tbody></table></div>
  </div>;
}
