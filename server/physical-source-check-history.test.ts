import { describe, expect, it } from "vitest";
import { physicalSourceCheckHistoryEntriesFromUnknown, physicalSourceCheckHistoryEntryFor, physicalSourceCheckTransitionFor } from "./physical-source-check-history";

const sourceCheck = {
  requestedUrl: "https://vendor.example/manual",
  checkedAt: "2026-09-01T00:00:00.000Z",
  status: "reachable" as const,
  identityStatus: "matched" as const,
  redirectCount: 0,
  finalUrl: "https://vendor.example/manual",
  httpStatus: 200,
  contentType: "text/html",
  detail: "본문에서 모델을 확인했습니다."
};

describe("physical source check history", () => {
  it("creates a deterministic initial history entry", () => {
    const entry = physicalSourceCheckHistoryEntryFor("gpu-1", sourceCheck, undefined, "history-1", "2026-09-01T00:01:00.000Z");

    expect(entry).toEqual({ id: "history-1", partId: "gpu-1", recordedAt: "2026-09-01T00:01:00.000Z", sourceCheck, transition: "initial" });
  });

  it("ignores only the check timestamp when deciding whether a status changed", () => {
    const previous = physicalSourceCheckHistoryEntryFor("gpu-1", sourceCheck, undefined, "history-1", "2026-08-31T00:00:00.000Z");
    const repeated = { ...sourceCheck, checkedAt: "2026-09-02T00:00:00.000Z" };
    const changed = { ...repeated, status: "http_error" as const, identityStatus: "not_checked" as const, httpStatus: 404 };

    expect(physicalSourceCheckTransitionFor(previous, repeated)).toBe("unchanged");
    expect(physicalSourceCheckTransitionFor(previous, changed)).toBe("changed");
  });

  it("parses only bounded, well-formed persisted history entries", () => {
    const valid = physicalSourceCheckHistoryEntryFor("gpu-1", sourceCheck, undefined, "history-1", "2026-09-01T00:01:00.000Z");
    const parsed = physicalSourceCheckHistoryEntriesFromUnknown([valid, { ...valid, id: "bad", sourceCheck: { ...sourceCheck, status: "unknown" } }, { ...valid, id: "bad-redirect", sourceCheck: { ...sourceCheck, redirectCount: "0" } }]);

    expect(parsed).toEqual([valid]);
  });

  it("keeps the newest entries when the history file exceeds the retention limit", () => {
    const entries = Array.from({ length: 1_020 }, (_, index) => ({ id: `history-${index}`, partId: "gpu-1", recordedAt: `2026-09-01T00:${String(index % 60).padStart(2, "0")}:00.000Z`, sourceCheck, transition: "unchanged" as const }));

    const parsed = physicalSourceCheckHistoryEntriesFromUnknown(entries);

    expect(parsed).toHaveLength(1_000);
    expect(parsed[0].id).toBe("history-20");
    expect(parsed.at(-1)?.id).toBe("history-1019");
  });
});
