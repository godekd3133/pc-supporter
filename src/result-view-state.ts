import type { FindingFilter } from "../shared/finding-filters";

export type ResultSection = "findings" | "purchase-list" | "purchase-checklist" | "purchase-decision" | "actions";

const findingFilters: FindingFilter[] = ["all", "blocker", "warning", "unknown", "info"];

export function resultFindingFilterFromSearch(search: string): FindingFilter {
  const value = new URLSearchParams(search).get("finding");
  return findingFilters.includes(value as FindingFilter) ? value as FindingFilter : "all";
}

export function resultFindingRuleFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get("findingRule")?.trim() ?? "";
  return value.length > 0 && value.length <= 120 && /^[A-Za-z0-9:_-]+$/.test(value) ? value : null;
}

export function resultSectionFromHash(hash: string): ResultSection | undefined {
  const value = hash.replace(/^#/, "");
  return ["findings", "purchase-list", "purchase-checklist", "purchase-decision", "actions"].includes(value) ? value as ResultSection : undefined;
}

export function resultViewUrlFor(pathname: string, search: string, filter: FindingFilter, section: ResultSection): string {
  const params = new URLSearchParams(search);
  if (filter === "all") params.delete("finding");
  else params.set("finding", filter);
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}#${section}`;
}
