import type { AccessoryItem, Part, SavedBuild, SavedBuildSummary } from "../shared/types";
import { loadCatalogSnapshot } from "./catalog-snapshot";
import { summarizeSavedBuild } from "./build-summary";
import { publicSavedBuild, type SavedBuildRecord } from "./build-share";

export type SavedBuildPresentationContext = {
  catalog: Part[];
  accessories: AccessoryItem[];
};

export type SavedBuildPresentation = SavedBuild & {
  summary: SavedBuildSummary;
};

/** Loads one coherent catalog/accessory pair for every saved-build response in a request. */
export async function loadSavedBuildPresentationContext(): Promise<SavedBuildPresentationContext> {
  const snapshot = await loadCatalogSnapshot();
  return { catalog: snapshot.catalog, accessories: snapshot.accessories };
}

/** Projects a persisted build through the public response contract and current catalog summary. */
export function savedBuildPresentationFor(
  build: SavedBuildRecord,
  context: SavedBuildPresentationContext
): SavedBuildPresentation {
  return {
    ...publicSavedBuild(build),
    summary: summarizeSavedBuild(build.selection, context.catalog, context.accessories)
  };
}

export function savedBuildPresentationsFor(
  builds: SavedBuildRecord[],
  context: SavedBuildPresentationContext
): SavedBuildPresentation[] {
  return builds.map((build) => savedBuildPresentationFor(build, context));
}
