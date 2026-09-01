import { randomUUID } from "node:crypto";
import { stat, unlink } from "node:fs/promises";
import { createExclusiveFile, removeGeneratedFile } from "./storage";

export const DEFAULT_FILE_LEASE_STALE_MS = 2 * 60 * 60 * 1000;

export type FileLeaseResult<T> =
  | { acquired: true; value: T }
  | { acquired: false };

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error) && typeof error === "object" && (error as NodeJS.ErrnoException).code === "EEXIST";
}

function isMissingError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error) && typeof error === "object" && (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function staleFileLease(path: string, staleMs: number, now: number) {
  try {
    const leaseStat = await stat(path);
    return now - leaseStat.mtimeMs >= staleMs;
  } catch (error: unknown) {
    if (isMissingError(error)) return false;
    throw error;
  }
}

export async function withFileLease<T>(path: string, operation: () => Promise<T>, options: { staleMs?: number; now?: () => number } = {}): Promise<FileLeaseResult<T>> {
  const staleMs = Math.max(1_000, Math.floor(options.staleMs ?? DEFAULT_FILE_LEASE_STALE_MS));
  const now = options.now ?? Date.now;
  let acquired = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await createExclusiveFile(path, JSON.stringify({ pid: process.pid, ownerId: randomUUID(), acquiredAt: new Date(now()).toISOString() }));
      acquired = true;
      break;
    } catch (error: unknown) {
      if (!isAlreadyExistsError(error)) throw error;
      if (!await staleFileLease(path, staleMs, now())) return { acquired: false };
      await unlink(path).catch((unlinkError: unknown) => {
        if (!isMissingError(unlinkError)) throw unlinkError;
      });
    }
  }
  if (!acquired) return { acquired: false };
  try {
    return { acquired: true, value: await operation() };
  } finally {
    await removeGeneratedFile(path);
  }
}
