import { describe, expect, it, vi } from "vitest";
import { SAVED_BUILD_MONITOR_LIMIT } from "../shared/saved-build-monitor";
import { parseSavedBuildMonitorRequest } from "./build-monitor";

describe("saved build monitor request", () => {
  it("normalizes and deduplicates bounded IDs", () => {
    expect(parseSavedBuildMonitorRequest({ ids: [" build-a ", "build-b", "build-a"] })).toEqual({ ids: ["build-a", "build-b"], errors: [] });
  });

  it("rejects missing, malformed, empty, and oversized requests", () => {
    expect(parseSavedBuildMonitorRequest(undefined).errors).toContain("ids 배열이 필요합니다.");
    expect(parseSavedBuildMonitorRequest({ ids: [] }).errors).toContain("확인할 저장 견적 ID가 없습니다.");
    expect(parseSavedBuildMonitorRequest({ ids: [""] }).errors[0]).toContain("ids[0]");
    const oversized = parseSavedBuildMonitorRequest({ ids: Array.from({ length: SAVED_BUILD_MONITOR_LIMIT + 1 }, (_, index) => `build-${index}`) });
    expect(oversized.ids).toHaveLength(SAVED_BUILD_MONITOR_LIMIT);
    expect(oversized.errors[0]).toContain(`최대 ${SAVED_BUILD_MONITOR_LIMIT}개`);
  });

  it("tracks duplicate IDs without scanning the accepted list for every input", () => {
    const includesSpy = vi.spyOn(Array.prototype, "includes");
    try {
      const result = parseSavedBuildMonitorRequest({ ids: Array.from({ length: 5_000 }, (_, index) => `build-${index}`) });
      expect(result.ids).toHaveLength(SAVED_BUILD_MONITOR_LIMIT);
      expect(result.errors[0]).toContain(`최대 ${SAVED_BUILD_MONITOR_LIMIT}개`);
      expect(includesSpy).not.toHaveBeenCalled();
    } finally {
      includesSpy.mockRestore();
    }
  });
});
