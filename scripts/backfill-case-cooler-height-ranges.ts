import "dotenv/config";
import { copyFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { CatalogChangeRecord, Part } from "../shared/types";
import { parseCaseCoolerHeightMm } from "../server/danawa";
import { appendCatalogChangeRecords, catalogChangeRecord, meaningfulCatalogChangeFields } from "../server/catalog-change-log";
import { CATALOG_CHANGE_LOG_PATH, CATALOG_PATH, DATA_DIR, readJson, removeGeneratedFile, writeJson } from "../server/storage";

const { values, positionals } = parseArgs({
  options: { apply: { type: "boolean", default: false } },
  strict: true,
  allowPositionals: true
});

if (positionals.length > 0) throw new Error("Only --apply is supported.");
if (process.env.DATABASE_URL?.trim()) throw new Error("This bounded backfill only supports the file-backed core catalog; unset DATABASE_URL.");
if (DATA_DIR !== resolve(process.cwd(), "data")) throw new Error("This backfill writes only this checkout's data folder; unset PC_SUPPORTER_DATA_DIR.");

const [catalog, detailImportState] = await Promise.all([
  readJson<Part[]>(CATALOG_PATH, []),
  readJson<{ status?: string } | null>(join(DATA_DIR, "accessory-detail-import-state.json"), null)
]);
if (values.apply && detailImportState?.status === "running") {
  throw new Error("Accessory detail enrichment is still updating the shared catalog change log; retry this backfill after it completes.");
}
const changedAt = new Date().toISOString();
const updates: Array<{ before: Part; after: Part }> = [];
for (const before of catalog) {
  if (before.category !== "case" || before.specs.maxCoolerHeightMm !== undefined || !before.rawSpecText) continue;
  const maxCoolerHeightMm = parseCaseCoolerHeightMm(before.rawSpecText);
  if (maxCoolerHeightMm === undefined) continue;
  const missingFields = before.missingFields.filter((field) => field !== "maxCoolerHeightMm");
  const after: Part = {
    ...before,
    specs: { ...before.specs, maxCoolerHeightMm },
    missingFields,
    dataQuality: missingFields.length === 0 ? "live" : before.dataQuality,
    updatedAt: changedAt
  };
  updates.push({ before, after });
}

const changeRecords = updates.flatMap(({ before, after }) => {
  const changedFields = meaningfulCatalogChangeFields(before, after);
  return changedFields.length > 0 ? [catalogChangeRecord("part", before, after, changedFields, { changedAt })] : [];
});
const projected = new Map(catalog.map((part) => [part.id, part]));
for (const update of updates) projected.set(update.after.id, update.after);
const output = {
  mode: values.apply ? "apply" : "dry-run",
  dataDirectory: DATA_DIR,
  source: "explicit mm ranges in existing Danawa raw case specification text; upper endpoint used as clearance maximum",
  candidates: updates.map(({ before, after }) => ({ id: before.id, name: before.name, sourceProductCode: before.sourceProductCode, valueBefore: before.specs.maxCoolerHeightMm, valueAfter: after.specs.maxCoolerHeightMm, remainingMissingFields: after.missingFields })),
  count: updates.length,
  projectedCompleteCases: [...projected.values()].filter((part) => part.category === "case" && part.missingFields.length === 0).length,
  catalogChangeRecords: changeRecords.length
};

if (!values.apply) {
  console.log(JSON.stringify(output, null, 2));
} else {
  if (updates.length === 0) throw new Error("No unparsed, explicitly bounded cooler-height ranges remain.");
  const backupDirectory = await mkdtemp(join(tmpdir(), "pc-supporter-case-cooler-height-backfill-"));
  await copyFile(CATALOG_PATH, join(backupDirectory, "catalog.json"));
  let hadChangeLog = false;
  try {
    await copyFile(CATALOG_CHANGE_LOG_PATH, join(backupDirectory, "catalog-change-log.json"));
    hadChangeLog = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    const updateById = new Map(updates.map((update) => [update.before.id, update.after]));
    await writeJson(CATALOG_PATH, catalog.map((part) => updateById.get(part.id) ?? part));
    await appendCatalogChangeRecords(changeRecords);
    console.log(JSON.stringify({ ...output, backupDirectory }, null, 2));
  } catch (error) {
    await writeJson(CATALOG_PATH, JSON.parse(await readFile(join(backupDirectory, "catalog.json"), "utf8")));
    if (hadChangeLog) await copyFile(join(backupDirectory, "catalog-change-log.json"), CATALOG_CHANGE_LOG_PATH);
    else await removeGeneratedFile(CATALOG_CHANGE_LOG_PATH);
    throw new Error(`Case cooler-height backfill failed; prior files were restored from ${backupDirectory}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
