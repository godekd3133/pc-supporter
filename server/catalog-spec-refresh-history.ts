import { randomUUID } from "node:crypto";
import { catalogPcieRefreshImpactFor, catalogSpecRefreshImpactFor, type CatalogPcieRefreshImpact, type CatalogSpecRefreshBatchFilters, type CatalogSpecRefreshBatchImpact, type CatalogSpecRefreshBatchItem, type CatalogSpecRefreshBatchItemStatus, type CatalogSpecRefreshBatchResponse, type CatalogSpecRefreshCategoryCoverageDelta, type CatalogSpecRefreshCategoryCoverageSummary, type CatalogSpecRefreshCategoryImpact, type CatalogSpecRefreshCoverageDelta, type CatalogSpecRefreshCoverageSummary, type CatalogSpecRefreshHistoryEntry, type CatalogSpecReviewAction, type CatalogSpecReviewEvidence } from "../shared/catalog-spec-review";
import { catalogPcieSlotCoverageDeltaFor, type CatalogPcieSlotCoverage, type CatalogPcieSlotCoverageDelta } from "../shared/catalog-spec-coverage";
import type { PcieSlotWidth } from "../shared/pcie-slot";
import { PART_CATEGORIES, type PartCategory } from "../shared/types";
import { CATALOG_SPEC_REFRESH_HISTORY_PATH, readJson, withSerializedFileMutation, writeJson } from "./storage";

const MAX_HISTORY_ENTRIES = 100;
const MAX_READ_ENTRIES = 20;
const ITEM_STATUSES: CatalogSpecRefreshBatchItemStatus[] = ["refreshed", "skipped", "failed"];
const PRIORITIES = ["high", "medium", "low"] as const;
const PCIE_REQUIRED_WIDTHS = [16, 8, 4, 1] as const satisfies readonly PcieSlotWidth[];

function textValue(value: unknown, maxLength: number) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength ? value : undefined;
}

function integerValue(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : undefined;
}

function pcieSlotCoverageFromUnknown(value: unknown): CatalogPcieSlotCoverage | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const total = integerValue(candidate.total, 0, 1_000_000);
  const rawTotal = candidate.rawTotal === undefined ? undefined : integerValue(candidate.rawTotal, total ?? 0, 1_000_000);
  const excludedCategoryMismatchCount = candidate.excludedCategoryMismatchCount === undefined ? undefined : integerValue(candidate.excludedCategoryMismatchCount, 0, 1_000_000);
  const rawEntries = candidate.byRequiredWidth;
  if (total === undefined || !rawEntries || typeof rawEntries !== "object" || Array.isArray(rawEntries)) return undefined;
  if ((rawTotal === undefined) !== (excludedCategoryMismatchCount === undefined) || rawTotal !== undefined && rawTotal - excludedCategoryMismatchCount! !== total) return undefined;
  const entries: Array<[PcieSlotWidth, CatalogPcieSlotCoverage["byRequiredWidth"][PcieSlotWidth] | undefined]> = PCIE_REQUIRED_WIDTHS.map((requiredWidth) => {
    const rawEntry = (rawEntries as Record<string, unknown>)[String(requiredWidth)];
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) return [requiredWidth, undefined];
    const entry = rawEntry as Record<string, unknown>;
    const entryTotal = integerValue(entry.total, 0, 1_000_000);
    const complete = integerValue(entry.complete, 0, entryTotal ?? 0);
    const missing = integerValue(entry.missing, 0, entryTotal ?? 0);
    const coveragePercent = typeof entry.coveragePercent === "number" && Number.isFinite(entry.coveragePercent) && entry.coveragePercent >= 0 && entry.coveragePercent <= 100 ? entry.coveragePercent : undefined;
    if (entry.requiredWidth !== requiredWidth || entryTotal === undefined || complete === undefined || missing === undefined || coveragePercent === undefined || entryTotal !== total || complete + missing !== total) return [requiredWidth, undefined];
    return [requiredWidth, { requiredWidth, total: entryTotal, complete, missing, coveragePercent }];
  });
  const validEntries = entries.filter((entry): entry is [PcieSlotWidth, CatalogPcieSlotCoverage["byRequiredWidth"][PcieSlotWidth]] => entry[1] !== undefined);
  if (validEntries.length !== PCIE_REQUIRED_WIDTHS.length) return undefined;
  return {
    total,
    ...(rawTotal !== undefined ? { rawTotal, excludedCategoryMismatchCount: excludedCategoryMismatchCount! } : {}),
    byRequiredWidth: Object.fromEntries(validEntries) as CatalogPcieSlotCoverage["byRequiredWidth"]
  };
}

