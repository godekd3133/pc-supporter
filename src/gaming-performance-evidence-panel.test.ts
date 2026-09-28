import { describe, expect, it } from "vitest";
import type { GamingPerformanceAssessment } from "../shared/types";
import { GamingPerformanceEvidencePanel } from "./GamingPerformanceEvidencePanel";

describe("GamingPerformanceEvidencePanel", () => {
  it("does not render measured FPS data to customers", () => {
    const assessment: GamingPerformanceAssessment = {
      status: "verified",
      gameIds: ["cyberpunk"],
      resolution: "1440p",
      refreshRate: 144,
      measurements: [{ recordId: "record-1", gameId: "cyberpunk", gpuName: "GPU", averageFps: 160, onePercentLowFps: 120, measuredAt: "2026-09-28T00:00:00.000Z", sourceUrl: "https://example.com/review" }],
      note: "verified"
    };

    expect(GamingPerformanceEvidencePanel({ assessment })).toBeNull();
  });
});
