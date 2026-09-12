import { describe, expect, it } from "vitest";
import type { CatalogPcieSlotCoverage, CatalogPcieSlotCoverageDelta } from "../shared/catalog-spec-coverage";
import type { CatalogSpecRefreshBatchResponse } from "../shared/catalog-spec-review";
import { catalogSpecRefreshHistoryEntriesFromUnknown, catalogSpecRefreshHistoryEntryFor, newCatalogSpecRefreshRunId } from "./catalog-spec-refresh-history";

const response: CatalogSpecRefreshBatchResponse = {
  schemaVersion: 1,
  kind: "catalog-spec-refresh-batch",
  runId: "run-1",
  startedAt: "2026-09-03T00:00:00.000Z",
  finishedAt: "2026-09-03T00:01:00.000Z",
  filters: { category: "gpu", priority: "high", offset: 0, limit: 12 },
  historyPersisted: true,
  requestedCount: 1,
  processedCount: 1,
  refreshedCount: 1,
  skippedCount: 0,
  failedCount: 0,
  changedFieldCount: 2,
  items: [{ partId: "gpu-1", partName: "검수 GPU", category: "gpu", status: "refreshed", changedFields: ["정규화 스펙", "누락 필드"], previousMissingFields: ["powerW"], nextMissingFields: [], refreshedAt: "2026-09-03T00:01:00.000Z" }]
};

