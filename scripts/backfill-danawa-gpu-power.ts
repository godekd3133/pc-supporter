import { copyFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Part } from "../shared/types";
import { appendCatalogChangeRecords, catalogChangeRecord, meaningfulCatalogChangeFields } from "../server/catalog-change-log";
import { readCatalogRecords, writeCatalogRecords } from "../server/repository";
import { CATALOG_CHANGE_LOG_PATH, writeJson } from "../server/storage";
import { parseGpuPowerW } from "../server/danawa";

const apply = process.argv.includes("--apply");
if (process.argv.slice(2).some((argument) => argument !== "--apply")) {
  throw new Error("Allowed option: --apply. Without it, this script only reports exact source-text backfills.");
}

type Update = { before: Part; after: Part };

function backfillUpdates(parts: Part[]): Update[] {
  return parts.flatMap((part) => {
    if (part.category !== "gpu" || part.source !== "danawa" || part.specs.powerW !== undefined || !part.missingFields.includes("powerW")) return [];
    const powerW = parseGpuPowerW(part.rawSpecText ?? "");
    if (powerW === undefined || !Number.isFinite(powerW) || powerW <= 0) return [];
    const missingFields = part.missingFields.filter((field) => field !== "powerW");
    const after: Part = {
      ...part,
      specs: { ...part.specs, powerW },
      missingFields,
      dataQuality: missingFields.length === 0 ? "live" : "incomplete"
    };
    return [{ before: part, after }];
  });
}

function completeGpuCount(parts: Part[]) {
  return parts.filter((part) => part.category === "gpu" && part.missingFields.length === 0).length;
}

const parts = await readCatalogRecords();
const updates = backfillUpdates(parts);
const planned = new Map(updates.map(({ before, after }) => [before.id, after]));
const projected = parts.map((part) => planned.get(part.id) ?? part);
const changesAt = new Date().toISOString();
const changeRecords = updates.flatMap(({ before, after }) => {
  const changedFields = meaningfulCatalogChangeFields(before, after);
  return changedFields.length > 0 ? [catalogChangeRecord("part", before, after, changedFields, { changedAt: changesAt })] : [];
});

if (apply) {
  if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is required; the catalog lives only in PostgreSQL.");
  const latest = await readCatalogRecords();
  const latestById = new Map(latest.map((part) => [part.id, part]));
  for (const { before } of updates) {
    const current = latestById.get(before.id);
    if (!current || current.specs.powerW !== undefined || current.rawSpecText !== before.rawSpecText || !current.missingFields.includes("powerW")) {
      throw new Error(`Catalog changed during backfill planning; re-run the dry-run before applying: ${before.id}`);
    }
  }
  const latestUpdates = backfillUpdates(latest);
  const latestPlanned = new Map(latestUpdates.map(({ before, after }) => [before.id, after]));
  const latestChangeRecords = latestUpdates.flatMap(({ before, after }) => {
    const changedFields = meaningfulCatalogChangeFields(before, after);
    return changedFields.length > 0 ? [catalogChangeRecord("part", before, after, changedFields, { changedAt: changesAt })] : [];
  });
  const backupDirectory = await mkdtemp(join(tmpdir(), "pc-supporter-gpu-power-backfill-"));
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
    completedGpuSpecsBefore: completeGpuCount(latest),
    completedGpuSpecsAfter: completeGpuCount(latest.map((part) => latestPlanned.get(part.id) ?? part)),
    changeLogRecords: latestChangeRecords.length,
    backupDirectory
  }, null, 2));
} else {
  console.log(JSON.stringify({
    mode: "dry-run",
    updated: updates.length,
    completedGpuSpecsBefore: completeGpuCount(parts),
    completedGpuSpecsAfter: completeGpuCount(projected),
    powerValuesFromExistingDanawaRawText: updates.length,
    pricesOrUpdatedAtChanged: false
  }, null, 2));
}
