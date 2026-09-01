import { describe, expect, it } from "vitest";
import { budgetLadderShareExpired, parseBudgetLadderShareInput, publicBudgetLadderShare, savedBudgetLadderFromUnknown } from "./budget-ladder-share";
import { budgetLadderDerivedSnapshotNameFor, budgetLadderShareLineageEntryFor } from "../shared/budget-ladder-share";

const item = (id: "economy" | "target" | "headroom", budgetWon: number, overrides: Record<string, unknown> = {}) => ({
  id,
  label: "사용자 지정 라벨",
  description: "사용자 지정 설명",
  budgetWon,
  status: "호환 가능",
  totalPriceWon: budgetWon - 100_000,
  budgetDeltaWon: -100_000,
  withinBudget: true,
  priceComplete: true,
  blockerCount: 0,
  warningCount: 0,
  unknownCount: 0,
  analysisScore: 70,
  lines: [{ category: "cpu", text: `${id} CPU` }],
  selection: { cpu: { partId: `${id}-cpu`, quantity: 1 }, memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: false },
  ...overrides
});

const payload = {
  type: "pc-supporter-budget-ladder",
  version: 1,
  exportedAt: "2026-09-01T00:00:00.000Z",
  items: [item("economy", 800_000), item("target", 1_000_000), item("headroom", 1_200_000)],
  changes: [{
    fromId: "economy",
    toId: "target",
    fromLabel: "사용자 지정 시작",
    toLabel: "사용자 지정 도착",
    budgetDeltaWon: 200_000,
    totalPriceDeltaWon: 200_000,
    blockerDelta: 0,
    warningDelta: 0,
    unknownDelta: 0,
    sameConfiguration: false,
    changedLines: [{ category: "cpu", label: "사용자 지정 CPU", before: "이전", after: "이후" }]
  }]
};

const request = {
  profile: "gaming",
  budgetWon: 1_000_000,
  includeGpu: true,
  priority: "performance",
  gamingResolution: "1440p",
  gamingRefreshRate: 240,
  memoryCapacityGb: 32,
  storageCapacityGb: 1000,
  hddCount: 0,
  listingPolicy: "retail_only"
};

describe("budget ladder share", () => {
  it("keeps the derived snapshot name prefix idempotent", () => {
    expect(budgetLadderDerivedSnapshotNameFor("원본 비교")).toBe("현재 기준 · 원본 비교");
    expect(budgetLadderDerivedSnapshotNameFor("현재 기준 · 원본 비교")).toBe("현재 기준 · 원본 비교");
    expect(budgetLadderDerivedSnapshotNameFor("현재 기준 · 현재 기준 · 원본 비교")).toBe("현재 기준 · 원본 비교");
  });

  it("normalizes a bounded snapshot and replaces user labels with canonical bands", () => {
    const parsed = parseBudgetLadderShareInput({ name: "  QHD 예산 비교  ", payload, request, parentId: "parent-share-1", expiresInDays: 30 });

    expect(parsed.errors).toEqual([]);
    expect(parsed.name).toBe("QHD 예산 비교");
    expect(parsed.payload?.items.map((entry) => [entry.id, entry.label, entry.description])).toEqual([
      ["economy", "절약형", "입력 예산의 약 80%로 구성"],
      ["target", "목표 예산", "입력한 목표 예산 그대로"],
      ["headroom", "여유형", "입력 예산의 약 120%로 구성"]
    ]);
    expect(parsed.payload?.changes[0]).toMatchObject({ fromLabel: "절약형", toLabel: "목표 예산" });
    expect(parsed.payload?.items[0].selection).toMatchObject({ cpu: { partId: "economy-cpu", quantity: 1 }, useIntegratedGraphics: false });
    expect(parsed.request).toMatchObject({ profile: "gaming", priority: "performance", gamingRefreshRate: 240 });
    expect(parsed.parentId).toBe("parent-share-1");
    expect(parsed.expiresInDays).toBe(30);

    const legacyRequest = parseBudgetLadderShareInput({ payload, request: { ...request, budgetWon: 800_000 } });
    expect(legacyRequest.request?.budgetWon).toBe(1_000_000);
  });

  it("rejects incomplete success items and non-adjacent or malformed diffs", () => {
    expect(parseBudgetLadderShareInput({ payload: { ...payload, items: [item("economy", 800_000, { totalPriceWon: undefined }), item("target", 1_000_000), item("headroom", 1_200_000)] } }).errors[0]).toContain("성공 결과에 예상 합계");
    expect(parseBudgetLadderShareInput({ payload: { ...payload, changes: [{ ...payload.changes[0], fromId: "economy", toId: "headroom" }] } }).errors[0]).toContain("인접 구간");
    expect(parseBudgetLadderShareInput({ payload: { ...payload, changes: [{ ...payload.changes[0], budgetDeltaWon: 200_000.5 }] } }).errors[0]).toContain("변화 값");
    expect(parseBudgetLadderShareInput({ payload, request: { ...request, gamingRefreshRate: 75 } }).errors[0]).toContain("주사율");
    expect(parseBudgetLadderShareInput({ payload, parentId: 42 }).errors[0]).toContain("원본 snapshot ID");
    expect(parseBudgetLadderShareInput({ payload: { ...payload, items: [item("economy", 800_000, { selection: { useIntegratedGraphics: true, memory: "invalid", ssd: [], hdd: [], accessories: [] } }), item("target", 1_000_000), item("headroom", 1_200_000)] } }).errors[0]).toContain("선택 목록");
  });

  it("normalizes persisted records, hides owner credentials, and detects catalog/share expiry", () => {
    const record = savedBudgetLadderFromUnknown({
      id: "budget-share-1",
      name: "예산 비교",
      payload,
      request,
      parentId: "budget-share-0",
      lineageId: "budget-lineage-1",
      versionNumber: 2,
      catalogSnapshotAt: "2026-09-01T00:00:00.000Z",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      expiresAt: "2026-09-02T00:00:00.000Z",
      ownerTokenHash: "a".repeat(64)
    });

    expect(record).toBeDefined();
    expect(publicBudgetLadderShare(record!, "2026-09-01T00:00:00.000Z")).toMatchObject({ catalogChangedSinceShare: false, request: { profile: "gaming" }, parentId: "budget-share-0", lineageId: "budget-lineage-1", versionNumber: 2 });
    expect(publicBudgetLadderShare(record!, "2026-09-03T00:00:00.000Z")).toMatchObject({ catalogChangedSinceShare: true, catalogCurrentSnapshotAt: "2026-09-03T00:00:00.000Z" });
    expect(publicBudgetLadderShare(record!)).not.toHaveProperty("ownerTokenHash");
    expect(budgetLadderShareLineageEntryFor(record!, Date.parse("2026-09-01T12:00:00.000Z"))).toMatchObject({ id: "budget-share-1", lineageId: "budget-lineage-1", versionNumber: 2, parentId: "budget-share-0", expired: false });
    expect(budgetLadderShareExpired(record!, Date.parse("2026-09-03T00:00:00.000Z"))).toBe(true);
  });
});
