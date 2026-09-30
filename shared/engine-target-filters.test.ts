import { describe, expect, it } from "vitest";
import type { Part } from "./types";
import { emptyEngineTargetFiltersConfig, engineFilterOptionLabelFor, engineTargetFilterActiveFacetCount, engineTargetFilterConfigFromUnknown, engineTargetFiltersActiveCategories, engineTargetFiltersAllowPart } from "./engine-target-filters";

const partFixture = (overrides: Partial<Part> = {}): Part => ({
  id: "p-1",
  category: "ssd",
  name: "삼성전자 990 PRO 1TB",
  brand: "삼성전자",
  priceWon: 150_000,
  dataQuality: "live",
  missingFields: [],
  source: "seed",
  updatedAt: "2026-09-01T00:00:00.000Z",
  specs: { interface: "NVMe", formFactor: "M.2 2280", capacityGb: 1_000, sequentialReadMbps: 7_450, ssdNandType: "TLC" },
  ...overrides
});

describe("engineTargetFilterConfigFromUnknown", () => {
  it("빈 입력을 활성 상태의 빈 설정으로 정규화한다", () => {
    expect(engineTargetFilterConfigFromUnknown(undefined)).toEqual({ valid: true, config: emptyEngineTargetFiltersConfig(), errors: [] });
    expect(engineTargetFilterConfigFromUnknown({})).toEqual({ valid: true, config: { schemaVersion: 1, enabled: true, categories: {} }, errors: [] });
  });

  it("지원하지 않는 범주와 필드를 오류로 보고한다", () => {
    const result = engineTargetFilterConfigFromUnknown({
      categories: {
        fan: { brands: ["A"] },
        ssd: { specValues: { notAField: ["x"] }, numericRanges: { speedMhz: [{ min: 5000, max: 3000 }] } }
      }
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("fan");
    expect(result.errors.join("\n")).toContain("notAField");
    expect(result.errors.join("\n")).toContain("최소값이 최대값보다 큽니다");
  });

  it("공백 제조사와 빈 조건을 걷어내고 중복을 합친다", () => {
    const result = engineTargetFilterConfigFromUnknown({
      enabled: false,
      categories: {
        ssd: { brands: [" 삼성전자 ", "삼성 전자", "Samsung"], specValues: { interface: ["NVMe", "NVMe"] }, priceWon: {} },
        hdd: { brands: [] }
      }
    });
    expect(result.valid).toBe(true);
    expect(result.config.enabled).toBe(false);
    // "삼성전자"와 "삼성 전자"는 정규화하면 같은 키라 중복 제거된다.
    expect(result.config.categories.ssd?.brands).toEqual(["삼성전자", "Samsung"]);
    expect(result.config.categories.ssd?.specValues?.interface).toEqual(["NVMe"]);
    expect(result.config.categories.ssd?.priceWon).toBeUndefined();
    expect(result.config.categories.hdd).toBeUndefined();
  });

  it("배열이 아닌 숫자 범위 입력도 단일 범위로 받아들인다", () => {
    const result = engineTargetFilterConfigFromUnknown({ categories: { gpu: { numericRanges: { vramGb: { min: 12 } } } } });
    expect(result.valid).toBe(true);
    expect(result.config.categories.gpu?.numericRanges?.vramGb).toEqual([{ min: 12 }]);
  });
});

describe("engineTargetFiltersAllowPart", () => {
  const enabledConfig = (rule: Parameters<typeof engineTargetFilterConfigFromUnknown>[0]) => {
    const parsed = engineTargetFilterConfigFromUnknown(rule);
    expect(parsed.valid).toBe(true);
    return parsed.config;
  };

  it("설정이 없거나 비활성이면 모든 부품을 통과시킨다", () => {
    const part = partFixture();
    expect(engineTargetFiltersAllowPart(part, undefined)).toBe(true);
    expect(engineTargetFiltersAllowPart(part, emptyEngineTargetFiltersConfig())).toBe(true);
    expect(engineTargetFiltersAllowPart(part, { schemaVersion: 1, enabled: false, categories: { ssd: { brands: ["없는 브랜드"] } } })).toBe(true);
  });

  it("제조사는 정규화한 텍스트로 비교한다", () => {
    const config = enabledConfig({ categories: { ssd: { brands: ["삼성 전자", "SK하이닉스"] } } });
    expect(engineTargetFiltersAllowPart(partFixture({ brand: "삼성전자" }), config)).toBe(true);
    expect(engineTargetFiltersAllowPart(partFixture({ brand: " SK하이닉스 " }), config)).toBe(true);
    expect(engineTargetFiltersAllowPart(partFixture({ brand: "WD" }), config)).toBe(false);
  });

  it("스펙 값 조건은 같은 필드 안에서 OR, 필드 사이에서 AND로 적용한다", () => {
    const config = enabledConfig({ categories: { ssd: { specValues: { interface: ["NVMe", "SATA"], formFactor: ["M.2 2280"] } } } });
    expect(engineTargetFiltersAllowPart(partFixture(), config)).toBe(true);
    expect(engineTargetFiltersAllowPart(partFixture({ specs: { ...partFixture().specs, interface: "SATA" } }), config)).toBe(true);
    expect(engineTargetFiltersAllowPart(partFixture({ specs: { ...partFixture().specs, formFactor: "2.5인치" } }), config)).toBe(false);
  });

  it("배열 스펙 값은 교집합으로 판정하고 숫자 필드는 숫자로 비교한다", () => {
    const config = enabledConfig({ categories: { cooler: { specValues: { supportedSockets: ["AM5"] } } } });
    const cooler = partFixture({ category: "cooler", specs: { supportedSockets: ["AM4", "AM5"], maxCoolingW: 250 } });
    expect(engineTargetFiltersAllowPart(cooler, config)).toBe(true);
    expect(engineTargetFiltersAllowPart(partFixture({ category: "cooler", specs: { supportedSockets: ["AM4"] } }), config)).toBe(false);
    const genConfig = enabledConfig({ categories: { ssd: { specValues: { m2PcieGeneration: ["4"] } } } });
    expect(engineTargetFiltersAllowPart(partFixture({ specs: { ...partFixture().specs, m2PcieGeneration: 4 } }), genConfig)).toBe(true);
    expect(engineTargetFiltersAllowPart(partFixture({ specs: { ...partFixture().specs, m2PcieGeneration: 5 } }), genConfig)).toBe(false);
  });

  it("수치 범위는 OR로 합치고 값이 없는 부품은 제외한다", () => {
    const config = enabledConfig({ categories: { ssd: { numericRanges: { sequentialReadMbps: [{ max: 3_999 }, { min: 7_000 }] } } } });
    expect(engineTargetFiltersAllowPart(partFixture(), config)).toBe(true); // 7450 ≥ 7000
    expect(engineTargetFiltersAllowPart(partFixture({ specs: { ...partFixture().specs, sequentialReadMbps: 3_500 } }), config)).toBe(true);
    expect(engineTargetFiltersAllowPart(partFixture({ specs: { ...partFixture().specs, sequentialReadMbps: 5_000 } }), config)).toBe(false);
    const { sequentialReadMbps, ...withoutRead } = partFixture().specs;
    void sequentialReadMbps;
    expect(engineTargetFiltersAllowPart(partFixture({ specs: withoutRead }), config)).toBe(false);
  });

  it("플래그와 가격대 조건을 적용한다", () => {
    const flagConfig = enabledConfig({ categories: { motherboard: { flags: { wifi: true } } } });
    const mb = partFixture({ category: "motherboard", specs: { wifi: true } });
    expect(engineTargetFiltersAllowPart(mb, flagConfig)).toBe(true);
    expect(engineTargetFiltersAllowPart(partFixture({ category: "motherboard", specs: {} }), flagConfig)).toBe(false);
    const priceConfig = enabledConfig({ categories: { ssd: { priceWon: { min: 100_000, max: 200_000 } } } });
    expect(engineTargetFiltersAllowPart(partFixture(), priceConfig)).toBe(true);
    expect(engineTargetFiltersAllowPart(partFixture({ priceWon: 90_000 }), priceConfig)).toBe(false);
    expect(engineTargetFiltersAllowPart(partFixture({ priceWon: undefined }), priceConfig)).toBe(false);
  });

  it("다른 범주의 규칙은 해당 범주 부품에 적용하지 않는다", () => {
    const config = enabledConfig({ categories: { ssd: { brands: ["삼성전자"] } } });
    expect(engineTargetFiltersAllowPart(partFixture({ category: "hdd", brand: "Seagate" }), config)).toBe(true);
    expect(engineTargetFiltersActiveCategories(config)).toEqual(["ssd"]);
    expect(engineTargetFilterActiveFacetCount(config.categories.ssd)).toBe(1);
  });
});

describe("engineFilterOptionLabelFor", () => {
  it("알려진 코드 값을 표시용 라벨로 변환한다", () => {
    expect(engineFilterOptionLabelFor("gpuVendor", "nvidia")).toBe("NVIDIA");
    expect(engineFilterOptionLabelFor("coolerType", "liquid")).toBe("수랭");
    expect(engineFilterOptionLabelFor("m2PcieGeneration", "4")).toBe("PCIe 4.0");
    expect(engineFilterOptionLabelFor("memoryModuleCountPerKit", "2")).toBe("2개 모듈");
    expect(engineFilterOptionLabelFor("socket", "AM5")).toBe("AM5");
  });
});
