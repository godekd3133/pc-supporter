import type { RecommendationPlan } from "../shared/types";
import type { BuildSelection } from "../shared/types";
import { repairPlanPerformanceRetentionFor } from "../shared/repair-plan-performance";
import { repairPlanTradeoffFor } from "../shared/repair-plan-tradeoff";

function formatWon(value: number) {
  return `${value.toLocaleString("ko-KR")}원`;
}

function formatPriceDelta(value: number | undefined) {
  if (value === undefined) return "가격 확인 필요";
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
  if (!plan.priceComplete) return "가격 확인 필요";
  return plan.withinBudget ? "예산 내" : `${formatPriceDelta(plan.budgetDeltaWon)} 초과`;
}

export function RepairPlanSummaryTable({ plans, build, onFocusPlan }: { plans: RecommendationPlan[]; build: BuildSelection; onFocusPlan: (index: number) => void }) {
  if (plans.length < 2) return null;
  const tradeoffs = repairPlanTradeoffFor(plans);
  const frontierCount = tradeoffs.filter((tradeoff) => tradeoff.frontier).length;
  return <div className="repair-plan-summary" data-testid="repair-plan-summary">
    <div className="repair-plan-summary-heading"><div><p className="eyebrow">플랜 요약</p><h3>{plans.length}가지 플랜 한눈에 비교</h3><p>남은 위험과 비용을 먼저 확인한 뒤 원하는 플랜의 상세 카드를 열어보세요.</p></div><span>{plans.length}안 비교</span></div>
    <div className="repair-plan-tradeoff" data-testid="repair-plan-tradeoff"><div className="repair-plan-tradeoff-heading"><div><strong>비용·위험·변경 규모의 비교 우위</strong><small>다른 플랜에 모든 기준에서 밀리지 않는 선택지만 남겼습니다.</small></div><span>{frontierCount}개 플랜</span></div><div className="repair-plan-tradeoff-list">{tradeoffs.map((tradeoff, index) => { const plan = plans[index]; return <button className={`repair-plan-tradeoff-item ${tradeoff.frontier ? "frontier" : "dominated"}`} type="button" onClick={() => onFocusPlan(index)} key={`${plan.label}-${index}`}><div><span>{tradeoff.frontier ? "비교 우위" : "밀림"}</span><strong>{plan.label}</strong></div><small>남은 위험 {tradeoff.riskScore}점 · 변경 {tradeoff.changeCount}개 · 추가 비용 {tradeoff.priceDeltaWon === undefined ? "확인 필요" : `${tradeoff.priceDeltaWon > 0 ? "+" : ""}${tradeoff.priceDeltaWon.toLocaleString("ko-KR")}원`}</small><em>{tradeoff.reason}</em></button>; })}</div><p className="repair-plan-tradeoff-note">가격이 확인되지 않은 플랜은 비용 우위를 단정하지 않습니다. `비교 우위`는 구매 확정이 아니라 비교를 시작할 부품 목록이에요.</p></div>
    <div className="repair-plan-summary-table-wrap"><table><caption>수리 플랜별 변경·남은 위험·가격·정보 비교</caption><thead><tr><th scope="col">비교 항목</th>{plans.map((plan, index) => <th scope="col" key={`${plan.label}-${index}`}><span>{plan.label}</span><strong>{plan.title}</strong><button className="text-button" type="button" onClick={() => onFocusPlan(index)}>플랜 보기</button></th>)}</tr></thead><tbody>
      <tr><th scope="row">변경 항목</th>{plans.map((plan) => <td key={`${plan.label}-changes`}>{plan.changes.length}개</td>)}</tr>
      <tr><th scope="row">남은 차단</th>{plans.map((plan) => <td className={plan.remainingBlockers > 0 ? "risk" : "clear"} key={`${plan.label}-blockers`}>{plan.remainingBlockers}개</td>)}</tr>
      <tr><th scope="row">남은 주의</th>{plans.map((plan) => <td className={plan.remainingWarnings > 0 ? "risk" : "clear"} key={`${plan.label}-warnings`}>{plan.remainingWarnings}개</td>)}</tr>
      <tr><th scope="row">확인 필요</th>{plans.map((plan) => <td className={plan.remainingUnknown > 0 ? "risk" : "clear"} key={`${plan.label}-unknown`}>{plan.remainingUnknown}개</td>)}</tr>
      <tr><th scope="row">적용 후 남는 문제</th>{plans.map((plan) => <td className="repair-plan-summary-issues" key={`${plan.label}-issues`}>{remainingIssueText(plan)}</td>)}</tr>
      <tr><th scope="row">가격 변화</th>{plans.map((plan) => <td key={`${plan.label}-price`}>{formatPriceDelta(plan.priceDeltaWon)}</td>)}</tr>
      <tr><th scope="row">적용 후 합계</th>{plans.map((plan) => <td key={`${plan.label}-total`}>{plan.priceComplete ? formatWon(plan.afterTotalPriceWon) : "가격 일부 확인 필요"}</td>)}</tr>
      <tr><th scope="row">목표 예산</th>{plans.map((plan) => <td key={`${plan.label}-budget`}>{budgetText(plan)}</td>)}</tr>
      <tr><th scope="row">카탈로그 성능 기준</th>{plans.map((plan) => { const retention = repairPlanPerformanceRetentionFor(build, plan); return <td className={`repair-plan-performance-cell ${retention.status}`} key={`${plan.label}-performance-retention`}>{retention.summary}</td>; })}</tr>
    </tbody></table></div>
  </div>;
}
