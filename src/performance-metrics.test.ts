import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BuildHealthPanel, PerformanceIndexMetricsPanel } from "./ResultPanels";

describe("compact performance metrics", () => {
  it("renders only the four labels and values without help, captions or video links", () => {
    const markup = renderToStaticMarkup(createElement(PerformanceIndexMetricsPanel, { hasGpu: true, report: { gamingEvidenceKind: "verified_video", gamingSource: { url: "https://youtu.be/iVL3KqqzlhM?t=650" }, cpuEvidenceKind: "video_table", cpuSource: "https://youtu.be/6NoegO2rlkE?t=180", gamingIndex: 139.3, frameStability: "high", singleCorePercent: 79, multiCorePercent: 31 } }));
    for (const label of ["게임 성능", "프레임 안정성", "싱글코어 성능", "멀티코어 성능"]) expect(markup).toContain(label);
    for (const value of ["139.3%", "높음", "79%", "31%"]) expect(markup).toContain(`<strong>${value}</strong>`);
    for (const removed of ["<button", "role=\"tooltip\"", "<small", "<h2", "youtu.be", "?에서", "테스트 영상"]) expect(markup).not.toContain(removed);
  });

  it("keeps missing values explicit without inventing zero performance", () => {
    const markup = renderToStaticMarkup(createElement(PerformanceIndexMetricsPanel, { hasGpu: false, report: {} }));
    expect(markup.match(/<strong>자료 없음<\/strong>/g)).toHaveLength(4);
    expect(markup).not.toContain("<strong>0%</strong>");
  });

  it("keeps unknown GPU length visible when a GPU is selected", () => {
    const markup = renderToStaticMarkup(createElement(BuildHealthPanel, { gpuSelected: true, psuSelected: false, caseSelected: true, metrics: {} }));
    const gpuLengthRow = markup.split('<div class="health-item ').find((row) => row.includes("GPU 장착 길이"));
    expect(gpuLengthRow).toContain("길이 정보 없음");
    expect(gpuLengthRow).not.toContain("미선택");
    expect(gpuLengthRow).toMatch(/^warning"/);
  });
});
