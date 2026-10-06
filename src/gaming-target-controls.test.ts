import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GpuVendorToggle, AMD_VENDOR_HELP } from "./GpuVendorToggle";
import { GeneratorGamingTargetControls } from "./GeneratorGamingTargetControls";
import type { GeneratorGamingTargetControlsProps } from "./GeneratorGamingTargetControls";
import { GamingTargetAssessmentPanel } from "./GamingTargetAssessmentPanel";
import { gamingTargetAssessmentFor } from "../shared/gaming-target-assessment";
import type { GamingFpsReference } from "../shared/gaming-target-assessment";

const noop = () => undefined;
const controls: GeneratorGamingTargetControlsProps = {
  mode: "target_fps", vendor: "nvidia", gameIds: ["cyberpunk"], resolution: "1440p", refreshRate: 144, targetFps: "120", graphicsPreset: "high", rayTracing: false, upscaling: "native", disabled: false,
  onMode: noop, onVendor: noop, onGames: noop, onResolution: noop, onRefreshRate: noop, onTargetFps: noop, onGraphicsPreset: noop, onRayTracing: noop, onUpscaling: noop
};

const reference: GamingFpsReference = {
  id: "cyberpunk-reference", gameId: "cyberpunk", cpuModel: "9800X3D", gpuModel: "RTX 5070", gpuVramGb: 12,
  resolution: "1440p", graphicsPreset: "high", sourcePreset: "Ultra", rayTracing: false, upscaling: "native", upscaler: "none", frameGeneration: false,
  averageFps: 93.4, onePercentLowFps: 73, memoryType: "DDR5", memorySpeedMhz: 6000, memoryCapacityGb: 32, memoryModuleCount: 2, memoryTiming: "CL30", driverVersion: "576.80",
  sourceKind: "independent_review", sourceUrl: "https://example.com/gpu-review", sourceTitle: "GPU test", publishedAt: "2026-10-01T00:00:00Z", verifiedAt: "2026-10-02T00:00:00Z", sourceNote: "동일 구간 평균 FPS"
};

describe("game target controls", () => {
  it("has an accessible vendor choice and the requested hover explanation", () => {
    const markup = renderToStaticMarkup(createElement(GpuVendorToggle, { value: "nvidia", onChange: noop }));
    expect(markup).toContain('role="radiogroup" aria-label="그래픽카드 제조사"');
    expect(markup).toContain('role="radio" aria-checked="true"');
    expect(markup).toContain('aria-label="NVIDIA와 AMD 선택 설명"');
    expect(markup).toContain('role="tooltip" hidden=""');
    expect(markup).toContain(AMD_VENDOR_HELP);
  });

  it("renders a custom FPS separately from monitor refresh and blocks a sixth game", () => {
    const markup = renderToStaticMarkup(createElement(GeneratorGamingTargetControls, { ...controls, gameIds: ["league", "valorant", "pubg", "cyberpunk", "lostark"] }));
    expect(markup).toContain('data-testid="generator-target-fps"');
    expect(markup).toContain('value="120"');
    expect(markup).toContain('value="144" selected=""');
    expect(markup).toContain("5개 선택");
    expect(markup).toMatch(/type="checkbox" disabled=""/);
  });

  it("keeps the budget-only branch free of hidden game-target controls", () => {
    const markup = renderToStaticMarkup(createElement(GeneratorGamingTargetControls, { ...controls, mode: "budget" }));
    expect(markup).toContain("예산 안에서 GPU 성능 우선");
    expect(markup).not.toContain('data-testid="generator-target-fps"');
    expect(markup).not.toContain("모니터 주사율");
    expect(markup).toContain('data-testid="gpu-vendor-amd"');
  });
});

describe("game target result evidence", () => {
  it("labels raw reference FPS and exposes CPU, RAM, environment differences and a usable source", () => {
    const assessment = gamingTargetAssessmentFor([reference], { gameIds: ["cyberpunk"], cpuName: "AMD 라이젠 7500F", gpuName: "RTX 5070 12GB", gpuVramGb: 12, resolution: "1440p", targetFps: 60, graphicsPreset: "high", upscaling: "native", memoryType: "DDR5", memorySpeedMhz: 5600, memoryCapacityGb: 16 }, "2026-10-05T00:00:00Z");
    const markup = renderToStaticMarkup(createElement(GamingTargetAssessmentPanel, { assessment, targetFps: 60, gameIds: ["cyberpunk"] }));
    expect(markup).toContain('data-target-status="projected"');
    expect(markup).toContain("출처의 평균 FPS");
    expect(markup).toContain("93.4 FPS");
    expect(markup).toContain("이 견적을 직접 측정한 FPS가 아닙니다");
    expect(markup).toContain("9800X3D");
    expect(markup).toContain("6000MHz");
    expect(markup).toContain("32GB");
    expect(markup).toContain("CL30");
    expect(markup).toContain('href="https://example.com/gpu-review"');
    expect(markup).toContain("다른 PC에서 측정한 값");
    expect(markup).not.toContain("같은 환경에서 목표 달성");
    const collapsedDetails = markup.match(/<details class="gaming-target-source-conditions">([^]*?)<\/details>/)?.[1];
    expect(collapsedDetails).toContain("이 견적과 다른 부분");
    expect(collapsedDetails).toContain("CPU:");
    expect(collapsedDetails).toContain("RAM 속도:");
    expect(markup.split('<details class="gaming-target-source-conditions">')[0]).not.toContain("RAM 속도:");
  });

  it("keeps missing game evidence visible without inventing absolute FPS", () => {
    const markup = renderToStaticMarkup(createElement(GamingTargetAssessmentPanel, { targetFps: 144, gameIds: ["pubg"], onEditConditions: noop }));
    expect(markup).toContain("비교할 FPS 자료가 없어요");
    expect(markup).toContain("배틀그라운드");
    expect(markup).toContain("게임 조건 다시 고르기");
    expect(markup).not.toContain("출처의 평균 FPS");
    expect(markup).not.toContain("목표 달성");
  });
});
