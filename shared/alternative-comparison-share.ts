import type { AlternativeComparisonCandidate } from "./alternative-comparison-export";

export interface AlternativeComparisonSnapshot {
  id: string;
  name: string;
  category?: string;
  currentPartName?: string;
  candidates: AlternativeComparisonCandidate[];
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export interface AlternativeComparisonCreateInput {
  name?: unknown;
  category?: unknown;
  currentPartName?: unknown;
  candidates?: unknown;
  expiresInDays?: unknown;
}
