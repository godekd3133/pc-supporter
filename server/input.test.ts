import { describe, expect, it } from "vitest";
import type { M2SlotOverride, Part } from "../shared/types";
import { buildM2SlotCoverage, buildM2SlotReviewTemplate, parseBuild, parseBuildGenerationRequest, parseRecommendationPreferences, validateAccessoryTargetPartIds, validateBuildPartIds, validateM2SlotOverrideBatch } from "./index";
import { seedCatalog } from "./seed-catalog";

describe("build request validation", () => {
  it("rejects malformed selections instead of silently dropping them", () => {
    const parsed = parseBuild({
      cpu: { partId: "cpu-001", quantity: 1.5 },
      memory: "not-an-array"
    });

    expect(parsed.errors).toEqual(expect.arrayContaining([
      "cpu.quantity는 1부터 99 사이의 정수여야 합니다.",
      "memory은 배열이어야 합니다."
    ]));
  });

  it("trims part IDs and preserves valid optional fields", () => {
    const parsed = parseBuild({
      cpu: { partId: " cpu-001 ", quantity: 1 },
      gpu: null,
      memory: [{ partId: "memory-001", quantity: 2 }],
      useIntegratedGraphics: true
    });

    expect(parsed.errors).toHaveLength(0);
    expect(parsed.build.cpu?.partId).toBe("cpu-001");
    expect(parsed.build.memory[0].quantity).toBe(2);
    expect(parsed.build.gpu).toBeUndefined();
  });

  it("parses optional peripheral selections with bounded quantities", () => {
    const parsed = parseBuild({ accessories: [{ accessoryId: " accessory-1 ", quantity: 2, targetPartId: " ssd-1 ", targetAccessoryId: " hub-1 " }], rgbControllerAccessoryId: " hub-1 " });

    expect(parsed.errors).toHaveLength(0);
    expect(parsed.build.accessories).toEqual([{ accessoryId: "accessory-1", quantity: 2, targetPartId: "ssd-1", targetAccessoryId: "hub-1" }]);
    expect(parsed.build.rgbControllerAccessoryId).toBe("hub-1");
  });

  it("validates accessory target SSD IDs against the selected SSD list", () => {
    const parsed = parseBuild({ ssd: [{ partId: "ssd-nvme-1tb", quantity: 1 }], accessories: [{ accessoryId: "accessory-1", quantity: 1, targetPartId: "missing-ssd" }] });
    expect(parsed.errors).toHaveLength(0);
    expect(validateAccessoryTargetPartIds(parsed.build, seedCatalog)).toEqual(["missing-ssd"]);
    expect(validateAccessoryTargetPartIds({ ...parsed.build, accessories: [{ accessoryId: "accessory-1", quantity: 1, targetPartId: "ssd-nvme-1tb" }] }, seedCatalog)).toEqual([]);
  });

  it("rejects malformed peripheral selections", () => {
    const parsed = parseBuild({ accessories: [{ accessoryId: "", quantity: 1 }, { accessoryId: "accessory-1", quantity: 1.5 }] });

    expect(parsed.errors).toEqual(expect.arrayContaining([
      "accessories[0].accessoryId가 필요합니다.",
      "accessories[1].quantity는 1부터 99 사이의 정수여야 합니다."
    ]));
  });

  it("normalizes valid M.2 slot selections and keeps the SSD IDs", () => {
    const parsed = parseBuild({
      m2SlotSelection: { "M.2 1": " ssd-nvme-1tb ", m2_2: "ssd-nvme-2tb" }
    });

    expect(parsed.errors).toHaveLength(0);
    expect(parsed.build.m2SlotSelection).toEqual({ M2_1: "ssd-nvme-1tb", M2_2: "ssd-nvme-2tb" });
  });

  it("rejects malformed and duplicate normalized M.2 slot selections", () => {
    const malformed = parseBuild({ m2SlotSelection: "M2_1" });
    expect(malformed.errors).toContain("m2SlotSelection은 슬롯 ID와 SSD ID를 담은 객체여야 합니다.");

    const duplicate = parseBuild({ m2SlotSelection: { "M.2_1": "ssd-one", "M2 1": "ssd-two" } });
    expect(duplicate.errors).toContain("M2_1 슬롯이 m2SlotSelection에서 중복되었습니다.");
  });

  it("validates a batch M.2 import against the catalog and keeps valid entries atomic", () => {
    const motherboard = seedCatalog.find((part) => part.id === "mb-b650-4x3")!;
    const slots = Array.from({ length: motherboard.specs.m2Slots ?? 1 }, (_value, index) => ({
      slotId: `M2_${index + 1}`,
      interfaces: ["NVMe"],
      pcieGeneration: 4,
      connection: "chipset",
      sharedWith: []
    }));
    const result = validateM2SlotOverrideBatch({
      items: [
        { partId: motherboard.id, slots },
        { partId: "missing-motherboard", slots: [] }
      ]
    }, seedCatalog);

    expect(result.items.find((item) => item.partId === motherboard.id)?.valid).toBe(true);
    expect(result.items.find((item) => item.partId === motherboard.id)?.complete).toBe(true);
    expect(result.items.find((item) => item.partId === "missing-motherboard")?.valid).toBe(false);
    expect(result.validOverrides).toHaveLength(0);
    expect(result.errors.some((error) => error.includes("missing-motherboard"))).toBe(true);
  });

  it("calculates M.2 mapping coverage and prioritizes complex unmapped boards", () => {
    const baseMotherboard = seedCatalog.find((part) => part.id === "mb-b650-4x3")!;
    const unmappedBoard: Part = {
      ...baseMotherboard,
      id: "coverage-unmapped-board",
      name: "커버리지 미등록 PCIe 복수 세대 보드",
      specs: { ...baseMotherboard.specs, m2Slots: 3, m2PcieGenerations: [5, 4] }
    };
    const mappedBoard: Part = {
      ...baseMotherboard,
      id: "coverage-mapped-board",
      name: "커버리지 등록 보드",
      specs: { ...baseMotherboard.specs, m2Slots: 2, m2PcieGenerations: [4] }
    };
    const mappedOverride: M2SlotOverride = {
      partId: mappedBoard.id,
      slots: [
        { slotId: "M2_1", interfaces: ["NVMe"], pcieGeneration: 4, connection: "cpu", sharedWith: [] },
        { slotId: "M2_2", interfaces: ["NVMe"], pcieGeneration: 4, connection: "chipset", sharedWith: [] }
      ],
      updatedAt: "2026-08-28T00:00:00.000Z"
    };
    const coverage = buildM2SlotCoverage([unmappedBoard, mappedBoard], { [mappedBoard.id]: mappedOverride }, { filter: "needs_review", limit: 10 });

    expect(coverage.totals).toMatchObject({
      eligibleMotherboards: 2,
      multiSlotMotherboards: 2,
      mapped: 1,
      incomplete: 0,
      unmapped: 1,
      coveragePercent: 50,
      mixedGenerationMotherboards: 1,
      unmappedMixedGenerationMotherboards: 1
    });
    expect(coverage.items[0]).toMatchObject({
      partId: unmappedBoard.id,
      mappingStatus: "unmapped",
      reviewPriority: "medium"
    });
    expect(coverage.items[0].reviewReason).toContain("PCIe 세대가 복수로 집계됨");
    expect(coverage.bySlotCount).toEqual(expect.arrayContaining([
      expect.objectContaining({ slotCount: 2, mapped: 1 }),
      expect.objectContaining({ slotCount: 3, unmapped: 1 })
    ]));
  });

  it("creates review templates without inventing missing slot facts", () => {
    const baseMotherboard = seedCatalog.find((part) => part.id === "mb-b650-4x3")!;
    const board: Part = {
      ...baseMotherboard,
      id: "review-template-board",
      specs: { ...baseMotherboard.specs, m2Slots: 2 }
    };
    const incompleteOverride: M2SlotOverride = {
      partId: board.id,
      slots: [{ slotId: "M2_1", interfaces: ["NVMe"], pcieGeneration: 4, connection: "cpu" }],
      sourceNote: "매뉴얼 확인 중",
      updatedAt: "2026-08-28T00:00:00.000Z"
    };
    const template = buildM2SlotReviewTemplate([board], { [board.id]: incompleteOverride }, { filter: "needs_review", limit: 10 });

    expect(template.items).toHaveLength(1);
    expect(template.items[0]).toMatchObject({ partId: board.id, sourceNote: "매뉴얼 확인 중" });
    expect(template.items[0].slots).toEqual([
      { slotId: "M2_1", interfaces: ["NVMe"], pcieGeneration: 4, connection: "cpu" },
      { slotId: "M2_2" }
    ]);
    const validation = validateM2SlotOverrideBatch({ items: template.items }, [board]);
    expect(validation.items[0]).toMatchObject({ valid: true, complete: false });
  });

  it("marks a complete mapping stale when the catalog was updated afterward", () => {
    const baseMotherboard = seedCatalog.find((part) => part.id === "mb-b650-4x3")!;
    const board: Part = {
      ...baseMotherboard,
      id: "stale-mapping-board",
      updatedAt: "2026-08-28T12:00:00.000Z",
      specs: { ...baseMotherboard.specs, m2Slots: 2, m2PcieGenerations: [4] }
    };
    const override: M2SlotOverride = {
      partId: board.id,
      slots: [
        { slotId: "M2_1", interfaces: ["NVMe"], pcieGeneration: 4, connection: "cpu", sharedWith: [] },
        { slotId: "M2_2", interfaces: ["NVMe"], pcieGeneration: 4, connection: "chipset", sharedWith: [] }
      ],
      updatedAt: "2026-08-27T12:00:00.000Z"
    };
    const staleCoverage = buildM2SlotCoverage([board], { [board.id]: override }, { filter: "all" });

    expect(staleCoverage.totals).toMatchObject({ mapped: 0, stale: 1, incomplete: 0, unmapped: 0, coveragePercent: 0 });
    expect(staleCoverage.items[0]).toMatchObject({ mappingStatus: "stale", reviewPriority: "medium" });
    expect(staleCoverage.items[0].reviewReason).toContain("재검수 필요");
    expect(staleCoverage.bySlotCount[0]).toMatchObject({ slotCount: 2, stale: 1 });

    const currentCoverage = buildM2SlotCoverage([board], { [board.id]: { ...override, updatedAt: "2026-08-28T13:00:00.000Z" } }, { filter: "all" });
    expect(currentCoverage.totals).toMatchObject({ mapped: 1, stale: 0, coveragePercent: 100 });
    expect(currentCoverage.items[0].mappingStatus).toBe("mapped");
  });

  it("rejects a valid part ID when it is placed in the wrong component category", () => {
    const parsed = parseBuild({
      cpu: { partId: "gpu-rtx-4060", quantity: 1 },
      memory: [],
      ssd: [],
      hdd: [],
      useIntegratedGraphics: true
    });

    expect(parsed.errors).toHaveLength(0);
    expect(validateBuildPartIds(parsed.build, seedCatalog).map((selection) => selection.partId)).toEqual(["gpu-rtx-4060"]);
  });

  it("preserves recommendation priority, profile, budget, and listing policy", () => {
    expect(parseRecommendationPreferences({ priority: "budget", profile: "gaming", budgetWon: 2_000_000, listingPolicy: "all" }))
      .toEqual({ priority: "budget", profile: "gaming", budgetWon: 2_000_000, listingPolicy: "all" });
    expect(parseRecommendationPreferences({ profile: "gaming", gamingResolution: "4k" }).gamingResolution).toBe("4k");
    expect(parseRecommendationPreferences({ profile: "gaming", gamingRefreshRate: 240 }).gamingRefreshRate).toBe(240);
    expect(parseRecommendationPreferences(undefined)).toEqual({ priority: "balanced", profile: "general", listingPolicy: "retail_only" });
  });

  it("defaults automatic generation to a GPU for gaming and validates the budget", () => {
    const parsed = parseBuildGenerationRequest({ profile: "gaming", budgetWon: 2_000_000 });

    expect(parsed.errors).toHaveLength(0);
    expect(parsed.request).toEqual({ profile: "gaming", budgetWon: 2_000_000, includeGpu: true, priority: "balanced", gamingResolution: "1440p", gamingRefreshRate: 144, memoryCapacityGb: 32, storageCapacityGb: 1000, hddCapacityGb: 4000, hddCount: 0, includeNonRetail: false, listingPolicy: "retail_only" });
    expect(parseBuildGenerationRequest({ profile: "gaming", budgetWon: 2_000_000, priority: "performance" }).request?.priority).toBe("performance");
  });

  it("rejects an unsupported RAM target capacity", () => {
    const parsed = parseBuildGenerationRequest({ profile: "gaming", budgetWon: 2_000_000, memoryCapacityGb: 48 });

    expect(parsed.request).toBeUndefined();
    expect(parsed.errors).toContain("memoryCapacityGb는 16, 32, 64, 128 중 하나여야 합니다.");
  });

  it("rejects an unsupported gaming resolution", () => {
    const parsed = parseBuildGenerationRequest({ profile: "gaming", budgetWon: 2_000_000, gamingResolution: "8k" });

    expect(parsed.request).toBeUndefined();
    expect(parsed.errors).toContain("gamingResolution은 1080p, 1440p, 4k 중 하나여야 합니다.");
  });

  it("rejects an unsupported gaming refresh rate", () => {
    const parsed = parseBuildGenerationRequest({ profile: "gaming", budgetWon: 2_000_000, gamingRefreshRate: 360 });

    expect(parsed.request).toBeUndefined();
    expect(parsed.errors).toContain("gamingRefreshRate는 60, 144, 240 중 하나여야 합니다.");
  });

  it("rejects an invalid automatic generation budget", () => {
    const parsed = parseBuildGenerationRequest({ profile: "office", budgetWon: 0, priority: "fast", includeGpu: "no", includeNonRetail: "maybe", listingPolicy: "used_only" });

    expect(parsed.request).toBeUndefined();
    expect(parsed.errors).toEqual(expect.arrayContaining([
      "budgetWon은 1원부터 100,000,000원 사이의 정수여야 합니다.",
      "priority는 balanced, budget, performance 중 하나여야 합니다.",
      "includeGpu는 boolean이어야 합니다.",
      "includeNonRetail은 boolean이어야 합니다.",
      "listingPolicy는 retail_only, include_bulk, all 중 하나여야 합니다."
    ]));
  });

  it("validates requested storage capacity and HDD quantity", () => {
    const parsed = parseBuildGenerationRequest({ profile: "office", budgetWon: 1_000_000, storageCapacityGb: 0, hddCount: 9, hddCapacityGb: -1 });

    expect(parsed.request).toBeUndefined();
    expect(parsed.errors).toEqual(expect.arrayContaining([
      "storageCapacityGb는 1부터 100,000 사이의 정수여야 합니다.",
      "hddCount는 0부터 8 사이의 정수여야 합니다.",
      "hddCapacityGb는 1부터 100,000 사이의 정수여야 합니다."
    ]));
  });
});
