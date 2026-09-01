import { DATA_FRESHNESS_LABELS, type AlternativeRisk, type CandidateDecisionSummary, type DataFreshness, type PhysicalEvidenceStatus, type RecommendationTrustLevel } from "./types";

export type CandidateDecisionInput = {
  risk: AlternativeRisk;
  reasons?: string[];
  resolvesTarget?: boolean;
  physicalStatus?: PhysicalEvidenceStatus;
  recommendationTrustLevel?: RecommendationTrustLevel;
  freshness?: DataFreshness;
};

const TRUST_LABELS: Record<RecommendationTrustLevel, string> = {
  high: "높은 근거",
  medium: "보통 근거",
  low: "낮은 근거"
};

function uniqueReasons(reasons: string[]) {
  return [...new Set(reasons.map((reason) => reason.trim()).filter(Boolean))].slice(0, 3);
}

export function candidateDecisionSummaryFor(input: CandidateDecisionInput): CandidateDecisionSummary {
  const status = input.risk === "unsafe"
    ? "avoid"
    : input.risk === "review" || input.resolvesTarget === false || input.physicalStatus === "review" || input.recommendationTrustLevel === "low" || input.freshness === "stale" || input.freshness === "unknown"
      ? "review"
      : "recommended";
  const label = status === "recommended" ? "추천 후보" : status === "review" ? "확인 후 적용" : "적용하지 않음";
  const summaryParts = status === "avoid"
    ? ["후보 자체에 차단 위험"]
    : status === "review"
      ? [input.resolvesTarget === false ? "현재 문제 해결 여부 확인 필요" : "추가 확인 필요"]
      : ["현재 문제 해결", "새 차단 없음"];
  if (input.physicalStatus === "verified") summaryParts.push("물리 근거 확인됨");
  if (input.physicalStatus === "review") summaryParts.push("물리 근거 확인 필요");
  if (input.freshness) summaryParts.push(DATA_FRESHNESS_LABELS[input.freshness]);
  if (input.recommendationTrustLevel) summaryParts.push(TRUST_LABELS[input.recommendationTrustLevel]);

  const reasons = [
    ...(input.reasons ?? []),
    ...(input.resolvesTarget === false ? ["현재 문제를 직접 해결하는 후보인지 추가 확인해야 합니다."] : []),
    ...(input.physicalStatus === "review" ? ["물리 근거가 확인 필요 상태라 실제 장착 전에 제조사 원문을 확인해야 합니다."] : []),
    ...(input.freshness === "stale" || input.freshness === "unknown" ? [`데이터가 ${DATA_FRESHNESS_LABELS[input.freshness]} 상태입니다.`] : []),
    ...(input.recommendationTrustLevel === "low" ? ["추천 근거가 낮아 후보 적용 전에 스펙과 호환 결과를 다시 확인해야 합니다."] : [])
  ];
  return {
    status,
    label,
    summary: summaryParts.join(" · "),
    reasons: uniqueReasons(reasons)
  };
}
