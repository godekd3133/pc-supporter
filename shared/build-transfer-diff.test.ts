import { describe, expect, it } from "vitest";
import type { BuildSelection, RecommendationPreferences } from "./types";
import { buildTransferDiffFor } from "./build-transfer-diff";

function build(overrides: Partial<BuildSelection> = {}): BuildSelection {
  return { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: true, ...overrides };
}

const preferences: RecommendationPreferences = { profile: "general", priority: "balanced", listingPolicy: "retail_only" };

describe("build transfer diff", () => {
  it("reports component, quantity, M.2, graphics, accessory, and preference changes", () => {
    const result = buildTransferDiffFor(
      build({ cpu: { partId: "cpu-old", quantity: 1 }, memory: [{ partId: "ram", quantity: 1 }], m2SlotSelection: { M2_1: "ssd-old" }, useIntegratedGraphics: true, accessories: [{ accessoryId: "fan", quantity: 1 }] }),
      preferences,
      build({ cpu: { partId: "cpu-new", quantity: 1 }, memory: [{ partId: "ram", quantity: 2 }], m2SlotSelection: { M2_2: "ssd-new" }, useIntegratedGraphics: false, accessories: [{ accessoryId: "fan", quantity: 2 }] }),
      { ...preferences, profile: "gaming", priority: "performance", budgetWon: 1_500_000, gamingRefreshRate: 240 },
      { partName: (id) => ({ "cpu-old": "이전 CPU", "cpu-new": "새 CPU", ram: "RAM", "ssd-old": "이전 SSD", "ssd-new": "새 SSD" }[id]), accessoryName: (id) => id === "fan" ? "팬" : undefined }
    );

    expect(result.changedCount).toBe(6);
    expect(result.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "CPU", before: "이전 CPU", after: "새 CPU" }),
      expect.objectContaining({ label: "RAM", before: "RAM", after: "RAM ×2" }),
      expect.objectContaining({ label: "M.2 슬롯 배치", before: "M2_1: 이전 SSD", after: "M2_2: 새 SSD" }),
      expect.objectContaining({ label: "그래픽 출력", before: "CPU 내장 그래픽", after: "외장 그래픽 필요" }),
      expect.objectContaining({ label: "주변 부품", before: "팬", after: "팬 ×2" }),
      expect.objectContaining({ label: "추천 기준", after: expect.stringContaining("240Hz") })
    ]));
  });

  it("ignores order-only changes in repeated selections", () => {
    const result = buildTransferDiffFor(
      build({ memory: [{ partId: "ram-b", quantity: 1 }, { partId: "ram-a", quantity: 1 }] }),
      preferences,
      build({ memory: [{ partId: "ram-a", quantity: 1 }, { partId: "ram-b", quantity: 1 }] }),
      preferences
    );
    expect(result).toEqual({ changedCount: 0, rows: [] });
  });

  it("reports no diff for identical builds and preferences", () => {
    const current = build({ cpu: { partId: "cpu-1", quantity: 1 }, m2SlotSelection: { M2_1: "ssd-1" } });
    expect(buildTransferDiffFor(current, preferences, current, preferences)).toEqual({ changedCount: 0, rows: [] });
  });

  it("reports a change when an M.2 accessory is retargeted to another SSD", () => {
    const before = build({ ssd: [{ partId: "ssd-a", quantity: 1 }, { partId: "ssd-b", quantity: 1 }], accessories: [{ accessoryId: "adapter", quantity: 1, targetPartId: "ssd-a" }] });
    const after = { ...before, accessories: [{ accessoryId: "adapter", quantity: 1, targetPartId: "ssd-b" }] };
    const result = buildTransferDiffFor(before, preferences, after, preferences, {
      partName: (id) => ({ "ssd-a": "SSD A", "ssd-b": "SSD B" }[id]),
      accessoryName: () => "M.2 어댑터"
    });

    expect(result.rows).toContainEqual(expect.objectContaining({ label: "주변 부품", before: "M.2 어댑터 · 대상 SSD A", after: "M.2 어댑터 · 대상 SSD B" }));

    const fanBefore = build({ accessories: [{ accessoryId: "fan", quantity: 1, targetAccessoryId: "hub-a" }] });
    const fanAfter = { ...fanBefore, accessories: [{ accessoryId: "fan", quantity: 1, targetAccessoryId: "hub-b" }] };
    const fanResult = buildTransferDiffFor(fanBefore, preferences, fanAfter, preferences, { accessoryName: (id) => ({ fan: "쿨링팬", "hub-a": "허브 A", "hub-b": "허브 B" }[id]) });
    const fanRow = fanResult.rows.find((row) => row.label === "주변 부품");
    expect(fanRow).toBeDefined();
    expect(fanRow?.before).toContain("대상 허브 허브 A");
    expect(fanRow?.after).toContain("대상 허브 허브 B");

    const rgbBefore = build({ rgbControllerAccessoryId: "hub-a" });
    const rgbAfter = build({ rgbControllerAccessoryId: "hub-b" });
    const rgbResult = buildTransferDiffFor(rgbBefore, preferences, rgbAfter, preferences, { accessoryName: (id) => ({ "hub-a": "RGB 허브 A", "hub-b": "RGB 허브 B" }[id]) });
    expect(rgbResult.rows).toContainEqual(expect.objectContaining({ label: "RGB 연결 컨트롤러", before: "RGB 허브 A", after: "RGB 허브 B" }));
  });
});
