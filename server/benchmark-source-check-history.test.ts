import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

describe("benchmark source-check history", () => {
  it("records initial and changed source checks in an isolated store", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-benchmark-source-check-"));
    const previousDataDirectory = process.env.PC_SUPPORTER_DATA_DIR;
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    vi.resetModules();
    try {
      const { appendBenchmarkSourceCheckHistory, readBenchmarkSourceCheckHistory } = await import("./benchmark-source-check-history");
      const firstCheck = { requestedUrl: "https://example.com/benchmark", checkedAt: "2026-09-03T00:00:00.000Z", status: "reachable" as const, identityStatus: "matched" as const, redirectCount: 0, httpStatus: 200 };
      const secondCheck = { ...firstCheck, checkedAt: "2026-09-03T01:00:00.000Z", status: "identity_mismatch" as const, identityStatus: "not_found" as const, detail: "모델 식별 실패" };

      expect((await appendBenchmarkSourceCheckHistory("cpu-1", firstCheck)).transition).toBe("initial");
      expect((await appendBenchmarkSourceCheckHistory("cpu-1", secondCheck)).transition).toBe("changed");
      expect(await readBenchmarkSourceCheckHistory("cpu-1", 2)).toMatchObject([
        { partId: "cpu-1", transition: "changed", sourceCheck: { status: "identity_mismatch" } },
        { partId: "cpu-1", transition: "initial", sourceCheck: { status: "reachable" } }
      ]);
    } finally {
      if (previousDataDirectory === undefined) delete process.env.PC_SUPPORTER_DATA_DIR;
      else process.env.PC_SUPPORTER_DATA_DIR = previousDataDirectory;
      await rm(directory, { recursive: true, force: true });
    }
  });
});
