import { describe, expect, it } from "vitest";
import { parsePublicPriceHistoryIds, parsePublicPriceHistoryWindow } from "./public-price-history";

describe("public price history request", () => {
  it("parses typed keys and removes duplicates", () => {
    expect(parsePublicPriceHistoryIds("part:cpu-1,part:cpu-1,accessory:fan-1")).toEqual({ items: [{ kind: "part", itemId: "cpu-1" }, { kind: "accessory", itemId: "fan-1" }] });
  });

  it("rejects missing or malformed keys", () => {
    expect(parsePublicPriceHistoryIds(undefined).error).toBe("가격 이력을 조회하려면 kind:itemId 형식의 ids가 필요합니다.");
    expect(parsePublicPriceHistoryIds("cpu-1").items).toEqual([]);
    expect(parsePublicPriceHistoryIds("part:").items).toEqual([]);
  });

  it("rejects requests above the maximum item count", () => {
    const result = parsePublicPriceHistoryIds(Array.from({ length: 51 }, (_value, index) => "part:id-" + index).join(","));
    expect(result.error).toBe("한 번에 최대 50개 부품의 가격 이력만 조회할 수 있습니다.");
    expect(result.items).toEqual([]);
  });

  it("accepts only supported public history windows", () => {
    expect(parsePublicPriceHistoryWindow(undefined)).toEqual({ days: 30 });
    expect(parsePublicPriceHistoryWindow("7")).toEqual({ days: 7 });
    expect(parsePublicPriceHistoryWindow(90)).toEqual({ days: 90 });
    expect(parsePublicPriceHistoryWindow("14").error).toBe("가격 이력 기간은 7일, 30일, 90일 중 하나여야 합니다.");
  });
});
