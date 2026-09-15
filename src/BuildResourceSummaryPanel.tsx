import { FiActivity, FiInfo, FiZap } from "react-icons/fi";
import type { BuildMetrics } from "../shared/types";
import { buildResourceSummaryFor, type BuildResourceCard, type BuildResourceState } from "../shared/build-resource-summary";

function stateMessageFor(state: BuildResourceState) {
  return state === "danger"
    ? "기준 미달 · 교체 또는 재확인"
    : state === "warning"
      ? "호환 통과 · 구매 전 확인"
      : state === "unknown"
        ? "원문 수치 확인 필요"
        : state === "good"
          ? "등록된 기준 충족"
          : "선택 부품 없음";
}

function ResourceCard({ card }: { card: BuildResourceCard }) {
  const Icon = card.id === "power" ? FiZap : FiActivity;
  return <article className={`build-resource-card ${card.state}`} data-testid={`build-resource-card-${card.id}`}>
    <div className="build-resource-card-heading"><span className="build-resource-card-icon"><Icon /></span><div><span>{card.label}</span><strong>{card.stateLabel}</strong></div></div>
    <b className="build-resource-card-headline">{card.headline}</b>
    <p>{card.detail}</p>
    <dl className="build-resource-card-facts"><div><dt>계산 기준</dt><dd>{card.basis}</dd></div><div><dt>확인 기준</dt><dd>{card.reviewThresholdW}W 이상 권장</dd></div>{card.headroomW !== undefined && <div><dt>결과</dt><dd>{stateMessageFor(card.state)}</dd></div>}</dl>
  </article>;
}

export function BuildResourceSummaryPanel({ metrics }: { metrics: BuildMetrics }) {
  const summary = buildResourceSummaryFor(metrics);
  return <section className={`build-resource-summary-panel ${summary.state}`} aria-label="전력·냉각 여유 요약" data-testid="build-resource-summary" tabIndex={-1}>
    <div className="build-resource-summary-heading"><div><p className="eyebrow">POWER & THERMAL BUDGET</p><h2>전력·냉각 여유</h2><p>{summary.summary}</p></div><span className={`build-resource-summary-status ${summary.state}`}><FiActivity /> {summary.stateLabel}</span></div>
    <div className="build-resource-summary-grid">{summary.cards.map((card) => <ResourceCard card={card} key={card.id} />)}</div>
    <p className="build-resource-summary-note"><FiInfo /> 전력은 선택 PSU 정격 출력과 GPU 권장 PSU의 차이, 냉각은 쿨러 지원 수치와 CPU TDP/PPT의 차이입니다. 실제 소비전력·온도·소음·부스트 유지 성능을 측정한 결과가 아니므로 조립 후 실측 로그와 제조사 원문을 함께 확인하세요.</p>
  </section>;
}
