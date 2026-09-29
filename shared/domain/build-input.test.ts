import { describe, expect, it } from "vitest";
import { parseBuild, parseBuildGenerationRequest, parseRecommendationPreferences } from "./build-input";

describe("shared request parsers", () => {
  it("matches the API build contract for quantities, list limits, accessory targets, and M.2 slots", () => {
    expect(parseBuild({ memory: [{ partId: "ram", quantity: 0 }], ssd: [], hdd: [], useIntegratedGraphics: true }).errors).toContain("메모리 1번째 수량은 1~99개로 입력해 주세요.");
    expect(parseBuild({ memory: Array.from({ length: 101 }, (_, index) => ({ partId: "ram-" + index, quantity: 1 })), ssd: [], hdd: [] }).errors).toContain("메모리 목록은 한 번에 최대 100개까지 선택할 수 있습니다.");
    expect(parseBuild({ memory: [], ssd: [], hdd: [], accessories: [{ accessoryId: "fan", quantity: 1, targetAccessoryId: " ".repeat(1) }] }).errors).toContain("주변 부품에 연결할 팬 허브를 확인해 주세요.");
    expect(parseBuild({ memory: [], ssd: [], hdd: [], m2SlotSelection: { M2_1: "ssd-a", "M.2 1": "ssd-b" } }).errors).toContain("M2_1 슬롯을 두 번 지정했습니다.");
    expect(parseBuild({ memory: [], ssd: [], hdd: [], m2SlotSelection: Object.fromEntries(Array.from({ length: 9 }, (_, index) => ["M2_" + (index + 1), "ssd"])) }).errors).toContain("M.2 슬롯은 최대 8개까지 지정할 수 있습니다.");
  });

  it("normalizes recommendation preferences using supported values and bounds", () => {
    expect(parseRecommendationPreferences({ profile: "unsupported", priority: "fast", listingPolicy: "used", budgetWon: 100_000_001 })).toEqual({
      priority: "balanced",
      profile: "general",
      listingPolicy: "retail_only"
    });
    expect(parseRecommendationPreferences({ profile: "gaming", gamingRefreshRate: "240", gamingGameIds: ["a", "", "b", "c", "d", "e", "f"] })).toMatchObject({
      profile: "gaming",
      gamingRefreshRate: 240,
      gamingGameIds: ["a", "b", "c", "d", "e"]
    });
  });

  it("rejects generation requests outside the API limits before engine execution", () => {
    expect(parseBuildGenerationRequest({ profile: "office", budgetWon: 100_000_001, includeGpu: false }).errors.some((message) => message.includes("budgetWon"))).toBe(true);
    expect(parseBuildGenerationRequest({ profile: "office", budgetWon: 100_000, includeGpu: false, memoryCapacityGb: 48 }).errors).toContain("memoryCapacityGb는 16, 32, 64, 128 중 하나여야 합니다.");
    expect(parseBuildGenerationRequest({ profile: "office", budgetWon: 100_000, includeGpu: false, hddCount: 9 }).errors).toContain("hddCount는 0부터 8 사이의 정수여야 합니다.");
    expect(parseBuildGenerationRequest({ profile: "gaming", budgetWon: 1_000_000, includeGpu: true, gamingGameIds: ["a", "b", "c", "d", "e", "f"] }).errors).toContain("gamingGameIds는 최대 5개의 비어 있지 않은 160자 이하 게임 ID 배열이어야 합니다.");
  });
});
