import type { BuildSelection, RecommendationPreferences } from "../shared/types";
import { compatibilityRequestKey } from "./compatibility-cache";
import { validateBuildSelection } from "./build-validation";
import { loadCatalogSnapshot, type CatalogSnapshot } from "./catalog-snapshot";
import { fileUpdatedAt } from "./storage";
import { gamingPerformanceEvidencePath } from "./gaming-performance-evidence";

type CompatibilityPreflightError = {
  statusCode: 400;
  body: Record<string, unknown>;
};

export type CompatibilityRequestPreparation = {
  snapshot: CatalogSnapshot;
  requestKey: string;
  gamingPerformanceEvidenceUpdatedAt: string;
  error?: CompatibilityPreflightError;
};

/** Captures one dependency-consistent snapshot and performs all compatibility input validation. */
export async function prepareCompatibilityRequest(
  build: BuildSelection,
  recommendationPreferences: RecommendationPreferences,
  engineVersion: string
): Promise<CompatibilityRequestPreparation> {
  const snapshot = await loadCatalogSnapshot();
  const gamingPerformanceEvidenceUpdatedAt = await fileUpdatedAt(gamingPerformanceEvidencePath(), "");
  const requestKey = compatibilityRequestKey(build, recommendationPreferences, engineVersion, {
    catalogSnapshotAt: snapshot.catalogUpdatedAt,
    accessoryUpdatedAt: snapshot.accessoryUpdatedAt,
    catalogRevision: snapshot.catalogRevision,
    gamingPerformanceEvidenceUpdatedAt
  });
  const validation = validateBuildSelection(build, snapshot.catalog, snapshot.accessories);
  if (validation.invalidSelections.length > 0) {
    return { snapshot, requestKey, gamingPerformanceEvidenceUpdatedAt, error: { statusCode: 400, body: { error: "카탈로그에 존재하지 않는 부품이 포함되어 있습니다.", partIds: validation.invalidSelections.map((selection) => selection.partId) } } };
  }
  if (validation.invalidAccessories.length > 0) {
    return { snapshot, requestKey, gamingPerformanceEvidenceUpdatedAt, error: { statusCode: 400, body: { error: "카탈로그에 존재하지 않는 주변 부품이 포함되어 있습니다.", accessoryIds: validation.invalidAccessories.map((selection) => selection.accessoryId) } } };
  }
  if (validation.invalidAccessoryTargets.length > 0) {
    return { snapshot, requestKey, gamingPerformanceEvidenceUpdatedAt, error: { statusCode: 400, body: { error: "주변 부품 연결 대상 SSD가 현재 견적에 없습니다.", targetPartIds: validation.invalidAccessoryTargets } } };
  }
  if (validation.invalidAccessoryHubTargets.length > 0) {
    return { snapshot, requestKey, gamingPerformanceEvidenceUpdatedAt, error: { statusCode: 400, body: { error: "주변 부품 연결 대상 팬 허브가 현재 견적에 없습니다.", targetAccessoryIds: validation.invalidAccessoryHubTargets } } };
  }
  if (validation.invalidRgbControllerAccessoryIds.length > 0) {
    return { snapshot, requestKey, gamingPerformanceEvidenceUpdatedAt, error: { statusCode: 400, body: { error: "RGB 연결 컨트롤러가 현재 견적에 선택되어 있지 않습니다.", rgbControllerAccessoryId: validation.invalidRgbControllerAccessoryIds[0] } } };
  }
  return { snapshot, requestKey, gamingPerformanceEvidenceUpdatedAt };
}
