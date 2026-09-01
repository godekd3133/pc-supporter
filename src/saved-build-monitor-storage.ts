import { SAVED_BUILD_MONITOR_ALERT_LIMIT, savedBuildMonitorAlertsFromUnknown } from "../shared/saved-build-monitor-alerts";
import type { SavedBuildMonitorAlert } from "../shared/saved-build-monitor-alerts";

export function savedBuildMonitorAlertsFromJson(raw: string | null): SavedBuildMonitorAlert[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return savedBuildMonitorAlertsFromUnknown(parsed, SAVED_BUILD_MONITOR_ALERT_LIMIT);
  } catch {
    return [];
  }
}

export function savedBuildMonitorAlertsToJson(alerts: SavedBuildMonitorAlert[]) {
  return JSON.stringify(alerts.slice(0, SAVED_BUILD_MONITOR_ALERT_LIMIT));
}

export function savedBuildMonitorAutoRefreshEnabledFromStorage(raw: string | null) {
  return raw === "true";
}

export function savedBuildMonitorAutoRefreshMinutesFromStorage(raw: string | null, fallback: 5 | 15 | 30 = 15): 5 | 15 | 30 {
  const value = Number(raw);
  return value === 5 || value === 15 || value === 30 ? value : fallback;
}
