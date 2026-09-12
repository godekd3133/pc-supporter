import type { AlternativeRisk, CandidateDecisionStatus, CandidateDecisionSummary } from "./types";

export type CandidateApplicationEvidence = {
  risk?: AlternativeRisk;
  decision?: CandidateDecisionSummary;
  reasons?: string[];
  candidateBlockerCount?: number;
  candidateWarningCount?: number;
  candidateUnknownCount?: number;
  remainingBlockers?: number;
  remainingWarnings?: number;
  remainingUnknown?: number;
};

export type CandidateApplicationReview = {
  status: Extract<CandidateDecisionStatus, "review" | "avoid">;
  label: string;
  summary: string;
  reasons: string[];
  candidateBlockerCount?: number;
  candidateWarningCount?: number;
  candidateUnknownCount?: number;
  remainingBlockers?: number;
  remainingWarnings?: number;
  remainingUnknown?: number;
};

function reviewStatusFor(evidence: CandidateApplicationEvidence): CandidateApplicationReview["status"] | undefined {
  if (evidence.risk === "unsafe" || evidence.decision?.status === "avoid") return "avoid";
  if (evidence.risk === "review" || evidence.decision?.status === "review") return "review";
  return undefined;
}

export function candidateApplicationBlockedFor(evidence?: CandidateApplicationEvidence) {
  return evidence !== undefined && reviewStatusFor(evidence) === "avoid";
}

export function candidateApplicationReviewFor(evidence?: CandidateApplicationEvidence): CandidateApplicationReview | undefined {
  if (!evidence) return undefined;
  const status = reviewStatusFor(evidence);
  if (!status) return undefined;
  const label = evidence.decision?.label ?? (status === "avoid" ? "적용하지 않음" : "확인 후 적용");
  const summary = evidence.decision?.summary ?? (status === "avoid" ? "후보 자체에 차단 위험이 있습니다." : "후보 적용 전에 추가 확인이 필요합니다.");
  const reasons = [...new Set([
    ...(evidence.decision?.reasons ?? []),
    ...(evidence.reasons ?? [])
  ].map((reason) => reason.trim()).filter(Boolean))].slice(0, 4);
  return {
    status,
    label,
    summary,
    reasons,
    ...(evidence.candidateBlockerCount !== undefined ? { candidateBlockerCount: evidence.candidateBlockerCount } : {}),
    ...(evidence.candidateWarningCount !== undefined ? { candidateWarningCount: evidence.candidateWarningCount } : {}),
    ...(evidence.candidateUnknownCount !== undefined ? { candidateUnknownCount: evidence.candidateUnknownCount } : {}),
    ...(evidence.remainingBlockers !== undefined ? { remainingBlockers: evidence.remainingBlockers } : {}),
    ...(evidence.remainingWarnings !== undefined ? { remainingWarnings: evidence.remainingWarnings } : {}),
    ...(evidence.remainingUnknown !== undefined ? { remainingUnknown: evidence.remainingUnknown } : {})
  };
}
