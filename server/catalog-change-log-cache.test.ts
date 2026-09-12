import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CatalogChangeRecord } from "../shared/types";
import { describe, expect, it, vi } from "vitest";

const changeRecord = (id: string): CatalogChangeRecord => ({
  id,
  kind: "part",
  itemId: `part-${id}`,
  itemName: `테스트 ${id}`,
  category: "cpu",
  changedAt: "2026-09-10T00:00:00.000Z",
  changedFields: [],
  previousDataQuality: "incomplete",
  nextDataQuality: "incomplete",
  previousMissingFields: [],
  nextMissingFields: [],
  valueDiffs: []
});

describe("catalog change log snapshot loader", () => {
  it("coalesces unchanged reads and refreshes after the file changes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-catalog-change-log-cache-"));
    const previousDataDirectory = process.env.PC_SUPPORTER_DATA_DIR;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    process.env.DATABASE_URL = "";
    vi.resetModules();

    try {
      const [{ CATALOG_CHANGE_LOG_PATH, writeJson }, changeLog] = await Promise.all([
        import("./storage"),
        import("./catalog-change-log")
      ]);
      const firstRecord = changeRecord("change-1");
      await writeJson(CATALOG_CHANGE_LOG_PATH, [firstRecord]);

      const [first, second] = await Promise.all([
        changeLog.readCatalogChangeLog(),
        changeLog.readCatalogChangeLog()
      ]);
      expect(first).toBe(second);
      expect(first).toEqual([firstRecord]);

      const secondRecord = changeRecord("change-2");
      await changeLog.appendCatalogChangeRecords([secondRecord]);
      const refreshed = await changeLog.readCatalogChangeLog();

      expect(refreshed).not.toBe(first);
      expect(refreshed).toEqual([secondRecord, firstRecord]);

      await new Promise((resolve) => setTimeout(resolve, 10));
      const thirdRecord = changeRecord("change-3");
      await writeJson(CATALOG_CHANGE_LOG_PATH, [thirdRecord, secondRecord, firstRecord]);
      const externallyRefreshed = await changeLog.readCatalogChangeLog();

      expect(externallyRefreshed).not.toBe(refreshed);
      expect(externallyRefreshed).toEqual([thirdRecord, secondRecord, firstRecord]);
    } finally {
      if (previousDataDirectory === undefined) delete process.env.PC_SUPPORTER_DATA_DIR;
      else process.env.PC_SUPPORTER_DATA_DIR = previousDataDirectory;
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
      vi.resetModules();
      await rm(directory, { recursive: true, force: true });
    }
  }, 10_000);
});
