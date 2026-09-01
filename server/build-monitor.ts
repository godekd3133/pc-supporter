import { SAVED_BUILD_MONITOR_LIMIT } from "../shared/saved-build-monitor";

export interface SavedBuildMonitorRequest {
  ids: string[];
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseSavedBuildMonitorRequest(value: unknown): SavedBuildMonitorRequest {
  if (!isRecord(value) || !Array.isArray(value.ids)) {
    return { ids: [], errors: ["ids 배열이 필요합니다."] };
  }

  const errors: string[] = [];
  const ids: string[] = [];
  for (const [index, rawId] of value.ids.entries()) {
    if (typeof rawId !== "string" || rawId.trim().length === 0 || rawId.trim().length > 120) {
      errors.push(`ids[${index}]가 올바른 저장 견적 ID가 아닙니다.`);
      continue;
    }
    const id = rawId.trim();
    if (!ids.includes(id)) ids.push(id);
  }

  if (ids.length === 0 && errors.length === 0) errors.push("확인할 저장 견적 ID가 없습니다.");
  if (ids.length > SAVED_BUILD_MONITOR_LIMIT) errors.push(`저장 견적은 한 번에 최대 ${SAVED_BUILD_MONITOR_LIMIT}개까지 확인할 수 있습니다.`);
  return { ids: ids.slice(0, SAVED_BUILD_MONITOR_LIMIT), errors };
}
