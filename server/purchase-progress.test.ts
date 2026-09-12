import { describe, expect, it } from "vitest";
import { parseSavedBuildPurchaseProgress, parseSavedBuildPurchaseProgressExpectedRevision, parseSavedBuildPurchaseProgressRevision, savedBuildPurchaseProgressFromUnknown, savedBuildPurchaseProgressHistoryTargetFor, savedBuildPurchaseProgressRevisionMatchesFor, savedBuildPurchaseProgressWithNextRevisionFor } from "./purchase-progress";

const progress = (overrides: Record<string, unknown> = {}) => ({ inputFingerprint: "build-fingerprint-1", rowKeys: ["part:cpu:cpu-a", "part:gpu:gpu-a"], checkedIds: ["part:cpu:cpu-a"], revision: 3, updatedAt: "2026-09-02T00:00:00.000Z", ...overrides });

describe("saved build purchase progress", () => {
  it("accepts a bounded progress payload and stamps the server update time", () => {
    const parsed = parseSavedBuildPurchaseProgress(progress(), "build-fingerprint-1", "2026-09-02T01:00:00.000Z");
    expect(parsed.errors).toEqual([]);
    expect(parsed.progress).toMatchObject({ inputFingerprint: "build-fingerprint-1", checkedIds: ["part:cpu:cpu-a"], revision: 1, updatedAt: "2026-09-02T01:00:00.000Z" });
    expect(savedBuildPurchaseProgressFromUnknown(parsed.progress)).toEqual(parsed.progress);
  });

  it("normalizes staged item states and keeps legacy checked IDs compatible", () => {
    const parsed = parseSavedBuildPurchaseProgress(progress({
      checkedIds: ["part:cpu:cpu-a"],
      itemStates: [
        { rowKey: "part:cpu:cpu-a", status: "ordered", updatedAt: "2026-09-02T00:30:00.000Z" },
        { rowKey: "part:gpu:gpu-a", status: "installed", updatedAt: "2026-09-02T00:31:00.000Z" }
      ]
    }), "build-fingerprint-1", "2026-09-02T01:00:00.000Z");
    expect(parsed.errors).toEqual([]);
    expect(parsed.progress?.checkedIds).toEqual(["part:gpu:gpu-a"]);
    expect(parsed.progress?.itemStates).toHaveLength(2);
    expect(savedBuildPurchaseProgressFromUnknown(parsed.progress)?.itemStates?.[0].status).toBe("ordered");
  });

  it("fails closed for a different fingerprint, duplicate IDs, and unknown checked rows", () => {
    expect(parseSavedBuildPurchaseProgress(progress({ inputFingerprint: "other" }), "build-fingerprint-1")).toMatchObject({ fingerprintMismatch: true, errors: ["현재 저장 견적과 다른 구매 진행률입니다."] });
    expect(parseSavedBuildPurchaseProgress(progress({ rowKeys: ["row", "row"] }), "build-fingerprint-1").errors[0]).toContain("중복");
    expect(parseSavedBuildPurchaseProgress(progress({ checkedIds: ["removed"] }), "build-fingerprint-1").errors[0]).toContain("현재 구매 목록");
  });

  it("rejects malformed persisted records without affecting valid records", () => {
    expect(savedBuildPurchaseProgressFromUnknown({ ...progress(), checkedIds: ["removed"] })).toBeUndefined();
    expect(savedBuildPurchaseProgressFromUnknown({ ...progress(), updatedAt: "bad-date" })).toBeUndefined();
    expect(savedBuildPurchaseProgressFromUnknown(progress())).toMatchObject({ inputFingerprint: "build-fingerprint-1" });
    expect(savedBuildPurchaseProgressFromUnknown({ ...progress(), revision: undefined })).toMatchObject({ revision: 1 });
    expect(savedBuildPurchaseProgressFromUnknown({ ...progress(), revision: 0 })).toBeUndefined();
  });

  it("requires the expected server revision and increments it on a server write", () => {
    expect(parseSavedBuildPurchaseProgressExpectedRevision(undefined)).toMatchObject({ revision: null, error: undefined });
    expect(parseSavedBuildPurchaseProgressExpectedRevision(null)).toMatchObject({ revision: null, error: undefined });
    expect(parseSavedBuildPurchaseProgressExpectedRevision(3)).toMatchObject({ revision: 3, error: undefined });
    expect(parseSavedBuildPurchaseProgressExpectedRevision(-1).error).toContain("expectedRevision");
    const current = savedBuildPurchaseProgressFromUnknown(progress());
    const next = savedBuildPurchaseProgressWithNextRevisionFor(parseSavedBuildPurchaseProgress(progress(), "build-fingerprint-1").progress!, current, "2026-09-02T02:00:00.000Z");
    expect(next).toMatchObject({ revision: 4, updatedAt: "2026-09-02T02:00:00.000Z" });
    expect(savedBuildPurchaseProgressRevisionMatchesFor(current, 3)).toBe(true);
    expect(savedBuildPurchaseProgressRevisionMatchesFor(current, 2)).toBe(false);
    expect(savedBuildPurchaseProgressRevisionMatchesFor(undefined, null)).toBe(true);
  });

  it("keeps a bounded revision history and selects only valid previous states", () => {
    const current = savedBuildPurchaseProgressFromUnknown({
      ...progress(),
      history: [
        { inputFingerprint: "build-fingerprint-1", rowKeys: ["part:cpu:cpu-a", "part:gpu:gpu-a"], checkedIds: [], revision: 2, updatedAt: "2026-09-02T00:30:00.000Z" },
        { inputFingerprint: "build-fingerprint-1", rowKeys: ["part:cpu:cpu-a", "part:gpu:gpu-a"], checkedIds: ["part:gpu:gpu-a"], revision: 2, updatedAt: "2026-09-02T00:31:00.000Z" },
        { inputFingerprint: "build-fingerprint-1", rowKeys: ["part:cpu:cpu-a"], checkedIds: ["removed"], revision: 1, updatedAt: "bad-date" }
      ]
    });
    expect(current?.history).toHaveLength(1);
    expect(current?.history?.[0].revision).toBe(2);
    expect(savedBuildPurchaseProgressHistoryTargetFor(current, 2)?.checkedIds).toEqual([]);
    expect(savedBuildPurchaseProgressHistoryTargetFor(current, 1)).toBeUndefined();
    const next = savedBuildPurchaseProgressWithNextRevisionFor(current!.history![0], current, "2026-09-02T02:00:00.000Z");
    expect(next.revision).toBe(4);
    expect(next.history?.map((entry) => entry.revision)).toEqual([3, 2]);
    expect(parseSavedBuildPurchaseProgressRevision(4)).toMatchObject({ revision: 4, error: undefined });
    expect(parseSavedBuildPurchaseProgressRevision(0).error).toContain("revision");
  });

  it("rejects persisted histories above the twenty-revision contract before normalizing them", () => {
    const oversizedHistory = Array.from({ length: 21 }, (_, index) => ({
      inputFingerprint: "build-fingerprint-1",
      rowKeys: ["part:cpu:cpu-a", "part:gpu:gpu-a"],
      checkedIds: [],
      revision: index + 1,
      updatedAt: `2026-09-02T00:${String(index).padStart(2, "0")}:00.000Z`
    }));
    expect(savedBuildPurchaseProgressFromUnknown({ ...progress(), history: oversizedHistory })).toBeUndefined();
  });
});
