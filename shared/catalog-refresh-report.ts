import type { CatalogChangeValueDiff, DataQuality } from "./types";
import type { RefreshTarget } from "./refresh-targets";

export interface CatalogRefreshReportItem {
  target: RefreshTarget;
  name: string;
  changedFields: string[];
  valueDiffs?: CatalogChangeValueDiff[];
  refreshedAt: string;
  previousDataQuality: DataQuality;
  nextDataQuality: DataQuality;
  previousMissingCount: number;
  nextMissingCount: number;
  previousPriceWon?: number;
  nextPriceWon?: number;
}

export interface CatalogRefreshReportFailure {
  target: RefreshTarget;
  message: string;
}

export interface CatalogRefreshReport {
  inputFingerprint: string;
  status: "success" | "partial" | "failed";
  requestedCount: number;
  successCount: number;
  failureCount: number;
  items: CatalogRefreshReportItem[];
  failures: CatalogRefreshReportFailure[];
  completedAt: string;
}

function compactRefreshValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "확인 정보 없음";
  if (Array.isArray(value)) return value.map((item) => compactRefreshValue(item)).join(", ");
  if (typeof value === "object") return Object.entries(value as Record<string, unknown>).map(([key, nested]) => `${key}: ${compactRefreshValue(nested)}`).join(" · ");
  return String(value);
}

/** Formats a persisted refresh value for a compact, readable before/after view. */
export function catalogRefreshValueText(value: string | undefined, maxLength = 280) {
  if (!value) return "확인 정보 없음";
  let text = value;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object") text = compactRefreshValue(parsed);
  } catch {
    // Non-JSON values such as prices and quality labels are already readable.
  }
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

const DATA_QUALITIES = ["seed", "live", "manual", "incomplete"] as const;
const REFRESH_KINDS = ["part", "accessory"] as const;
const MAX_REFRESH_REPORT_ITEMS = 12;
const MAX_REFRESH_REPORT_CHANGED_FIELDS = 20;
const MAX_REFRESH_REPORT_VALUE_DIFFS = 8;
const MAX_REFRESH_REPORT_VALUE_DIFF_FIELD_LENGTH = 160;
const MAX_REFRESH_REPORT_VALUE_DIFF_VALUE_LENGTH = 420;
const MAX_REFRESH_REPORT_FINGERPRINT_LENGTH = 8_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function textWithinLimit(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function nonNegativeInteger(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
}

function boundedPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100_000_000;
}

function timestampWithinLimit(value: unknown): value is string {
  return textWithinLimit(value, 120) && Number.isFinite(Date.parse(value));
}

function refreshReportValueDiffFromUnknown(value: unknown): CatalogChangeValueDiff | undefined {
  if (!isRecord(value) || !textWithinLimit(value.field, MAX_REFRESH_REPORT_VALUE_DIFF_FIELD_LENGTH)) return undefined;
  if (value.previous !== undefined && !textWithinLimit(value.previous, MAX_REFRESH_REPORT_VALUE_DIFF_VALUE_LENGTH)) return undefined;
  if (value.next !== undefined && !textWithinLimit(value.next, MAX_REFRESH_REPORT_VALUE_DIFF_VALUE_LENGTH)) return undefined;
  return {
    field: value.field,
    ...(value.previous !== undefined ? { previous: value.previous } : {}),
    ...(value.next !== undefined ? { next: value.next } : {})
  };
}

function refreshTargetFromUnknown(value: unknown): RefreshTarget | undefined {
  if (!isRecord(value) || !REFRESH_KINDS.includes(value.kind as typeof REFRESH_KINDS[number]) || !textWithinLimit(value.id, 160)) return undefined;
  return { kind: value.kind as RefreshTarget["kind"], id: value.id };
}

