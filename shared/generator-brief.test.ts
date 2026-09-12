import { describe, expect, it } from "vitest";
import { generatorBriefInterpretationFor } from "./generator-brief";

describe("generator brief interpretation", () => {
  it("parses a Korean gaming brief into deterministic generator fields", () => {
    const interpretation = generatorBriefInterpretationFor("QHD 게이밍 220만원, RAM 32GB, SSD 2TB, HDD 2개 4TB, 144Hz 외장 그래픽, 정식 유통");
    expect(interpretation.config).toEqual({
      profile: "gaming",
      gamingResolution: "1440p",
      gamingRefreshRate: 144,
      budgetWon: 2_200_000,
      memoryCapacityGb: 32,
      storageCapacityGb: 2000,
      hddCount: 2,
      hddCapacityGb: 4000,
      includeGpu: true,
      listingPolicy: "retail_only"
    });
    expect(interpretation.matches).toHaveLength(10);
    expect(interpretation.warnings).toEqual([]);
    expect(interpretation.confidence).toBe("high");
    expect(interpretation.coverage).toEqual({ matched: 7, total: 7, missing: [] });
    expect(interpretation.guidance).toEqual([]);
  });

  it("supports developer briefs with explicit integrated graphics", () => {
    const interpretation = generatorBriefInterpretationFor("개발·AI용 250만원, RAM 64기가, SSD 2TB, 내장 그래픽, 가성비");
    expect(interpretation.config).toMatchObject({ profile: "development", priority: "budget", budgetWon: 2_500_000, memoryCapacityGb: 64, storageCapacityGb: 2000, includeGpu: false });
    expect(interpretation.matches.map((match) => match.field)).toEqual(expect.arrayContaining(["profile", "priority", "budgetWon", "memoryCapacityGb", "storageCapacityGb", "includeGpu"]));
  });

  it("does not silently coerce unsupported capacities", () => {
    const interpretation = generatorBriefInterpretationFor("QHD 180만원, RAM 48GB, SSD 3TB, HDD 3개");
    expect(interpretation.config).toMatchObject({ profile: "gaming", gamingResolution: "1440p", budgetWon: 1_800_000 });
    expect(interpretation.config.memoryCapacityGb).toBeUndefined();
    expect(interpretation.config.storageCapacityGb).toBeUndefined();
    expect(interpretation.config.hddCount).toBeUndefined();
    expect(interpretation.warnings).toHaveLength(3);
    expect(interpretation.confidence).toBe("low");
  });

  it("keeps the current GPU choice when the brief conflicts", () => {
    const interpretation = generatorBriefInterpretationFor("게이밍인데 내장 그래픽만, 외장 그래픽 포함");
    expect(interpretation.config.includeGpu).toBeUndefined();
    expect(interpretation.warnings[0]).toContain("조건이 함께 감지");
    expect(interpretation.confidence).toBe("low");
  });

  it("interprets a verification-first priority from natural language", () => {
    const interpretation = generatorBriefInterpretationFor("검증 우선 200만원 게이밍 PC");
    expect(interpretation.config.priority).toBe("reliability");
    expect(interpretation.matches).toEqual(expect.arrayContaining([expect.objectContaining({ field: "priority", value: "검증 우선" })]));
  });

  it("accepts spaced profile and priority phrases", () => {
    expect(generatorBriefInterpretationFor("영상 편집 PC, 성능 우선").config).toMatchObject({ profile: "creator", priority: "performance" });
    expect(generatorBriefInterpretationFor("웹 서핑용 PC, 예산 우선").config).toMatchObject({ profile: "office", priority: "budget" });
  });

  it("reports missing core fields and offers explicit follow-up phrases", () => {
    const interpretation = generatorBriefInterpretationFor("게이밍 200만원");
    expect(interpretation.coverage).toEqual({ matched: 3, total: 7, missing: ["RAM 목표", "SSD 목표", "게임 해상도", "목표 주사율"] });
    expect(interpretation.guidance).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "memory", phrase: "RAM 32GB" }),
      expect.objectContaining({ id: "storage", phrase: "SSD 1TB" }),
      expect.objectContaining({ id: "gaming-resolution", phrase: "QHD" }),
      expect.objectContaining({ id: "gaming-refresh", phrase: "144Hz" })
    ]));
    expect(interpretation.guidance).toHaveLength(4);
  });

  it("explains when no supported condition was found", () => {
    const interpretation = generatorBriefInterpretationFor("조용하고 예쁜 컴퓨터");
    expect(interpretation.config).toEqual({});
    expect(interpretation.matches).toEqual([]);
    expect(interpretation.warnings[0]).toContain("해석할 수 있는 조건");
    expect(interpretation.confidence).toBe("low");
  });
});
