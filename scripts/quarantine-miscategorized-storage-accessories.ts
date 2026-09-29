import { copyFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AccessoryItem } from "../shared/types";
import { inferListingType } from "../server/listing";
import { readCatalogRecords } from "../server/repository";
import { ACCESSORIES_PATH, DATA_DIR, readJson, removeGeneratedFile, withSerializedFileMutation, writeJson } from "../server/storage";

const QUARANTINE_PATH = resolve(DATA_DIR, "accessory-category-quarantine.json");
const MISCLASSIFIED_SOURCE_CATEGORY_ID = "112760";
const apply = process.argv.includes("--apply");
if (process.argv.slice(2).some((argument) => argument !== "--apply")) {
  throw new Error("Allowed option: --apply. Without it, this script only reports storage-category classification candidates.");
}

type QuarantineItem = {
  quarantinedAt: string;
  reason: "duplicate-core-storage-product-code" | "not-an-accessory-under-shared-listing-policy";
  inferredListingType: string;
  duplicateCorePartId?: string;
  item: AccessoryItem;
};
type QuarantineDocument = { schemaVersion: 1; updatedAt: string; items: QuarantineItem[] };

function inferredStorageListingType(item: AccessoryItem) {
  return inferListingType({ category: "ssd", name: item.name, rawSpecText: item.rawSpecText });
}

function quarantineCandidates(items: AccessoryItem[], corePartIdByCode: Map<string, string>, quarantinedAt: string) {
  return items.flatMap((item) => {
    if (item.category !== "storage_accessory" || item.source !== "danawa" || item.sourceCategoryId !== MISCLASSIFIED_SOURCE_CATEGORY_ID) return [];
    const inferredListingType = inferredStorageListingType(item);
    const duplicateCorePartId = item.sourceProductCode ? corePartIdByCode.get(item.sourceProductCode) : undefined;
    if (inferredListingType === "accessory" && !duplicateCorePartId) return [];
    return [{
      quarantinedAt,
      reason: duplicateCorePartId
        ? "duplicate-core-storage-product-code" as const
        : "not-an-accessory-under-shared-listing-policy" as const,
      inferredListingType,
      duplicateCorePartId,
      item
    }];
  });
}

function countsByListingType(items: AccessoryItem[]) {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const listingType = inferredStorageListingType(item);
    counts[listingType] = (counts[listingType] ?? 0) + 1;
  }
  return counts;
}

if (process.env.DATABASE_URL?.trim()) throw new Error("This bounded migration only supports the file-backed accessory catalog; DATABASE_URL must be unset.");
const [accessories, coreParts, existingQuarantine] = await Promise.all([
  readJson<AccessoryItem[]>(ACCESSORIES_PATH, []),
  readCatalogRecords(),
  readJson<QuarantineDocument | null>(QUARANTINE_PATH, null)
]);
const corePartIdByCode = new Map(coreParts.filter((part) => part.sourceProductCode).map((part) => [part.sourceProductCode!, part.id]));
const classifiedStorageItems = accessories.filter((item) => item.category === "storage_accessory" && item.source === "danawa" && item.sourceCategoryId === MISCLASSIFIED_SOURCE_CATEGORY_ID);
const quarantinedAt = new Date().toISOString();
const candidates = quarantineCandidates(accessories, corePartIdByCode, quarantinedAt);
const removedIds = new Set(candidates.map(({ item }) => item.id));
const projected = accessories.filter((item) => !removedIds.has(item.id));

if (apply) {
  const backupDirectory = await mkdtemp(join(tmpdir(), "pc-supporter-storage-accessory-quarantine-"));
  await withSerializedFileMutation(ACCESSORIES_PATH, async () => {
    const latest = await readJson<AccessoryItem[]>(ACCESSORIES_PATH, []);
    const latestCandidates = quarantineCandidates(latest, corePartIdByCode, new Date().toISOString());
    if (latestCandidates.length === 0) throw new Error("No miscategorized storage accessory rows remain to quarantine.");
    await copyFile(ACCESSORIES_PATH, join(backupDirectory, "accessories.json"));
    let previousQuarantine: QuarantineDocument | null = null;
    let quarantineText: string | undefined;
    try {
      quarantineText = await readFile(QUARANTINE_PATH, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (quarantineText) {
      previousQuarantine = JSON.parse(quarantineText) as QuarantineDocument;
      if (previousQuarantine.schemaVersion !== 1 || !Array.isArray(previousQuarantine.items)) throw new Error("Existing storage accessory quarantine has an unsupported format.");
      await copyFile(QUARANTINE_PATH, join(backupDirectory, "accessory-category-quarantine.json"));
    }
    const existingIds = new Set(previousQuarantine?.items.map(({ item }) => item.id) ?? []);
    const appended = latestCandidates.filter(({ item }) => !existingIds.has(item.id));
    const quarantine: QuarantineDocument = {
      schemaVersion: 1,
      updatedAt: quarantinedAt,
      items: [...(previousQuarantine?.items ?? []), ...appended]
    };
    const latestRemovedIds = new Set(latestCandidates.map(({ item }) => item.id));
    try {
      await writeJson(ACCESSORIES_PATH, latest.filter((item) => !latestRemovedIds.has(item.id)));
      await writeJson(QUARANTINE_PATH, quarantine);
    } catch (error) {
      await writeJson(ACCESSORIES_PATH, JSON.parse(await readFile(join(backupDirectory, "accessories.json"), "utf8")));
      if (previousQuarantine) {
        await writeJson(QUARANTINE_PATH, previousQuarantine);
      } else await removeGeneratedFile(QUARANTINE_PATH);
      throw new Error(`Storage accessory quarantine failed after backup was saved at ${backupDirectory}: ${error instanceof Error ? error.message : String(error)}`);
    }
    console.log(JSON.stringify({
      mode: "apply",
      sourceCategoryId: MISCLASSIFIED_SOURCE_CATEGORY_ID,
      removedFromAccessoryCatalog: latestCandidates.length,
      duplicateCoreRowsQuarantined: latestCandidates.filter(({ duplicateCorePartId }) => Boolean(duplicateCorePartId)).length,
      nonAccessoryRowsQuarantined: latestCandidates.filter(({ reason }) => reason === "not-an-accessory-under-shared-listing-policy").length,
      preservedAccessoryTypeRowsFromMisroutedSource: latest.filter((item) => item.category === "storage_accessory" && item.source === "danawa" && item.sourceCategoryId === MISCLASSIFIED_SOURCE_CATEGORY_ID && inferredStorageListingType(item) === "accessory").length,
      quarantineFile: QUARANTINE_PATH,
      backupDirectory
    }, null, 2));
  });
} else {
  console.log(JSON.stringify({
    mode: "dry-run",
    sourceCategoryId: MISCLASSIFIED_SOURCE_CATEGORY_ID,
    sourceRows: classifiedStorageItems.length,
    inferredListingTypes: countsByListingType(classifiedStorageItems),
    quarantineCandidates: candidates.length,
    duplicateCoreRows: candidates.filter(({ duplicateCorePartId }) => Boolean(duplicateCorePartId)).length,
    nonAccessoryRowsBySharedPolicy: candidates.filter(({ reason }) => reason === "not-an-accessory-under-shared-listing-policy").length,
    accessoryRowsRetainedForProductLevelReview: classifiedStorageItems.length - candidates.length,
    projectedAccessoryCount: projected.length,
    priorQuarantineEntries: existingQuarantine?.items.length ?? 0
  }, null, 2));
}
