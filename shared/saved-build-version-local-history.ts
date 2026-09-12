export interface SavedBuildVersionLocalShareEntry {
  id: string;
  url: string;
  name: string;
  createdAt: string;
  beforeLabel: string;
  beforeName: string;
  beforeBuildId?: string;
  afterLabel: string;
  afterName: string;
  afterBuildId?: string;
  expiresAt?: string;
  ownerToken?: string;
}

const MAX_LOCAL_SHARES = 20;

function textValue(value: unknown, maximum: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maximum) : undefined;
}

function validShareUrl(value: unknown) {
  const url = textValue(value, 2_000);
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function normalizeEntry(value: unknown): SavedBuildVersionLocalShareEntry | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const id = textValue(candidate.id, 120);
  const url = validShareUrl(candidate.url);
  const name = textValue(candidate.name, 160);
  const createdAt = textValue(candidate.createdAt, 80);
  const beforeLabel = textValue(candidate.beforeLabel, 24);
  const beforeName = textValue(candidate.beforeName, 200);
  const beforeBuildId = candidate.beforeBuildId === undefined ? undefined : textValue(candidate.beforeBuildId, 120);
  const afterLabel = textValue(candidate.afterLabel, 24);
  const afterName = textValue(candidate.afterName, 200);
  const afterBuildId = candidate.afterBuildId === undefined ? undefined : textValue(candidate.afterBuildId, 120);
  if (candidate.beforeBuildId !== undefined && !beforeBuildId || candidate.afterBuildId !== undefined && !afterBuildId) return undefined;
  if (!id || !url || !name || !createdAt || !beforeLabel || !beforeName || !afterLabel || !afterName || !Number.isFinite(Date.parse(createdAt))) return undefined;
  const expiresAt = candidate.expiresAt === undefined ? undefined : textValue(candidate.expiresAt, 80);
  if (expiresAt !== undefined && !Number.isFinite(Date.parse(expiresAt))) return undefined;
  const ownerToken = candidate.ownerToken === undefined ? undefined : textValue(candidate.ownerToken, 500);
  if (candidate.ownerToken !== undefined && !ownerToken) return undefined;
  return { id, url, name, createdAt: new Date(createdAt).toISOString(), beforeLabel, beforeName, ...(beforeBuildId ? { beforeBuildId } : {}), afterLabel, afterName, ...(afterBuildId ? { afterBuildId } : {}), ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}), ...(ownerToken ? { ownerToken } : {}) };
}

function uniqueEntries(entries: SavedBuildVersionLocalShareEntry[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

export function savedBuildVersionLocalSharesFromJson(raw: string | null | undefined) {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [] as SavedBuildVersionLocalShareEntry[];
    if (parsed.length > MAX_LOCAL_SHARES) return [] as SavedBuildVersionLocalShareEntry[];
    return uniqueEntries(parsed.map(normalizeEntry).filter((entry): entry is SavedBuildVersionLocalShareEntry => entry !== undefined)).slice(0, MAX_LOCAL_SHARES);
  } catch {
    return [] as SavedBuildVersionLocalShareEntry[];
  }
}

export function savedBuildVersionLocalSharesToJson(entries: SavedBuildVersionLocalShareEntry[]) {
  return JSON.stringify(uniqueEntries(entries).slice(0, MAX_LOCAL_SHARES));
}

export function savedBuildVersionLocalShareRemember(entries: SavedBuildVersionLocalShareEntry[], entry: SavedBuildVersionLocalShareEntry) {
  return [entry, ...entries.filter((current) => current.id !== entry.id)].slice(0, MAX_LOCAL_SHARES);
}

export function savedBuildVersionLocalShareRemove(entries: SavedBuildVersionLocalShareEntry[], id: string) {
  return entries.filter((entry) => entry.id !== id);
}

export function savedBuildVersionLocalShareExpired(entry: Pick<SavedBuildVersionLocalShareEntry, "expiresAt">, now = Date.now()) {
  if (!entry.expiresAt) return false;
  const timestamp = Date.parse(entry.expiresAt);
  return !Number.isFinite(timestamp) || timestamp <= now;
}
