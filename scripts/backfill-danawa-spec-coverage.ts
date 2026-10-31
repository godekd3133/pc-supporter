import { copyFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Part, PartSpecs } from "../shared/types";
import { appendCatalogChangeRecords, catalogChangeRecord, meaningfulCatalogChangeFields } from "../server/catalog-change-log";
import { readCatalogRecords, writeCatalogRecords } from "../server/repository";
import { CATALOG_CHANGE_LOG_PATH, writeJson } from "../server/storage";
import { reparseDanawaPart } from "../server/danawa";

// 카탈로그 읽기 경로(loadCatalog)는 이미 모든 다나와 행을 reparse하므로 견적과
// 호환성 판정에는 배포만으로 새 파싱이 반영된다. 이 스크립트는 PostgreSQL에
// 저장된 스펙도 같은 값으로 맞춰 관리자 화면/변경 로그가 읽기 경로와 어긋나지
// 않게 한다. 저장된 원문(rawSpecText)에서 읽은 값만 쓰고 가격/updatedAt은 건드리지 않는다.
const apply = process.argv.includes("--apply");
if (process.argv.slice(2).some((argument) => argument !== "--apply")) {
  throw new Error("Allowed option: --apply. Without it, this script only reports source-text backfills.");
}

const FIELDS: Partial<Record<Part["category"], Array<keyof PartSpecs>>> = {
  cpu: ["maxMemorySpeedMhz", "maxMemorySpeedMhzByType"],
  motherboard: ["maxMemorySpeedMhz", "fanPortCount", "pumpFanHeaderCount"],
  case: ["fanHubIncluded"],
  cooler: ["radiatorSizeMm"]
};

type Update = { before: Part; after: Part; fields: Array<keyof PartSpecs> };

function sameValue(a: unknown, b: unknown) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function backfillUpdates(parts: Part[]): Update[] {
  return parts.flatMap((part) => {
    const fields = FIELDS[part.category];
    if (!fields || part.source !== "danawa") return [];
    const reparsed = reparseDanawaPart(part);
    const changed = fields.filter((field) => !sameValue(part.specs[field], reparsed.specs[field]));
    if (changed.length === 0) return [];
    const specs: PartSpecs = { ...part.specs };
    for (const field of changed) {
      if (reparsed.specs[field] === undefined) delete specs[field];
      else specs[field] = reparsed.specs[field] as never;
    }
    return [{ before: part, after: { ...part, specs }, fields: changed }];
  });
}

function fieldCounts(updates: Update[]) {
  const counts: Record<string, number> = {};
  for (const { before, fields } of updates) {
    for (const field of fields) counts[`${before.category}.${field}`] = (counts[`${before.category}.${field}`] ?? 0) + 1;
  }
  return counts;
}

const parts = await readCatalogRecords();
const updates = backfillUpdates(parts);
const changesAt = new Date().toISOString();

if (apply) {
  if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is required; the catalog lives only in PostgreSQL.");
  const latest = await readCatalogRecords();
  const latestById = new Map(latest.map((part) => [part.id, part]));
  for (const { before } of updates) {
    const current = latestById.get(before.id);
    if (!current || current.rawSpecText !== before.rawSpecText) {
      throw new Error(`Catalog changed during backfill planning; re-run the dry-run before applying: ${before.id}`);
    }
  }
  const latestUpdates = backfillUpdates(latest);
  const latestPlanned = new Map(latestUpdates.map(({ before, after }) => [before.id, after]));
  const latestChangeRecords = latestUpdates.flatMap(({ before, after }) => {
    const changedFields = meaningfulCatalogChangeFields(before, after);
    return changedFields.length > 0 ? [catalogChangeRecord("part", before, after, changedFields, { changedAt: changesAt })] : [];
  });
  const backupDirectory = await mkdtemp(join(tmpdir(), "pc-supporter-spec-coverage-backfill-"));
  await writeJson(join(backupDirectory, "catalog.json"), latest);
  await copyFile(CATALOG_CHANGE_LOG_PATH, join(backupDirectory, "catalog-change-log.json"));
  try {
    await writeCatalogRecords(latest.map((part) => latestPlanned.get(part.id) ?? part));
    await appendCatalogChangeRecords(latestChangeRecords);
  } catch (error) {
    await writeCatalogRecords(JSON.parse(await readFile(join(backupDirectory, "catalog.json"), "utf8")));
    await writeJson(CATALOG_CHANGE_LOG_PATH, JSON.parse(await readFile(join(backupDirectory, "catalog-change-log.json"), "utf8")));
    throw new Error(`Backfill failed after backup was saved at ${backupDirectory}: ${error instanceof Error ? error.message : String(error)}`);
  }
  console.log(JSON.stringify({
    mode: "apply",
    updated: latestUpdates.length,
    fields: fieldCounts(latestUpdates),
    changeLogRecords: latestChangeRecords.length,
    backupDirectory
  }, null, 2));
} else {
  console.log(JSON.stringify({
    mode: "dry-run",
    updated: updates.length,
    fields: fieldCounts(updates),
    pricesOrUpdatedAtChanged: false
  }, null, 2));
}
