import { useEffect, useState, type ComponentType } from "react";
import { FiActivity, FiInfo, FiLayers, FiZap } from "react-icons/fi";
import type { Part, UpgradeBundleRecommendation, UpgradeBundleSearchSummary, UpgradeCompatibilityEvidence, UpgradeBudgetEvidence, UpgradeExpansionEvidence, UpgradeRecommendation } from "../shared/types";
import { CATEGORY_LABELS } from "../shared/types";
import { upgradeBundlePartNeedsHydration } from "../shared/upgrade-bundle-transport";
import { upgradeBundlePartDetailsCache } from "./upgrade-bundle-part-cache";
import { UpgradeBundleChangeCard } from "./UpgradeBundleChangeCard";

type DetailComponent = ComponentType<{ recommendation: UpgradeRecommendation }>;

type UpgradeBundlePanelProps = {
  bundles: UpgradeBundleRecommendation[];
  searchSummary?: UpgradeBundleSearchSummary;
  catalogSnapshotAt?: string;
  onApply: (bundle: UpgradeBundleRecommendation) => void;
  onPreview: (bundle: UpgradeBundleRecommendation) => void;
  formatPriceDelta: (value: number | undefined) => string;
  upgradeCompatibilityStatus: (evidence: UpgradeCompatibilityEvidence) => string;
  upgradeCompatibilityText: (evidence: UpgradeCompatibilityEvidence) => string;
  upgradeBudgetText: (evidence: UpgradeBudgetEvidence | undefined) => string | undefined;
  upgradeExpansionText: (evidence: UpgradeExpansionEvidence | undefined) => string;
  upgradeExpansionTone: (evidence: UpgradeExpansionEvidence | undefined) => string;
  Detail: DetailComponent;
};

type UpgradeBundleSortMode = "recommended" | "performance" | "expansion" | "saving";

function sortedUpgradeBundles(bundles: UpgradeBundleRecommendation[], sortMode: UpgradeBundleSortMode) {
  return bundles
    .map((bundle, index) => ({ bundle, index }))
    .sort((left, right) => {
      if (sortMode === "recommended") return left.index - right.index;
      if (sortMode === "performance") return right.bundle.totalImprovementPercent - left.bundle.totalImprovementPercent || left.index - right.index;
      if (sortMode === "expansion") {
        const leftDelta = left.bundle.expansionEvidence?.scoreDelta ?? Number.NEGATIVE_INFINITY;
        const rightDelta = right.bundle.expansionEvidence?.scoreDelta ?? Number.NEGATIVE_INFINITY;
        const leftScore = left.bundle.expansionEvidence?.candidateScore ?? Number.NEGATIVE_INFINITY;
        const rightScore = right.bundle.expansionEvidence?.candidateScore ?? Number.NEGATIVE_INFINITY;
        return rightDelta - leftDelta || rightScore - leftScore || right.bundle.totalImprovementPercent - left.bundle.totalImprovementPercent || left.index - right.index;
      }
      const leftDelta = left.bundle.totalPriceDeltaWon ?? Number.MAX_SAFE_INTEGER;
      const rightDelta = right.bundle.totalPriceDeltaWon ?? Number.MAX_SAFE_INTEGER;
      return leftDelta - rightDelta || right.bundle.totalImprovementPercent - left.bundle.totalImprovementPercent || left.index - right.index;
    })
    .map((entry) => entry.bundle);
}

function upgradeBundleExpansionText(evidence: UpgradeBundleRecommendation["expansionEvidence"], formatExpansionText: UpgradeBundlePanelProps["upgradeExpansionText"]) {
  if (!evidence) return "확장성 비교 불가 · 조합 적용 후 다시 확인";
  return formatExpansionText(evidence).replace("후보 ", "조합 ");
}

