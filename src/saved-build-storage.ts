// Saved-build local storage helpers.

export const SAVED_BUILD_OWNER_TOKENS_STORAGE_KEY = "pc-supporter-saved-build-owner-tokens";

export function readSavedBuildOwnerTokens() {
  try {
    const raw = window.localStorage.getItem(SAVED_BUILD_OWNER_TOKENS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {} as Record<string, string>;
    const entries = Object.entries(parsed);
    if (entries.length > LOCAL_SAVED_STATE_LIMIT) return {} as Record<string, string>;
    return Object.fromEntries(entries.filter(([id, token]) => typeof id === "string" && typeof token === "string" && token.length >= 40).slice(0, LOCAL_SAVED_STATE_LIMIT));
  } catch {
    return {} as Record<string, string>;
  }
}

export function writeSavedBuildOwnerTokens(tokens: Record<string, string>) {
  try {
    window.localStorage.setItem(SAVED_BUILD_OWNER_TOKENS_STORAGE_KEY, JSON.stringify(Object.fromEntries(Object.entries(tokens).slice(0, LOCAL_SAVED_STATE_LIMIT))));
  } catch {
    // A full local storage bucket must not prevent the editor from working.
  }
}

export function rememberSavedBuildOwnerToken(id: string, token: string) {
  if (!id.trim() || !token.trim()) return;
  writeSavedBuildOwnerTokens({ [id]: token, ...readSavedBuildOwnerTokens() });
}

export function readSavedBuildOwnerToken(id: string) {
  return readSavedBuildOwnerTokens()[id];
}

export const LOCAL_SAVED_STATE_LIMIT = 20;

export const SAVED_BUILD_IDS_STORAGE_KEY = "pc-supporter-saved-build-ids";

export function readSavedBuildIds() {
  try {
    const raw = window.localStorage.getItem(SAVED_BUILD_IDS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed) || parsed.length > LOCAL_SAVED_STATE_LIMIT) return [] as string[];
    return parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0).slice(0, LOCAL_SAVED_STATE_LIMIT);
  } catch {
    return [] as string[];
  }
}

export function writeSavedBuildIds(ids: string[]) {
  try {
    const nextIds = [...new Set(ids)].slice(0, LOCAL_SAVED_STATE_LIMIT);
    window.localStorage.setItem(SAVED_BUILD_IDS_STORAGE_KEY, JSON.stringify(nextIds));
    const allowedIds = new Set(nextIds);
    const tokens = readSavedBuildOwnerTokens();
    writeSavedBuildOwnerTokens(Object.fromEntries(Object.entries(tokens).filter(([id]) => allowedIds.has(id))));
  } catch {
    // A full local storage bucket must not prevent the history screen from working.
  }
}
