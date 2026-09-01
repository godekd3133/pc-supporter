import { describe, expect, it } from "vitest";
import type { Part } from "../shared/types";
import { applyCaseRgbLoadOverrides, caseRgbLoadCoverageFor, stripCaseRgbLoadOverride, validateCaseRgbLoadOverride, validateCaseRgbLoadOverrideBatch } from "./case-rgb-load-overrides";

function part(overrides: Partial<Part> = {}): Part {
  return {
    id: "case-1",
    category: "case",
    name: "RGB 케이스",
    source: "danawa",
    specs: { fanCount: 4, rgbDeviceCount: 3, rgbDeviceVoltage: "5V" },
    dataQuality: "live",
    missingFields: [],
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides
  };
}

describe("case RGB load overrides", () => {
  it("requires a case, an explicit load value, and traceable evidence", () => {
    const valid = validateCaseRgbLoadOverride(part(), {
      rgbDeviceCurrentA: "0.4",
      manufacturerModel: "CASE-RGB-REV-A",
      sourceNote: "제조사 설치 매뉴얼의 LED팬 1개당 소비전류 표",
      sourceUrl: "https://vendor.example/manual.pdf"
    });
    expect(valid.errors).toEqual([]);
    expect(valid.value).toMatchObject({ partId: "case-1", rgbDeviceCurrentA: 0.4, manufacturerModel: "CASE-RGB-REV-A" });
    expect(valid.value?.updatedAt).toBeTruthy();

    const invalid = validateCaseRgbLoadOverride(part(), { rgbDevicePowerW: 0, manufacturerModel: "", sourceNote: "" });
    expect(invalid.value).toBeUndefined();
    expect(invalid.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("RGB 장치당 소비전력"),
      expect.stringContaining("manufacturerModel"),
      expect.stringContaining("sourceNote")
    ]));
  });

  it("rejects duplicate, missing, and non-case batch entries atomically", () => {
    const catalog = [part(), part({ id: "cpu-1", category: "cpu", name: "CPU", specs: {} })];
    const validation = validateCaseRgbLoadOverrideBatch({ items: [
      { partId: "case-1", rgbDevicePowerW: 2.5, manufacturerModel: "CASE-A", sourceNote: "매뉴얼" },
      { partId: "case-1", rgbDevicePowerW: 2.6, manufacturerModel: "CASE-A", sourceNote: "수정" },
      { partId: "cpu-1", rgbDevicePowerW: 2.5, manufacturerModel: "CPU-A", sourceNote: "잘못된 대상" },
      { partId: "missing", rgbDevicePowerW: 2.5, manufacturerModel: "MISSING", sourceNote: "대상 없음" }
    ] }, catalog);
    expect(validation.validOverrides).toEqual([]);
    expect(validation.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("중복"),
      expect.stringContaining("케이스만"),
      expect.stringContaining("카탈로그에서 부품을 찾을 수 없습니다")
    ]));
  });

  it("applies provenance at runtime and restores raw catalog state when stripped", () => {
    const override = {
      partId: "case-1",
      rgbDevicePowerW: 2.5,
      manufacturerModel: "CASE-RGB-REV-A",
      sourceNote: "제조사 매뉴얼",
      sourceUrl: "https://vendor.example/manual.pdf",
      updatedAt: "2026-09-01T00:00:00.000Z"
    };
    const applied = applyCaseRgbLoadOverrides([part()], { "case-1": override });
    expect(applied[0].specs).toMatchObject({ rgbDevicePowerW: 2.5, rgbDeviceLoadProvenance: { manufacturerModel: "CASE-RGB-REV-A", sourceNote: "제조사 매뉴얼" } });
    const stripped = stripCaseRgbLoadOverride(applied[0]);
    expect(stripped.specs.rgbDevicePowerW).toBeUndefined();
    expect(stripped.specs.rgbDeviceLoadProvenance).toBeUndefined();
  });

  it("reports RGB load coverage only for cases with known RGB devices", () => {
    const catalog = [part(), part({ id: "case-no-rgb", specs: { fanCount: 2 } })];
    const coverage = caseRgbLoadCoverageFor(catalog, {
      "case-1": {
        partId: "case-1",
        rgbDevicePowerW: 2.5,
        manufacturerModel: "CASE-RGB-REV-A",
        sourceNote: "제조사 매뉴얼",
        updatedAt: "2026-09-01T00:00:00.000Z"
      }
    });
    expect(coverage).toMatchObject({ totalRgbCases: 1, registeredCount: 1, missingCount: 0, coveragePercent: 100 });
  });

  it("does not round a small but non-zero coverage value down to zero", () => {
    const catalog = Array.from({ length: 547 }, (_value, index) => part({ id: `case-${index}` }));
    const coverage = caseRgbLoadCoverageFor(catalog, {
      "case-0": {
        partId: "case-0",
        rgbDevicePowerW: 2.5,
        manufacturerModel: "CASE-RGB-REV-A",
        sourceNote: "제조사 매뉴얼",
        updatedAt: "2026-09-01T00:00:00.000Z"
      }
    });
    expect(coverage.coveragePercent).toBe(0.2);
  });
});
