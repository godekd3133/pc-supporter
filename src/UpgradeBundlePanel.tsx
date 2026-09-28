import { useEffect, type ComponentType } from "react";
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

export function UpgradeBundlePanel({ bundles, searchSummary, catalogSnapshotAt, onApply, onPreview, formatPriceDelta, upgradeCompatibilityStatus, upgradeCompatibilityText, upgradeBudgetText, Detail }: UpgradeBundlePanelProps) {
  const visibleBundles = bundles.slice(0, 3);
  const visiblePartIds = [...new Set(visibleBundles.flatMap((bundle) => bundle.changes.filter((change) => upgradeBundlePartNeedsHydration(change.part)).map((change) => change.part.id)))];
  const visiblePartIdsKey = visiblePartIds.join("|");

  useEffect(() => {
    if (visiblePartIds.length === 0) return;
    void upgradeBundlePartDetailsCache.prefetch(visiblePartIds, catalogSnapshotAt).catch(() => undefined);
  }, [visiblePartIdsKey, catalogSnapshotAt]);

  return <section className="upgrade-bundle-panel" data-testid="upgrade-bundle-panel"><div className="upgrade-bundle-heading"><div><h2>업그레이드 조합</h2><p>2~3개 부품을 바꿨을 때의 호환 상태와 확장성을 계산한 결과입니다.</p></div><span className="upgrade-bundle-icon"><FiLayers /></span></div><div className="upgrade-bundle-list">{visibleBundles.map((bundle, index) => <article className="upgrade-bundle-card" key={bundle.changes.map((change) => `${change.category}-${change.part.id}`).join("-")}><div className="upgrade-bundle-top"><span className="upgrade-bundle-rank">{bundle.changes.length}개 부품 · {index === 0 ? "추천 조합" : `${index + 1}순위 조합`}</span></div><div className="upgrade-bundle-changes">{bundle.changes.map((change) => <UpgradeBundleChangeCard key={`${change.category}-${change.part.id}`} change={change} catalogSnapshotAt={catalogSnapshotAt} Detail={Detail} />)}</div><div className="upgrade-bundle-meta"><span>{upgradeCompatibilityStatus(bundle.compatibilityEvidence)} · {upgradeCompatibilityText(bundle.compatibilityEvidence)}</span><span>조합 가격 변화 {formatPriceDelta(bundle.totalPriceDeltaWon)}</span>{bundle.budgetEvidence && <span className={bundle.budgetEvidence.priceComplete && bundle.budgetEvidence.withinBudget === false ? "over" : "within"}>{upgradeBudgetText(bundle.budgetEvidence)}</span>}</div><div className="upgrade-bundle-actions"><button className="button button-small button-light" type="button" onClick={() => onPreview(bundle)}><FiActivity /> 미리 적용</button><button className="button button-small button-fix" type="button" onClick={() => onApply(bundle)}><FiZap /> 이 조합 적용 후 재검사</button></div></article>)}</div><p className="upgrade-bundle-note"><FiInfo /> 표시 가격은 핵심 부품 합계입니다. 주변 부품과 운송비는 포함하지 않습니다.</p></section>;
}
