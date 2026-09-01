import type { Finding, FindingSeverity } from "./types";

export type FindingFilter = "all" | FindingSeverity;

export const FINDING_FILTERS: FindingFilter[] = ["all", "blocker", "warning", "unknown", "info"];

export function findingMatchesFilter(finding: Finding, filter: FindingFilter) {
  return filter === "all" || finding.severity === filter;
}

export function filteredFindingsFor(findings: Finding[], filter: FindingFilter) {
  return findings.filter((finding) => findingMatchesFilter(finding, filter));
}

export function findingFilterCounts(findings: Finding[]) {
  return {
    all: findings.length,
    blocker: findings.filter((finding) => finding.severity === "blocker").length,
    warning: findings.filter((finding) => finding.severity === "warning").length,
    unknown: findings.filter((finding) => finding.severity === "unknown").length,
    info: findings.filter((finding) => finding.severity === "info").length
  } satisfies Record<FindingFilter, number>;
}
