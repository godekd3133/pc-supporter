import { FiActivity, FiZap } from "react-icons/fi";
import type { BuildMetrics } from "../shared/types";
import { buildResourceSummaryFor, type BuildResourceCard } from "../shared/build-resource-summary";

function ResourceCard({ card }: { card: BuildResourceCard }) {
  const Icon = card.id === "power" ? FiZap : FiActivity;
  return <article className={`build-resource-card ${card.state}`} data-testid={`build-resource-card-${card.id}`}>
    <div className="build-resource-card-heading"><span className="build-resource-card-icon"><Icon /></span><div><span>{card.label}</span><strong>{card.stateLabel}</strong></div></div>
    <b className="build-resource-card-headline">{card.headline}</b>
    <p>{card.detail}</p>
  </article>;
}

export function BuildResourceSummaryPanel({ metrics }: { metrics: BuildMetrics }) {
  const summary = buildResourceSummaryFor(metrics);
  return <section className={`build-resource-summary-panel ${summary.state}`} aria-label="전력·냉각 여유 요약" data-testid="build-resource-summary" tabIndex={-1}>
    <div className="build-resource-summary-heading"><div><h2>전력·냉각 여유</h2><p>{summary.summary}</p></div><span className={`build-resource-summary-status ${summary.state}`}><FiActivity /> {summary.stateLabel}</span></div>
    <div className="build-resource-summary-grid">{summary.cards.map((card) => <ResourceCard card={card} key={card.id} />)}</div>
  </section>;
}
