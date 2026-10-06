import { describe, expect, it } from "vitest";
import { buildPerformanceReportFor, cpuVideoPerformanceRowFor, gpuGamingIndexFor, gpuVideoPerformanceRowFor, GPU_VIDEO_PERFORMANCE_SOURCE, CPU_VIDEO_PERFORMANCE_SOURCE } from "./relative-performance-index";
import type { Part } from "./types";

function gpu(model: string, vramGb?: number): Part {
  return { id: model, category: "gpu", name: model, model, specs: { vramGb }, source: "seed", dataQuality: "seed", missingFields: [], updatedAt: "2026-10-04T00:00:00.000Z" };
}

describe("video-derived relative gaming performance", () => {
  it("raises the estimated frame stability for the 5600 to 7500F to X3D CPU upgrade path", () => {
    const cpu = (model: string, cores: number): Part => ({ ...gpu(model), category: "cpu", specs: { cores, threads: cores * 2 } });
    expect(buildPerformanceReportFor({ cpu: cpu("5600", 6) }).frameStability).toBe("medium");
    expect(buildPerformanceReportFor({ cpu: cpu("7500F", 6) }).frameStability).toBe("high");
    expect(buildPerformanceReportFor({ cpu: cpu("7800X3D", 8) }).frameStability).toBe("very_high");
  });
  it("uses the specified video's QHD column and Ti model precedence", () => {
    expect(gpuGamingIndexFor(gpu("RTX 5090", 32))).toBe(265.5);
    expect(gpuGamingIndexFor(gpu("RTX 5080", 16))).toBe(191.7);
    expect(gpuGamingIndexFor(gpu("RTX 5070 Ti", 16))).toBe(171.1);
    expect(gpuGamingIndexFor(gpu("RTX 5070", 12))).toBe(139.3);
    expect(gpuGamingIndexFor(gpu("RTX 5060", 8))).toBe(84.3);
    expect(gpuGamingIndexFor(gpu("RTX 5050", 8))).toBe(71.1);
  });

  it("distinguishes 5060 Ti VRAM variants and does not assert an unconfirmed variant", () => {
    expect(gpuGamingIndexFor(gpu("RTX 5060 Ti", 16))).toBe(100);
    expect(gpuGamingIndexFor(gpu("RTX 5060 Ti", 8))).toBe(97.4);
    expect(gpuGamingIndexFor(gpu("RTX 5060 Ti D7 8GB"))).toBe(97.4);
    expect(gpuVideoPerformanceRowFor(gpu("RTX 5060 Ti"))).toBeUndefined();
    expect(gpuGamingIndexFor(gpu("RTX 5060 Ti"))).toBeUndefined();
  });

  it("distinguishes source-verified rows from legacy estimates", () => {
    const verified = buildPerformanceReportFor({ gpu: gpu("RTX 5060 Ti", 16) });
    expect(verified.gamingEvidenceKind).toBe("video_table");
    expect(verified.gamingSource).toBe(GPU_VIDEO_PERFORMANCE_SOURCE.url);
    expect(GPU_VIDEO_PERFORMANCE_SOURCE.resolution).toBe("QHD");
    expect(GPU_VIDEO_PERFORMANCE_SOURCE.referenceModel).toBe("RTX 5060 Ti 16GB");
    const legacy = buildPerformanceReportFor({ gpu: gpu("RTX 2060", 6) });
    expect(legacy.gamingEvidenceKind).toBe("model_estimate");
    expect(legacy.gamingSource).toBeUndefined();
    expect(buildPerformanceReportFor({ gpu: gpu("Unknown GPU") }).gamingEvidenceKind).toBeUndefined();
  });

  it("uses the video's exact CPU percentages and separates the dual-cache variant", () => {
    const cpu = (model: string): Part => ({ ...gpu(model), category: "cpu", specs: { cores: 8, threads: 16, boostClockGhz: 5 } });
    expect(cpuVideoPerformanceRowFor(cpu("9800X3D"))?.single).toBe(107.1);
    expect(cpuVideoPerformanceRowFor(cpu("9950X3D"))?.multi).toBe(173.0);
    expect(cpuVideoPerformanceRowFor(cpu("9950X3D2"))?.multi).toBe(179.3);
    const report = buildPerformanceReportFor({ cpu: cpu("5500GT") });
    expect(report.singleCorePercent).toBe(73.4);
    expect(report.multiCorePercent).toBe(45.7);
    expect(report.cpuEvidenceKind).toBe("video_table");
    expect(CPU_VIDEO_PERFORMANCE_SOURCE.singleReferenceModel).toBe("Core i5-13600K");
    expect(CPU_VIDEO_PERFORMANCE_SOURCE.multiReferenceModel).toBe("Core i5-14600K");
  });
});
