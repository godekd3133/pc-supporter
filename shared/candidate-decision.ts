import { DATA_FRESHNESS_LABELS, type AlternativeRisk, type CandidateDecisionSummary, type DataFreshness, type PhysicalEvidenceStatus, type RecommendationTrustLevel } from "./types";

export type CandidateDecisionInput = {
  risk: AlternativeRisk;
  reasons?: string[];
  resolvesTarget?: boolean;
  physicalStatus?: PhysicalEvidenceStatus;
  recommendationTrustLevel?: RecommendationTrustLevel;
  catalogSpecSourceCheckNeedsReview?: boolean;
  freshness?: DataFreshness;
};

const TRUST_LABELS: Record<RecommendationTrustLevel, string> = {
  high: "높음",
  medium: "보통",
  low: "낮음"
};

function uniqueReasons(reasons: string[]) {
  return [...new Set(reasons.map((reason) => reason.trim()).filter(Boolean))].slice(0, 3);
}

export function candidateDecisionSummaryFor(input: CandidateDecisionInput): CandidateDecisionSummary {
  const status = input.risk === "unsafe"
    ? "avoid"
    : input.risk === "review" || input.resolvesTarget === false || input.physicalStatus === "review" || input.recommendationTrustLevel === "low" || input.catalogSpecSourceCheckNeedsReview === true || input.freshness === "stale" || input.freshness === "unknown"
      ? "review"
      : "recommended";
  const label = status === "recommended" ? "추천 부품" : status === "review" ? "확인 후 적용" : "적용하지 않음";
  const summaryParts = status === "avoid"
    ? ["부품 자체에 차단 위험"]
    : status === "review"
      ? [input.resolvesTarget === false ? "현재 문제 해결 여부 확인 필요" : "추가 확인 필요"]
      : ["현재 문제 해결", "새 차단 없음"];
  if (input.physicalStatus === "verified") summaryParts.push("장착 정보 확인됨");
  if (input.physicalStatus === "review") summaryParts.push("장착 정보 미확인");
  if (input.catalogSpecSourceCheckNeedsReview === true) summaryParts.push("제조사 페이지 확인 필요");
  if (input.freshness) summaryParts.push(DATA_FRESHNESS_LABELS[input.freshness]);
  if (input.recommendationTrustLevel) summaryParts.push(TRUST_LABELS[input.recommendationTrustLevel]);

  const reasons = [
    ...(input.reasons ?? []),
    ...(input.resolvesTarget === false ? ["현재 문제를 직접 해결하는 부품인지 추가 확인해야 합니다."] : []),
    ...(input.physicalStatus === "review" ? ["장착 정보가 부족합니다. 장착 전에 제조사 안내를 확인하세요."] : []),
    ...(input.catalogSpecSourceCheckNeedsReview === true ? ["직접 입력한 부품은 제조사 안내에서 모델명과 사양을 확인한 뒤 적용하세요."] : []),
    ...(input.freshness === "stale" || input.freshness === "unknown" ? [`부품 정보: ${DATA_FRESHNESS_LABELS[input.freshness]}`] : []),
    ...(input.recommendationTrustLevel === "low" ? ["추천 점수가 낮습니다. 적용 전에 사양과 호환 결과를 확인하세요."] : [])
  ];
  return {
    status,
    label,
    summary: summaryParts.join(" · "),
    reasons: uniqueReasons(reasons)
  };
}