function pcieSlotCoverageDeltaFromUnknown(value: unknown): CatalogPcieSlotCoverageDelta | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const rawEntries = candidate.byRequiredWidth;
  if (!rawEntries || typeof rawEntries !== "object" || Array.isArray(rawEntries)) return undefined;
  const entries: Array<[PcieSlotWidth, CatalogPcieSlotCoverageDelta["byRequiredWidth"][PcieSlotWidth] | undefined]> = PCIE_REQUIRED_WIDTHS.map((requiredWidth) => {
    const rawEntry = (rawEntries as Record<string, unknown>)[String(requiredWidth)];
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) return [requiredWidth, undefined];
    const entry = rawEntry as Record<string, unknown>;
    const complete = integerValue(entry.complete, -1_000_000, 1_000_000);
    const missing = integerValue(entry.missing, -1_000_000, 1_000_000);
    const coveragePercent = typeof entry.coveragePercent === "number" && Number.isFinite(entry.coveragePercent) && entry.coveragePercent >= -100 && entry.coveragePercent <= 100 ? entry.coveragePercent : undefined;
    if (entry.requiredWidth !== requiredWidth || complete === undefined || missing === undefined || coveragePercent === undefined) return [requiredWidth, undefined];
    return [requiredWidth, { requiredWidth, complete, missing, coveragePercent }];
  });
  const validEntries = entries.filter((entry): entry is [PcieSlotWidth, CatalogPcieSlotCoverageDelta["byRequiredWidth"][PcieSlotWidth]] => entry[1] !== undefined);
  if (validEntries.length !== PCIE_REQUIRED_WIDTHS.length) return undefined;
  return { byRequiredWidth: Object.fromEntries(validEntries) as CatalogPcieSlotCoverageDelta["byRequiredWidth"] };
}

function stringArray(value: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(value) || value.length > maxItems || !value.every((item) => typeof item === "string" && item.length > 0 && item.length <= maxLength)) return undefined;
  return [...value];
}

function categoryCoverageSummaryFromUnknown(value: unknown): CatalogSpecRefreshCategoryCoverageSummary | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const category = PART_CATEGORIES.includes(candidate.category as PartCategory) ? candidate.category as PartCategory : undefined;
  const total = integerValue(candidate.total, 0, 1_000_000);
  const complete = integerValue(candidate.complete, 0, total ?? 0);
  const partial = integerValue(candidate.partial, 0, total ?? 0);
  const incompleteCount = integerValue(candidate.incompleteCount, 0, partial ?? 0);
  const coveragePercent = typeof candidate.coveragePercent === "number" && Number.isFinite(candidate.coveragePercent) && candidate.coveragePercent >= 0 && candidate.coveragePercent <= 100 ? candidate.coveragePercent : undefined;
  if (!category || total === undefined || complete === undefined || partial === undefined || incompleteCount === undefined || coveragePercent === undefined || complete + partial !== total) return undefined;
  return { category, total, complete, partial, incompleteCount, coveragePercent };
}

function categoryCoverageDeltaFromUnknown(value: unknown): CatalogSpecRefreshCategoryCoverageDelta | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const category = PART_CATEGORIES.includes(candidate.category as PartCategory) ? candidate.category as PartCategory : undefined;
  const complete = integerValue(candidate.complete, -1_000_000, 1_000_000);
  const partial = integerValue(candidate.partial, -1_000_000, 1_000_000);
  const incompleteCount = integerValue(candidate.incompleteCount, -1_000_000, 1_000_000);
  const coveragePercent = typeof candidate.coveragePercent === "number" && Number.isFinite(candidate.coveragePercent) && candidate.coveragePercent >= -100 && candidate.coveragePercent <= 100 ? candidate.coveragePercent : undefined;
  if (!category || complete === undefined || partial === undefined || incompleteCount === undefined || coveragePercent === undefined) return undefined;
  return { category, complete, partial, incompleteCount, coveragePercent };
}

function categoryImpactFromUnknown(value: unknown): CatalogSpecRefreshCategoryImpact | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const category = PART_CATEGORIES.includes(candidate.category as PartCategory) ? candidate.category as PartCategory : undefined;
  const count = integerValue(candidate.count, 0, 1_000_000);
  if (!category || count === undefined) return undefined;
  return { category, count };
}

