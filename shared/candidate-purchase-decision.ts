import type { AlternativeRisk, CandidateDecisionStatus, CatalogPriceEvidence, DataFreshness, PhysicalEvidenceStatus, RecommendationTrustLevel } from "./types";
import { eun } from "./josa";

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
  if (input.priceEvidence === "reference") return "참고 가격입니다. 판매처에서 현재 가격을 확인하세요.";
  if (input.priceEvidence === "recorded") return "가격이 기록된 날짜를 확인하세요.";
  if (input.priceEvidence === "unknown" || !input.priceKnown) return "판매 가격을 알 수 없습니다. 판매처에서 확인하세요.";
  return "판매 페이지에서 최신 가격과 재고를 확인하세요.";
}

export function candidatePurchaseDecisionFor(input: CandidatePurchaseDecisionInput): CandidatePurchaseDecision {
  const holdReasons: string[] = [];
  if (input.candidateRisk === "unsafe" || input.decisionStatus === "avoid") holdReasons.push("이 부품에 호환 차단 문제가 있습니다.");
  if (input.remainingBlockers > 0) holdReasons.push(`부품을 바꾼 뒤에도 차단 문제 ${input.remainingBlockers}개가 남습니다.`);
  if (input.nextStatus === "incompatible") holdReasons.push("부품을 바꾸면 전체 견적이 호환되지 않습니다.");
  if (holdReasons.length > 0) {
    return { state: "hold", label: "적용 보류", summary: `${eun(input.name)} 적용하지 말고 호환 차단 문제부터 해결하세요.`, reasons: holdReasons };
  }

  const reviewReasons: string[] = [];
  if (input.candidateRisk === "review" || input.decisionStatus === "review") reviewReasons.push("이 부품에 확인할 항목이 있습니다.");
  if (input.nextStatus === "needs_review") reviewReasons.push("부품을 바꾼 뒤 확인할 항목이 남습니다.");
  if (input.remainingWarnings > 0) reviewReasons.push(`주의 ${input.remainingWarnings}개가 남습니다.`);
  if (input.remainingUnknown > 0) reviewReasons.push(`확인할 항목 ${input.remainingUnknown}개가 남습니다.`);
  if (candidatePriceNeedsReview(input)) reviewReasons.push(candidatePriceReviewReason(input));
  else if (!input.totalPriceKnown) reviewReasons.push("전체 견적의 총액을 알 수 없습니다.");
  if (input.physicalStatus === "review") reviewReasons.push("케이스 안에 들어가는지와 연결 규격을 확인하세요.");
  if (input.freshness === "stale" || input.freshness === "unknown") reviewReasons.push("부품 정보가 오래됐거나 갱신일을 알 수 없습니다.");
  if (input.recommendationTrustLevel === "low") reviewReasons.push(`추천 근거가 부족합니다${input.recommendationTrustScore !== undefined ? ` (${input.recommendationTrustScore}점)` : ""}.`);
  if (input.similarityScore !== undefined && input.similarityScore >= 95 && input.similarityConfidence === "unknown") reviewReasons.push("성능 유사도를 비교한 자료가 없습니다.");
  if (input.similarityScore !== undefined && input.similarityScore >= 95 && input.similarityConfidence === "limited") reviewReasons.push("성능 유사도 비교에 일부 자료만 사용됐습니다.");
  if (input.similarityScore !== undefined && input.similarityScore >= 95 && (input.benchmarkFreshness === "stale" || input.benchmarkFreshness === "unknown")) reviewReasons.push("성능 비교 자료가 오래됐거나 갱신일을 알 수 없습니다.");
  if (input.similarityScore !== undefined && input.similarityScore >= 95 && input.benchmarkSourceCheckNeedsReview) reviewReasons.push("성능 비교에 사용한 출처를 확인하세요.");
  if (input.catalogSpecSourceCheckNeedsReview) reviewReasons.push("직접 입력한 스펙과 제조사 모델명이 맞는지 확인하세요.");
  if (input.analysisScoreDelta !== undefined && Number.isFinite(input.analysisScoreDelta) && input.analysisConfidence === "unknown") reviewReasons.push("바꾼 뒤 성능 점수를 계산할 정보가 부족합니다.");
  if (input.analysisScoreDelta !== undefined && Number.isFinite(input.analysisScoreDelta) && input.analysisScoreDelta < 0) reviewReasons.push(`${input.analysisConfidence === "limited" ? "일부 정보만 반영해 " : ""}바꾼 뒤 전체 성능 점수가 ${Math.abs(Math.round(input.analysisScoreDelta))}점 낮아집니다.`);
  if (reviewReasons.length > 0) {
    return { state: "review", label: "확인 후 구매", summary: "아래 가격·호환·장착 정보를 확인한 뒤 구매하세요.", reasons: reviewReasons };
  }

  if (input.similarityScore !== undefined && input.similarityScore >= 95 && (input.similarityConfidence === undefined || input.similarityConfidence === "high") && input.priceDeltaWon !== undefined && input.priceDeltaWon > 0 && (input.analysisScoreDelta === undefined || input.analysisScoreDelta >= 0)) {
    const performanceReasons = [`성능 유사도 ${input.similarityScore}점`, `전체 견적 ${signedWon(input.priceDeltaWon)}`];
    if (input.analysisScoreDelta !== undefined && Number.isFinite(input.analysisScoreDelta)) performanceReasons.push(`성능 점수 ${input.analysisScoreDelta > 0 ? "+" : ""}${Math.round(input.analysisScoreDelta)}점`);
    return {
      state: "performance",
      label: "성능 우선",
      summary: `성능 유사도 ${input.similarityScore}점입니다. 견적 변동은 ${signedWon(input.priceDeltaWon)}입니다.${input.analysisScoreDelta !== undefined && Number.isFinite(input.analysisScoreDelta) ? ` 성능 점수는 ${input.analysisScoreDelta > 0 ? "+" : ""}${Math.round(input.analysisScoreDelta)}점 바뀝니다.` : ""}`,
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
    const historyReason = history?.currentPositionPercent !== undefined ? `최근 가격 범위에서 높은 편입니다 (상위 ${history.currentPositionPercent.toFixed(1)}%).` : "최근 기록된 가격이 높은 편입니다.";
    return {
      state: "wait",
      label: "가격 하락 대기",
      summary: `${historyReason} 지금 바꾸면 전체 견적이 ${input.priceDeltaWon!.toLocaleString("ko-KR")}원 더 듭니다. 가격을 더 살펴본 뒤 결정하세요.`,
      reasons: [historyReason, `전체 견적 ${signedWon(input.priceDeltaWon!)}`, ...(history?.hasDropThenRebound ? ["최근 내린 뒤 다시 올랐습니다."] : [])]
    };
  }

  const reasons = ["바꾼 뒤 전체 검사에서 차단·주의·미확인 항목 없음"];
  if (input.similarityScore !== undefined) reasons.push(`성능 유사도 ${input.similarityScore}점`);
  if (input.analysisScoreDelta !== undefined && Number.isFinite(input.analysisScoreDelta)) reasons.push(`성능 점수 ${input.analysisScoreDelta > 0 ? "+" : ""}${Math.round(input.analysisScoreDelta)}점`);
  if (input.priceDeltaWon !== undefined) reasons.push(`전체 견적 ${signedWon(input.priceDeltaWon)}`);
  return { state: "buy", label: "구매 추천", summary: "바꾼 뒤 전체 검사에서 차단·주의·미확인 항목이 남지 않습니다.", reasons };
}
