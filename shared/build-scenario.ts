import type { CompatibilityResult } from "./types";

export type BuildScenarioDirection = "improved" | "worsened" | "changed" | "unchanged";

export interface BuildScenarioComparison {
  direction: BuildScenarioDirection;
  statusChanged: boolean;
  currentStatus: CompatibilityResult["status"];
  nextStatus: CompatibilityResult["status"];
  blockerDelta: number;
  warningDelta: number;
  unknownDelta: number;
  priceDeltaWon?: number;
  priceChanged: boolean;
  summary: string;
}

const statusRank: Record<CompatibilityResult["status"], number> = {
  compatible: 0,
  needs_review: 1,
  incompatible: 2
};

function signedDelta(value: number) {
  return `${value > 0 ? "+" : ""}${value}`;
}

function statusLabel(status: CompatibilityResult["status"]) {
  return status === "compatible" ? "호환 가능" : status === "needs_review" ? "확인 필요" : "호환 불가";
}

function riskSummary(current: CompatibilityResult, next: CompatibilityResult) {
  return `차단 ${current.blockerCount} → ${next.blockerCount} · 주의 ${current.warningCount} → ${next.warningCount} · 확인 필요 ${current.unknownCount} → ${next.unknownCount}`;
}

export function buildScenarioComparisonFor(current: CompatibilityResult, next: CompatibilityResult): BuildScenarioComparison {
  const blockerDelta = next.blockerCount - current.blockerCount;
  const warningDelta = next.warningCount - current.warningCount;
  const unknownDelta = next.unknownCount - current.unknownCount;
  const currentRisk = current.blockerCount * 100 + current.warningCount * 10 + current.unknownCount;
  const nextRisk = next.blockerCount * 100 + next.warningCount * 10 + next.unknownCount;
  const statusChanged = current.status !== next.status;
  const priceChanged = current.priceComplete && next.priceComplete && current.totalPriceWon !== next.totalPriceWon;
  const priceDeltaWon = priceChanged ? next.totalPriceWon - current.totalPriceWon : undefined;

  let direction: BuildScenarioDirection = "unchanged";
  if (nextRisk < currentRisk || (nextRisk === currentRisk && statusRank[next.status] < statusRank[current.status])) {
    direction = "improved";
  } else if (nextRisk > currentRisk || (nextRisk === currentRisk && statusRank[next.status] > statusRank[current.status])) {
    direction = "worsened";
  } else if (statusChanged || priceChanged) {
    direction = "changed";
  }

  const changes = [
    blockerDelta !== 0 ? `차단 ${signedDelta(blockerDelta)}` : undefined,
    warningDelta !== 0 ? `주의 ${signedDelta(warningDelta)}` : undefined,
    unknownDelta !== 0 ? `확인 필요 ${signedDelta(unknownDelta)}` : undefined,
    priceDeltaWon !== undefined ? `총액 ${priceDeltaWon > 0 ? "+" : ""}${priceDeltaWon.toLocaleString("ko-KR")}원` : undefined,
    statusChanged ? `판정 ${statusLabel(current.status)} → ${statusLabel(next.status)}` : undefined
  ].filter((value): value is string => Boolean(value));

  return {
    direction,
    statusChanged,
    currentStatus: current.status,
    nextStatus: next.status,
    blockerDelta,
    warningDelta,
    unknownDelta,
    ...(priceDeltaWon !== undefined ? { priceDeltaWon } : {}),
    priceChanged,
    summary: changes.length > 0 ? changes.join(" · ") : riskSummary(current, next)
  };
}