function impactFromUnknown(value: unknown): CatalogSpecRefreshBatchImpact | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const newlyCompletedCount = integerValue(candidate.newlyCompletedCount, 0, 12);
  const newlyResolvedFieldCount = integerValue(candidate.newlyResolvedFieldCount, 0, 384);
  const rawCategories = candidate.newlyCompletedByCategory;
  const categories = Array.isArray(rawCategories) ? rawCategories.map(categoryImpactFromUnknown) : undefined;
  if (newlyCompletedCount === undefined || newlyResolvedFieldCount === undefined || !categories || categories.some((category) => !category) || new Set(categories.map((category) => category!.category)).size !== categories.length || categories.reduce((total, category) => total + category!.count, 0) > newlyCompletedCount) return undefined;
  return { newlyCompletedCount, newlyResolvedFieldCount, newlyCompletedByCategory: categories as CatalogSpecRefreshCategoryImpact[] };
}

function pcieImpactFromUnknown(value: unknown): CatalogPcieRefreshImpact | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const newlyCompleteCount = integerValue(candidate.newlyCompleteCount, 0, 12);
  const newlyResolvedFieldCount = integerValue(candidate.newlyResolvedFieldCount, 0, 48);
  if (newlyCompleteCount === undefined || newlyResolvedFieldCount === undefined) return undefined;
  return { newlyCompleteCount, newlyResolvedFieldCount };
}

function coverageSummaryFromUnknown(value: unknown): CatalogSpecRefreshCoverageSummary | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const total = integerValue(candidate.total, 0, 1_000_000);
  const complete = integerValue(candidate.complete, 0, total ?? 0);
  const partial = integerValue(candidate.partial, 0, total ?? 0);
  const incompleteCount = integerValue(candidate.incompleteCount, 0, total ?? 0);
  const coveragePercent = typeof candidate.coveragePercent === "number" && Number.isFinite(candidate.coveragePercent) && candidate.coveragePercent >= 0 && candidate.coveragePercent <= 100 ? candidate.coveragePercent : undefined;
  const categories = candidate.categories === undefined ? undefined : Array.isArray(candidate.categories) ? candidate.categories.map(categoryCoverageSummaryFromUnknown) : undefined;
  const pcieSlotCoverage = candidate.pcieSlotCoverage === undefined ? undefined : pcieSlotCoverageFromUnknown(candidate.pcieSlotCoverage);
  if (total === undefined || complete === undefined || partial === undefined || incompleteCount === undefined || coveragePercent === undefined || complete + partial !== total || candidate.categories !== undefined && (!categories || categories.some((category) => !category) || new Set(categories.map((category) => category!.category)).size !== categories.length) || candidate.pcieSlotCoverage !== undefined && !pcieSlotCoverage) return undefined;
  if (categories) {
    const categoryTotal = categories.reduce((sum, category) => sum + category!.total, 0);
    const categoryComplete = categories.reduce((sum, category) => sum + category!.complete, 0);
    const categoryPartial = categories.reduce((sum, category) => sum + category!.partial, 0);
    const categoryIncomplete = categories.reduce((sum, category) => sum + category!.incompleteCount, 0);
    if (categoryTotal !== total || categoryComplete !== complete || categoryPartial !== partial || categoryIncomplete !== incompleteCount) return undefined;
  }
  return { total, complete, partial, incompleteCount, coveragePercent, ...(categories ? { categories: categories as CatalogSpecRefreshCategoryCoverageSummary[] } : {}), ...(pcieSlotCoverage ? { pcieSlotCoverage } : {}) };
}

