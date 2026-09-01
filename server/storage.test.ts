import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readJson, withSerializedFileMutation, writeJson } from "./storage";

describe("serialized file mutations", () => {
  it("preserves every read-modify-write update under concurrent callers", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-storage-"));
    const path = join(directory, "counter.json");
    try {
      await writeJson(path, 0);
      await Promise.all(Array.from({ length: 20 }, () => withSerializedFileMutation(path, async () => {
        const current = await readJson<number>(path, 0);
        await new Promise((resolve) => setTimeout(resolve, 1));
        await writeJson(path, current + 1);
      })));
      expect(await readJson<number>(path, 0)).toBe(20);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
