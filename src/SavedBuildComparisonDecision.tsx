import { useState } from "react";
import { FiActivity, FiAlertTriangle, FiCheckCircle, FiExternalLink, FiInfo, FiShoppingCart } from "react-icons/fi";
import type { CompatibilityResult, SavedBuild } from "../shared/types";
import { savedBuildComparisonConsensusFor, savedBuildComparisonDecisionFor, savedBuildComparisonExpansionFor, savedBuildComparisonRankingsFor, savedBuildComparisonTradeoffsFor } from "../shared/saved-build-comparison";
import type { BuildComparisonMetricResult, SavedBuildComparisonDecisionKind, SavedBuildComparisonEntry, SavedBuildComparisonRanking } from "../shared/saved-build-comparison";
import { buildBenchmarkSnapshotStatusText } from "../shared/build-benchmark-snapshot";
import { savedBuildPurchaseProgressSummaryFor } from "../shared/saved-build-purchase-progress";

export type SavedBuildLiveCheck =
  | { status: "loading" }
  | { status: "ready"; result: CompatibilityResult }
  | { status: "error"; message: string };

const savedBuildDecisionDefinitions: Array<{ kind: SavedBuildComparisonDecisionKind; label: string; description: string }> = [
  { kind: "compatibility", label: "호환 우선", description: "차단·주의·확인 필요를 합산한 위험 점수가 가장 낮은 견적" },
  { kind: "price", label: "가격 우선", description: "현재 카탈로그에서 총액이 확인된 견적 중 가장 낮은 금액" },
  { kind: "analysis", label: "분석 점수 우선", description: "선택한 사용 목적 기준 상대 분석 점수가 가장 높은 견적" },
  { kind: "expansion", label: "확장성 우선", description: "메모리·스토리지·전력·냉각·장착 여유가 가장 큰 견적" }
];

function comparisonStatusText(result: BuildComparisonMetricResult) {
  return result.status === "compatible" ? "호환 가능" : result.status === "needs_review" ? "확인 필요" : "호환 불가";
}

function comparisonRankingMetricText(ranking: SavedBuildComparisonRanking, kind: SavedBuildComparisonDecisionKind, formatWon: (value: number | undefined) => string) {
  if (!ranking.eligible || ranking.metric === undefined) return ranking.reason ?? "현재 기준으로 순위를 계산할 수 없습니다.";
  if (kind === "compatibility") return `위험 ${ranking.metric}점 · ${comparisonStatusText(ranking.entry.result)} · 차단 ${ranking.entry.result.blockerCount}개`;
  if (kind === "price") return `총액 ${formatWon(ranking.metric)} · ${comparisonStatusText(ranking.entry.result)}`;
  if (kind === "analysis") return `상대 분석 ${ranking.metric}점 · ${comparisonStatusText(ranking.entry.result)}`;
  const expansion = savedBuildComparisonExpansionFor(ranking.entry.result.metrics);
  return `${expansion.summary} · ${comparisonStatusText(ranking.entry.result)}`;
}

function purchaseProgressText(build: SavedBuild | undefined) {
  const summary = savedBuildPurchaseProgressSummaryFor(build?.purchaseProgress);
  if (summary.status === "unrecorded") return "구매 진행 기록 없음";
  return `구매 ${summary.percent}% · 예정 ${summary.stageCounts.planned} · 주문 ${summary.stageCounts.ordered} · 수령 ${summary.stageCounts.received} · 조립 ${summary.stageCounts.installed}`;
}

function benchmarkEvidenceText(result: BuildComparisonMetricResult) {
  const benchmark = result.benchmarkSnapshot;
  if (!benchmark) return "벤치마크 저장본 기록 없음";
  return `benchmark ${buildBenchmarkSnapshotStatusText(benchmark.status)} · ${benchmark.presentScoreCount}/${benchmark.expectedScoreCount}개 점수`;
}