describe("catalog spec refresh history", () => {
  it("creates a history entry without the transient persistence flag", () => {
    const entry = catalogSpecRefreshHistoryEntryFor(response, "2026-09-03T00:02:00.000Z");

    expect(entry).toEqual({ ...response, historyPersisted: undefined, createdAt: "2026-09-03T00:02:00.000Z" });
    expect(entry).not.toHaveProperty("historyPersisted");
  });

  it("accepts valid entries and rejects count or shape mismatches", () => {
    expect(catalogSpecRefreshHistoryEntriesFromUnknown([{ ...response, historyPersisted: false, createdAt: response.finishedAt }])).toHaveLength(1);
    expect(catalogSpecRefreshHistoryEntriesFromUnknown([{ ...response, createdAt: response.finishedAt, processedCount: 2 }])).toEqual([]);
    expect(catalogSpecRefreshHistoryEntriesFromUnknown([{ ...response, createdAt: response.finishedAt, items: [{ ...response.items[0], status: "unknown" }] }])).toEqual([]);
    expect(catalogSpecRefreshHistoryEntriesFromUnknown([{ ...response, createdAt: response.finishedAt, filters: { category: "not-a-category" } }])).toEqual([]);
  });

  it("generates unique UUID run identifiers", () => {
    const first = newCatalogSpecRefreshRunId();
    const second = newCatalogSpecRefreshRunId();
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toMatch(/^[0-9a-f-]{36}$/);
    expect(first).not.toBe(second);
  });

  it("rejects an oversized raw history before normalizing every run", () => {
    const oversized = Array.from({ length: 101 }, (_, index) => ({ ...response, runId: `run-${index}`, createdAt: response.finishedAt }));
    expect(catalogSpecRefreshHistoryEntriesFromUnknown(oversized)).toEqual([]);
  });

  it("round-trips optional coverage progress and rejects malformed summaries", () => {
    const withCoverage = {
      ...response,
      coverageBefore: { total: 10, complete: 6, partial: 4, incompleteCount: 4, coveragePercent: 60, categories: [{ category: "cpu" as const, total: 10, complete: 6, partial: 4, incompleteCount: 4, coveragePercent: 60 }] },
      coverageAfter: { total: 10, complete: 7, partial: 3, incompleteCount: 3, coveragePercent: 70, categories: [{ category: "cpu" as const, total: 10, complete: 7, partial: 3, incompleteCount: 3, coveragePercent: 70 }] },
      coverageDelta: { complete: 1, partial: -1, incompleteCount: -1, coveragePercent: 10, categories: [{ category: "cpu" as const, complete: 1, partial: -1, incompleteCount: -1, coveragePercent: 10 }] },
      impact: { newlyCompletedCount: 1, newlyResolvedFieldCount: 1, newlyCompletedByCategory: [{ category: "gpu" as const, count: 1 }] }
    };
    const entry = catalogSpecRefreshHistoryEntryFor(withCoverage, "2026-09-03T00:02:00.000Z");
    const parsed = catalogSpecRefreshHistoryEntriesFromUnknown([entry]);

    expect(parsed[0]).toMatchObject({ coverageBefore: withCoverage.coverageBefore, coverageAfter: withCoverage.coverageAfter, coverageDelta: withCoverage.coverageDelta });
    expect(catalogSpecRefreshHistoryEntriesFromUnknown([{ ...entry, coverageBefore: { ...withCoverage.coverageBefore, complete: 9 } }])).toEqual([]);
    expect(catalogSpecRefreshHistoryEntriesFromUnknown([{ ...entry, coverageDelta: { ...withCoverage.coverageDelta, coveragePercent: 101 } }])).toEqual([]);
    expect(catalogSpecRefreshHistoryEntriesFromUnknown([{ ...entry, coverageDelta: { ...withCoverage.coverageDelta, complete: 2 } }])).toEqual([]);
    expect(catalogSpecRefreshHistoryEntriesFromUnknown([{ ...entry, impact: { ...withCoverage.impact, newlyCompletedCount: 0 } }])).toEqual([]);
  });

  it("round-trips PCIe evidence filters, impact, and coverage deltas", () => {
    const pcieBefore: CatalogPcieSlotCoverage = {
      total: 1,
      rawTotal: 2,
      excludedCategoryMismatchCount: 1,
      byRequiredWidth: {
        16: { requiredWidth: 16, total: 1, complete: 0, missing: 1, coveragePercent: 0 },
        8: { requiredWidth: 8, total: 1, complete: 0, missing: 1, coveragePercent: 0 },
        4: { requiredWidth: 4, total: 1, complete: 0, missing: 1, coveragePercent: 0 },
        1: { requiredWidth: 1, total: 1, complete: 0, missing: 1, coveragePercent: 0 }
      }
    };
    const pcieAfter: CatalogPcieSlotCoverage = {
      total: 1,
      rawTotal: 2,
      excludedCategoryMismatchCount: 1,
      byRequiredWidth: {
        16: { requiredWidth: 16, total: 1, complete: 1, missing: 0, coveragePercent: 100 },
        8: { requiredWidth: 8, total: 1, complete: 1, missing: 0, coveragePercent: 100 },
        4: { requiredWidth: 4, total: 1, complete: 1, missing: 0, coveragePercent: 100 },
        1: { requiredWidth: 1, total: 1, complete: 1, missing: 0, coveragePercent: 100 }
      }
    };
    const pcieDelta: CatalogPcieSlotCoverageDelta = {
      byRequiredWidth: {
        16: { requiredWidth: 16, complete: 1, missing: -1, coveragePercent: 100 },
        8: { requiredWidth: 8, complete: 1, missing: -1, coveragePercent: 100 },
        4: { requiredWidth: 4, complete: 1, missing: -1, coveragePercent: 100 },
        1: { requiredWidth: 1, complete: 1, missing: -1, coveragePercent: 100 }
      }
    };
    const withPcie: CatalogSpecRefreshBatchResponse = {
      ...response,
      filters: { category: "motherboard", evidence: "pcie", offset: 0, limit: 1 },
      changedFieldCount: 4,
      coverageBefore: { total: 1, complete: 0, partial: 1, incompleteCount: 1, coveragePercent: 0, pcieSlotCoverage: pcieBefore },
      coverageAfter: { total: 1, complete: 1, partial: 0, incompleteCount: 0, coveragePercent: 100, pcieSlotCoverage: pcieAfter },
      coverageDelta: { complete: 1, partial: -1, incompleteCount: -1, coveragePercent: 100, pcieSlotCoverage: pcieDelta },
      pcieImpact: { newlyCompleteCount: 1, newlyResolvedFieldCount: 4 },
      items: [{ partId: "board-1", partName: "PCIe 검수 보드", category: "motherboard", status: "refreshed", changedFields: ["PCIe 슬롯"], previousPcieMissingFields: ["pcieX16Slots", "pcieX8Slots", "pcieX4Slots", "pcieX1Slots"], nextPcieMissingFields: [], refreshedAt: "2026-09-03T00:01:00.000Z" }]
    };

    const entry = catalogSpecRefreshHistoryEntryFor(withPcie, "2026-09-03T00:02:00.000Z");
    const parsed = catalogSpecRefreshHistoryEntriesFromUnknown([entry]);

    expect(parsed[0]).toMatchObject({ filters: { category: "motherboard", evidence: "pcie" }, pcieImpact: withPcie.pcieImpact, coverageBefore: withPcie.coverageBefore, coverageAfter: withPcie.coverageAfter, coverageDelta: withPcie.coverageDelta, items: [{ previousPcieMissingFields: withPcie.items[0].previousPcieMissingFields, nextPcieMissingFields: [] }] });
    expect(parsed[0]?.coverageBefore?.pcieSlotCoverage).toMatchObject({ total: 1, rawTotal: 2, excludedCategoryMismatchCount: 1 });
    expect(catalogSpecRefreshHistoryEntriesFromUnknown([{ ...entry, pcieImpact: { newlyCompleteCount: 0, newlyResolvedFieldCount: 4 } }])).toEqual([]);
    expect(catalogSpecRefreshHistoryEntriesFromUnknown([{ ...entry, coverageDelta: { ...entry.coverageDelta, pcieSlotCoverage: { ...pcieDelta, byRequiredWidth: { ...pcieDelta.byRequiredWidth, 4: { ...pcieDelta.byRequiredWidth[4], missing: 0 } } } } }])).toEqual([]);
    expect(catalogSpecRefreshHistoryEntriesFromUnknown([{ ...entry, coverageBefore: { ...entry.coverageBefore, pcieSlotCoverage: { ...pcieBefore, excludedCategoryMismatchCount: 0 } } }])).toEqual([]);
  });
});
