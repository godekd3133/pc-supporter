export const CATALOG_BATCH_ID_LIMIT = 100;

export interface CatalogBatchIdRequest {
  ids: string[];
  errors: string[];
}

export function parseCatalogBatchIds(value: unknown, max = CATALOG_BATCH_ID_LIMIT): CatalogBatchIdRequest {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray((value as { ids?: unknown }).ids)) {
    return { ids: [], errors: ["ids 배열이 필요합니다."] };
  }
  const rawIds = (value as { ids: unknown[] }).ids;
  const errors: string[] = [];
  const ids: string[] = [];
  rawIds.forEach((rawId, index) => {
    if (typeof rawId !== "string" || rawId.trim().length === 0 || rawId.trim().length > 160) {
      errors.push(`ids[${index}]가 올바른 카탈로그 ID가 아닙니다.`);
      return;
    }
    const id = rawId.trim();
    if (!ids.includes(id)) ids.push(id);
  });
  const limit = Math.max(1, Math.min(CATALOG_BATCH_ID_LIMIT, Math.floor(max)));
  if (ids.length === 0 && errors.length === 0) errors.push("조회할 카탈로그 ID가 없습니다.");
  if (ids.length > limit) errors.push(`카탈로그는 한 번에 최대 ${limit}개까지 조회할 수 있습니다.`);
  return { ids: ids.slice(0, limit), errors };
}

export function parseCatalogBatchQuery(value: unknown, max = CATALOG_BATCH_ID_LIMIT): CatalogBatchIdRequest {
  const rawValues = Array.isArray(value) ? value : [value];
  const ids = rawValues.flatMap((rawValue) => typeof rawValue === "string" ? rawValue.split(",") : []);
  return parseCatalogBatchIds({ ids }, max);
}
