import type { CompatibilityReportViewState } from "../shared/compatibility-report";

export function savedBuildSharePathFor(id: string, viewState: CompatibilityReportViewState): string {
  const query = viewState.findingFilter === "all" ? "" : `?finding=${encodeURIComponent(viewState.findingFilter)}`;
  const hash = viewState.section ? `#${viewState.section}` : "";
  return `/share/${encodeURIComponent(id)}${query}${hash}`;
}

export function savedBuildShareUrlFor(origin: string, id: string, viewState: CompatibilityReportViewState): string {
  return `${origin}${savedBuildSharePathFor(id, viewState)}`;
}
