import { describe, expect, it } from "vitest";
import { generateBuildDraft } from "./engine";
import { seedCatalog } from "./seed-catalog";
import { REFERENCE_BUILDS, referenceBuildBudgetWeight } from "../shared/reference-builds";
import type { BuildGenerationRequest, Part } from "../shared/types";

const seedCpu = seedCatalog.find((part) => part.id === "cpu-7500f")!;
const seedGpu = seedCatalog.find((part) => part.id === "gpu-rtx-4060")!;

const sourced = (part: Part, id: string, name: string, model: string | undefined, priceWon: number, specs: Part["specs"] = {}): Part => ({
  ...part,
  id,
  name,
  model,
  priceWon,
  source: "danawa",
  sourceProductCode: id,
  listingType: "retail",
  dataQuality: "live",
  missingFields: [],
  specs: { ...part.specs, ...specs }
});

const catalogWith = (cpus: Part[], gpus: Part[]): Part[] =>
  seedCatalog.filter((part) => part.category !== "cpu" && part.category !== "gpu").concat(cpus, gpus);

const gamingRequest = (budgetWon: number): BuildGenerationRequest => ({
  profile: "gaming",
  priority: "balanced",
  budgetWon,
  includeGpu: true
});

describe("reference build guidance", () => {
  it("외장 GPU는 이미 고른 CPU 계열과 짝지어진 참조 견적의 GPU 계열을 우선한다", () => {
    const cpu = sourced(seedCpu, "cpu-7500x3d", "AMD 라이젠5-5세대 7500X3D (라파엘) (멀티팩 정품)", "7500X3D", 330_000);
    const referenceGpu = sourced(seedGpu, "gpu-rtx-5060ti", "기가바이트 RTX 5060 Ti WINDFORCE OC D7 8GB", "RTX 5060 Ti", 660_000, { vramGb: 8, gpuArchitectureFamily: "RTX 50" });
    // 참조 견적에 없는 계열 — 같은 성능 입력에 더 싼 가격으로 기본 선택이 되게 한다.
    const alternativeGpu = sourced(seedGpu, "gpu-rx-9060xt", "ASRock 라데온 RX 9060 XT 스틸레전드 OC D6 16GB", "RX 9060 XT", 600_000, { vramGb: 16, gpuArchitectureFamily: "RX 90" });
    const catalog = catalogWith([cpu], [alternativeGpu, referenceGpu]);

    const baseline = generateBuildDraft(catalog, gamingRequest(1_800_000), [], { referenceBuilds: [] });
    const guided = generateBuildDraft(catalog, gamingRequest(1_800_000));

    expect(baseline.lines.find((line) => line.category === "gpu")?.partId).toBe("gpu-rx-9060xt");
    expect(guided.lines.find((line) => line.category === "gpu")?.partId).toBe("gpu-rtx-5060ti");
  });

  it("CPU는 요청 예산 근처의 참조 견적에 등장하는 계열을 우선한다", () => {
    // 생성기는 출처가 검증된 벤치마크만 신뢰한다 — cinebench에 provenance를 달아
    // 실측 지수 경로를 통과시킨다. 없으면 모델명 추정치(7500X3D≈미상, 9600=신세대)
    // 로 떨어져 참조 계열이 지는 회귀가 생겼다.
    const cpuSpecs: Part["specs"] = {
      cores: 6,
      threads: 12,
      boostClockGhz: 4.8,
      cinebenchR23Single: 1_800,
      cinebenchR23Multi: 14_000,
      benchmarkProvenance: {
        sourceKind: "independent_review",
        sourceNote: "참조 견적 유도 회귀 테스트용 정보",
        updatedAt: "2026-09-05T00:00:00.000Z"
      }
    };
    const referenceCpu = sourced(seedCpu, "cpu-7500x3d", "AMD 라이젠5-5세대 7500X3D (라파엘)", "7500X3D", 330_000, cpuSpecs);
    const alternativeCpu = sourced(seedCpu, "cpu-9600", "AMD 라이젠5-6세대 9600 (그래니트 릿지)", "9600", 310_000, {
      ...cpuSpecs,
      boostClockGhz: 5.1,
      cinebenchR23Multi: 15_500
    });
    const gpu = sourced(seedGpu, "gpu-rtx-4060", "ZOTAC GeForce RTX 4060 Twin Edge", "RTX 4060", 440_000, { vramGb: 8, gpuArchitectureFamily: "RTX 40" });
    const catalog = catalogWith([alternativeCpu, referenceCpu], [gpu]);

    const baseline = generateBuildDraft(catalog, gamingRequest(1_800_000), [], { referenceBuilds: [] });
    const guided = generateBuildDraft(catalog, gamingRequest(1_800_000));

    expect(baseline.lines.find((line) => line.category === "cpu")?.partId).toBe("cpu-9600");
    expect(guided.lines.find((line) => line.category === "cpu")?.partId).toBe("cpu-7500x3d");
  });

  it("referenceBuilds를 빈 배열로 넘기면 참조 유도가 꺼진다", () => {
    const cpu = sourced(seedCpu, "cpu-7500x3d", "AMD 라이젠5-5세대 7500X3D (라파엘)", "7500X3D", 330_000);
    const referenceGpu = sourced(seedGpu, "gpu-rtx-5060ti", "기가바이트 RTX 5060 Ti WINDFORCE OC D7 8GB", "RTX 5060 Ti", 660_000, { vramGb: 8, gpuArchitectureFamily: "RTX 50" });
    const alternativeGpu = sourced(seedGpu, "gpu-rx-9060xt", "ASRock 라데온 RX 9060 XT 스틸레전드 OC D6 16GB", "RX 9060 XT", 600_000, { vramGb: 16, gpuArchitectureFamily: "RX 90" });
    const catalog = catalogWith([cpu], [alternativeGpu, referenceGpu]);

    const off = generateBuildDraft(catalog, gamingRequest(1_800_000), [], { referenceBuilds: [] });

    expect(off.lines.find((line) => line.category === "gpu")?.partId).toBe("gpu-rx-9060xt");
  });
});

describe("reference build table", () => {
  it("참조 견적표는 예산과 CPU 이름을 갖춘 견적들을 담는다", () => {
    expect(REFERENCE_BUILDS.length).toBeGreaterThanOrEqual(10);
    for (const build of REFERENCE_BUILDS) {
      expect(build.budgetWon).toBeGreaterThan(0);
      expect(build.parts.cpu).toBeTruthy();
    }
  });

  it("예산 거리 가중치는 같은 예산에서 1, 2배 차이에서 0이다", () => {
    expect(referenceBuildBudgetWeight(1_800_000, 1_800_000)).toBe(1);
    expect(referenceBuildBudgetWeight(1_800_000, 1_790_000)).toBeGreaterThan(0.95);
    expect(referenceBuildBudgetWeight(3_600_000, 1_800_000)).toBe(0);
    expect(referenceBuildBudgetWeight(900_000, 1_800_000)).toBe(0);
  });
});
