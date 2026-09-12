import { randomUUID } from "node:crypto";
import type { PhysicalSourceCheck, PhysicalSourceCheckHistoryEntry, PhysicalSourceCheckTransition } from "../shared/types";
import { physicalSourceCheckFromUnknown, physicalSourceCheckTransitionFor } from "./physical-source-check-history";
import { CATALOG_SPEC_OVERRIDE_SOURCE_CHECK_HISTORY_PATH, readJson, withSerializedFileMutation, writeJson } from "./storage";

const MAX_HISTORY_ENTRIES = 1_000;
const MAX_PART_HISTORY_ENTRIES = 20;

function textValue(value: unknown, maxLength: number) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength ? value : undefined;
}

export function catalogSpecOverrideSourceCheckHistoryEntriesFromUnknown(value: unknown): PhysicalSourceCheckHistoryEntry[] {
  if (!Array.isArray(value) || value.length > MAX_HISTORY_ENTRIES) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const candidate = item as Record<string, unknown>;
    const id = textValue(candidate.id, 120);
    const partId = textValue(candidate.partId, 160);
    const recordedAt = textValue(candidate.recordedAt, 120);
    const sourceCheck = physicalSourceCheckFromUnknown(candidate.sourceCheck);
    const transition: PhysicalSourceCheckTransition | undefined = candidate.transition === "initial" || candidate.transition === "unchanged" || candidate.transition === "changed" ? candidate.transition : undefined;
    return id && partId && recordedAt && sourceCheck && transition ? [{ id, partId, recordedAt, sourceCheck, transition }] : [];
  }).slice(-MAX_HISTORY_ENTRIES);
}

export async function readCatalogSpecOverrideSourceCheckHistory(partId?: string, limit = MAX_PART_HISTORY_ENTRIES) {
  const entries = catalogSpecOverrideSourceCheckHistoryEntriesFromUnknown(await readJson<unknown>(CATALOG_SPEC_OVERRIDE_SOURCE_CHECK_HISTORY_PATH, []));
  const boundedLimit = Number.isFinite(limit) ? Math.min(MAX_PART_HISTORY_ENTRIES, Math.max(1, Math.floor(limit))) : MAX_PART_HISTORY_ENTRIES;
  const filtered = partId ? entries.filter((entry) => entry.partId === partId) : entries;
  return filtered.slice().reverse().slice(0, boundedLimit);
}

export async function appendCatalogSpecOverrideSourceCheckHistory(partId: string, sourceCheck: PhysicalSourceCheck) {
  return withSerializedFileMutation(CATALOG_SPEC_OVERRIDE_SOURCE_CHECK_HISTORY_PATH, async () => {
    const entries = catalogSpecOverrideSourceCheckHistoryEntriesFromUnknown(await readJson<unknown>(CATALOG_SPEC_OVERRIDE_SOURCE_CHECK_HISTORY_PATH, []));
    const previous = entries.slice().reverse().find((entry) => entry.partId === partId);
    const entry: PhysicalSourceCheckHistoryEntry = {
      id: randomUUID(),
      partId,
      recordedAt: new Date().toISOString(),
      sourceCheck,
      transition: physicalSourceCheckTransitionFor(previous, sourceCheck)
    };
    await writeJson(CATALOG_SPEC_OVERRIDE_SOURCE_CHECK_HISTORY_PATH, [...entries, entry].slice(-MAX_HISTORY_ENTRIES));
    return entry;
  });
}
