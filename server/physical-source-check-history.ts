import { randomUUID } from "node:crypto";
import type { PhysicalSourceCheck, PhysicalSourceCheckHistoryEntry, PhysicalSourceCheckTransition } from "../shared/types";
import { PHYSICAL_SOURCE_CHECK_HISTORY_PATH, readJson, withSerializedFileMutation, writeJson } from "./storage";

const MAX_HISTORY_ENTRIES = 1_000;
const MAX_PART_HISTORY_ENTRIES = 20;
const SOURCE_CHECK_STATUSES = ["reachable", "redirected", "http_error", "unreachable", "blocked", "identity_mismatch"] as const;
const SOURCE_IDENTITY_STATUSES = ["matched", "not_found", "manual_required", "not_checked"] as const;
const SOURCE_TRANSITIONS = ["initial", "unchanged", "changed"] as const;

function textValue(value: unknown, maxLength: number) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength ? value : undefined;
}

function optionalTextValue(value: unknown, maxLength: number) {
  return value === undefined ? undefined : textValue(value, maxLength);
}

function sourceCheckFromUnknown(value: unknown): PhysicalSourceCheck | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const requestedUrl = textValue(candidate.requestedUrl, 2_000);
  const checkedAt = textValue(candidate.checkedAt, 120);
  const status = SOURCE_CHECK_STATUSES.includes(candidate.status as typeof SOURCE_CHECK_STATUSES[number]) ? candidate.status as PhysicalSourceCheck["status"] : undefined;
  const identityStatus = SOURCE_IDENTITY_STATUSES.includes(candidate.identityStatus as typeof SOURCE_IDENTITY_STATUSES[number]) ? candidate.identityStatus as PhysicalSourceCheck["identityStatus"] : undefined;
  const redirectCount = candidate.redirectCount;
  if (!requestedUrl || !checkedAt || !status || !identityStatus || typeof redirectCount !== "number" || !Number.isInteger(redirectCount) || redirectCount < 0 || redirectCount > 10) return undefined;
  const finalUrl = optionalTextValue(candidate.finalUrl, 2_000);
  const contentType = optionalTextValue(candidate.contentType, 160);
  const detail = optionalTextValue(candidate.detail, 500);
  const httpStatus = candidate.httpStatus;
  if (candidate.finalUrl !== undefined && !finalUrl || candidate.contentType !== undefined && !contentType || candidate.detail !== undefined && !detail) return undefined;
  if (httpStatus !== undefined && (typeof httpStatus !== "number" || !Number.isInteger(httpStatus) || httpStatus < 100 || httpStatus > 599)) return undefined;
  return { requestedUrl, checkedAt, status, identityStatus, redirectCount, ...(finalUrl ? { finalUrl } : {}), ...(httpStatus !== undefined ? { httpStatus } : {}), ...(contentType ? { contentType } : {}), ...(detail ? { detail } : {}) };
}

export function physicalSourceCheckHistoryEntriesFromUnknown(value: unknown): PhysicalSourceCheckHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const candidate = item as Record<string, unknown>;
    const id = textValue(candidate.id, 120);
    const partId = textValue(candidate.partId, 160);
    const recordedAt = textValue(candidate.recordedAt, 120);
    const sourceCheck = sourceCheckFromUnknown(candidate.sourceCheck);
    const transition = SOURCE_TRANSITIONS.includes(candidate.transition as typeof SOURCE_TRANSITIONS[number]) ? candidate.transition as PhysicalSourceCheckTransition : undefined;
    return id && partId && recordedAt && sourceCheck && transition ? [{ id, partId, recordedAt, sourceCheck, transition }] : [];
  }).slice(-MAX_HISTORY_ENTRIES);
}

function sourceCheckFingerprint(sourceCheck: PhysicalSourceCheck) {
  return JSON.stringify({
    requestedUrl: sourceCheck.requestedUrl,
    status: sourceCheck.status,
    identityStatus: sourceCheck.identityStatus,
    redirectCount: sourceCheck.redirectCount,
    finalUrl: sourceCheck.finalUrl,
    httpStatus: sourceCheck.httpStatus,
    contentType: sourceCheck.contentType,
    detail: sourceCheck.detail
  });
}

export function physicalSourceCheckTransitionFor(previous: PhysicalSourceCheckHistoryEntry | undefined, current: PhysicalSourceCheck): PhysicalSourceCheckTransition {
  if (!previous) return "initial";
  return sourceCheckFingerprint(previous.sourceCheck) === sourceCheckFingerprint(current) ? "unchanged" : "changed";
}

export function physicalSourceCheckHistoryEntryFor(partId: string, sourceCheck: PhysicalSourceCheck, previous: PhysicalSourceCheckHistoryEntry | undefined, id: string = randomUUID(), recordedAt = new Date().toISOString()): PhysicalSourceCheckHistoryEntry {
  return { id, partId, recordedAt, sourceCheck, transition: physicalSourceCheckTransitionFor(previous, sourceCheck) };
}

export async function readPhysicalSourceCheckHistory(partId?: string, limit = MAX_PART_HISTORY_ENTRIES) {
  const entries = physicalSourceCheckHistoryEntriesFromUnknown(await readJson<unknown>(PHYSICAL_SOURCE_CHECK_HISTORY_PATH, []));
  const boundedLimit = Number.isFinite(limit) ? Math.min(MAX_PART_HISTORY_ENTRIES, Math.max(1, Math.floor(limit))) : MAX_PART_HISTORY_ENTRIES;
  const filtered = partId ? entries.filter((entry) => entry.partId === partId) : entries;
  return filtered.slice().reverse().slice(0, boundedLimit);
}

export async function appendPhysicalSourceCheckHistory(partId: string, sourceCheck: PhysicalSourceCheck) {
  return withSerializedFileMutation(PHYSICAL_SOURCE_CHECK_HISTORY_PATH, async () => {
    const entries = physicalSourceCheckHistoryEntriesFromUnknown(await readJson<unknown>(PHYSICAL_SOURCE_CHECK_HISTORY_PATH, []));
    const previous = entries.slice().reverse().find((entry) => entry.partId === partId);
    const entry = physicalSourceCheckHistoryEntryFor(partId, sourceCheck, previous);
    await writeJson(PHYSICAL_SOURCE_CHECK_HISTORY_PATH, [...entries, entry].slice(-MAX_HISTORY_ENTRIES));
    return entry;
  });
}
