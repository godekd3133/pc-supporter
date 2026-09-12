export interface AlternativeComparisonLocalShareEntry {
  id: string;
  url: string;
  name: string;
  createdAt: string;
  category?: string;
  currentPartName?: string;
  currentPartSummary?: string;
  currentPartPrice?: string;
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

function normalizeEntry(value: unknown): AlternativeComparisonLocalShareEntry | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const id = textValue(candidate.id, 120);
  const url = validShareUrl(candidate.url);
  const name = textValue(candidate.name, 120);
  const createdAt = textValue(candidate.createdAt, 80);
  if (!id || !url || !name || !createdAt || !Number.isFinite(Date.parse(createdAt))) return undefined;
  const category = candidate.category === undefined ? undefined : textValue(candidate.category, 80);
  if (candidate.category !== undefined && !category) return undefined;
  const currentPartName = candidate.currentPartName === undefined ? undefined : textValue(candidate.currentPartName, 160);
  if (candidate.currentPartName !== undefined && !currentPartName) return undefined;
  const currentPartSummary = candidate.currentPartSummary === undefined ? undefined : textValue(candidate.currentPartSummary, 500);
  if (candidate.currentPartSummary !== undefined && !currentPartSummary) return undefined;
  const currentPartPrice = candidate.currentPartPrice === undefined ? undefined : textValue(candidate.currentPartPrice, 120);
  if (candidate.currentPartPrice !== undefined && !currentPartPrice) return undefined;
  const expiresAt = candidate.expiresAt === undefined ? undefined : textValue(candidate.expiresAt, 80);
  if (expiresAt !== undefined && !Number.isFinite(Date.parse(expiresAt))) return undefined;
  const ownerToken = candidate.ownerToken === undefined ? undefined : textValue(candidate.ownerToken, 500);
  if (candidate.ownerToken !== undefined && !ownerToken) return undefined;
  return {
    id,
    url,
    name,
    createdAt: new Date(createdAt).toISOString(),
    ...(category ? { category } : {}),
    ...(currentPartName ? { currentPartName } : {}),
    ...(currentPartSummary ? { currentPartSummary } : {}),
    ...(currentPartPrice ? { currentPartPrice } : {}),
    ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
    ...(ownerToken ? { ownerToken } : {})
  };
}

function uniqueEntries(entries: AlternativeComparisonLocalShareEntry[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

export function alternativeComparisonLocalSharesFromJson(raw: string | null | undefined) {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [] as AlternativeComparisonLocalShareEntry[];
    if (parsed.length > MAX_LOCAL_SHARES) return [] as AlternativeComparisonLocalShareEntry[];
    const entries = parsed.map(normalizeEntry).filter((entry): entry is AlternativeComparisonLocalShareEntry => entry !== undefined);
    return uniqueEntries(entries).slice(0, MAX_LOCAL_SHARES);
  } catch {
    return [] as AlternativeComparisonLocalShareEntry[];
  }
}

export function alternativeComparisonLocalSharesToJson(entries: AlternativeComparisonLocalShareEntry[]) {
  return JSON.stringify(uniqueEntries(entries).slice(0, MAX_LOCAL_SHARES));
}

export function alternativeComparisonLocalShareRemember(entries: AlternativeComparisonLocalShareEntry[], entry: AlternativeComparisonLocalShareEntry) {
  return [entry, ...entries.filter((current) => current.id !== entry.id)].slice(0, MAX_LOCAL_SHARES);
}

export function alternativeComparisonLocalShareRemove(entries: AlternativeComparisonLocalShareEntry[], id: string) {
  return entries.filter((entry) => entry.id !== id);
}

export function alternativeComparisonLocalShareExpired(entry: Pick<AlternativeComparisonLocalShareEntry, "expiresAt">, now = Date.now()) {
  if (!entry.expiresAt) return false;
  const timestamp = Date.parse(entry.expiresAt);
  return !Number.isFinite(timestamp) || timestamp <= now;
}
