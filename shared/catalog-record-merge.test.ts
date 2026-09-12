import { describe, expect, it } from "vitest";
import { incomingCatalogRecordWins, mergeCatalogRecords } from "./catalog-record-merge";

type RecordValue = { id: string; updatedAt: string; name: string };

const record = (id: string, updatedAt: string, name: string): RecordValue => ({ id, updatedAt, name });

describe("catalog record merge", () => {
  it("rejects an older response from rolling a record back", () => {
    const current = record("cpu-a", "2026-09-08T01:00:00.000Z", "최신 CPU");
    const older = record("cpu-a", "2026-09-08T00:00:00.000Z", "이전 CPU");

    expect(incomingCatalogRecordWins(current, older)).toBe(false);
    expect(mergeCatalogRecords([current], [older])).toEqual([current]);
  });

  it("accepts a newer or equal-timestamp response", () => {
    const current = record("cpu-a", "2026-09-08T01:00:00.000Z", "현재 CPU");
    const newer = record("cpu-a", "2026-09-08T02:00:00.000Z", "갱신 CPU");
    const sameTimestamp = record("cpu-a", current.updatedAt, "같은 시각의 projection");

    expect(incomingCatalogRecordWins(current, newer)).toBe(true);
    expect(incomingCatalogRecordWins(current, sameTimestamp)).toBe(true);
    expect(mergeCatalogRecords([current], [newer])).toEqual([newer]);
  });

  it("treats invalid timestamps as unknown without discarding a valid record", () => {
    const current = record("cpu-a", "2026-09-08T01:00:00.000Z", "유효한 CPU");
    const invalid = record("cpu-a", "not-a-date", "잘못된 응답");

    expect(incomingCatalogRecordWins(current, invalid)).toBe(false);
    expect(mergeCatalogRecords([current], [invalid])).toEqual([current]);
    expect(incomingCatalogRecordWins(undefined, invalid)).toBe(true);
  });
});
