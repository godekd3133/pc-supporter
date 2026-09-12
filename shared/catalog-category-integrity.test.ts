import { describe, expect, it } from "vitest";
import type { Part } from "./types";
import { catalogCategoryIntegritySummaryFor, catalogCategoryMismatchFor } from "./catalog-category-integrity";

function part(overrides: Partial<Part> = {}): Part {
  return {
    id: "part-1",
    category: "motherboard",
    name: "ASRock B650M 정상 메인보드",
    source: "danawa",
    rawSpecText: "AMD(소켓AM5) / DDR5 / 전원부: 12+2+1페이즈",
    specs: {},
    dataQuality: "incomplete",
    missingFields: ["pcieX1Slots"],
    updatedAt: "2026-09-05T00:00:00.000Z",
    ...overrides
  };
}

describe("catalog category integrity", () => {
  it("marks explicit embedded, Raspberry Pi, and Arduino identity as a motherboard mismatch", () => {
    expect(catalogCategoryMismatchFor(part({ name: "Raspberry Pi 4 Model B", rawSpecText: "임베디드 보드" }))).toMatchObject({ signal: "raspberry_pi" });
    expect(catalogCategoryMismatchFor(part({ name: "아두이노 우노 호환보드", rawSpecText: "임베디드 보드" }))).toMatchObject({ signal: "arduino" });
    expect(catalogCategoryMismatchFor(part({ name: "NVIDIA Jetson Developer Kit", rawSpecText: "임베디드 보드 / ARM(CPU내장)" }))).toMatchObject({ signal: "embedded_board" });
    expect(catalogCategoryMismatchFor(part({ name: "SG90 미니 서보모터", rawSpecText: "" }))).toMatchObject({ signal: "non_pc_component" });
  });

  it("does not infer a mismatch from generic motherboard vocabulary", () => {
    expect(catalogCategoryMismatchFor(part({ name: "ASUS TUF Gaming 메인보드", rawSpecText: "전원부: 14+2+1페이즈 / 온도 센서 / RGB 모듈 헤더" }))).toBeUndefined();
    expect(catalogCategoryMismatchFor(part({ category: "cpu", name: "Arduino CPU 테스트 픽커", rawSpecText: "임베디드 보드" }))).toBeUndefined();
  });

  it("summarizes only high-confidence mismatches without deleting raw records", () => {
    const summary = catalogCategoryIntegritySummaryFor([
      part({ id: "valid" }),
      part({ id: "arduino", name: "Arduino 센서 모듈", rawSpecText: "임베디드 보드" }),
      part({ id: "embedded", name: "Jetson Kit", rawSpecText: "임베디드 보드" }),
      part({ id: "cpu", category: "cpu", name: "Arduino CPU 테스트 픽커", rawSpecText: "임베디드 보드" })
    ]);

    expect(summary).toEqual({
      ruleVersion: 1,
      checkedCount: 3,
      mismatchCount: 2,
      byCategory: { motherboard: 2 },
      bySignal: [
        { signal: "arduino", label: "아두이노 식별자", count: 1 },
        { signal: "embedded_board", label: "임베디드 보드 표기", count: 1 }
      ]
    });
  });
});