function refreshReportItemFromUnknown(value: unknown): CatalogRefreshReportItem | undefined {
  if (!isRecord(value)) return undefined;
  const target = refreshTargetFromUnknown(value.target);
  const changedFields = value.changedFields;
  if (!target || !textWithinLimit(value.name, 240) || !Array.isArray(changedFields) || changedFields.length > MAX_REFRESH_REPORT_CHANGED_FIELDS || !changedFields.every((field) => textWithinLimit(field, 120)) || !timestampWithinLimit(value.refreshedAt) || !DATA_QUALITIES.includes(value.previousDataQuality as typeof DATA_QUALITIES[number]) || !DATA_QUALITIES.includes(value.nextDataQuality as typeof DATA_QUALITIES[number]) || !nonNegativeInteger(value.previousMissingCount, 100) || !nonNegativeInteger(value.nextMissingCount, 100)) return undefined;
  if (value.previousPriceWon !== undefined && !boundedPrice(value.previousPriceWon)) return undefined;
  if (value.nextPriceWon !== undefined && !boundedPrice(value.nextPriceWon)) return undefined;
  const rawValueDiffs = value.valueDiffs;
  if (rawValueDiffs !== undefined && (!Array.isArray(rawValueDiffs) || rawValueDiffs.length > MAX_REFRESH_REPORT_VALUE_DIFFS)) return undefined;
  const valueDiffs = rawValueDiffs === undefined ? undefined : rawValueDiffs.map(refreshReportValueDiffFromUnknown);
  if (valueDiffs?.some((diff): diff is undefined => diff === undefined)) return undefined;
  return {
    target,
    name: value.name,
    changedFields,
    ...(valueDiffs && valueDiffs.length > 0 ? { valueDiffs: valueDiffs as CatalogChangeValueDiff[] } : {}),
    refreshedAt: value.refreshedAt,
    previousDataQuality: value.previousDataQuality as DataQuality,
    nextDataQuality: value.nextDataQuality as DataQuality,
    previousMissingCount: value.previousMissingCount,
    nextMissingCount: value.nextMissingCount,
    ...(value.previousPriceWon !== undefined ? { previousPriceWon: value.previousPriceWon } : {}),
    ...(value.nextPriceWon !== undefined ? { nextPriceWon: value.nextPriceWon } : {})
  };
}

function refreshReportFailureFromUnknown(value: unknown): CatalogRefreshReportFailure | undefined {
  if (!isRecord(value)) return undefined;
  const target = refreshTargetFromUnknown(value.target);
  if (!target || !textWithinLimit(value.message, 500)) return undefined;
  return { target, message: value.message };
}

export function catalogRefreshReportFromUnknown(value: unknown): CatalogRefreshReport | undefined {
  if (!isRecord(value) || !textWithinLimit(value.inputFingerprint, MAX_REFRESH_REPORT_FINGERPRINT_LENGTH) || !["success", "partial", "failed"].includes(value.status as string) || !Array.isArray(value.items) || !Array.isArray(value.failures) || !timestampWithinLimit(value.completedAt)) return undefined;
  const requestedCount = value.requestedCount;
  const successCount = value.successCount;
  const failureCount = value.failureCount;
  if (!nonNegativeInteger(requestedCount, MAX_REFRESH_REPORT_ITEMS) || requestedCount < 1 || !nonNegativeInteger(successCount, MAX_REFRESH_REPORT_ITEMS) || !nonNegativeInteger(failureCount, MAX_REFRESH_REPORT_ITEMS)) return undefined;
  const items = value.items.map(refreshReportItemFromUnknown);
  const failures = value.failures.map(refreshReportFailureFromUnknown);
  if (items.some((item): item is undefined => item === undefined) || failures.some((failure): failure is undefined => failure === undefined) || items.length > MAX_REFRESH_REPORT_ITEMS || failures.length > MAX_REFRESH_REPORT_ITEMS || items.length !== successCount || failures.length !== failureCount || successCount + failureCount !== requestedCount) return undefined;
  if (value.status === "success" && (successCount === 0 || failureCount !== 0) || value.status === "partial" && (successCount === 0 || failureCount === 0) || value.status === "failed" && (successCount !== 0 || failureCount === 0)) return undefined;
  const targetKeys = new Set<string>();
  for (const item of items) {
    const key = `${item!.target.kind}:${item!.target.id}`;
    if (targetKeys.has(key)) return undefined;
    targetKeys.add(key);
  }
  for (const failure of failures) {
    const key = `${failure!.target.kind}:${failure!.target.id}`;
    if (targetKeys.has(key)) return undefined;
    targetKeys.add(key);
  }
  return {
    inputFingerprint: value.inputFingerprint,
    status: value.status as CatalogRefreshReport["status"],
    requestedCount,
    successCount,
    failureCount,
    items: items as CatalogRefreshReportItem[],
    failures: failures as CatalogRefreshReportFailure[],
    completedAt: value.completedAt
  };
}