function coverageDeltaFromUnknown(value: unknown): CatalogSpecRefreshCoverageDelta | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const complete = integerValue(candidate.complete, -1_000_000, 1_000_000);
  const partial = integerValue(candidate.partial, -1_000_000, 1_000_000);
  const incompleteCount = integerValue(candidate.incompleteCount, -1_000_000, 1_000_000);
  const coveragePercent = typeof candidate.coveragePercent === "number" && Number.isFinite(candidate.coveragePercent) && candidate.coveragePercent >= -100 && candidate.coveragePercent <= 100 ? candidate.coveragePercent : undefined;
  const categories = candidate.categories === undefined ? undefined : Array.isArray(candidate.categories) ? candidate.categories.map(categoryCoverageDeltaFromUnknown) : undefined;
  const pcieSlotCoverage = candidate.pcieSlotCoverage === undefined ? undefined : pcieSlotCoverageDeltaFromUnknown(candidate.pcieSlotCoverage);
  if (complete === undefined || partial === undefined || incompleteCount === undefined || coveragePercent === undefined || candidate.categories !== undefined && (!categories || categories.some((category) => !category) || new Set(categories.map((category) => category!.category)).size !== categories.length) || candidate.pcieSlotCoverage !== undefined && !pcieSlotCoverage) return undefined;
  return { complete, partial, incompleteCount, coveragePercent, ...(categories ? { categories: categories as CatalogSpecRefreshCategoryCoverageDelta[] } : {}), ...(pcieSlotCoverage ? { pcieSlotCoverage } : {}) };
}

function filtersFromUnknown(value: unknown): CatalogSpecRefreshBatchFilters | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const category = PART_CATEGORIES.includes(candidate.category as PartCategory) ? candidate.category as PartCategory : undefined;
  const priority = PRIORITIES.includes(candidate.priority as typeof PRIORITIES[number]) ? candidate.priority as typeof PRIORITIES[number] : undefined;
  const action = candidate.action === "refresh_source" || candidate.action === "review_source" || candidate.action === "inspect_catalog" ? candidate.action as CatalogSpecReviewAction : undefined;
  const evidence = candidate.evidence === "all" || candidate.evidence === "spec" || candidate.evidence === "pcie" ? candidate.evidence as CatalogSpecReviewEvidence : undefined;
  const query = candidate.query === undefined ? undefined : textValue(candidate.query, 120);
  const missingField = candidate.missingField === undefined ? undefined : textValue(candidate.missingField, 120);
  const offset = candidate.offset === undefined ? undefined : integerValue(candidate.offset, 0, 100_000);
  const limit = candidate.limit === undefined ? undefined : integerValue(candidate.limit, 1, 100);
  if (candidate.category !== undefined && !category || candidate.priority !== undefined && !priority || candidate.action !== undefined && !action || candidate.evidence !== undefined && !evidence || candidate.query !== undefined && !query || candidate.missingField !== undefined && !missingField || candidate.offset !== undefined && offset === undefined || candidate.limit !== undefined && limit === undefined) return undefined;
  return { ...(category ? { category } : {}), ...(priority ? { priority } : {}), ...(action ? { action } : {}), ...(evidence ? { evidence } : {}), ...(query ? { query } : {}), ...(missingField ? { missingField } : {}), ...(offset !== undefined ? { offset } : {}), ...(limit !== undefined ? { limit } : {}) };
}

function itemFromUnknown(value: unknown): CatalogSpecRefreshBatchItem | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const partId = textValue(candidate.partId, 160);
  const partName = textValue(candidate.partName, 240);
  const status = ITEM_STATUSES.includes(candidate.status as CatalogSpecRefreshBatchItemStatus) ? candidate.status as CatalogSpecRefreshBatchItemStatus : undefined;
  const category = PART_CATEGORIES.includes(candidate.category as PartCategory) ? candidate.category as PartCategory : undefined;
  const changedFields = candidate.changedFields === undefined ? undefined : stringArray(candidate.changedFields, 16, 120);
  const previousMissingFields = candidate.previousMissingFields === undefined ? undefined : stringArray(candidate.previousMissingFields, 32, 120);
  const nextMissingFields = candidate.nextMissingFields === undefined ? undefined : stringArray(candidate.nextMissingFields, 32, 120);
  const previousPcieMissingFields = candidate.previousPcieMissingFields === undefined ? undefined : stringArray(candidate.previousPcieMissingFields, 4, 120);
  const nextPcieMissingFields = candidate.nextPcieMissingFields === undefined ? undefined : stringArray(candidate.nextPcieMissingFields, 4, 120);
  const refreshedAt = candidate.refreshedAt === undefined ? undefined : textValue(candidate.refreshedAt, 120);
  const code = candidate.code === undefined ? undefined : textValue(candidate.code, 120);
  const error = candidate.error === undefined ? undefined : textValue(candidate.error, 500);
  const retryAfterSeconds = candidate.retryAfterSeconds === undefined ? undefined : integerValue(candidate.retryAfterSeconds, 1, 86_400);
  if (!partId || !partName || !status) return undefined;
  if (candidate.category !== undefined && !category || candidate.changedFields !== undefined && !changedFields || candidate.previousMissingFields !== undefined && !previousMissingFields || candidate.nextMissingFields !== undefined && !nextMissingFields || candidate.previousPcieMissingFields !== undefined && !previousPcieMissingFields || candidate.nextPcieMissingFields !== undefined && !nextPcieMissingFields || candidate.refreshedAt !== undefined && !refreshedAt || candidate.code !== undefined && !code || candidate.error !== undefined && !error || candidate.retryAfterSeconds !== undefined && retryAfterSeconds === undefined) return undefined;
  return {
    partId,
    partName,
    ...(category ? { category } : {}),
    status,
    ...(changedFields ? { changedFields } : {}),
    ...(previousMissingFields ? { previousMissingFields } : {}),
    ...(nextMissingFields ? { nextMissingFields } : {}),
    ...(previousPcieMissingFields ? { previousPcieMissingFields } : {}),
    ...(nextPcieMissingFields ? { nextPcieMissingFields } : {}),
    ...(refreshedAt ? { refreshedAt } : {}),
    ...(code ? { code } : {}),
    ...(error ? { error } : {}),
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {})
  };
}

