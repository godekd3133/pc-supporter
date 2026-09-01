export interface SavedWatchlistAlertState {
  watchlistId: string;
  alertId: string;
  readAt?: string;
  dismissedAt?: string;
  updatedAt: string;
}

export function parseSavedWatchlistAlertIds(value: unknown, max = 20): { alertIds: string[]; error?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray((value as { alertIds?: unknown }).alertIds)) return { alertIds: [], error: "alertIds는 알림 ID 배열이어야 합니다." };
  const rawIds = (value as { alertIds: unknown[] }).alertIds;
  if (rawIds.some((alertId) => typeof alertId !== "string" || !alertId.trim())) return { alertIds: [], error: "alertIds에는 비어 있지 않은 문자열만 사용할 수 있습니다." };
  const alertIds = [...new Set(rawIds as string[])];
  if (alertIds.length > max) return { alertIds: [], error: "한 번에 최대 20개 알림만 처리할 수 있습니다." };
  return { alertIds };
}

function normalizedTimestamp(value: unknown) {
  if (typeof value !== "string") return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

export function savedWatchlistAlertStateFromUnknown(value: unknown): SavedWatchlistAlertState | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Partial<SavedWatchlistAlertState>;
  if (typeof candidate.watchlistId !== "string" || !candidate.watchlistId.trim() || typeof candidate.alertId !== "string" || !candidate.alertId.trim()) return undefined;
  const updatedAt = normalizedTimestamp(candidate.updatedAt);
  if (!updatedAt) return undefined;
  const readAt = candidate.readAt === undefined ? undefined : normalizedTimestamp(candidate.readAt);
  const dismissedAt = candidate.dismissedAt === undefined ? undefined : normalizedTimestamp(candidate.dismissedAt);
  if (candidate.readAt !== undefined && !readAt || candidate.dismissedAt !== undefined && !dismissedAt) return undefined;
  return { watchlistId: candidate.watchlistId, alertId: candidate.alertId, updatedAt, ...(readAt ? { readAt } : {}), ...(dismissedAt ? { dismissedAt } : {}) };
}

export function upsertSavedWatchlistAlertStates(states: SavedWatchlistAlertState[], watchlistId: string, alertIds: string[], patch: "read" | "dismiss", updatedAt: string, max = 5000) {
  const byKey = new Map(states.map((state) => [state.watchlistId + ":" + state.alertId, state]));
  const field = patch === "read" ? "readAt" : "dismissedAt";
  [...new Set(alertIds.filter((alertId) => alertId.trim()))].forEach((alertId) => {
    const key = watchlistId + ":" + alertId;
    const current = byKey.get(key);
    byKey.set(key, { watchlistId, alertId, updatedAt, ...(current?.readAt ? { readAt: current.readAt } : {}), ...(current?.dismissedAt ? { dismissedAt: current.dismissedAt } : {}), [field]: updatedAt });
  });
  return [...byKey.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, Math.max(1, Math.floor(max)));
}
