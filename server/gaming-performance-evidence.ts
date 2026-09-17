import { existsSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gamingPerformanceEvidenceBatchValidationFor, gamingPerformanceEvidenceFromJson } from "../shared/gaming-performance-evidence";
import type { GamingPerformanceEvidenceRecord } from "../shared/gaming-performance-evidence";
import { DATA_DIR, withSerializedFileMutation, writeJson } from "./storage";

type EvidenceCache = { path: string; mtimeMs: number; records: GamingPerformanceEvidenceRecord[] } | undefined;
let cache: EvidenceCache;

export function gamingPerformanceEvidencePath() {
  return process.env.GAMING_PERFORMANCE_EVIDENCE_PATH?.trim() || resolve(DATA_DIR, "gaming-performance-evidence.json");
}

export function loadGamingPerformanceEvidence(): GamingPerformanceEvidenceRecord[] {
  const path = gamingPerformanceEvidencePath();
  if (!existsSync(path)) return [];
  try {
    const mtimeMs = statSync(path).mtimeMs;
    if (cache?.path === path && cache.mtimeMs === mtimeMs) return cache.records;
    const records = gamingPerformanceEvidenceFromJson(readFileSync(path, "utf8"));
    cache = { path, mtimeMs, records };
    return records;
  } catch {
    return [];
  }
}

export function invalidateGamingPerformanceEvidenceCache() {
  cache = undefined;
}

export async function saveGamingPerformanceEvidence(records: readonly GamingPerformanceEvidenceRecord[]) {
  const path = gamingPerformanceEvidencePath();
  await withSerializedFileMutation(path, async () => {
    await writeJson(path, records);
    invalidateGamingPerformanceEvidenceCache();
  });
  return loadGamingPerformanceEvidence();
}

export async function readGamingPerformanceEvidenceFile() {
  const path = gamingPerformanceEvidencePath();
  try {
    return gamingPerformanceEvidenceBatchValidationFor(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return gamingPerformanceEvidenceBatchValidationFor([]);
  }
}