export function SavedBuildComparisonDecisionSummary({ builds, liveChecks, formatWon, onOpenBuild, openingBuildId }: { builds: SavedBuild[]; liveChecks: Record<string, SavedBuildLiveCheck>; formatWon: (value: number | undefined) => string; onOpenBuild?: (build: SavedBuild, focus?: "purchase-list") => void; openingBuildId?: string | null }) {
  const [rankingKind, setRankingKind] = useState<SavedBuildComparisonDecisionKind>("compatibility");
  const entries: SavedBuildComparisonEntry[] = builds.flatMap((build) => {
    const check = liveChecks[build.id];
    return check?.status === "ready" ? [{ id: build.id, name: build.name, result: check.result }] : [];
  });
  const buildById = new Map(builds.map((build) => [build.id, build]));
  const consensus = savedBuildComparisonConsensusFor(entries);
  const rankings = savedBuildComparisonRankingsFor(entries, rankingKind);
  const tradeoffs = savedBuildComparisonTradeoffsFor(entries);
  const partial = entries.length < builds.length;
  const pendingText = entries.length === 0 ? "현재 카탈로그 재검사가 끝나면 계산합니다." : "일부 견적의 재검사가 끝나면 전체 비교 기준으로 갱신합니다.";
  return <section className="history-comparison-decision" aria-label="견적 비교 결정 요약">
    <div className="history-comparison-decision-heading"><div><p className="eyebrow">DECISION SUMMARY</p><h3>비교 결과 빠른 선택</h3><p>현재 카탈로그 재검사 결과를 기준으로 안전성·가격·분석 점수·확장성 여유를 각각 따로 계산합니다.</p></div><span>{entries.length} / {builds.length}개 재검사 완료</span></div>
    <div className={`history-comparison-consensus ${consensus.status}`} data-testid="saved-build-comparison-consensus">
      <span className="history-comparison-consensus-icon">{consensus.status === "converged" ? <FiCheckCircle /> : <FiAlertTriangle />}</span>
      <div className="history-comparison-consensus-copy"><strong>{consensus.status === "converged" ? "기준이 한 견적으로 수렴했습니다." : consensus.status === "split" ? "기준에 따라 추천 견적이 달라집니다." : "결정 요약을 계산하는 중입니다."}</strong><p>{consensus.summary}</p>{consensus.status === "split" && <small>안전성·가격·분석·확장성 중 무엇을 더 중요하게 볼지 선택한 뒤, 아래 기준별 순위를 확인하세요.</small>}</div>
      <span className="history-comparison-consensus-count">{consensus.confirmedCriteria} / {consensus.totalCriteria} 기준 확정</span>
      {consensus.status === "converged" && consensus.winnerId && <div className="history-comparison-consensus-context"><span>공통 부품</span><strong>{consensus.winnerName}</strong><small>{buildById.get(consensus.winnerId)?.decisionNote ? `선택 이유 · ${buildById.get(consensus.winnerId)?.decisionNote}` : "선택 이유 메모 없음"} · {purchaseProgressText(buildById.get(consensus.winnerId))}</small></div>}
      {consensus.status === "split" && <div className="history-comparison-consensus-context split"><span>기준별 부품</span><strong>{consensus.winnerNames.join(" · ")}</strong><small>각 부품의 선택 이유와 구매 진행은 기준별 카드에서 함께 확인할 수 있습니다.</small></div>}
    </div>
    <div className="history-comparison-decision-grid">
      {savedBuildDecisionDefinitions.map((definition) => {
        const decision = savedBuildComparisonDecisionFor(entries, definition.kind);
        const decisionBuild = decision ? buildById.get(decision.entry.id) : undefined;
        const metricText = decision
          ? definition.kind === "compatibility"
            ? `위험 ${decision.metric}점 · ${comparisonStatusText(decision.entry.result)} · 차단 ${decision.entry.result.blockerCount}개`
            : definition.kind === "price"
              ? `총액 ${formatWon(decision.metric)} · ${comparisonStatusText(decision.entry.result)}`
              : definition.kind === "analysis"
                ? `상대 분석 ${decision.metric}점 · ${comparisonStatusText(decision.entry.result)}`
                : `${savedBuildComparisonExpansionFor(decision.entry.result.metrics).summary} · ${comparisonStatusText(decision.entry.result)}`
          : pendingText;
        const openableBuild = onOpenBuild && decisionBuild && decisionBuild.id !== "current-draft" ? decisionBuild : undefined;
        const opening = openingBuildId !== null && openingBuildId !== undefined;
        return <article className={decision ? "history-comparison-decision-card selected" : "history-comparison-decision-card pending"} key={definition.kind}><span>{definition.label}</span>{decision ? <><strong>{decision.entry.name}</strong><small>{metricText}</small><em>{partial ? "현재 확인된 견적 중 우선" : definition.description}</em><div className="history-comparison-decision-card-context"><span><FiInfo /> {decisionBuild?.decisionNote ? `선택 이유 · ${decisionBuild.decisionNote}` : "선택 이유 메모 없음"}</span><span><FiShoppingCart /> {purchaseProgressText(decisionBuild)}</span><span><FiActivity /> {benchmarkEvidenceText(decision.entry.result)}</span></div>{openableBuild && <div className="history-comparison-decision-card-actions"><button className="text-button" type="button" data-testid={`saved-build-comparison-result-open-${definition.kind}`} onClick={() => onOpenBuild?.(openableBuild)} disabled={opening}><FiExternalLink /> {openingBuildId === openableBuild.id ? "결과 여는 중..." : "결과 열기"}</button><button className="text-button" type="button" data-testid={`saved-build-comparison-purchase-open-${definition.kind}`} onClick={() => onOpenBuild?.(openableBuild, "purchase-list")} disabled={opening}><FiShoppingCart /> 구매 목록</button></div>}</> : <><strong>계산 대기</strong><small>{metricText}</small><em>{definition.description}</em></>}</article>;
      })}
    </div>
    <div className="history-comparison-ranking">
      <div className="history-comparison-ranking-heading"><div><strong>기준별 전체 순위</strong><small>결정 요약과 같은 계산 규칙으로 모든 재검사 완료 견적을 정렬합니다.</small></div><label><span>순위 기준</span><select aria-label="견적 비교 순위 기준" value={rankingKind} onChange={(event) => setRankingKind(event.target.value as SavedBuildComparisonDecisionKind)}><option value="compatibility">호환성 우선</option><option value="price">가격 우선</option><option value="analysis">분석 점수 우선</option><option value="expansion">확장성 우선</option></select></label></div>
      {rankings.length > 0 ? <ol className="history-comparison-ranking-list">{rankings.map((ranking) => { const expansion = rankingKind === "expansion" && ranking.eligible ? savedBuildComparisonExpansionFor(ranking.entry.result.metrics) : undefined; return <li className={ranking.eligible ? ranking.rank === 1 ? "history-comparison-ranking-item winner" : "history-comparison-ranking-item" : "history-comparison-ranking-item ineligible"} key={`${ranking.entry.id}-${rankingKind}`}><span className="history-comparison-ranking-rank">{ranking.rank ? `${ranking.rank}위` : "제외"}</span><div><strong>{ranking.entry.name}</strong><small>{comparisonRankingMetricText(ranking, rankingKind, formatWon)}</small></div>{ranking.eligible && ranking.rank === 1 && <em>현재 기준 최우선</em>}{expansion && <details className="history-comparison-ranking-details" open={ranking.rank === 1}><summary>여유 지표 정보 {expansion.knownDimensionCount}/{expansion.totalDimensionCount}</summary><ul>{expansion.details.map((detail) => <li key={detail}>{detail}</li>)}</ul></details>}</li>; })}</ol> : <p className="history-comparison-ranking-empty">재검사가 끝나면 기준별 순위를 계산합니다.</p>}
      <p className="history-comparison-ranking-note"><FiInfo /> {partial ? "아직 재검사가 끝나지 않은 견적은 순위에서 잠시 제외하고, 완료될 때마다 다시 계산합니다." : "가격·분석 점수·확장성 지표가 부족한 견적은 해당 기준의 확정 순위에서 제외하고 사유를 남깁니다."}</p>
    </div>
    {entries.length >= 2 && <section className="history-comparison-tradeoff" data-testid="saved-build-comparison-tradeoff" aria-label="저장 견적 버전 비교 우위"><div className="history-comparison-tradeoff-heading"><div><strong>호환·비용·분석·확장성의 비교 우위</strong><small>현재 카탈로그 재검사 결과에서 다른 버전이 모든 기준으로 앞서는 경우만 밀림으로 표시합니다.</small></div><span>{tradeoffs.filter((tradeoff) => tradeoff.frontier).length}개 버전</span></div><div className="history-comparison-tradeoff-list">{tradeoffs.map((tradeoff) => <article className={tradeoff.frontier ? "frontier" : "dominated"} key={tradeoff.id}><div><span>{tradeoff.frontier ? "비교 우위" : "밀림"}</span><strong>{tradeoff.name}</strong></div><small>위험 {tradeoff.riskScore}점 · 총액 {tradeoff.totalPriceWon === undefined ? "확인 필요" : formatWon(tradeoff.totalPriceWon)} · 분석 {tradeoff.analysisScore === undefined ? "확인 필요" : `${tradeoff.analysisScore}점`} · 확장성 {tradeoff.expansionScore === undefined ? "확인 필요" : `${tradeoff.expansionScore}점`}</small><p>{tradeoff.reason}</p></article>)}</div><p className="history-comparison-tradeoff-note"><FiInfo /> 한쪽에만 존재하는 가격·분석·확장성 정보로는 버전을 밀림으로 단정하지 않습니다. 비교 우위는 읽기 전용 비교 기준입니다.</p></section>}
    <p className="history-comparison-decision-note"><FiInfo /> 호환 우선·가격 우선·분석 점수 우선·확장성 우선은 서로 다른 선택 기준입니다. 가격·분석·확장성 데이터가 부족한 견적은 해당 기준의 1순위로 정하지 않아요.</p>
  </section>;
}
