import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ACCESSORY_CATEGORIES, type AccessoryCategory, type AccessoryItem, type Part, type PartCategory } from "../shared/types";
import { assessAccessorySpecProfile } from "../server/accessory-spec-coverage";

type SourceProduct = { productCode?: string | number };
type SourcePage = { totalCount?: number; totalPages?: number; products?: SourceProduct[] };
type SourceCategory = {
  category?: PartCategory;
  categoryId?: string;
  label?: string;
  status?: string;
  pages?: Record<string, SourcePage>;
};
type SourceManifest = { categories?: Record<string, SourceCategory> };
type InventoryCheckpoint = { entries?: Record<string, { status?: string; reason?: string }> };

const projectRoot = process.cwd();
const sourceDataDirectory = resolve(projectRoot, "data");
const publicOutputDirectory = resolve(projectRoot, process.env.PC_SUPPORTER_BUILD_OUT_DIR?.trim() || "dist", "catalog-data");
const privateOutputDirectory = resolve(projectRoot, "dist-local", "data");
const requiredSources = ["catalog.json", "accessories.json"];
const privateSourceAllowlist = [
  "catalog.json",
  "accessories.json",
  "catalog-change-log.json",
  "catalog-spec-refresh-history.json",
  "catalog-spec-overrides.json",
  "catalog-spec-override-source-check-history.json",
  "benchmark-overrides.json",
  "benchmark-source-check-history.json",
  "gaming-performance-evidence.json",
  "m2-slot-overrides.json",
  "gpu-physical-overrides.json",
  "physical-source-check-history.json",
  "case-rgb-load-overrides.json",
  "cooling-fan-load-overrides.json",
  "danawa-pc9-all-pages.json",
  "danawa-pc9-detail-checkpoint.json",
  "danawa-accessory-all-pages.json",
  "accessory-coverage.json",
  "accessory-crawl-manifest.json",
  "accessory-crawl-state.json",
  "accessory-detail-import-state.json",
  "price-refresh-state.json",
  "price-refresh-attempts.json",
  "accessory-list-reconciliation.json",
  "accessory-category-quarantine.json"
];

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function sha256(path: string) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function writeJson(path: string, value: unknown) {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function qualityCounts(items: Array<{ dataQuality?: string }>) {
  return items.reduce<Record<string, number>>((counts, item) => {
    const quality = item.dataQuality ?? "unknown";
    counts[quality] = (counts[quality] ?? 0) + 1;
    return counts;
  }, {});
}

function categoryCounts(items: Array<{ category?: string }>) {
  return items.reduce<Record<string, number>>((counts, item) => {
    const category = item.category ?? "unknown";
    counts[category] = (counts[category] ?? 0) + 1;
    return counts;
  }, {});
}

function completeCount(items: Array<{ dataQuality?: string; missingFields?: string[] }>) {
  return items.filter((item) => item.dataQuality !== "incomplete" && (item.missingFields?.length ?? 0) === 0).length;
}

type AccessorySpecAssessmentCounts = { complete: number; partial: number; notAssessed: number };

function accessorySpecAssessmentSummary(items: AccessoryItem[]) {
  const byCategory = Object.fromEntries(ACCESSORY_CATEGORIES.map((category) => [category, {
    complete: 0,
    partial: 0,
    notAssessed: 0,
    profiles: {} as Record<string, AccessorySpecAssessmentCounts & { total: number; assessed: number }>
  }])) as Record<AccessoryCategory, {
    complete: number;
    partial: number;
    notAssessed: number;
    profiles: Record<string, AccessorySpecAssessmentCounts & { total: number; assessed: number }>;
  }>;

  for (const item of items) {
    const assessments = assessAccessorySpecProfile(item);
    const categoryCounts = byCategory[item.category];
    const itemStatus = assessments.some((assessment) => assessment.status === "partial")
      ? "partial"
      : assessments.length === 0 || assessments.some((assessment) => assessment.status === "not_assessed")
        ? "notAssessed"
        : "complete";
    categoryCounts[itemStatus] += 1;

    for (const assessment of assessments) {
      const profileCounts = categoryCounts.profiles[assessment.profile] ??= { total: 0, assessed: 0, complete: 0, partial: 0, notAssessed: 0 };
      profileCounts.total += 1;
      profileCounts[assessment.status === "not_assessed" ? "notAssessed" : assessment.status] += 1;
      if (assessment.status !== "not_assessed") profileCounts.assessed += 1;
    }
  }

  const totals = Object.values(byCategory).reduce((result, category) => ({
    complete: result.complete + category.complete,
    partial: result.partial + category.partial,
    notAssessed: result.notAssessed + category.notAssessed
  }), { complete: 0, partial: 0, notAssessed: 0 });
  return { ...totals, byCategory };
}

function sourceInventorySummary(manifest: SourceManifest, selectedCategoryIds?: Set<string>) {
  const categories = Object.entries(manifest.categories ?? {}).filter(([categoryId]) => !selectedCategoryIds || selectedCategoryIds.has(categoryId));
  const codesByCategory = new Map<string, Set<string>>();
  let expectedProductCount = 0;
  let expectedPages = 0;
  let observedPages = 0;
  const categoryReports = categories.map(([categoryId, category]) => {
    const pages = Object.entries(category.pages ?? {});
    const pageOne = category.pages?.["1"];
    const totalCount = pageOne?.totalCount;
    if (typeof totalCount === "number") expectedProductCount += totalCount;
    expectedPages += Math.max(0, ...pages.map(([, page]) => page.totalPages ?? 0), pageOne?.totalPages ?? 0);
    observedPages += pages.length;
    const codes = new Set(pages.flatMap(([, page]) => (page.products ?? []).flatMap((product) => {
      const code = String(product.productCode ?? "");
      return /^\d+$/.test(code) ? [code] : [];
    })));
    codesByCategory.set(`${category.category ?? "unknown"}:${categoryId}`, codes);
    return {
      category: category.category ?? "unknown",
      categoryId,
      label: category.label ?? "",
      status: category.status ?? "unknown",
      expectedProducts: totalCount,
      observedUniqueProducts: codes.size,
      observedPages: pages.length
    };
  });
  const observedUniqueProducts = [...codesByCategory.values()].reduce((total, codes) => total + codes.size, 0);
  return {
    expectedProducts: expectedProductCount,
    observedUniqueProducts,
    unobservedProducts: Math.max(0, expectedProductCount - observedUniqueProducts),
    expectedPages,
    observedPages,
    pageCoveragePercent: expectedPages === 0 ? null : Number(((observedPages / expectedPages) * 100).toFixed(2)),
    listComplete: categoryReports.length > 0 && categoryReports.every((category) => category.status === "complete" && category.expectedProducts === category.observedUniqueProducts),
    categories: categoryReports
  };
}

function sourceProductKeys(manifest: SourceManifest, selectedCategoryIds?: Set<string>) {
  const keys = new Set<string>();
  for (const [categoryId, category] of Object.entries(manifest.categories ?? {})) {
    if (selectedCategoryIds && !selectedCategoryIds.has(categoryId)) continue;
    for (const page of Object.values(category.pages ?? {})) {
      for (const product of page.products ?? []) {
        const code = String(product.productCode ?? "");
        if (/^\d+$/.test(code)) keys.add(`${category.category ?? "unknown"}:${code}`);
      }
    }
  }
  return keys;
}

function productCodeFromSourceKey(key: string) {
  const separatorIndex = key.indexOf(":");
  return separatorIndex < 0 ? "" : key.slice(separatorIndex + 1);
}

function findRestrictedPublicKey(value: unknown, path = "$"): string | undefined {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findRestrictedPublicKey(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  for (const [key, child] of Object.entries(value)) {
    if (/recommendationtrust|benchmark|provenance|sourcecheck|physicalevidence|gamingperformance|(?:^|)fps/i.test(key)) return `${path}.${key}`;
    const found = findRestrictedPublicKey(child, `${path}.${key}`);
    if (found) return found;
  }
  return undefined;
}

const missingRequiredFiles: string[] = [];
for (const filename of requiredSources) {
  try { await stat(join(sourceDataDirectory, filename)); }
  catch { missingRequiredFiles.push(filename); }
}
if (missingRequiredFiles.length > 0) {
  console.log(JSON.stringify({
    status: "local-catalog-not-included",
    sourceDataDirectory,
    missingRequiredFiles,
    note: "Regular clean-checkout builds remain possible; rerun after local catalog JSON is present."
  }, null, 2));
} else {
  // Force this packaging operation to use the repository's local files, never a database
  // configured in a developer shell or .env file.
  process.env.PC_SUPPORTER_DATA_DIR = sourceDataDirectory;
  process.env.DATABASE_URL = "";
  const [{ loadCatalog }, { loadAccessories }, { publicApiPayloadProjection }] = await Promise.all([
    import("../server/catalog"),
    import("../server/accessories"),
    import("../shared/public-api-projection")
  ]);

  const [core, accessories] = await Promise.all([loadCatalog(), loadAccessories()]) as [Part[], AccessoryItem[]];
  if (core.length === 0 || accessories.length === 0) throw new Error("Local catalog files were present but resolved to an empty catalog.");

  const publicCore = publicApiPayloadProjection(core);
  const publicAccessories = publicApiPayloadProjection(accessories);
  const restrictedKey = findRestrictedPublicKey(publicCore) ?? findRestrictedPublicKey(publicAccessories);
  if (restrictedKey) throw new Error(`Refusing to write private recommendation evidence to dist: ${restrictedKey}`);

  await mkdir(publicOutputDirectory, { recursive: true });
  await mkdir(privateOutputDirectory, { recursive: true });
  const publicCorePath = join(publicOutputDirectory, "core.json");
  const publicAccessoriesPath = join(publicOutputDirectory, "accessories.json");
  await writeJson(publicCorePath, publicCore);
  await writeJson(publicAccessoriesPath, publicAccessories);

  const rootTargets = await readJson<Array<{ category: PartCategory; categoryId: string; root?: boolean }>>(join(projectRoot, "scripts", "fixtures", "danawa-pc9-targets.json"));
  const coreCategoryIds = new Set([
    ...rootTargets.filter((target) => target.root && target.category !== "cooler").map((target) => target.categoryId),
    ...rootTargets.filter((target) => target.category === "cooler" && ["11336857", "11336856"].includes(target.categoryId)).map((target) => target.categoryId)
  ]);
  const coreManifest = await readJson<SourceManifest>(join(sourceDataDirectory, "danawa-pc9-all-pages.json")).catch(() => ({ categories: {} }));
  const accessoryManifest = await readJson<SourceManifest>(join(sourceDataDirectory, "danawa-accessory-all-pages.json")).catch(() => ({ categories: {} }));
  const coreCheckpoint = await readJson<InventoryCheckpoint>(join(sourceDataDirectory, "danawa-pc9-detail-checkpoint.json")).catch(() => ({ entries: {} }));
  const coreSourceInventory = sourceInventorySummary(coreManifest, coreCategoryIds);
  const accessorySourceInventory = sourceInventorySummary(accessoryManifest);

  const coreDanawaCodes = new Set(core.filter((part) => part.source === "danawa" && part.sourceProductCode).map((part) => `${part.category}:${part.sourceProductCode}`));
  const accessoryDanawaCodes = new Set(accessories.filter((item) => item.source === "danawa" && item.sourceProductCode).map((item) => `${item.category}:${item.sourceProductCode}`));
  const accessoryDanawaProductCodes = new Set(accessories.filter((item) => item.source === "danawa" && item.sourceProductCode).map((item) => item.sourceProductCode!));
  const coreSourceKeys = sourceProductKeys(coreManifest, coreCategoryIds);
  const accessorySourceKeys = sourceProductKeys(accessoryManifest);
  const coreMatchedKeys = new Set([...coreSourceKeys].filter((key) => coreDanawaCodes.has(key)));
  const coreAlsoInAccessoryKeys = new Set([...coreSourceKeys].filter((key) => accessoryDanawaProductCodes.has(productCodeFromSourceKey(key))));
  const coreRejectedEntries = Object.entries(coreCheckpoint.entries ?? {}).filter(([key, entry]) => coreSourceKeys.has(key) && entry.status === "rejected");
  const coreRejectedKeys = new Set(coreRejectedEntries.map(([key]) => key));
  const coreRejectedReasons = coreRejectedEntries.reduce<Record<string, number>>((counts, [, entry]) => {
    const reason = entry.reason ?? "missing-rejection-reason";
    counts[reason] = (counts[reason] ?? 0) + 1;
    return counts;
  }, {});
  const coreResolvedKeys = new Set([...coreMatchedKeys, ...coreAlsoInAccessoryKeys, ...coreRejectedKeys]);
  const coreUnresolvedSourceProducts = [...coreSourceKeys].filter((key) => !coreResolvedKeys.has(key)).length;
  const accessoryMatchedKeys = new Set([...accessorySourceKeys].filter((key) => accessoryDanawaCodes.has(key)));
  const coreSourceMatched = coreMatchedKeys.size;
  const accessorySourceMatched = accessoryMatchedKeys.size;
  const coreSourceReconciliationComplete = coreSourceInventory.listComplete && coreUnresolvedSourceProducts === 0;
  const accessorySourceReconciliationComplete = accessorySourceInventory.listComplete && accessorySourceMatched === accessorySourceKeys.size;

  const privateFiles: Array<{ name: string; bytes: number; sha256: string }> = [];
  for (const filename of privateSourceAllowlist) {
    const sourcePath = join(sourceDataDirectory, filename);
    try {
      await stat(sourcePath);
      const targetPath = join(privateOutputDirectory, filename);
      await copyFile(sourcePath, targetPath);
      const info = await stat(targetPath);
      privateFiles.push({ name: filename, bytes: info.size, sha256: await sha256(targetPath) });
    } catch {
      // Optional catalog evidence files are listed only when present locally.
    }
  }

  const coreComplete = completeCount(core);
  const accessorySpecAssessment = accessorySpecAssessmentSummary(accessories);
  const accessoryComplete = accessorySpecAssessment.complete;
  const corePriced = core.filter((part) => typeof part.priceWon === "number" && part.priceWon > 0).length;
  const accessoryPriced = accessories.filter((item) => typeof item.priceWon === "number" && item.priceWon > 0).length;
  const coverage = {
    status: coreComplete === core.length
      && accessoryComplete === accessories.length
      && corePriced === core.length
      && accessoryPriced === accessories.length
      && coreSourceReconciliationComplete
      && accessorySourceReconciliationComplete
      ? "complete" : "partial",
    reconciliation: {
      coreSourceInventory: coreSourceReconciliationComplete ? "complete" : "partial",
      accessorySourceInventory: accessorySourceReconciliationComplete ? "complete" : "partial"
    },
    core: {
      count: core.length,
      complete: coreComplete,
      partial: core.length - coreComplete,
      priced: corePriced,
      unpriced: core.length - corePriced,
      priceCheckedAt: core.filter((part) => Boolean(part.priceCheckedAt)).length,
      pricedWithoutPriceCheckedAt: core.filter((part) => typeof part.priceWon === "number" && part.priceWon > 0 && !part.priceCheckedAt).length,
      byCategory: categoryCounts(core),
      qualityCounts: qualityCounts(core),
      sourceInventory: {
        ...coreSourceInventory,
        matchedToCoreCatalog: coreSourceMatched,
        alsoPresentInAccessoryCatalog: coreAlsoInAccessoryKeys.size,
        excludedFromCoreCandidates: coreRejectedKeys.size,
        coreExclusionReasons: coreRejectedReasons,
        unresolvedSourceProducts: coreUnresolvedSourceProducts,
        allSourceCodesClassified: coreSourceReconciliationComplete
      }
    },
    accessories: {
      count: accessories.length,
      complete: accessoryComplete,
      partial: accessorySpecAssessment.partial,
      notAssessed: accessorySpecAssessment.notAssessed,
      specAssessmentByCategory: accessorySpecAssessment.byCategory,
      priced: accessoryPriced,
      unpriced: accessories.length - accessoryPriced,
      priceCheckedAt: accessories.filter((item) => Boolean(item.priceCheckedAt)).length,
      pricedWithoutPriceCheckedAt: accessories.filter((item) => typeof item.priceWon === "number" && item.priceWon > 0 && !item.priceCheckedAt).length,
      byCategory: categoryCounts(accessories),
      qualityCounts: qualityCounts(accessories),
      sourceInventory: {
        ...accessorySourceInventory,
        matchedToLocalCatalog: accessorySourceMatched,
        unmatchedObservedProducts: Math.max(0, accessorySourceInventory.observedUniqueProducts - accessorySourceMatched),
        allObservedCodesMatched: accessorySourceReconciliationComplete
      }
    }
  };
  const publicManifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    dataSource: "local-file-catalog-public-api-projection",
    coverage: {
      status: coverage.status,
      core: { count: coverage.core.count, complete: coverage.core.complete, partial: coverage.core.partial, priced: coverage.core.priced, unpriced: coverage.core.unpriced, priceCheckedAt: coverage.core.priceCheckedAt, pricedWithoutPriceCheckedAt: coverage.core.pricedWithoutPriceCheckedAt, byCategory: coverage.core.byCategory, qualityCounts: coverage.core.qualityCounts },
      accessories: { count: coverage.accessories.count, complete: coverage.accessories.complete, partial: coverage.accessories.partial, notAssessed: coverage.accessories.notAssessed, specAssessmentByCategory: coverage.accessories.specAssessmentByCategory, priced: coverage.accessories.priced, unpriced: coverage.accessories.unpriced, priceCheckedAt: coverage.accessories.priceCheckedAt, pricedWithoutPriceCheckedAt: coverage.accessories.pricedWithoutPriceCheckedAt, byCategory: coverage.accessories.byCategory, qualityCounts: coverage.accessories.qualityCounts }
    },
    files: [
      { name: "core.json", bytes: (await stat(publicCorePath)).size, sha256: await sha256(publicCorePath) },
      { name: "accessories.json", bytes: (await stat(publicAccessoriesPath)).size, sha256: await sha256(publicAccessoriesPath) }
    ]
  };
  await writeJson(join(publicOutputDirectory, "manifest.json"), publicManifest);

  const privateManifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    generatedBy: "scripts/build-local-catalog-data.ts",
    storageMode: "file",
    coverage,
    files: privateFiles
  };
  await writeJson(join(privateOutputDirectory, "catalog-bundle-manifest.json"), privateManifest);

  console.log(JSON.stringify({
    status: coverage.status === "complete" ? "local-catalog-included-complete" : "local-catalog-included-partial",
    publicDirectory: publicOutputDirectory,
    privateSidecarDirectory: privateOutputDirectory,
    publicFiles: publicManifest.files,
    privateFileCount: privateFiles.length,
    coverage
  }, null, 2));
}
