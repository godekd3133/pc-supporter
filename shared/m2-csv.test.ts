import { describe, expect, it } from "vitest";
import type { M2SlotReviewTemplateItem } from "./types";
import { m2ReviewTemplatesToCsv, parseM2ReviewCsv } from "./m2-csv";

describe("M.2 review CSV", () => {
  it("round-trips quoted commas, newlines, quotes, and explicit no-sharing", () => {
    const items: M2SlotReviewTemplateItem[] = [{
      partId: "mb-csv-1",
      partName: "보드, WiFi \"검수판\"",
      slots: [{ slotId: "M2_1", interfaces: ["NVMe", "SATA"], pcieGeneration: 5, connection: "cpu", sharedWith: [] }],
      sourceNote: "매뉴얼 12페이지,\nRev \"A\"",
      sourceUrl: "https://example.com/manual.pdf"
    }];

    const parsed = parseM2ReviewCsv(m2ReviewTemplatesToCsv(items));

    expect(parsed.errors).toEqual([]);
    expect(parsed.items).toEqual(items);
  });

  it("groups slot rows into one board and accepts Korean connection labels", () => {
    const csv = [
      "partId,partName,slotId,interfaces,pcieGeneration,connection,sharedWith,sourceNote,sourceUrl",
      "mb-csv-2,검수 보드,M2_1,NVMe,4,CPU 직결,없음,,",
      "mb-csv-2,검수 보드,M2_2,NVMe|SATA,4,칩셋,SATA_3|PCIe_2,,"
    ].join("\n");

    const parsed = parseM2ReviewCsv(csv);

    expect(parsed.errors).toEqual([]);
    expect(parsed.items).toEqual([{
      partId: "mb-csv-2",
      partName: "검수 보드",
      slots: [
        { slotId: "M2_1", interfaces: ["NVMe"], pcieGeneration: 4, connection: "cpu", sharedWith: [] },
        { slotId: "M2_2", interfaces: ["NVMe", "SATA"], pcieGeneration: 4, connection: "chipset", sharedWith: ["SATA_3", "PCIe_2"] }
      ]
    }]);
  });

  it("rejects duplicate slots and invalid slot facts", () => {
    const csv = [
      "partId,partName,slotId,interfaces,pcieGeneration,connection,sharedWith,sourceNote,sourceUrl",
      "mb-csv-3,오류 보드,M2_1,USB,7,bad,,,",
      "mb-csv-3,오류 보드,M2_1,NVMe,4,cpu,,,",
      "mb-csv-3,오류 보드,M2_1,NVMe,4,cpu,,,"
    ].join("\n");

    const parsed = parseM2ReviewCsv(csv);

    expect(parsed.items).toEqual([]);
    expect(parsed.errors).toEqual(expect.arrayContaining([
      "2행: interfaces는 NVMe 또는 SATA만 사용할 수 있습니다.",
      "2행: PCIe 세대는 2부터 6 사이의 숫자여야 합니다.",
      "2행: connection은 cpu, chipset, unknown 중 하나여야 합니다.",
      "4행: mb-csv-3의 M2_1 슬롯이 중복되었습니다."
    ]));
  });
});
