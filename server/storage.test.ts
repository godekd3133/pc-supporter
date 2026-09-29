import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { filePersistenceIsReady, readJson, withSerializedFileMutation } from "./storage";

describe("JSON file persistence", () => {
  it("uses the fallback only when the file does not exist", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-storage-missing-"));
    const path = join(directory, "builds.json");
    try {
      await expect(readJson(path, [])).resolves.toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("preserves malformed persisted data instead of replacing it with a fallback on mutation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-storage-corrupt-"));
    const path = join(directory, "builds.json");
    const original = "{\"savedBuilds\":[";
    try {
      await writeFile(path, original, "utf8");

      await expect(withSerializedFileMutation(path, async () => {
        const builds = await readJson<{ savedBuilds: unknown[] }>(path, { savedBuilds: [] });
        await writeFile(path, JSON.stringify(builds), "utf8");
      })).rejects.toThrow(SyntaxError);

      await expect(readFile(path, "utf8")).resolves.toBe(original);
      await expect(filePersistenceIsReady()).resolves.toBe(false);

      await writeFile(path, "{\"savedBuilds\":[]}\n", "utf8");
      await expect(filePersistenceIsReady()).resolves.toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("propagates non-missing file access errors instead of treating them as missing data", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-storage-access-"));
    const blocker = join(directory, "not-a-directory");
    try {
      await writeFile(blocker, "file", "utf8");

      const inaccessiblePath = join(blocker, "builds.json");
      await expect(readJson(inaccessiblePath, [])).rejects.toMatchObject({ code: "ENOTDIR" });
      await expect(filePersistenceIsReady()).resolves.toBe(false);
      await rm(blocker);
      await expect(filePersistenceIsReady()).resolves.toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
