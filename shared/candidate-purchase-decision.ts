import type { AlternativeRisk, CandidateDecisionStatus, CatalogPriceEvidence, DataFreshness, PhysicalEvidenceStatus, RecommendationTrustLevel } from "./types";

export type CandidatePurchaseDecisionState = "buy" | "wait" | "performance" | "review" | "hold";

export interface CandidatePurchasePriceHistory {
  sampleCount: number;
  minPriceWon?: number;
  latestPriceWon?: number;
  fromHighPercent?: number;
  currentPositionPercent?: number;
  hasDropThenRebound: boolean;
}

export interface CandidatePurchaseDecisionInput {
  name: string;
  candidateRisk?: AlternativeRisk;
  decisionStatus?: CandidateDecisionStatus;
  nextStatus: "compatible" | "needs_review" | "incompatible";
  remainingBlockers: number;
  remainingWarnings: number;
  remainingUnknown: number;
  priceKnown: boolean;
  priceEvidence?: CatalogPriceEvidence;
  totalPriceKnown: boolean;
  priceDeltaWon?: number;
  similarityScore?: number;
  similarityConfidence?: "high" | "limited" | "unknown";
  benchmarkFreshness?: "fresh" | "aging" | "stale" | "unknown";
  benchmarkSourceCheckNeedsReview?: boolean;
  catalogSpecSourceCheckNeedsReview?: boolean;
  analysisScoreDelta?: number;
  analysisConfidence?: "high" | "limited" | "unknown";
  recommendationTrustScore?: number;
  recommendationTrustLevel?: RecommendationTrustLevel;
  freshness?: DataFreshness;
  physicalStatus?: PhysicalEvidenceStatus;
  priceHistory?: CandidatePurchasePriceHistory;
}

export interface CandidatePurchaseDecision {
  state: CandidatePurchaseDecisionState;
  label: string;
  summary: string;
  reasons: string[];
}

function signedWon(value: number) {
  return `${value > 0 ? "+" : ""}${value.toLocaleString("ko-KR")}원`;
}

function candidatePriceNeedsReview(input: CandidatePurchaseDecisionInput) {
  if (input.priceEvidence === undefined) return !input.priceKnown;
  return input.priceEvidence !== "live" && input.priceEvidence !== "manual";
}

function candidatePriceReviewReason(input: CandidatePurchaseDecisionInput) {
  if (input.priceEvidence === "reference") return "참고 가격만 있어 후보 실제 판매 가격을 확정할 수 없습니다.";
  if (input.priceEvidence === "recorded") return "기록 가격의 데이터 상태가 완전하지 않아 후보 실제 판매 가격을 확정할 수 없습니다.";
  if (input.priceEvidence === "unknown" || !input.priceKnown) return "후보 또는 전체 견적 가격을 확정할 수 없습니다.";
  return "후보 가격 출처를 구매 전에 다시 확인해야 합니다.";
}

