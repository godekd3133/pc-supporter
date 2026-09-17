export interface GeneratorVariantsLocalShareEntry {
  id: string;
  url: string;
  name: string;
  createdAt: string;
  expiresAt?: string;
  ownerToken?: string;
}

export const GENERATOR_VARIANTS_LOCAL_SHARES_STORAGE_KEY = "pc-supporter-generator-variants-shares";
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

function normalizeEntry(value: unknown): GeneratorVariantsLocalShareEntry | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const id = textValue(candidate.id, 120);
  const url = validShareUrl(candidate.url);
  const name = textValue(candidate.name, 160);
  const createdAt = textValue(candidate.createdAt, 80);
  if (!id || !url || !name || !createdAt || !Number.isFinite(Date.parse(createdAt))) return undefined;
  const expiresAt = candidate.expiresAt === undefined ? undefined : textValue(candidate.expiresAt, 80);
  if (expiresAt !== undefined && !Number.isFinite(Date.parse(expiresAt))) return undefined;
  const ownerToken = candidate.ownerToken === undefined ? undefined : textValue(candidate.ownerToken, 500);
  if (candidate.ownerToken !== undefined && !ownerToken) return undefined;
  return { id, url, name, createdAt: new Date(createdAt).toISOString(), ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}), ...(ownerToken ? { ownerToken } : {}) };
}

function uniqueEntries(entries: GeneratorVariantsLocalShareEntry[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

export function generatorVariantsLocalSharesFromJson(raw: string | null | undefined) {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed) || parsed.length > MAX_LOCAL_SHARES) return [] as GeneratorVariantsLocalShareEntry[];
    return uniqueEntries(parsed.map(normalizeEntry).filter((entry): entry is GeneratorVariantsLocalShareEntry => entry !== undefined)).slice(0, MAX_LOCAL_SHARES);
  } catch {
    return [] as GeneratorVariantsLocalShareEntry[];
  }
}

export function generatorVariantsLocalSharesToJson(entries: GeneratorVariantsLocalShareEntry[]) {
  return JSON.stringify(uniqueEntries(entries).slice(0, MAX_LOCAL_SHARES));
}

export function generatorVariantsLocalShareRemember(entries: GeneratorVariantsLocalShareEntry[], entry: GeneratorVariantsLocalShareEntry) {
  return [entry, ...entries.filter((current) => current.id !== entry.id)].slice(0, MAX_LOCAL_SHARES);
}

export function generatorVariantsLocalShareRemove(entries: GeneratorVariantsLocalShareEntry[], id: string) {
  return entries.filter((entry) => entry.id !== id);
}

export function generatorVariantsLocalShareExpired(entry: Pick<GeneratorVariantsLocalShareEntry, "expiresAt">, now = Date.now()) {
  if (!entry.expiresAt) return false;
  const timestamp = Date.parse(entry.expiresAt);
  return !Number.isFinite(timestamp) || timestamp <= now;
}
