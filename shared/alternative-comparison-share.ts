import type { AlternativeComparisonCandidate } from "./alternative-comparison-export";

export interface AlternativeComparisonSnapshot {
  id: string;
  name: string;
  category?: string;
  currentPartName?: string;
  currentPartSummary?: string;
  currentPartPrice?: string;
  catalogSnapshotAt?: string;
  engineVersion?: string;
  candidates: AlternativeComparisonCandidate[];
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export interface AlternativeComparisonCreateInput {
  name?: unknown;
  category?: unknown;
  currentPartName?: unknown;
  currentPartSummary?: unknown;
  currentPartPrice?: unknown;
  catalogSnapshotAt?: unknown;
  engineVersion?: unknown;
  candidates?: unknown;
  expiresInDays?: unknown;
}
