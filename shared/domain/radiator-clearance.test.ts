import { describe, expect, it } from "vitest";
import type { Part, RadiatorSupport } from "../types";
import { radiatorClearanceFindings } from "./radiator-clearance";

const part = (category: Part["category"], specs: Part["specs"]): Part => ({ id: `fixture-${category}`, category, name: "치수 검증 부품", source: "manual", specs, dataQuality: "manual", missingFields: [], updatedAt: "2026-10-04T00:00:00Z" });
const support = (requirements: RadiatorSupport["requirements"]): RadiatorSupport => ({ position: "top", sizesMm: [120, 240, 360], requirements });

describe("manufacturer radiator clearance requirements", () => {
  it("compares actual radiator plus fan thickness and leaves missing fan data unknown", () => {
    const s = support([{ maxAssemblyThicknessMm: 63 }]);
    expect(radiatorClearanceFindings(s, 360, part("cooler", { radiatorThicknessMm: 27, radiatorFanThicknessMm: 25 }), [])).toEqual([]);
    expect(radiatorClearanceFindings(s, 360, part("cooler", { radiatorThicknessMm: 40, radiatorFanThicknessMm: 25 }), [])).toEqual([expect.objectContaining({ severity: "blocker", actual: "65mm" })]);
    expect(radiatorClearanceFindings(s, 360, part("cooler", { radiatorThicknessMm: 27 }), [])).toEqual([expect.objectContaining({ severity: "unknown" })]);
  });

  it("requires the height of every selected memory kit", () => {
    const s = support([{ maxMemoryHeightMm: 46 }]);
    const cooler = part("cooler", {});
    expect(radiatorClearanceFindings(s, 240, cooler, [part("memory", { memoryHeightMm: 46 })])).toEqual([]);
    expect(radiatorClearanceFindings(s, 240, cooler, [part("memory", { memoryHeightMm: 47 })])).toEqual([expect.objectContaining({ severity: "blocker" })]);
    expect(radiatorClearanceFindings(s, 240, cooler, [part("memory", { memoryHeightMm: 40 }), part("memory", {})])).toEqual([expect.objectContaining({ severity: "unknown" })]);
    expect(radiatorClearanceFindings(s, 240, cooler, [part("memory", { memoryHeightMm: 47 }), part("memory", {})])).toEqual([expect.objectContaining({ severity: "blocker" })]);
    expect(radiatorClearanceFindings(support([{ maxMemoryHeightMm: 46, exclusiveUpperBound: true }]), 240, cooler, [part("memory", { memoryHeightMm: 46 }), part("memory", {})])).toEqual([expect.objectContaining({ severity: "blocker" })]);
  });

  it("applies a size-specific restriction only to its documented sizes", () => {
    const s = support([{ sizesMm: [240], maxMemoryHeightMm: 35 }]);
    const memory = [part("memory", { memoryHeightMm: 50 })];
    expect(radiatorClearanceFindings(s, 120, part("cooler", {}), memory)).toEqual([]);
    expect(radiatorClearanceFindings(s, 240, part("cooler", {}), memory)[0].severity).toBe("blocker");
  });

  it("preserves strict less-than limits and real millimeter dimensions", () => {
    const s = support([{ maxAssemblyThicknessMm: 77, exclusiveUpperBound: true }, { maxRadiatorWidthMm: 121 }]);
    expect(radiatorClearanceFindings(s, 360, part("cooler", { radiatorThicknessMm: 52, radiatorFanThicknessMm: 25, radiatorWidthMm: 121 }), [])[0]).toMatchObject({ severity: "blocker", expected: "77mm 미만" });
    expect(radiatorClearanceFindings(s, 360, part("cooler", { radiatorThicknessMm: 51.5, radiatorFanThicknessMm: 25, radiatorWidthMm: 121 }), [])).toEqual([]);
  });

  it("retains manual layout conditions even when all numeric measurements fit", () => {
    const s = support([{ maxAssemblyThicknessMm: 77, configurationNote: "메인보드를 낮은 수냉 모드로 설치" }]);
    expect(radiatorClearanceFindings(s, 360, part("cooler", { radiatorThicknessMm: 27, radiatorFanThicknessMm: 25 }), [])).toEqual([expect.objectContaining({ severity: "unknown", label: "설치 조건" })]);
    expect(radiatorClearanceFindings(s, 360, part("cooler", { radiatorThicknessMm: 60, radiatorFanThicknessMm: 25 }), []).every((finding) => finding.severity === "unknown")).toBe(true);
  });

  it("checks GPU clearance only when a GPU occupies that space", () => {
    const s = support([{ maxGpuLengthMm: 355 }]);
    expect(radiatorClearanceFindings(s, 360, part("cooler", {}), [])).toEqual([]);
    expect(radiatorClearanceFindings(s, 360, part("cooler", {}), [], part("gpu", {}))[0].severity).toBe("unknown");
    expect(radiatorClearanceFindings(s, 360, part("cooler", {}), [], part("gpu", { lengthMm: 360 }))[0].severity).toBe("blocker");
  });
});