export function UpgradeBundlePanel({ bundles, searchSummary, catalogSnapshotAt, onApply, onPreview, formatPriceDelta, upgradeCompatibilityStatus, upgradeCompatibilityText, upgradeBudgetText, upgradeExpansionText, upgradeExpansionTone, Detail }: UpgradeBundlePanelProps) {
  const [sortMode, setSortMode] = useState<UpgradeBundleSortMode>("recommended");
  const visibleBundles = sortedUpgradeBundles(bundles, sortMode).slice(0, 3);
  const visiblePartIds = [...new Set(visibleBundles.flatMap((bundle) => bundle.changes.filter((change) => upgradeBundlePartNeedsHydration(change.part)).map((change) => change.part.id)))];
  const visiblePartIdsKey = visiblePartIds.join("|");
  const bundleVisibilityText = searchSummary
    ? `후보 ${searchSummary.candidateCount}개 · 2개 조합 ${searchSummary.evaluatedPairCount}개 검증${(searchSummary.evaluatedTripleCount ?? 0) > 0 ? ` · 3개 조합 ${searchSummary.evaluatedTripleCount}개 검증` : ""} · 안전 ${searchSummary.safeBundleCount}개 중 상위 ${visibleBundles.length}개 표시`
    : bundles.length > visibleBundles.length ? `전체 ${bundles.length}개 안전 조합 중 상위 ${visibleBundles.length}개 표시` : `확인된 안전 조합 ${bundles.length}개`;

  useEffect(() => {
    if (visiblePartIds.length === 0) return;
    void upgradeBundlePartDetailsCache.prefetch(visiblePartIds, catalogSnapshotAt).catch(() => undefined);
  }, [visiblePartIdsKey, catalogSnapshotAt]);

  return <section className="upgrade-bundle-panel" data-upgrade-bundle-sort={sortMode}><div className="upgrade-bundle-heading"><div><p className="eyebrow">UPGRADE COMBINATIONS</p><h2>함께 바꾸는 업그레이드 조합</h2><p>서로 다른 카테고리의 후보를 2~3개 함께 적용한 최종 구성까지 다시 검사해, 호환 상태와 확장성 변화를 함께 확인한 조합만 제안합니다.</p></div><span className="upgrade-bundle-icon"><FiLayers /></span></div><div className="upgrade-bundle-sort"><label><span>조합 정렬</span><select aria-label="업그레이드 조합 정렬" value={sortMode} onChange={(event) => setSortMode(event.target.value as UpgradeBundleSortMode)}><option value="recommended">추천 순</option><option value="performance">합산 성능 개선 폭</option><option value="expansion">확장성 개선 폭</option><option value="saving">추가 지출 낮은 순</option></select></label><small>{sortMode === "recommended" ? "서버가 계산한 조합 우선순위" : sortMode === "performance" ? "2~3개 후보를 함께 적용한 성능 변화가 큰 순" : sortMode === "expansion" ? "조합 적용 후 확장성 점수 변화가 큰 순" : "조합 적용 후 추가 지출이 낮은 순"} · {bundleVisibilityText}</small></div><div className="upgrade-bundle-list">{visibleBundles.map((bundle, index) => <article className="upgrade-bundle-card" key={bundle.changes.map((change) => `${change.category}-${change.part.id}`).join("-")}><div className="upgrade-bundle-top"><span className="upgrade-bundle-rank">{bundle.changes.length}개 부품 · {index === 0 ? "추천 조합" : `${index + 1}순위 조합`}</span><span className="upgrade-score">합산 변화 +{bundle.totalImprovementPercent.toFixed(1)}% · 지수 {bundle.totalUpgradeScore}점</span></div><div className="upgrade-bundle-changes">{bundle.changes.map((change) => <UpgradeBundleChangeCard key={`${change.category}-${change.part.id}`} change={change} catalogSnapshotAt={catalogSnapshotAt} Detail={Detail} />)}</div><div className="upgrade-bundle-meta"><span>{upgradeCompatibilityStatus(bundle.compatibilityEvidence)}</span><span>조합 가격 변화 {formatPriceDelta(bundle.totalPriceDeltaWon)}</span>{bundle.expansionEvidence && <span className={`upgrade-bundle-expansion ${upgradeExpansionTone(bundle.expansionEvidence)}`}>{upgradeBundleExpansionText(bundle.expansionEvidence, upgradeExpansionText)}</span>}{bundle.budgetEvidence && <span className={bundle.budgetEvidence.priceComplete && bundle.budgetEvidence.withinBudget === false ? "over" : "within"}>{upgradeBudgetText(bundle.budgetEvidence)}</span>}</div><p className="upgrade-bundle-reason">{bundle.reason}</p><div className="upgrade-bundle-actions"><button className="button button-small button-light" type="button" onClick={() => onPreview(bundle)}><FiActivity /> 가상 적용</button><button className="button button-small button-fix" type="button" onClick={() => onApply(bundle)}><FiZap /> 이 조합 적용 후 재검사</button></div></article>)}</div><p className="upgrade-bundle-note"><FiInfo /> 조합 가격은 핵심 부품 기준이며, 각 후보와 2~3개 조합을 동일한 호환성 규칙으로 재평가한 결과입니다. 확장성 변화는 조합 전체를 적용한 후의 자원 여유 기준이며, 실제 FPS·온도·BIOS 호환성은 제조사 원문을 확인해 주세요.</p></section>;
}
