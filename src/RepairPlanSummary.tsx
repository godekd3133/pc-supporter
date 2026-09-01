import type { RecommendationPlan } from "../shared/types";
import type { BuildSelection } from "../shared/types";
import { repairPlanPerformanceRetentionFor } from "../shared/repair-plan-performance";

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
  return <div className="repair-plan-summary" data-testid="repair-plan-summary">
    <div className="repair-plan-summary-heading"><div><p className="eyebrow">PLAN SNAPSHOT</p><h3>{plans.length}가지 플랜 한눈에 비교</h3><p>잔여 위험과 비용을 먼저 확인한 뒤 원하는 플랜의 상세 카드를 열어보세요.</p></div><span>{plans.length}안 비교</span></div>
    <div className="repair-plan-summary-table-wrap"><table><caption>수리 플랜별 변경·잔여 위험·가격·근거 비교</caption><thead><tr><th scope="col">비교 항목</th>{plans.map((plan, index) => <th scope="col" key={`${plan.label}-${index}`}><span>{plan.label}</span><strong>{plan.title}</strong><button className="text-button" type="button" onClick={() => onFocusPlan(index)}>플랜 보기</button></th>)}</tr></thead><tbody>
      <tr><th scope="row">변경 항목</th>{plans.map((plan) => <td key={`${plan.label}-changes`}>{plan.changes.length}개</td>)}</tr>
      <tr><th scope="row">잔여 차단</th>{plans.map((plan) => <td className={plan.remainingBlockers > 0 ? "risk" : "clear"} key={`${plan.label}-blockers`}>{plan.remainingBlockers}개</td>)}</tr>
      <tr><th scope="row">잔여 주의</th>{plans.map((plan) => <td className={plan.remainingWarnings > 0 ? "risk" : "clear"} key={`${plan.label}-warnings`}>{plan.remainingWarnings}개</td>)}</tr>
      <tr><th scope="row">확인 필요</th>{plans.map((plan) => <td className={plan.remainingUnknown > 0 ? "risk" : "clear"} key={`${plan.label}-unknown`}>{plan.remainingUnknown}개</td>)}</tr>
      <tr><th scope="row">적용 후 남는 문제</th>{plans.map((plan) => <td className="repair-plan-summary-issues" key={`${plan.label}-issues`}>{remainingIssueText(plan)}</td>)}</tr>
      <tr><th scope="row">가격 변화</th>{plans.map((plan) => <td key={`${plan.label}-price`}>{formatPriceDelta(plan.priceDeltaWon)}</td>)}</tr>
      <tr><th scope="row">적용 후 합계</th>{plans.map((plan) => <td key={`${plan.label}-total`}>{plan.priceComplete ? formatWon(plan.afterTotalPriceWon) : "가격 일부 확인 필요"}</td>)}</tr>
      <tr><th scope="row">목표 예산</th>{plans.map((plan) => <td key={`${plan.label}-budget`}>{budgetText(plan)}</td>)}</tr>
      <tr><th scope="row">카탈로그 성능 기준</th>{plans.map((plan) => { const retention = repairPlanPerformanceRetentionFor(build, plan); return <td className={`repair-plan-performance-cell ${retention.status}`} key={`${plan.label}-performance-retention`}>{retention.summary}</td>; })}</tr>
      <tr><th scope="row">성능 근거</th>{plans.map((plan) => <td key={`${plan.label}-similarity`}>{plan.similarityLabel} {plan.similarityScore}점{plan.similarityEvidence ? ` · ${plan.similarityEvidence.confidence === "high" ? "근거 충분" : plan.similarityEvidence.confidence === "limited" ? "근거 제한" : "근거 확인 필요"}` : ""}</td>)}</tr>
    </tbody></table></div>
    <p className="repair-plan-summary-note">잔여 위험이 0이라고 표시되어도 실제 BIOS·QVL·온도·소음·배송 조건까지 자동 보장되는 것은 아닙니다.</p>
  </div>;
}
