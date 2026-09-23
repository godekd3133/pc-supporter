import { useEffect, useState, type ComponentType } from "react";
import { FiActivity, FiInfo, FiLayers, FiZap } from "react-icons/fi";
import type { Part, UpgradeBundleRecommendation, UpgradeBundleSearchSummary, UpgradeCompatibilityEvidence, UpgradeBudgetEvidence, UpgradeRecommendation } from "../shared/types";
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
  Detail: DetailComponent;
};

type UpgradeBundleSortMode = "recommended" | "reliability" | "performance" | "expansion" | "saving";

function upgradeBundleTrustScore(bundle: UpgradeBundleRecommendation) {
  return bundle.changes.reduce((total, change) => {
    if (!change.recommendationTrust) return total;
    const levelScore = { high: 3, medium: 2, low: 1 }[change.recommendationTrust.level];
    return total + levelScore * 100 + change.recommendationTrust.score;
  }, 0);
}

function sortedUpgradeBundles(bundles: UpgradeBundleRecommendation[], sortMode: UpgradeBundleSortMode) {
  return bundles
    .map((bundle, index) => ({ bundle, index }))
    .sort((left, right) => {
      if (sortMode === "recommended") return left.index - right.index;
      if (sortMode === "reliability") return upgradeBundleTrustScore(right.bundle) - upgradeBundleTrustScore(left.bundle) || left.index - right.index;
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



export function UpgradeBundlePanel({ bundles, searchSummary, catalogSnapshotAt, onApply, onPreview, formatPriceDelta, upgradeCompatibilityStatus, upgradeCompatibilityText, upgradeBudgetText, Detail }: UpgradeBundlePanelProps) {
  const [sortMode, setSortMode] = useState<UpgradeBundleSortMode>("recommended");
  const visibleBundles = sortedUpgradeBundles(bundles, sortMode).slice(0, 3);
  const visiblePartIds = [...new Set(visibleBundles.flatMap((bundle) => bundle.changes.filter((change) => upgradeBundlePartNeedsHydration(change.part)).map((change) => change.part.id)))];
  const visiblePartIdsKey = visiblePartIds.join("|");
  const bundleVisibilityText = visibleBundles.length + "개 조합";

  useEffect(() => {
    if (visiblePartIds.length === 0) return;
    void upgradeBundlePartDetailsCache.prefetch(visiblePartIds, catalogSnapshotAt).catch(() => undefined);
  }, [visiblePartIdsKey, catalogSnapshotAt]);

  return <section className="upgrade-bundle-panel" data-upgrade-bundle-sort={sortMode}><div className="upgrade-bundle-heading"><div><h2>업그레이드 조합</h2><p>2~3개 부품을 바꿨을 때의 호환 상태와 확장성을 계산한 결과입니다.</p></div><span className="upgrade-bundle-icon"><FiLayers /></span></div><div className="upgrade-bundle-sort"><label><span>조합 정렬</span><select aria-label="업그레이드 조합 정렬" value={sortMode} onChange={(event) => setSortMode(event.target.value as UpgradeBundleSortMode)}><option value="recommended">추천 순</option><option value="reliability">호환 우선</option><option value="performance">합산 성능 개선 폭</option><option value="expansion">확장성 개선 폭</option><option value="saving">추가 지출 낮은 순</option></select></label><small>{sortMode === "recommended" ? "호환 상태와 가격을 고려한 순서" : sortMode === "reliability" ? "호환 가능한 구성을 먼저 보여줘요." : sortMode === "performance" ? "2~3개 부품을 바꿨을 때 성능 개선이 큰 순" : sortMode === "expansion" ? "확장성이 좋아지는 순" : "조합 적용 후 추가 지출이 낮은 순"} · {bundleVisibilityText}</small></div><div className="upgrade-bundle-list">{visibleBundles.map((bundle, index) => <article className="upgrade-bundle-card" key={bundle.changes.map((change) => `${change.category}-${change.part.id}`).join("-")}><div className="upgrade-bundle-top"><span className="upgrade-bundle-rank">{bundle.changes.length}개 부품 · {index === 0 ? "추천 조합" : `${index + 1}순위 조합`}</span></div><div className="upgrade-bundle-changes">{bundle.changes.map((change) => <UpgradeBundleChangeCard key={`${change.category}-${change.part.id}`} change={change} catalogSnapshotAt={catalogSnapshotAt} Detail={Detail} />)}</div><div className="upgrade-bundle-meta"><span>{upgradeCompatibilityStatus(bundle.compatibilityEvidence)}</span><span>조합 가격 변화 {formatPriceDelta(bundle.totalPriceDeltaWon)}</span>{bundle.budgetEvidence && <span className={bundle.budgetEvidence.priceComplete && bundle.budgetEvidence.withinBudget === false ? "over" : "within"}>{upgradeBudgetText(bundle.budgetEvidence)}</span>}</div><p className="upgrade-bundle-reason">{bundle.reason}</p><div className="upgrade-bundle-actions"><button className="button button-small button-light" type="button" onClick={() => onPreview(bundle)}><FiActivity /> 미리 적용</button><button className="button button-small button-fix" type="button" onClick={() => onApply(bundle)}><FiZap /> 이 조합 적용 후 재검사</button></div></article>)}</div><p className="upgrade-bundle-note"><FiInfo /> 표시 가격은 핵심 부품 합계입니다. 주변 부품과 운송비는 포함하지 않습니다.</p></section>;
}
