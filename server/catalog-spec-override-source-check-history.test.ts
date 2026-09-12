import { describe, expect, it } from "vitest";
import { catalogSpecOverrideSourceCheckHistoryEntriesFromUnknown } from "./catalog-spec-override-source-check-history";

const sourceCheck = { requestedUrl: "https://vendor.example/spec", checkedAt: "2026-09-03T00:00:00.000Z", status: "reachable" as const, identityStatus: "matched" as const, redirectCount: 0, finalUrl: "https://vendor.example/spec", httpStatus: 200, contentType: "text/html", detail: "모델 확인" };

describe("catalog spec override source-check history", () => {
  it("accepts valid transitions and removes malformed entries", () => {
    const entries = catalogSpecOverrideSourceCheckHistoryEntriesFromUnknown([
      { id: "check-1", partId: "gpu-1", recordedAt: "2026-09-03T00:00:00.000Z", sourceCheck, transition: "initial" },
      { id: "bad", partId: "gpu-1", recordedAt: "2026-09-03T00:00:00.000Z", sourceCheck: { ...sourceCheck, identityStatus: "unknown" }, transition: "changed" },
      { id: "bad-transition", partId: "gpu-1", recordedAt: "2026-09-03T00:00:00.000Z", sourceCheck, transition: "invalid" }
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: "check-1", partId: "gpu-1", transition: "initial", sourceCheck: { identityStatus: "matched" } });
  });
});
