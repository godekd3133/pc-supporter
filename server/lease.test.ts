import { randomUUID } from "node:crypto";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withFileLease } from "./lease";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function lockPath() {
  const directory = await mkdtemp(resolve(tmpdir(), "pc-supporter-lease-"));
  temporaryDirectories.push(directory);
  return resolve(directory, `lease-${randomUUID()}.lock`);
}

describe("file lease", () => {
  it("runs the operation exclusively and removes the lock afterwards", async () => {
    const path = await lockPath();
    await expect(withFileLease(path, async () => "done")).resolves.toEqual({ acquired: true, value: "done" });
    await expect(writeFile(path, "second", "utf8")).resolves.toBeUndefined();
  });

  it("skips a fresh lock held by another process", async () => {
    const path = await lockPath();
    await writeFile(path, "fresh", "utf8");
    let called = false;
    await expect(withFileLease(path, async () => { called = true; return "wrong"; }, { staleMs: 60 * 60 * 1000 })).resolves.toEqual({ acquired: false });
    expect(called).toBe(false);
  });

  it("recovers an explicitly stale lock and cleans up its replacement", async () => {
    const path = await lockPath();
    const staleAt = new Date(Date.now() - 10_000);
    await writeFile(path, JSON.stringify({ pid: process.pid, ownerId: "test", acquiredAt: staleAt.toISOString() }), "utf8");
    await utimes(path, staleAt, staleAt);
    await expect(withFileLease(path, async () => "recovered", { staleMs: 1_000 })).resolves.toEqual({ acquired: true, value: "recovered" });
    await expect(writeFile(path, "after", "utf8")).resolves.toBeUndefined();
  });
});
