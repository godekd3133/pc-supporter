export type BrowserNotificationPermission = "unsupported" | "default" | "granted" | "denied";

const MAX_NOTIFIED_ALERT_IDS = 100;

export function browserNotificationPermissionFromUnknown(value: unknown): BrowserNotificationPermission {
  return value === "granted" || value === "denied" || value === "default" ? value : "unsupported";
}

export function browserNotificationEnabledFromStorage(raw: string | null) {
  return raw === "true";
}

export function browserNotificationIdsFromJson(raw: string | null) {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((value): value is string => typeof value === "string" && value.length > 0 && value.length <= 240))].slice(0, MAX_NOTIFIED_ALERT_IDS);
  } catch {
    return [];
  }
}

export function browserNotificationIdsToJson(ids: string[]) {
  return JSON.stringify([...new Set(ids)].slice(-MAX_NOTIFIED_ALERT_IDS));
}

export function mergeBrowserNotificationIds(existing: string[], incoming: string[]) {
  return [...new Set([...existing, ...incoming])].slice(-MAX_NOTIFIED_ALERT_IDS);
}

export function browserNotificationPermissionLabel(permission: BrowserNotificationPermission) {
  if (permission === "granted") return "허용됨";
  if (permission === "denied") return "차단됨";
  if (permission === "default") return "허용 전";
  return "지원 안 함";
}
