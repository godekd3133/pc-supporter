import { GENERATOR_VARIANTS_EXPORT_TYPE, GENERATOR_VARIANTS_EXPORT_VERSION } from "./generator-variants-share";

export const GENERATOR_VARIANTS_LOCAL_HISTORY_KEY = "pc-supporter-generator-variants-history";
export const GENERATOR_VARIANTS_LOCAL_HISTORY_LIMIT = 10;
export const GENERATOR_VARIANTS_LOCAL_HISTORY_MAX_PAYLOAD_BYTES = 1_000_000;

export interface GeneratorVariantsLocalHistoryEntry {
  id: string;
  name: string;
  createdAt: string;
  payload: string;
}

function textValue(value: unknown, maximum: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maximum) : undefined;
}

function validPayload(value: unknown) {
  const payload = textValue(value, GENERATOR_VARIANTS_LOCAL_HISTORY_MAX_PAYLOAD_BYTES);
  if (!payload || new TextEncoder().encode(payload).length > GENERATOR_VARIANTS_LOCAL_HISTORY_MAX_PAYLOAD_BYTES) return undefined;
  try {
    const parsed: unknown = JSON.parse(payload);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const record = parsed as Record<string, unknown>;
    if (record.type !== GENERATOR_VARIANTS_EXPORT_TYPE || record.version !== GENERATOR_VARIANTS_EXPORT_VERSION || !Array.isArray(record.items) || record.items.length < 1 || record.items.length > 3) return undefined;
    return JSON.stringify(parsed);
  } catch {
    return undefined;
  }
}

function normalizeEntry(value: unknown): GeneratorVariantsLocalHistoryEntry | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const id = textValue(candidate.id, 120);
  const name = textValue(candidate.name, 160);
  const createdAt = textValue(candidate.createdAt, 80);
  const payload = validPayload(candidate.payload);
  if (!id || !name || !createdAt || !payload || !Number.isFinite(Date.parse(createdAt))) return undefined;
  return { id, name, createdAt: new Date(createdAt).toISOString(), payload };
}

function uniqueEntries(entries: GeneratorVariantsLocalHistoryEntry[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

export function generatorVariantsLocalHistoryFromJson(raw: string | null | undefined) {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed) || parsed.length > GENERATOR_VARIANTS_LOCAL_HISTORY_LIMIT) return [] as GeneratorVariantsLocalHistoryEntry[];
    return uniqueEntries(parsed.map(normalizeEntry).filter((entry): entry is GeneratorVariantsLocalHistoryEntry => entry !== undefined)).slice(0, GENERATOR_VARIANTS_LOCAL_HISTORY_LIMIT);
  } catch {
    return [] as GeneratorVariantsLocalHistoryEntry[];
  }
}

export function generatorVariantsLocalHistoryToJson(entries: GeneratorVariantsLocalHistoryEntry[]) {
  return JSON.stringify(uniqueEntries(entries).slice(0, GENERATOR_VARIANTS_LOCAL_HISTORY_LIMIT));
}

function payloadDedupeKey(payload: string) {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return payload;
    const { exportedAt: _exportedAt, ...rest } = parsed as Record<string, unknown>;
    return JSON.stringify(rest);
  } catch {
    return payload;
  }
}

export function generatorVariantsLocalHistoryRemember(entries: GeneratorVariantsLocalHistoryEntry[], entry: GeneratorVariantsLocalHistoryEntry) {
  const payloadKey = payloadDedupeKey(entry.payload);
  return [entry, ...entries.filter((current) => current.id !== entry.id && payloadDedupeKey(current.payload) !== payloadKey)].slice(0, GENERATOR_VARIANTS_LOCAL_HISTORY_LIMIT);
}

export function generatorVariantsLocalHistoryRemove(entries: GeneratorVariantsLocalHistoryEntry[], id: string) {
  return entries.filter((entry) => entry.id !== id);
}
