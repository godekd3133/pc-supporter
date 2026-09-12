import type { BuildAnalysis } from "./types";

export type AlternativeComparisonScenarioStatus = "compatible" | "needs_review" | "incompatible";

export type AlternativeComparisonScenarioCheckKind = "compatibility" | "price" | "physical" | "data" | "application";

export type AlternativeComparisonScenarioCheckStatus = "ready" | "review" | "blocked";

export interface AlternativeComparisonScenarioCheck {
  id: string;
  kind: AlternativeComparisonScenarioCheckKind;
  status: AlternativeComparisonScenarioCheckStatus;
  label: string;
  detail: string;
}

export interface AlternativeComparisonScenarioPriceHistory {
  windowDays: 7 | 30 | 90;
  sampleCount: number;
  latestPriceWon?: number;
  minPriceWon?: number;
  maxPriceWon?: number;
  fromHighPercent?: number;
  currentPositionPercent?: number;
  hasDropThenRebound: boolean;
}

export interface AlternativeComparisonScenarioTradeoff {
  frontier: boolean;
  eligible?: boolean;
  riskScore?: number;
  priceDeltaWon?: number;
  analysisScore?: number;
  evidenceScore?: number;
  dominatedByCandidateId?: string;
  reason: string;
}

export interface AlternativeComparisonScenario {
  status: AlternativeComparisonScenarioStatus;
  blockerCount: number;
  warningCount: number;
  unknownCount: number;
  analysisScore?: number;
  analysisScoreLabel?: BuildAnalysis["scoreLabel"];
  analysisConfidence?: BuildAnalysis["confidence"];
  analysisScoreDelta?: number;
  priceDeltaWon?: number;
  purchaseDecision?: string;
  purchaseDecisionSummary?: string;
  priceHistory?: AlternativeComparisonScenarioPriceHistory;
  tradeoff?: AlternativeComparisonScenarioTradeoff;
  checks?: AlternativeComparisonScenarioCheck[];
}
