import type { BuildMetrics } from "./types";

export const POWER_HEADROOM_REVIEW_W = 120;
export const COOLER_HEADROOM_REVIEW_W = 50;

export type BuildResourceId = "power" | "cooling";
export type BuildResourceState = "good" | "warning" | "danger" | "unknown" | "neutral";

export interface BuildResourceCard {
  id: BuildResourceId;
  label: string;
  state: BuildResourceState;
  stateLabel: string;
  headline: string;
  detail: string;
  basis: string;
  reviewThresholdW: number;
  headroomW?: number;
}

export interface BuildResourceSummary {
  state: BuildResourceState;
  stateLabel: string;
  summary: string;
  cards: [BuildResourceCard, BuildResourceCard];
}

function stateFor(headroomW: number | undefined, reviewThresholdW: number, active: boolean): BuildResourceState {
  if (!active) return "neutral";
  if (headroomW === undefined) return "unknown";
  if (headroomW < 0) return "danger";
  if (headroomW < reviewThresholdW) return "warning";
  return "good";
}

function stateLabelFor(state: BuildResourceState) {
  return state === "good" ? "여유 있음" : state === "warning" ? "여유 좁음" : state === "danger" ? "기준 미달" : state === "unknown" ? "정보 부족" : "미적용";
}

function headroomText(headroomW: number | undefined) {
  if (headroomW === undefined) return "확인 필요";
  return headroomW >= 0 ? `${headroomW}W 여유` : `${Math.abs(headroomW)}W 부족`;
}

function powerCardFor(metrics: BuildMetrics): BuildResourceCard {
  const active = metrics.powerHeadroomW !== undefined
    || metrics.gpuPowerW !== undefined
    || metrics.recommendedPsuW !== undefined
    || metrics.psuWattageW !== undefined;
  const state = stateFor(metrics.powerHeadroomW, POWER_HEADROOM_REVIEW_W, active);
  const detail = metrics.psuWattageW !== undefined && metrics.recommendedPsuW !== undefined
    ? `선택한 파워 ${metrics.psuWattageW}W · 그래픽카드 권장 파워 ${metrics.recommendedPsuW}W`
    : metrics.gpuPowerW !== undefined
      ? `그래픽카드 기준 소비전력 ${metrics.gpuPowerW}W · 권장 파워 용량 확인 필요`
      : "그래픽카드 권장 파워 용량과 선택한 파워의 정격 출력을 확인하세요.";
  return {
    id: "power",
    label: "전력 예산",
    state,
    stateLabel: stateLabelFor(state),
    headline: state === "neutral" ? "미적용" : headroomText(metrics.powerHeadroomW),
    detail,
    basis: "선택한 파워 정격 출력 - 그래픽카드 권장 파워 용량",
    reviewThresholdW: POWER_HEADROOM_REVIEW_W,
    ...(metrics.powerHeadroomW !== undefined ? { headroomW: metrics.powerHeadroomW } : {})
  };
}

function coolingCardFor(metrics: BuildMetrics): BuildResourceCard {
  const active = metrics.coolerHeadroomW !== undefined
    || metrics.coolerCapacityW !== undefined
    || metrics.cpuPowerW !== undefined;
  const state = stateFor(metrics.coolerHeadroomW, COOLER_HEADROOM_REVIEW_W, active);
  const detail = metrics.coolerCapacityW !== undefined && metrics.cpuPowerW !== undefined
    ? `쿨러 지원 ${metrics.coolerCapacityW}W · CPU 기준 전력 ${metrics.cpuPowerW}W`
    : metrics.cpuPowerW !== undefined
      ? `CPU 기준 전력 ${metrics.cpuPowerW}W · 쿨러 지원 수치 확인 필요`
      : "CPU 기준 전력과 쿨러 지원 수치를 확인하세요.";
  return {
    id: "cooling",
    label: "냉각 예산",
    state,
    stateLabel: stateLabelFor(state),
    headline: state === "neutral" ? "미적용" : headroomText(metrics.coolerHeadroomW),
    detail,
    basis: "쿨러 지원 수치 - CPU TDP/PPT",
    reviewThresholdW: COOLER_HEADROOM_REVIEW_W,
    ...(metrics.coolerHeadroomW !== undefined ? { headroomW: metrics.coolerHeadroomW } : {})
  };
}

function overallStateFor(cards: BuildResourceCard[]): BuildResourceState {
  if (cards.some((card) => card.state === "danger")) return "danger";
  if (cards.some((card) => card.state === "warning")) return "warning";
  if (cards.some((card) => card.state === "unknown")) return "unknown";
  if (cards.some((card) => card.state === "good")) return "good";
  return "neutral";
}

export function buildResourceSummaryFor(metrics: BuildMetrics): BuildResourceSummary {
  const cards: [BuildResourceCard, BuildResourceCard] = [powerCardFor(metrics), coolingCardFor(metrics)];
  const state = overallStateFor(cards);
  const stateLabel = stateLabelFor(state);
  const summary = state === "danger"
    ? "등록된 수치로는 전력 또는 냉각 여유가 부족합니다. 부품 정보와 조립 조건을 확인하세요."
    : state === "warning"
      ? "계산된 전력·냉각 여유가 좁습니다. 구매 전에 실제 구성과 부품 정보를 확인하세요."
      : state === "unknown"
        ? "전력·냉각 수치가 없어 여유를 계산하지 못했습니다. 확인 전에는 안전하다고 볼 수 없습니다."
        : state === "good"
          ? "등록된 정격과 권장 수치로 계산한 여유입니다."
          : "선택한 부품 정보로 전력·냉각 여유를 계산하지 않았습니다.";
  return { state, stateLabel, summary, cards };
}
