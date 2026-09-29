import { describe, expect, it } from "vitest";
import { requiredDirectoryArgument } from "./private-catalog-import-args";

describe("private catalog import source path", () => {
  it("requires an explicit source directory instead of silently reading data", () => {
    expect(() => requiredDirectoryArgument(["--dry-run"], "--source-dir"))
      .toThrow("--source-dir 경로를 명시해야 합니다. 기본 data 경로는 자동으로 읽지 않습니다.");
  });

  it("resolves the explicitly provided source directory", () => {
    expect(requiredDirectoryArgument(["--source-dir", "/tmp/approved-catalog-copy"], "--source-dir"))
      .toBe("/tmp/approved-catalog-copy");
  });

  it("rejects a missing source directory value", () => {
    expect(() => requiredDirectoryArgument(["--source-dir", "--dry-run"], "--source-dir"))
      .toThrow("--source-dir 값이 필요합니다.");
  });
});
