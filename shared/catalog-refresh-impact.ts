import type { CatalogRefreshReport, CatalogRefreshReportItem } from "./catalog-refresh-report";
import type { SavedBuildCheckFindingDiff } from "./saved-build-check";

export interface CatalogRefreshFindingImpact {
  item: CatalogRefreshReportItem;
  findingChanges: SavedBuildCheckFindingDiff[];
}

function findingAffectedPartIds(change: SavedBuildCheckFindingDiff) {
  return new Set([...(change.before?.affectedPartIds ?? []), ...(change.after?.affectedPartIds ?? [])]);
}

export function catalogRefreshFindingImpactsFor(report: CatalogRefreshReport, findingChanges: ReadonlyArray<SavedBuildCheckFindingDiff>): CatalogRefreshFindingImpact[] {
  return report.items.map((item) => ({
    item,
    findingChanges: findingChanges.filter((change) => change.change !== "unchanged" && findingAffectedPartIds(change).has(item.target.id))
  }));
}
