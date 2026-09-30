import { beforeEach, describe, expect, it } from "vitest";
import type { BuildGenerationRequest } from "../shared/types";
import {
  generationRequestSummaryFor,
  recentGenerationFailures,
  recordGenerationFailure,
  resetGenerationFailuresForTest,
  type GenerationFailureRecord
} from "./generation-failure-log";

const request: BuildGenerationRequest = {
  profile: "gaming",
  priority: "performance",
  budgetWon: 800_000,
  includeGpu: true,
  gamingResolution: "1080p",
  gamingRefreshRate: 60,
  gamingGameIds: ["league"],
  memoryCapacityGb: 32,
  storageCapacityGb: 1_000
};

describe("generation failure log", () => {
  beforeEach(() => resetGenerationFailuresForTest());

  it("records a structured failure with the request shape, diagnostics, and recovery ids", () => {
    const sink: GenerationFailureRecord[] = [];
    recordGenerationFailure({
      route: "/api/builds/recommend",
      statusCode: 422,
      error: new Error("요청 예산 800,000원 안에 자동 구성을 찾지 못했습니다."),
      request,
      diagnostics: [{
        id: "budget-infeasible",
        title: "요청 예산 안에 자동 구성이 없습니다.",
        summary: "...",
        facts: [{ label: "요청 예산", value: "800,000원" }, { label: "가장 낮은 후보 합계", value: "987,950원" }],
        recommendation: "..."
      }],
      recoveryOptionIds: ["without-discrete-gpu", "budget-minimum-viable"],
      requestId: "req-123"
    }, (record) => sink.push(record));

    expect(sink).toHaveLength(1);
    const record = sink[0];
    expect(record.event).toBe("builds.generation.failed");
    expect(record.requestId).toBe("req-123");
    expect(record.statusCode).toBe(422);
    expect(record.request).toMatchObject({ profile: "gaming", budgetWon: 800_000, gamingResolution: "1080p", memoryCapacityGb: 32 });
    expect(record.diagnostics.map((d) => d.id)).toEqual(["budget-infeasible"]);
    expect(record.recoveryOptionIds).toEqual(["without-discrete-gpu", "budget-minimum-viable"]);
    expect(recentGenerationFailures()).toHaveLength(1);
    expect(recentGenerationFailures()[0]).toBe(record);
  });

  it("caps the recent buffer and returns newest first", () => {
    for (let i = 0; i < 205; i += 1) {
      recordGenerationFailure(
        { route: "/api/builds/recommend", statusCode: 422, error: new Error(`fail-${i}`), request },
        () => undefined
      );
    }
    const recent = recentGenerationFailures(500);
    expect(recent).toHaveLength(200);
    expect(recent[0].error).toBe("fail-204");
    expect(recent[199].error).toBe("fail-5");
  });

  it("summarizes request fields without unbounded payloads", () => {
    const summary = generationRequestSummaryFor({
      ...request,
      gamingGameIds: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]
    });
    expect(summary.gamingGameIds).toHaveLength(8);
    expect(summary).not.toHaveProperty("catalog");
  });

  it("never throws when the sink fails", () => {
    expect(() => recordGenerationFailure(
      { route: "/api/builds/recommend", statusCode: 422, error: "boom", request },
      () => { throw new Error("sink down"); }
    )).not.toThrow();
    expect(recentGenerationFailures()).toHaveLength(1);
  });
});
