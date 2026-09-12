export type PriceWatchDecisionState = "target" | "buy" | "wait" | "observe" | "tracking" | "unavailable" | "error";

export type PriceWatchDecisionCounts = Record<PriceWatchDecisionState, number>;

export function priceWatchDecisionCountsFor(decisionStates: Readonly<Record<string, PriceWatchDecisionState>>): PriceWatchDecisionCounts {
  const counts = { target: 0, buy: 0, wait: 0, observe: 0, tracking: 0, unavailable: 0, error: 0 } satisfies PriceWatchDecisionCounts;
  Object.values(decisionStates).forEach((state) => { counts[state] += 1; });
  return counts;
}

export interface PriceWatchDecisionHistory {
  sampleCount: number;
  minPriceWon?: number;
  latestPriceWon?: number;
  fromHighPercent?: number;
  currentPositionPercent?: number;
  hasDropThenRebound: boolean;
}

export interface PriceWatchDecisionInput {
  currentStatus: "available" | "unavailable" | "error" | "unknown";
  currentPriceWon?: number;
  targetPriceWon?: number;
  nearLowThresholdPercent?: number;
  history?: PriceWatchDecisionHistory;
}

export interface PriceWatchDecision {
  state: PriceWatchDecisionState;
  label: string;
  summary: string;
}

function won(value: number) {
  return `${value.toLocaleString("ko-KR")}원`;
}

function nearLowThreshold(value: number | undefined) {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value!)) : 10;
}

export function priceWatchDecisionFor(input: PriceWatchDecisionInput): PriceWatchDecision {
  if (input.currentStatus === "error") return { state: "error", label: "일시 확인 오류", summary: "현재 가격을 다시 확인해야 가격 행동을 판단할 수 있습니다." };
  if (input.currentStatus === "unavailable" || input.currentStatus === "unknown" || input.currentPriceWon === undefined || !Number.isFinite(input.currentPriceWon)) {
    return { state: "unavailable", label: "가격 확인 필요", summary: "현재 가격을 확인할 수 없어 목표가·가격 위치를 판단하지 않습니다." };
  }
  if (input.targetPriceWon !== undefined && Number.isFinite(input.targetPriceWon) && input.targetPriceWon > 0 && input.currentPriceWon <= input.targetPriceWon) {
    return { state: "target", label: "목표가 도달", summary: `현재가 ${won(input.currentPriceWon)}가 설정한 목표가 ${won(input.targetPriceWon)} 이하입니다.` };
  }

  const history = input.history;
  if (history && history.sampleCount >= 2) {
    const threshold = nearLowThreshold(input.nearLowThresholdPercent);
    if (history.currentPositionPercent !== undefined && history.currentPositionPercent <= threshold) {
      return { state: "buy", label: "구매 검토", summary: `최근 가격 범위의 ${history.currentPositionPercent.toFixed(1)}% 위치로 최저가에 가깝습니다.` };
    }
    if (history.currentPositionPercent !== undefined && history.currentPositionPercent >= 80 && (history.fromHighPercent === undefined || history.fromHighPercent > -5)) {
      return { state: "wait", label: "가격 하락 대기", summary: `최근 가격 범위 상단 ${history.currentPositionPercent.toFixed(1)}%라 가격을 더 관찰하는 편이 좋습니다.` };
    }
    if (history.hasDropThenRebound) {
      return { state: "observe", label: "재상승 관찰", summary: "최근 하락 후 재상승 기록이 있어 다음 가격 변화를 관찰합니다." };
    }
  }

  if (input.targetPriceWon !== undefined && Number.isFinite(input.targetPriceWon) && input.targetPriceWon > 0 && input.currentPriceWon > input.targetPriceWon) {
    return { state: "tracking", label: "목표가 관찰 중", summary: `현재가가 목표가보다 ${won(input.currentPriceWon - input.targetPriceWon)} 높습니다.` };
  }
  return { state: "tracking", label: "가격 추적 중", summary: "현재 가격과 변경 이력을 계속 관찰합니다." };
}
