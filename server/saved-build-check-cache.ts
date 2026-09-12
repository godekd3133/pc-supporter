import type { BuildSelection, RecommendationPreferences, SavedBuildCheckSnapshot } from "../shared/types";
import { compatibilityResultCacheKey, TtlLruInFlightCache } from "./compatibility-cache";

export type SavedBuildCheckCacheDependencies = {
  catalogSnapshotAt: string;
  accessoryUpdatedAt: string;
  catalogRevision: number;
  engineVersion: string;
};

export function savedBuildCheckPreviewCacheKey(args: { build: BuildSelection; recommendationPreferences: RecommendationPreferences; dependencies: SavedBuildCheckCacheDependencies }) {
  return compatibilityResultCacheKey({
    build: args.build,
    recommendationPreferences: args.recommendationPreferences,
    catalogSnapshotAt: args.dependencies.catalogSnapshotAt,
    accessoryUpdatedAt: args.dependencies.accessoryUpdatedAt,
    catalogRevision: args.dependencies.catalogRevision,
    engineVersion: args.dependencies.engineVersion
  });
}

export const savedBuildCheckPreviewCache = new TtlLruInFlightCache<SavedBuildCheckSnapshot>({ ttlMs: 5 * 60 * 1000, maxEntries: 40 });
