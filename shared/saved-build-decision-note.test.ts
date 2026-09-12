import { describe, expect, it } from "vitest";
import { SAVED_BUILD_DECISION_NOTE_MAX_LENGTH, SAVED_BUILD_METADATA_HISTORY_LIMIT, SAVED_BUILD_NAME_MAX_LENGTH, savedBuildDecisionNoteFromUnknown, savedBuildMetadataHistoryEntryFor, savedBuildMetadataHistoryFromUnknown, savedBuildMetadataHistoryWithNextEntryFor, savedBuildNameFromUnknown } from "./saved-build-decision-note";

describe("saved build decision note", () => {
  it("normalizes a bounded saved build name", () => {
    expect(savedBuildNameFromUnknown("  QHD 작업용 PC  ")).toBe("QHD 작업용 PC");
    expect(savedBuildNameFromUnknown("   ")).toBeUndefined();
    expect(savedBuildNameFromUnknown("x".repeat(SAVED_BUILD_NAME_MAX_LENGTH + 1))).toBeUndefined();
  });

  it("trims a bounded note and treats empty input as absent", () => {
    expect(savedBuildDecisionNoteFromUnknown("  QHD에서 소음 우선  ")).toBe("QHD에서 소음 우선");
    expect(savedBuildDecisionNoteFromUnknown("   ")).toBeUndefined();
    expect(savedBuildDecisionNoteFromUnknown(undefined)).toBeUndefined();
  });

  it("rejects notes over the public storage limit", () => {
    expect(savedBuildDecisionNoteFromUnknown("x".repeat(SAVED_BUILD_DECISION_NOTE_MAX_LENGTH + 1))).toBeUndefined();
    expect(savedBuildDecisionNoteFromUnknown("x".repeat(SAVED_BUILD_DECISION_NOTE_MAX_LENGTH))).toHaveLength(SAVED_BUILD_DECISION_NOTE_MAX_LENGTH);
  });

  it("keeps bounded before-and-after metadata history without exposing malformed entries", () => {
    const entry = savedBuildMetadataHistoryEntryFor({ name: "v1", decisionNote: "성능 우선" }, { name: "v2", decisionNote: "소음 우선" }, "2026-09-04T00:00:00.000Z");
    expect(entry).toMatchObject({ changedFields: ["name", "decisionNote"], previousName: "v1", previousDecisionNote: "성능 우선", nextName: "v2", nextDecisionNote: "소음 우선" });
    expect(savedBuildMetadataHistoryFromUnknown([entry, { changedAt: "bad", changedFields: ["name"], previousName: "", nextName: "v3" }])).toHaveLength(1);
    expect(savedBuildMetadataHistoryWithNextEntryFor([], entry)).toHaveLength(1);
  });

  it("rejects persisted metadata history above the twelve-entry contract before parsing entries", () => {
    const entries = Array.from({ length: SAVED_BUILD_METADATA_HISTORY_LIMIT + 1 }, (_, index) => savedBuildMetadataHistoryEntryFor({ name: `v${index}`, decisionNote: "이전" }, { name: `v${index + 1}`, decisionNote: "다음" }, `2026-09-04T00:${String(index).padStart(2, "0")}:00.000Z`)!);
    expect(savedBuildMetadataHistoryFromUnknown(entries)).toBeUndefined();
  });
});
