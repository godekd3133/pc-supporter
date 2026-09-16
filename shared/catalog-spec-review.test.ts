import { describe, expect, it } from "vitest";
import type { CatalogPcieSlotCoverage } from "./catalog-spec-coverage";
import type { Part } from "./types";
import { catalogPcieRefreshImpactFor, catalogSpecRefreshCoverageDeltaFor, catalogSpecRefreshCoverageSummaryFor, catalogSpecRefreshImpactFor, catalogSpecRefreshProgressSummaryFor, catalogSpecReviewQueueFor, catalogSpecReviewWorkPackageFor } from "./catalog-spec-review";
import type { CatalogSpecRefreshHistoryEntry } from "./catalog-spec-review";

function part(overrides: Partial<Part>): Part {
  return {
    id: "part-default",
    category: "cpu",
    name: "기본 부품",
    source: "danawa",
    sourceProductCode: "default",
    danawaUrl: "https://example.com/default",
    specs: {},
    dataQuality: "incomplete",
    missingFields: ["socket"],
    updatedAt: "2026-08-20T00:00:00.000Z",
    ...overrides
  };
}

describe("catalog spec review queue", () => {
  it("prioritizes high-impact fields in categories with broad gaps", () => {
    const catalog = [
      ...Array.from({ length: 10 }, (_, index) => part({ id: `cpu-complete-${index}`, category: "cpu", name: `완전 CPU ${index}`, dataQuality: "live", missingFields: [], specs: { socket: "AM5" } })),
      part({ id: "cpu-review", category: "cpu", name: "CPU 보강", missingFields: ["tdpW"], specs: { socket: "AM5" } }),
      part({ id: "gpu-review", category: "gpu", name: "GPU 보강", missingFields: ["powerW"], specs: { vramGb: 24 } })
    ];

    const queue = catalogSpecReviewQueueFor(catalog, { now: "2026-09-01T00:00:00.000Z", limit: 10 });

    expect(queue.items.map((item) => item.partId)).toEqual(["gpu-review", "cpu-review"]);
    expect(queue.items[0]).toMatchObject({ priority: "high", nextAction: "refresh_source", freshness: "aging" });
    expect(queue.items[0].focusFields[0]).toMatchObject({ field: "powerW", label: "소비전력" });
    expect(queue.items[0].catalogUrl).toContain("partId=gpu-review");
  });

  it("supports category, query, missing-field, priority, and page filters", () => {
    const catalog = [
      part({ id: "ssd-capacity", category: "ssd", name: "SSD 용량", missingFields: ["capacityGb"], specs: {}, source: "manual", danawaUrl: undefined, sourceProductCode: undefined }),
      part({ id: "ssd-interface", category: "ssd", name: "SSD 인터페이스", missingFields: ["interface"], specs: {} }),
      part({ id: "case-gpu", category: "case", name: "케이스 GPU", missingFields: ["maxGpuLengthMm"], specs: {} })
    ];

    const filtered = catalogSpecReviewQueueFor(catalog, { category: "ssd", query: "인터페이스", missingField: "interface", now: "2026-09-01T00:00:00.000Z" });
    expect(filtered.total).toBe(1);
    expect(filtered.queueTotal).toBe(1);
    expect(filtered.items[0]).toMatchObject({ partId: "ssd-interface", nextAction: "refresh_source" });

    const page = catalogSpecReviewQueueFor(catalog, { category: "ssd", offset: 1, limit: 1, now: "2026-09-01T00:00:00.000Z" });
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);
    expect(page.items[0].partId).toBe("ssd-capacity");
  });

  it("routes PCIe-only gaps into the evidence queue without changing generic missing fields", () => {
    const catalog = [
      part({ id: "board-pcie-gap", category: "motherboard", name: "PCIe 정보 부족 보드", dataQuality: "live", missingFields: [], specs: { pcieX16Slots: 1 } }),
      part({ id: "board-pcie-complete", category: "motherboard", name: "PCIe 정보 확인 보드", dataQuality: "live", missingFields: [], specs: { pcieX16Slots: 1, pcieX8Slots: 0, pcieX4Slots: 0, pcieX1Slots: 2 } })
    ];

    const pcieQueue = catalogSpecReviewWorkPackageFor(catalog, { category: "motherboard", evidence: "pcie", limit: 10, now: "2026-09-01T00:00:00.000Z" });
    const genericQueue = catalogSpecReviewWorkPackageFor(catalog, { category: "motherboard", evidence: "spec", limit: 10, now: "2026-09-01T00:00:00.000Z" });

    expect(pcieQueue).toMatchObject({ evidence: "pcie", summary: { total: 1, queueTotal: 1, includedCount: 1 } });
    expect(pcieQueue.items[0]).toMatchObject({ partId: "board-pcie-gap", missingFields: [], pcieMissingFields: ["pcieX8Slots", "pcieX4Slots", "pcieX1Slots"], evidenceKind: "pcie", nextAction: "refresh_source" });
    expect(pcieQueue.items[0].focusFields.map((field) => field.field)).toEqual(["pcieX8Slots", "pcieX4Slots", "pcieX1Slots"]);
    expect(pcieQueue.fields.map((field) => field.field)).toEqual(["pcieX16Slots", "pcieX8Slots", "pcieX4Slots", "pcieX1Slots"]);
    expect(genericQueue.fields.every((field) => !field.field.startsWith("pcieX"))).toBe(true);
    expect(genericQueue.items).toHaveLength(0);

    const allQueue = catalogSpecReviewQueueFor(catalog, { category: "motherboard", limit: 10, now: "2026-09-01T00:00:00.000Z" });
    expect(allQueue.items.map((item) => item.partId)).toEqual(["board-pcie-gap"]);
  });

  it("separates automatic source refresh work from manual catalog inspection", () => {
    const catalog = [
      part({ id: "danawa-source", source: "danawa", sourceProductCode: "source-1", danawaUrl: "https://example.com/source", missingFields: ["socket"] }),
      part({ id: "manual-inspection", source: "manual", sourceProductCode: undefined, danawaUrl: undefined, missingFields: ["socket"] })
    ];

    const refreshOnly = catalogSpecReviewWorkPackageFor(catalog, { category: "cpu", action: "refresh_source", now: "2026-09-01T00:00:00.000Z" });
    const inspectOnly = catalogSpecReviewWorkPackageFor(catalog, { category: "cpu", action: "inspect_catalog", now: "2026-09-01T00:00:00.000Z" });

    expect(refreshOnly.action).toBe("refresh_source");
    expect(refreshOnly.items).toHaveLength(1);
    expect(refreshOnly.items[0].nextAction).toBe("refresh_source");
    expect(inspectOnly.items).toHaveLength(1);
    expect(inspectOnly.items[0].nextAction).toBe("inspect_catalog");
    expect(refreshOnly.queueFingerprint).not.toBe(inspectOnly.queueFingerprint);
  });

  it("moves repeatedly failed source checks to manual review instead of retrying forever", () => {
    const failedHistory: CatalogSpecRefreshHistoryEntry[] = Array.from({ length: 3 }, (_, index) => ({
      schemaVersion: 1,
      kind: "catalog-spec-refresh-batch",
      runId: `failed-run-${index}`,
      createdAt: `2026-09-0${index + 1}T00:01:00.000Z`,
      startedAt: `2026-09-0${index + 1}T00:00:00.000Z`,
      finishedAt: `2026-09-0${index + 1}T00:01:00.000Z`,
      requestedCount: 1,
      processedCount: 1,
      refreshedCount: 0,
      skippedCount: 0,
      failedCount: 1,
      changedFieldCount: 0,
      items: [{ partId: "failed-source", partName: "실패 CPU", category: "cpu", status: "failed", code: "PART_REFRESH_FAILED", error: "원문 접근 실패" }]
    }));
    const candidate = part({ id: "failed-source", category: "cpu", source: "danawa", sourceProductCode: "failed-source-code", danawaUrl: "https://example.com/failed-source" });
    const retryable = catalogSpecReviewQueueFor([candidate], { category: "cpu", refreshHistory: failedHistory.slice(0, 1), now: "2026-09-04T00:00:00.000Z" });
    const repeated = catalogSpecReviewQueueFor([candidate], { category: "cpu", refreshHistory: failedHistory, now: "2026-09-04T00:00:00.000Z" });
    const recovered = catalogSpecReviewQueueFor([candidate], {
      category: "cpu",
      refreshHistory: [...failedHistory, {
        ...failedHistory[2],
        runId: "recovered-run",
        createdAt: "2026-09-04T00:01:00.000Z",
        startedAt: "2026-09-04T00:00:00.000Z",
        finishedAt: "2026-09-04T00:01:00.000Z",
        refreshedCount: 1,
        failedCount: 0,
        items: [{ partId: "failed-source", partName: "복구 CPU", category: "cpu", status: "refreshed", previousMissingFields: ["socket"], nextMissingFields: ["socket"] }]
      }],
      now: "2026-09-04T00:02:00.000Z"
    });

    expect(retryable.items[0]).toMatchObject({ nextAction: "refresh_source", refreshAttemptCount: 1, refreshFailureCount: 1, refreshFailureStreakCount: 1, refreshOutcome: "retryable_failure" });
    expect(repeated.items[0]).toMatchObject({ nextAction: "review_source", nextActionLabel: "반복 실패 · 직접 확인", refreshAttemptCount: 3, refreshFailureCount: 3, refreshFailureStreakCount: 3, refreshOutcome: "repeated_failure" });
    expect(repeated.items[0].reviewReason).toContain("직접 확인 전환");
    expect(recovered.items[0]).toMatchObject({ nextAction: "refresh_source", refreshAttemptCount: 4, refreshFailureCount: 3, refreshFailureStreakCount: 0, refreshOutcome: "succeeded" });
  });

  it("calculates explicit coverage progress without treating incomplete data as complete", () => {
    const before = catalogSpecRefreshCoverageSummaryFor([
      part({ id: "complete", dataQuality: "live", missingFields: [], specs: { socket: "AM5", tdpW: 65 } }),
      part({ id: "partial", dataQuality: "incomplete", missingFields: ["tdpW"] })
    ], "2026-09-03T00:00:00.000Z");
    const after = catalogSpecRefreshCoverageSummaryFor([
      part({ id: "complete", dataQuality: "live", missingFields: [], specs: { socket: "AM5", tdpW: 65 } }),
      part({ id: "partial", dataQuality: "live", missingFields: [], specs: { socket: "AM5", tdpW: 65 } })
    ], "2026-09-03T00:00:00.000Z");

    expect(before).toMatchObject({ total: 2, complete: 1, partial: 1, incompleteCount: 1, coveragePercent: 50 });
    expect(after).toMatchObject({ total: 2, complete: 2, partial: 0, incompleteCount: 0, coveragePercent: 100 });
    expect(before.categories).toEqual(expect.arrayContaining([{ category: "cpu", total: 2, complete: 1, partial: 1, incompleteCount: 1, coveragePercent: 50 }]));
    expect(after.categories).toEqual(expect.arrayContaining([{ category: "cpu", total: 2, complete: 2, partial: 0, incompleteCount: 0, coveragePercent: 100 }]));
    expect(catalogSpecRefreshCoverageDeltaFor(before, after)).toMatchObject({ complete: 1, partial: -1, incompleteCount: -1, coveragePercent: 50, categories: expect.arrayContaining([{ category: "cpu", complete: 1, partial: -1, incompleteCount: -1, coveragePercent: 50 }]) });
  });

  it("tracks PCIe evidence fields separately from generic completeness impact", () => {
    expect(catalogPcieRefreshImpactFor([
      { partId: "board", partName: "보드", category: "motherboard", status: "refreshed", previousPcieMissingFields: ["pcieX4Slots", "pcieX1Slots"], nextPcieMissingFields: [] },
      { partId: "cpu", partName: "CPU", category: "cpu", status: "refreshed", previousMissingFields: ["tdpW"], nextMissingFields: [] }
    ])).toEqual({ newlyCompleteCount: 1, newlyResolvedFieldCount: 2 });
  });

  it("summarizes cumulative PCIe evidence progress separately from generic fields", () => {
    const pcieCoverage = (complete: number): CatalogPcieSlotCoverage => ({
      total: 1,
      byRequiredWidth: {
        16: { requiredWidth: 16, total: 1, complete, missing: 1 - complete, coveragePercent: complete * 100 },
        8: { requiredWidth: 8, total: 1, complete, missing: 1 - complete, coveragePercent: complete * 100 },
        4: { requiredWidth: 4, total: 1, complete, missing: 1 - complete, coveragePercent: complete * 100 },
        1: { requiredWidth: 1, total: 1, complete, missing: 1 - complete, coveragePercent: complete * 100 }
      }
    });
    const coverageBefore = { total: 1, complete: 0, partial: 1, incompleteCount: 1, coveragePercent: 0, pcieSlotCoverage: pcieCoverage(0) };
    const coverageAfter = { total: 1, complete: 0, partial: 1, incompleteCount: 1, coveragePercent: 0, pcieSlotCoverage: pcieCoverage(1) };
    const history: CatalogSpecRefreshHistoryEntry[] = [
      {
        schemaVersion: 1,
        kind: "catalog-spec-refresh-batch",
        runId: "pcie-old",
        createdAt: "2026-09-03T01:00:00.000Z",
        startedAt: "2026-09-03T00:59:00.000Z",
        finishedAt: "2026-09-03T01:00:00.000Z",
        requestedCount: 1,
        processedCount: 1,
        refreshedCount: 1,
        skippedCount: 0,
        failedCount: 0,
        changedFieldCount: 1,
        coverageBefore,
        coverageAfter,
        pcieImpact: { newlyCompleteCount: 0, newlyResolvedFieldCount: 1 },
        items: [{ partId: "board-old", partName: "PCIe 이전 보드", category: "motherboard", status: "refreshed", previousPcieMissingFields: ["pcieX4Slots", "pcieX1Slots"], nextPcieMissingFields: ["pcieX1Slots"] }]
      },
      {
        schemaVersion: 1,
        kind: "catalog-spec-refresh-batch",
        runId: "pcie-new",
        createdAt: "2026-09-03T02:00:00.000Z",
        startedAt: "2026-09-03T01:59:00.000Z",
        finishedAt: "2026-09-03T02:00:00.000Z",
        requestedCount: 1,
        processedCount: 1,
        refreshedCount: 1,
        skippedCount: 0,
        failedCount: 0,
        changedFieldCount: 1,
        coverageBefore: coverageAfter,
        coverageAfter,
        pcieImpact: { newlyCompleteCount: 1, newlyResolvedFieldCount: 1 },
        items: [{ partId: "board-new", partName: "PCIe 최신 보드", category: "motherboard", status: "refreshed", previousPcieMissingFields: ["pcieX1Slots"], nextPcieMissingFields: [] }]
      }
    ];

    const progress = catalogSpecRefreshProgressSummaryFor(history);

    expect(progress).toMatchObject({
      pcieNewlyCompleteCount: 1,
      pcieResolvedFieldCount: 2,
      latestCoverageAfter: { pcieSlotCoverage: { byRequiredWidth: { 4: { coveragePercent: 100 } } } },
      coverageDelta: { pcieSlotCoverage: { byRequiredWidth: { 4: { complete: 1, missing: -1, coveragePercent: 100 } } } },
      pcieFieldProgress: expect.arrayContaining([
        { field: "pcieX4Slots", observed: 1, resolved: 1, remaining: 0, successPercent: 100 },
        { field: "pcieX1Slots", observed: 2, resolved: 1, remaining: 1, successPercent: 50 }
      ])
    });
  });

  it("summarizes cumulative refresh progress from recorded coverage snapshots", () => {
    const history: CatalogSpecRefreshHistoryEntry[] = [
      {
        schemaVersion: 1,
        kind: "catalog-spec-refresh-batch",
        runId: "run-new",
        createdAt: "2026-09-03T02:00:00.000Z",
        startedAt: "2026-09-03T01:59:00.000Z",
        finishedAt: "2026-09-03T02:00:00.000Z",
        requestedCount: 2,
        processedCount: 2,
        refreshedCount: 1,
        skippedCount: 1,
        failedCount: 0,
        changedFieldCount: 1,
        coverageBefore: { total: 10, complete: 6, partial: 4, incompleteCount: 4, coveragePercent: 60 },
        coverageAfter: { total: 10, complete: 7, partial: 3, incompleteCount: 3, coveragePercent: 70 },
        coverageDelta: { complete: 1, partial: -1, incompleteCount: -1, coveragePercent: 10 },
        impact: { newlyCompletedCount: 1, newlyResolvedFieldCount: 2, newlyCompletedByCategory: [{ category: "cpu", count: 1 }] },
        items: [
          { partId: "cpu-new", partName: "CPU 새 항목", category: "cpu", status: "refreshed", previousMissingFields: ["socket", "memoryType"], nextMissingFields: [] },
          { partId: "cpu-skipped", partName: "CPU 건너뜀", category: "cpu", status: "skipped", code: "PART_REFRESH_COOLDOWN" }
        ]
      },
      {
        schemaVersion: 1,
        kind: "catalog-spec-refresh-batch",
        runId: "run-old",
        createdAt: "2026-09-02T02:00:00.000Z",
        startedAt: "2026-09-02T01:59:00.000Z",
        finishedAt: "2026-09-02T02:00:00.000Z",
        requestedCount: 3,
        processedCount: 3,
        refreshedCount: 2,
        skippedCount: 0,
        failedCount: 1,
        changedFieldCount: 2,
        coverageBefore: { total: 10, complete: 4, partial: 6, incompleteCount: 6, coveragePercent: 40 },
        coverageAfter: { total: 10, complete: 6, partial: 4, incompleteCount: 4, coveragePercent: 60 },
        coverageDelta: { complete: 2, partial: -2, incompleteCount: -2, coveragePercent: 20 },
        impact: { newlyCompletedCount: 0, newlyResolvedFieldCount: 1, newlyCompletedByCategory: [] },
        items: [
          { partId: "cpu-old", partName: "CPU 이전 항목", category: "cpu", status: "refreshed", previousMissingFields: ["tdpW", "socket"], nextMissingFields: ["socket"] },
          { partId: "gpu-failed", partName: "GPU 실패 항목", category: "gpu", status: "failed", error: "원문 확인 실패" },
          { partId: "cpu-old-skipped", partName: "CPU 이전 건너뜀", category: "cpu", status: "skipped", code: "PART_REFRESH_COOLDOWN" }
        ]
      }
    ];

    expect(catalogSpecRefreshImpactFor(history[0].items)).toEqual(history[0].impact);
    expect(catalogSpecRefreshProgressSummaryFor(history)).toMatchObject({
      runCount: 2,
      coverageRunCount: 2,
      totalRefreshedCount: 3,
      totalSkippedCount: 1,
      totalFailedCount: 1,
      firstCoverageBefore: { coveragePercent: 40, incompleteCount: 6 },
      latestCoverageAfter: { coveragePercent: 70, incompleteCount: 3 },
      coverageDelta: { complete: 3, incompleteCount: -3, coveragePercent: 30 },
      newlyCompletedCount: 1,
      completedByCategory: [{ category: "cpu", count: 1 }],
      resolvedFieldCount: 3,
      fieldProgress: expect.arrayContaining([
        { field: "memoryType", observed: 1, resolved: 1, remaining: 0, successPercent: 100 },
        { field: "tdpW", observed: 1, resolved: 1, remaining: 0, successPercent: 100 }
      ]),
      categoryProgress: expect.arrayContaining([
        { category: "cpu", attempted: 2, succeeded: 2, failed: 0, skipped: 2, successPercent: 100 },
        { category: "gpu", attempted: 1, succeeded: 0, failed: 1, skipped: 0, successPercent: 0 }
      ]),
      points: [
        { runId: "run-old", coveragePercent: 60 },
        { runId: "run-new", coveragePercent: 70 }
      ]
    });
  });

  it("includes unnamed incomplete records and creates a resumable package", () => {
    const catalog = [part({ id: "unnamed", name: "누락 필드 미기록", missingFields: [], dataQuality: "incomplete", source: "seed", danawaUrl: undefined, sourceProductCode: undefined })];

    const packageData = catalogSpecReviewWorkPackageFor(catalog, { category: "cpu", limit: 1, now: "2026-09-01T00:00:00.000Z" });

    expect(packageData).toMatchObject({ schemaVersion: 1, kind: "catalog-spec-review-package", offset: 0, limit: 1, summary: { total: 1, queueTotal: 1, includedCount: 1, remainingCount: 0, highCount: 0, mediumCount: 1, lowCount: 0 } });
    expect(packageData.items[0]).toMatchObject({ partId: "unnamed", nextAction: "inspect_catalog", missingFields: [], focusFields: [] });
    expect(packageData.fields.some((field) => field.field === "socket" && field.category === "cpu")).toBe(true);
    expect(packageData.nextOffset).toBeUndefined();
  });

  it("exposes the next offset when the current package is partial", () => {
    const catalog = [
      part({ id: "one", missingFields: ["socket"] }),
      part({ id: "two", missingFields: ["tdpW"] })
    ];

    const packageData = catalogSpecReviewWorkPackageFor(catalog, { category: "cpu", limit: 1, now: "2026-09-01T00:00:00.000Z" });

    expect(packageData.nextOffset).toBe(1);
    expect(packageData.summary.remainingCount).toBe(1);
  });

  it("keeps the queue fingerprint stable across pages and changes it when queue evidence changes", () => {
    const catalog = [
      part({ id: "one", missingFields: ["socket"] }),
      part({ id: "two", missingFields: ["tdpW"] })
    ];
    const firstPage = catalogSpecReviewWorkPackageFor(catalog, { category: "cpu", limit: 1, now: "2026-09-01T00:00:00.000Z" });
    const secondPage = catalogSpecReviewWorkPackageFor(catalog, { category: "cpu", offset: 1, limit: 1, now: "2026-09-01T00:00:00.000Z" });
    const changedQueue = catalogSpecReviewWorkPackageFor([
      ...catalog.slice(0, 1),
      part({ id: "two", missingFields: ["socket", "tdpW"] })
    ], { category: "cpu", limit: 1, now: "2026-09-01T00:00:00.000Z" });

    expect(firstPage.queueFingerprint).toBe(secondPage.queueFingerprint);
    expect(changedQueue.queueFingerprint).not.toBe(firstPage.queueFingerprint);
  });
});
