import type { PhysicalEvidenceSummary } from "./types";

export const PHYSICAL_EVIDENCE_FILTERS = ["all", "verified", "review"] as const;
export type PhysicalEvidenceFilter = (typeof PHYSICAL_EVIDENCE_FILTERS)[number];

export function physicalEvidenceFilterFromUnknown(value: unknown): PhysicalEvidenceFilter {
  return value === "verified" || value === "review" ? value : "all";
}

export function physicalEvidenceFilterLabel(filter: PhysicalEvidenceFilter) {
  return filter === "verified" ? "물리 근거 확인됨" : filter === "review" ? "물리 근거 확인 필요" : "전체 물리 근거";
}

export function physicalEvidenceMatches(filter: PhysicalEvidenceFilter, evidence: PhysicalEvidenceSummary | undefined) {
  return filter === "all" || evidence?.status === filter;
}