export function catalogSpecRefreshHistoryEntriesFromUnknown(value: unknown): CatalogSpecRefreshHistoryEntry[] {
  if (!Array.isArray(value) || value.length > MAX_HISTORY_ENTRIES) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const candidate = entry as Record<string, unknown>;
    if (candidate.schemaVersion !== 1 || candidate.kind !== "catalog-spec-refresh-batch") return [];
    const runId = textValue(candidate.runId, 120);
    const createdAt = textValue(candidate.createdAt, 120);
    const startedAt = textValue(candidate.startedAt, 120);
    const finishedAt = textValue(candidate.finishedAt, 120);
    const filters = candidate.filters === undefined ? undefined : filtersFromUnknown(candidate.filters);
    const requestedCount = integerValue(candidate.requestedCount, 1, 12);
    const processedCount = integerValue(candidate.processedCount, 0, 12);
    const refreshedCount = integerValue(candidate.refreshedCount, 0, 12);
    const skippedCount = integerValue(candidate.skippedCount, 0, 12);
    const failedCount = integerValue(candidate.failedCount, 0, 12);
    const changedFieldCount = integerValue(candidate.changedFieldCount, 0, 192);
    const coverageBefore = candidate.coverageBefore === undefined ? undefined : coverageSummaryFromUnknown(candidate.coverageBefore);
    const coverageAfter = candidate.coverageAfter === undefined ? undefined : coverageSummaryFromUnknown(candidate.coverageAfter);
    const coverageDelta = candidate.coverageDelta === undefined ? undefined : coverageDeltaFromUnknown(candidate.coverageDelta);
    const impact = candidate.impact === undefined ? undefined : impactFromUnknown(candidate.impact);
    const pcieImpact = candidate.pcieImpact === undefined ? undefined : pcieImpactFromUnknown(candidate.pcieImpact);
    const items = Array.isArray(candidate.items) && candidate.items.length <= 12 ? candidate.items.map(itemFromUnknown) : undefined;
    if (!runId || !createdAt || !startedAt || !finishedAt || requestedCount === undefined || processedCount === undefined || refreshedCount === undefined || skippedCount === undefined || failedCount === undefined || changedFieldCount === undefined || !items || items.some((item) => !item)) return [];
    if (candidate.filters !== undefined && filters === undefined || candidate.coverageBefore !== undefined && coverageBefore === undefined || candidate.coverageAfter !== undefined && coverageAfter === undefined || candidate.coverageDelta !== undefined && coverageDelta === undefined || candidate.impact !== undefined && impact === undefined || candidate.pcieImpact !== undefined && pcieImpact === undefined) return [];
    if (processedCount !== items.length || refreshedCount + skippedCount + failedCount !== processedCount || requestedCount < processedCount) return [];
    if (impact && JSON.stringify(impact) !== JSON.stringify(catalogSpecRefreshImpactFor(items as CatalogSpecRefreshBatchItem[]))) return [];
    if (pcieImpact && JSON.stringify(pcieImpact) !== JSON.stringify(catalogPcieRefreshImpactFor(items as CatalogSpecRefreshBatchItem[]))) return [];
    if (coverageBefore && coverageAfter && coverageDelta && (coverageDelta.complete !== coverageAfter.complete - coverageBefore.complete || coverageDelta.partial !== coverageAfter.partial - coverageBefore.partial || coverageDelta.incompleteCount !== coverageAfter.incompleteCount - coverageBefore.incompleteCount || coverageDelta.coveragePercent !== Number((coverageAfter.coveragePercent - coverageBefore.coveragePercent).toFixed(1)))) return [];
    if (coverageDelta?.categories && (!coverageBefore?.categories || !coverageAfter?.categories)) return [];
    if (coverageDelta?.pcieSlotCoverage && (!coverageBefore?.pcieSlotCoverage || !coverageAfter?.pcieSlotCoverage)) return [];
    if (coverageBefore?.pcieSlotCoverage && coverageAfter?.pcieSlotCoverage && coverageDelta?.pcieSlotCoverage && JSON.stringify(coverageDelta.pcieSlotCoverage) !== JSON.stringify(catalogPcieSlotCoverageDeltaFor(coverageBefore.pcieSlotCoverage, coverageAfter.pcieSlotCoverage))) return [];
    if (coverageBefore?.categories && coverageAfter?.categories && coverageDelta?.categories) {
      const beforeByCategory = new Map(coverageBefore.categories.map((category) => [category.category, category]));
      const afterByCategory = new Map(coverageAfter.categories.map((category) => [category.category, category]));
      const deltaByCategory = new Map(coverageDelta.categories.map((category) => [category.category, category]));
      if (beforeByCategory.size !== afterByCategory.size || beforeByCategory.size !== deltaByCategory.size || [...beforeByCategory.keys()].some((category) => !afterByCategory.has(category) || !deltaByCategory.has(category))) return [];
      for (const [category, beforeCategory] of beforeByCategory) {
        const afterCategory = afterByCategory.get(category)!;
        const deltaCategory = deltaByCategory.get(category)!;
        if (deltaCategory.complete !== afterCategory.complete - beforeCategory.complete || deltaCategory.partial !== afterCategory.partial - beforeCategory.partial || deltaCategory.incompleteCount !== afterCategory.incompleteCount - beforeCategory.incompleteCount || deltaCategory.coveragePercent !== Number((afterCategory.coveragePercent - beforeCategory.coveragePercent).toFixed(1))) return [];
      }
    }
    return [{ schemaVersion: 1 as const, kind: "catalog-spec-refresh-batch" as const, runId, createdAt, startedAt, finishedAt, ...(filters ? { filters } : {}), requestedCount, processedCount, refreshedCount, skippedCount, failedCount, changedFieldCount, ...(coverageBefore ? { coverageBefore } : {}), ...(coverageAfter ? { coverageAfter } : {}), ...(coverageDelta ? { coverageDelta } : {}), ...(impact ? { impact } : {}), ...(pcieImpact ? { pcieImpact } : {}), items: items as CatalogSpecRefreshBatchItem[] }];
  }).slice(0, MAX_HISTORY_ENTRIES);
}

