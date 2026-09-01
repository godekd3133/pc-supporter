export interface BudgetLadderLocalShareEntry {
  id: string;
  url: string;
  name: string;
  createdAt: string;
  versionNumber?: number;
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

function normalizeEntry(value: unknown): BudgetLadderLocalShareEntry | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const id = textValue(candidate.id, 120);
  const url = validShareUrl(candidate.url);
  const name = textValue(candidate.name, 120);
  const createdAt = textValue(candidate.createdAt, 80);
  if (!id || !url || !name || !createdAt || !Number.isFinite(Date.parse(createdAt))) return undefined;
  const versionNumber = candidate.versionNumber === undefined ? undefined : Number(candidate.versionNumber);
  if (versionNumber !== undefined && (!Number.isInteger(versionNumber) || versionNumber < 1 || versionNumber > 1_000_000)) return undefined;
  const expiresAt = candidate.expiresAt === undefined ? undefined : textValue(candidate.expiresAt, 80);
  if (expiresAt !== undefined && !Number.isFinite(Date.parse(expiresAt))) return undefined;
  const ownerToken = candidate.ownerToken === undefined ? undefined : textValue(candidate.ownerToken, 500);
  if (candidate.ownerToken !== undefined && !ownerToken) return undefined;
  return { id, url, name, createdAt: new Date(createdAt).toISOString(), ...(versionNumber !== undefined ? { versionNumber } : {}), ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}), ...(ownerToken ? { ownerToken } : {}) };
}

function uniqueEntries(entries: BudgetLadderLocalShareEntry[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

export function budgetLadderLocalSharesFromJson(raw: string | null | undefined) {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [] as BudgetLadderLocalShareEntry[];
    const entries = parsed.map(normalizeEntry).filter((entry): entry is BudgetLadderLocalShareEntry => entry !== undefined);
    return uniqueEntries(entries).slice(0, MAX_LOCAL_SHARES);
  } catch {
    return [] as BudgetLadderLocalShareEntry[];
  }
}

export function budgetLadderLocalSharesToJson(entries: BudgetLadderLocalShareEntry[]) {
  return JSON.stringify(uniqueEntries(entries).slice(0, MAX_LOCAL_SHARES));
}

export function budgetLadderLocalShareRemember(entries: BudgetLadderLocalShareEntry[], entry: BudgetLadderLocalShareEntry) {
  return [entry, ...entries.filter((current) => current.id !== entry.id)].slice(0, MAX_LOCAL_SHARES);
}

export function budgetLadderLocalShareRemove(entries: BudgetLadderLocalShareEntry[], id: string) {
  return entries.filter((entry) => entry.id !== id);
}

export function budgetLadderLocalShareExpired(entry: Pick<BudgetLadderLocalShareEntry, "expiresAt">, now = Date.now()) {
  if (!entry.expiresAt) return false;
  const timestamp = Date.parse(entry.expiresAt);
  return !Number.isFinite(timestamp) || timestamp <= now;
}
