import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BuildHealthPanel, PerformanceIndexMetricsPanel } from "./ResultPanels";

describe("performance metric explanations", () => {
  it("renders all four metrics with keyboard and tap reachable question buttons", () => {
    const markup = renderToStaticMarkup(createElement(PerformanceIndexMetricsPanel, { hasGpu: true, report: { gamingEvidenceKind: "verified_video", gamingSource: { url: "https://youtu.be/iVL3KqqzlhM?t=650" }, gamingIndex: 139.3, frameStability: "high", singleCorePercent: 79, multiCorePercent: 31 } }));
    for (const metric of ["게임 성능", "프레임 안정성", "싱글코어 성능", "멀티코어 성능"]) {
      expect(markup).toContain(`aria-label="${metric} 설명"`);
    }
    expect(markup.match(/role="tooltip"/g)).toHaveLength(4);
    expect(markup).toContain("139.3%");
    expect(markup).toContain("높음");
    expect(markup).toContain("RTX 5060 Ti 16GB = 100%");
    expect(markup).toContain("참고 영상의 QHD");
  });

  it("labels unsupported GPUs as estimates rather than verified video measurements", () => {
    const markup = renderToStaticMarkup(createElement(PerformanceIndexMetricsPanel, { hasGpu: true, report: { gamingIndex: 42, gamingEvidenceKind: "estimate" } }));
    expect(markup).toContain("모델별 추정값");
    expect(markup).toContain("이 모델은 참고 영상에 없어 추정값을 표시합니다");
    expect(markup).not.toContain("GPU 테스트 영상</a>");
  });

  it("keeps missing measurements explicit rather than filling them with invented values", () => {
    const markup = renderToStaticMarkup(createElement(PerformanceIndexMetricsPanel, { hasGpu: true, report: {} }));
    expect(markup.match(/<strong>자료 없음<\/strong>/g)).toHaveLength(4);
    expect(markup).not.toContain("추정값을 표시합니다");
    expect(markup).not.toContain("<strong>0%</strong>");
  });

  it("links the verified CPU video and describes its two separate reference CPUs", () => {
    const markup = renderToStaticMarkup(createElement(PerformanceIndexMetricsPanel, { hasGpu: false, report: { cpuEvidenceKind: "video_table", cpuSource: "https://youtu.be/6NoegO2rlkE?t=180", singleCorePercent: 73.4, multiCorePercent: 45.7 } }));
    expect(markup).toContain('href="https://youtu.be/6NoegO2rlkE?t=180"');
    expect(markup).toContain("Core i5-13600K = 100%");
    expect(markup).toContain("Core i5-14600K = 100%");
    expect(markup).not.toContain("최상급 싱글코어(R23 2300점급)");
  });

  it("separates the frame-stability grade from an actual measured 1% low", () => {
    const markup = renderToStaticMarkup(createElement(PerformanceIndexMetricsPanel, { hasGpu: true, report: { frameStability: "very_high" } }));
    expect(markup).toContain("CPU 성능·캐시로 추정");
    expect(markup).toContain("게임별 1% low를 직접 측정한 결과는 아니에요");
  });

  it("keeps unknown GPU length visible when a GPU is selected", () => {
    const markup = renderToStaticMarkup(createElement(BuildHealthPanel, { gpuSelected: true, psuSelected: false, caseSelected: true, metrics: {} }));
    const gpuLengthRow = markup.split('<div class="health-item ').find((row) => row.includes("GPU 장착 길이"));
    expect(gpuLengthRow).toContain("길이 정보 없음");
    expect(gpuLengthRow).not.toContain("미선택");
    expect(gpuLengthRow).toMatch(/^warning"/);
  });
});