export function catalogSpecRefreshHistoryEntryFor(response: CatalogSpecRefreshBatchResponse, createdAt = response.finishedAt): CatalogSpecRefreshHistoryEntry {
  const { historyPersisted: _historyPersisted, ...result } = response;
  return { ...result, createdAt };
}

export async function readCatalogSpecRefreshHistory(limit = MAX_READ_ENTRIES) {
  const entries = catalogSpecRefreshHistoryEntriesFromUnknown(await readJson<unknown>(CATALOG_SPEC_REFRESH_HISTORY_PATH, []));
  const boundedLimit = Number.isFinite(limit) ? Math.min(MAX_READ_ENTRIES, Math.max(1, Math.floor(limit))) : MAX_READ_ENTRIES;
  return entries.slice(0, boundedLimit);
}

export async function appendCatalogSpecRefreshHistory(entry: CatalogSpecRefreshHistoryEntry) {
  return withSerializedFileMutation(CATALOG_SPEC_REFRESH_HISTORY_PATH, async () => {
    const entries = catalogSpecRefreshHistoryEntriesFromUnknown(await readJson<unknown>(CATALOG_SPEC_REFRESH_HISTORY_PATH, []));
    const next = [entry, ...entries.filter((candidate) => candidate.runId !== entry.runId)].slice(0, MAX_HISTORY_ENTRIES);
    await writeJson(CATALOG_SPEC_REFRESH_HISTORY_PATH, next);
    return entry;
  });
}

export function newCatalogSpecRefreshRunId() {
  return randomUUID();
}