export function candidatePurchaseDecisionFor(input: CandidatePurchaseDecisionInput): CandidatePurchaseDecision {
  const holdReasons: string[] = [];
  if (input.candidateRisk === "unsafe" || input.decisionStatus === "avoid") holdReasons.push("후보 자체에 차단 위험이 있습니다.");
  if (input.remainingBlockers > 0) holdReasons.push(`미리 적용 후 차단 오류 ${input.remainingBlockers}개가 남습니다.`);
  if (input.nextStatus === "incompatible") holdReasons.push("미리 적용 후 전체 견적이 호환 불가 상태입니다.");
  if (holdReasons.length > 0) {
    return { state: "hold", label: "적용 보류", summary: `${input.name}은(는) 현재 견적에 적용하지 말고 차단 원인을 먼저 해결하세요.`, reasons: holdReasons };
  }

  const reviewReasons: string[] = [];
  if (input.candidateRisk === "review" || input.decisionStatus === "review") reviewReasons.push("후보 결과에 확인 필요가 남습니다.");
  if (input.nextStatus === "needs_review") reviewReasons.push("미리 적용 후 전체 결과가 확인 필요입니다.");
  if (input.remainingWarnings > 0) reviewReasons.push(`미리 적용 후 주의 ${input.remainingWarnings}개가 남습니다.`);
  if (input.remainingUnknown > 0) reviewReasons.push(`미리 적용 후 확인 필요 ${input.remainingUnknown}개가 남습니다.`);
  if (candidatePriceNeedsReview(input)) reviewReasons.push(candidatePriceReviewReason(input));
  else if (!input.totalPriceKnown) reviewReasons.push("전체 견적 가격을 확정할 수 없습니다.");
  if (input.physicalStatus === "review") reviewReasons.push("물리 장착 정보를 추가로 확인해야 합니다.");
  if (input.freshness === "stale" || input.freshness === "unknown") reviewReasons.push("부품 정보의 갱신 시점을 다시 확인해야 합니다.");
  if (input.recommendationTrustLevel === "low") reviewReasons.push(`추천 점수가 낮음${input.recommendationTrustScore !== undefined ? ` ${input.recommendationTrustScore}점` : ""}입니다.`);
  if (input.similarityScore !== undefined && input.similarityScore >= 95 && input.similarityConfidence === "unknown") reviewReasons.push("높은 성능 유사도 점수의 비교 정보가 확인되지 않았습니다.");
  if (input.similarityScore !== undefined && input.similarityScore >= 95 && input.similarityConfidence === "limited") reviewReasons.push("높은 성능 유사도 점수의 비교 범위가 제한적입니다.");
  if (input.similarityScore !== undefined && input.similarityScore >= 95 && (input.benchmarkFreshness === "stale" || input.benchmarkFreshness === "unknown")) reviewReasons.push("높은 성능 유사도에 사용된 벤치마크 자료의 갱신 상태를 다시 확인해야 합니다.");
  if (input.similarityScore !== undefined && input.similarityScore >= 95 && input.benchmarkSourceCheckNeedsReview) reviewReasons.push("높은 성능 유사도에 사용된 벤치마크 원문 확인을 다시 확인해야 합니다.");
  if (input.catalogSpecSourceCheckNeedsReview) reviewReasons.push("수동 보강 스펙의 제조사 원문 URL 접근과 모델 식별을 다시 확인해야 합니다.");
  if (input.analysisScoreDelta !== undefined && Number.isFinite(input.analysisScoreDelta) && input.analysisConfidence === "unknown") reviewReasons.push("미리 적용 후 성능 분석 정보가 확인되지 않았습니다.");
  if (input.analysisScoreDelta !== undefined && Number.isFinite(input.analysisScoreDelta) && input.analysisScoreDelta < 0) reviewReasons.push(`${input.analysisConfidence === "limited" ? "일부 스펙 기준으로 " : ""}미리 적용 후 전체 성능 점수가 현재보다 ${Math.abs(Math.round(input.analysisScoreDelta))}점 낮습니다.`);
  if (reviewReasons.length > 0) {
    return { state: "review", label: "확인 후 구매", summary: `${input.name}은(는) 호환 후보지만 가격·데이터·잔여 위험을 확인한 뒤 구매하세요.`, reasons: reviewReasons };
  }

  if (input.similarityScore !== undefined && input.similarityScore >= 95 && (input.similarityConfidence === undefined || input.similarityConfidence === "high") && input.priceDeltaWon !== undefined && input.priceDeltaWon > 0 && (input.analysisScoreDelta === undefined || input.analysisScoreDelta >= 0)) {
    const performanceReasons = [`성능 유사도 ${input.similarityScore}점`, `가격 변화 ${signedWon(input.priceDeltaWon)}`];
    if (input.analysisScoreDelta !== undefined && Number.isFinite(input.analysisScoreDelta)) performanceReasons.push(`전체 성능 변화 ${input.analysisScoreDelta > 0 ? "+" : ""}${Math.round(input.analysisScoreDelta)}점`);
    return {
      state: "performance",
      label: "성능 우선",
      summary: `${input.name}은(는) 성능 유사도 ${input.similarityScore}점으로 높고${input.analysisScoreDelta !== undefined ? ` 전체 성능도 ${input.analysisScoreDelta > 0 ? "+" : ""}${Math.round(input.analysisScoreDelta)}점 변화하지만` : "지만"}, 전체 견적이 ${signedWon(input.priceDeltaWon)} 증가합니다.`,
      reasons: performanceReasons
    };
  }

  const history = input.priceHistory;
  const priceNearRecentHigh = Boolean(
    history
      && history.sampleCount >= 2
      && history.currentPositionPercent !== undefined
      && history.currentPositionPercent >= 80
      && (history.fromHighPercent === undefined || history.fromHighPercent > -5)
      && input.priceDeltaWon !== undefined
      && input.priceDeltaWon > 0
  );
  if (priceNearRecentHigh) {
    const historyReason = history?.currentPositionPercent !== undefined ? `최근 가격 범위 상단 ${history.currentPositionPercent.toFixed(1)}%` : "최근 가격 상단";
    return {
      state: "wait",
      label: "가격 하락 대기",
      summary: `${input.name}은(는) 호환 기준은 통과했지만 ${historyReason}이고 전체 견적이 ${signedWon(input.priceDeltaWon!)} 증가해 가격을 더 관찰하는 편이 좋습니다.`,
      reasons: [historyReason, `가격 변화 ${signedWon(input.priceDeltaWon!)}`, ...(history?.hasDropThenRebound ? ["최근 하락 후 재상승 신호"] : [])]
    };
  }

  const reasons = ["미리 적용 후 차단·주의·확인 필요 없음"];
  if (input.similarityScore !== undefined) reasons.push(`성능 유사도 ${input.similarityScore}점`);
  if (input.analysisScoreDelta !== undefined && Number.isFinite(input.analysisScoreDelta)) reasons.push(`전체 성능 변화 ${input.analysisScoreDelta > 0 ? "+" : ""}${Math.round(input.analysisScoreDelta)}점`);
  if (input.priceDeltaWon !== undefined) reasons.push(`가격 변화 ${signedWon(input.priceDeltaWon)}`);
  return { state: "buy", label: "구매 추천", summary: `${input.name}은(는) 현재 확인된 호환·가격·정보 기준에서 우선 구매 후보입니다.`, reasons };
}
