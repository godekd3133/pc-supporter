import { copyFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Part } from "../shared/types";
import { appendCatalogChangeRecords, catalogChangeRecord, meaningfulCatalogChangeFields } from "../server/catalog-change-log";
import { readCatalogRecords, writeCatalogRecords } from "../server/repository";
import { CATALOG_CHANGE_LOG_PATH, CATALOG_PATH, writeJson } from "../server/storage";

const apply = process.argv.includes("--apply");
if (process.argv.slice(2).some((argument) => argument !== "--apply")) {
  throw new Error("Allowed option: --apply. Without it, this script only reports missing required case board-form-factor evidence.");
}

type Update = { before: Part; after: Part };

function hasBoardFormFactors(part: Part) {
  return Array.isArray(part.specs.motherboardFormFactors) && part.specs.motherboardFormFactors.length > 0;
}

function backfillUpdates(parts: Part[]): Update[] {
  return parts.flatMap((part) => {
    if (part.category !== "case" || hasBoardFormFactors(part) || part.missingFields.includes("motherboardFormFactors")) return [];
    const missingFields = [...part.missingFields, "motherboardFormFactors"];
    const after: Part = {
      ...part,
      missingFields,
      dataQuality: part.dataQuality === "live" ? "incomplete" : part.dataQuality
    };
    return [{ before: part, after }];
  });
}

function completeCaseCount(parts: Part[]) {
  return parts.filter((part) => part.category === "case" && part.missingFields.length === 0).length;
}

const parts = await readCatalogRecords();
const updates = backfillUpdates(parts);
const planned = new Map(updates.map(({ before, after }) => [before.id, after]));
const projected = parts.map((part) => planned.get(part.id) ?? part);

if (apply) {
  if (process.env.DATABASE_URL?.trim()) throw new Error("This bounded migration only writes file-backed catalogs; DATABASE_URL must be unset.");
  const latest = await readCatalogRecords();
  const latestById = new Map(latest.map((part) => [part.id, part]));
  for (const { before } of updates) {
    const current = latestById.get(before.id);
    if (!current || hasBoardFormFactors(current) || current.missingFields.includes("motherboardFormFactors")) {
      throw new Error(`Catalog changed during backfill planning; re-run the dry-run before applying: ${before.id}`);
    }
  }
  const latestUpdates = backfillUpdates(latest);
  const latestPlanned = new Map(latestUpdates.map(({ before, after }) => [before.id, after]));
  const changedAt = new Date().toISOString();
  const changeRecords = latestUpdates.flatMap(({ before, after }) => {
    const changedFields = meaningfulCatalogChangeFields(before, after);
    return changedFields.length > 0 ? [catalogChangeRecord("part", before, after, changedFields, { changedAt })] : [];
  });
  const backupDirectory = await mkdtemp(join(tmpdir(), "pc-supporter-case-form-factor-backfill-"));
  await copyFile(CATALOG_PATH, join(backupDirectory, "catalog.json"));
  await copyFile(CATALOG_CHANGE_LOG_PATH, join(backupDirectory, "catalog-change-log.json"));
  try {
    await writeCatalogRecords(latest.map((part) => latestPlanned.get(part.id) ?? part));
    await appendCatalogChangeRecords(changeRecords);
  } catch (error) {
    await writeJson(CATALOG_PATH, JSON.parse(await readFile(join(backupDirectory, "catalog.json"), "utf8")));
    await writeJson(CATALOG_CHANGE_LOG_PATH, JSON.parse(await readFile(join(backupDirectory, "catalog-change-log.json"), "utf8")));
    throw new Error(`Backfill failed after backup was saved at ${backupDirectory}: ${error instanceof Error ? error.message : String(error)}`);
  }
  console.log(JSON.stringify({
    mode: "apply",
    updated: latestUpdates.length,
    completeCasesBefore: completeCaseCount(latest),
    completeCasesAfter: completeCaseCount(latest.map((part) => latestPlanned.get(part.id) ?? part)),
    changeLogRecords: changeRecords.length,
    backupDirectory
  }, null, 2));
} else {
  console.log(JSON.stringify({
    mode: "dry-run",
    updated: updates.length,
    completeCasesBefore: completeCaseCount(parts),
    completeCasesAfter: completeCaseCount(projected),
    recordsMissingRequiredBoardFormats: updates.length
  }, null, 2));
}
