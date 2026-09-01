import { useState, type ComponentType } from "react";
import { FiChevronDown, FiLoader } from "react-icons/fi";
import type { Part, UpgradeRecommendation } from "../shared/types";
import { CATEGORY_LABELS } from "../shared/types";
import { upgradeBundlePartNeedsHydration } from "../shared/upgrade-bundle-transport";
import { upgradeBundlePartDetailsCache } from "./upgrade-bundle-part-cache";

type UpgradeRecommendationDetailProps = { recommendation: UpgradeRecommendation };

function formatPriceDelta(value: number | undefined) {
  if (value === undefined) return "가격 확인 필요";
  if (value === 0) return "현재와 같은 가격";
  return `${value > 0 ? "+" : ""}${value.toLocaleString("ko-KR")}원`;
}

export function UpgradeBundleChangeCard({ change, catalogSnapshotAt, Detail }: { change: UpgradeRecommendation; catalogSnapshotAt?: string; Detail: ComponentType<UpgradeRecommendationDetailProps> }) {
  const [expanded, setExpanded] = useState(false);
  const [hydratedPart, setHydratedPart] = useState<Part | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const detailReady = Boolean(hydratedPart) || !upgradeBundlePartNeedsHydration(change.part);
  const recommendation = hydratedPart ? { ...change, part: hydratedPart } : change;

  async function loadDetails() {
    if (detailReady || loading) return;
    setLoading(true);
    setError(null);
    try {
      setHydratedPart(await upgradeBundlePartDetailsCache.get(change.part.id, catalogSnapshotAt));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "상세 스펙을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  function toggleDetails() {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded) void loadDetails();
  }

  return <div className="upgrade-bundle-change"><span className="category-badge">{CATEGORY_LABELS[change.category]}</span><div><small>{change.currentPartName}</small><strong>→ {recommendation.part.name}</strong><em>{change.improvedDimensions.join(" · ")} · {change.quantity > 1 ? `수량 ${change.quantity}개 · ` : ""}{formatPriceDelta(change.priceDeltaWon)}</em><button className="upgrade-bundle-detail-toggle" type="button" aria-expanded={expanded} onClick={toggleDetails}>{expanded ? "상세 스펙 닫기" : "상세 스펙 보기"} <FiChevronDown /></button></div>{expanded && (loading ? <div className="upgrade-bundle-detail-loading" role="status"><FiLoader className="spin" /> 상세 스펙을 불러오는 중...</div> : error ? <div className="upgrade-bundle-detail-error" role="alert"><span>{error}</span><button className="text-button" type="button" onClick={() => void loadDetails()}>다시 불러오기</button></div> : detailReady ? <Detail recommendation={recommendation} /> : <div className="upgrade-bundle-detail-loading" role="status"><FiLoader className="spin" /> 상세 스펙을 준비하는 중...</div>)}</div>;
}
