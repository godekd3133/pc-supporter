import { describe, expect, it } from "vitest";
import { pcieSlotEvidenceMissingFieldsFor } from "./pcie-slot";

describe("PCIe slot evidence", () => {
  it("reports only the explicitly unknown slot-count fields", () => {
    expect(pcieSlotEvidenceMissingFieldsFor({ pcieX16Slots: 1, pcieX8Slots: 0 })).toEqual(["pcieX4Slots", "pcieX1Slots"]);
    expect(pcieSlotEvidenceMissingFieldsFor({ pcieX16Slots: 1, pcieX8Slots: 0, pcieX4Slots: 0, pcieX1Slots: 2 })).toEqual([]);
  });
});
