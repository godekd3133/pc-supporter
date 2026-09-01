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
});
