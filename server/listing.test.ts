import { describe, expect, it } from "vitest";
import type { Part } from "../shared/types";
import { inferListingType, isListingAllowed } from "./listing";

function part(overrides: Partial<Part>): Part {
  return {
    id: "part-1",
    category: "ssd",
    name: "정상 SSD 1TB",
    source: "danawa",
    specs: { interface: "NVMe", formFactor: "M.2 2280", capacityGb: 1000 },
    dataQuality: "live",
    missingFields: [],
    updatedAt: "2026-08-27T00:00:00.000Z",
    ...overrides
  };
}

describe("listing policy", () => {
  it("classifies listing conditions and storage accessories", () => {
    expect(inferListingType(part({ name: "정상 SSD 1TB" }))).toBe("retail");
    expect(inferListingType(part({ name: "정상 SSD 1TB 벌크" }))).toBe("bulk");
    expect(inferListingType(part({ name: "정상 SSD 1TB 병행수입" }))).toBe("parallel_import");
    expect(inferListingType(part({ name: "정상 SSD 1TB 해외구매" }))).toBe("overseas");
    expect(inferListingType(part({ name: "정상 SSD 1TB 중고" }))).toBe("used");
    expect(inferListingType(part({ name: "USB 3.0 to SATA 컨버터 4TB" }))).toBe("accessory");
    expect(inferListingType(part({ category: "ssd", name: "M.2 SSD 보관케이스", rawSpecText: "보관케이스 / SSD전용" }))).toBe("accessory");
    expect(inferListingType(part({ category: "psu", name: "듀얼파워 커넥터", rawSpecText: "전용 액세서리 / 메인전원: 24핀" }))).toBe("accessory");
  });

  it("separates case-category riser accessories without classifying case features as accessories", () => {
    expect(inferListingType(part({ category: "case", name: "AONE PCI-E 4.0 라이저 케이블", rawSpecText: "액세서리 / PCIe 라이저" }))).toBe("accessory");
    expect(inferListingType(part({ category: "case", name: "정상 케이스", rawSpecText: "ATX 케이스 / 라이저 케이블 장착 지원" }))).toBe("retail");
  });

  it("keeps bulk opt-in but never allows a storage accessory as a core part", () => {
    const bulk = part({ name: "정상 SSD 1TB 벌크" });
    const used = part({ name: "정상 SSD 1TB 중고" });
    const accessory = part({ name: "USB-SATA 컨버터" });

    expect(isListingAllowed(bulk, "retail_only")).toBe(false);
    expect(isListingAllowed(bulk, "include_bulk")).toBe(true);
    expect(isListingAllowed(used, "include_bulk")).toBe(false);
    expect(isListingAllowed(used, "all")).toBe(true);
    expect(isListingAllowed(accessory, "all")).toBe(false);
  });

  it("excludes high-confidence non-PC products mislabeled as motherboards from every listing policy", () => {
    const embedded = part({ category: "motherboard", name: "Raspberry Pi 4 Model B", rawSpecText: "임베디드 보드" });
    const oldBoard = part({ category: "motherboard", name: "Z390 중고 메인보드", rawSpecText: "인텔(소켓1151v2) / 인텔 Z390" });

    expect(isListingAllowed(embedded, "retail_only")).toBe(false);
    expect(isListingAllowed(embedded, "include_bulk")).toBe(false);
    expect(isListingAllowed(embedded, "all")).toBe(false);
    expect(isListingAllowed(oldBoard, "all")).toBe(true);
  });
});
