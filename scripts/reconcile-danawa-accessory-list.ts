import "dotenv/config";
import { copyFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { AccessoryCategory, AccessoryCrawlCategoryReport, AccessoryItem, Part, PartSpecs } from "../shared/types";
import { DANAWA_ACCESSORY_CATEGORIES, parseAccessorySpecs } from "../server/accessory-crawler";
import { recordAccessoryCoverage } from "../server/accessories";
import { appendCatalogChangeRecords, catalogChangeRecord, meaningfulCatalogChangeFields } from "../server/catalog-change-log";
import { isAllowedSourceUrl } from "../server/danawa";
import {
  mutateAccessoryCatalogRecords,
  mutateAccessoryCoverageRecord,
  readAccessoryCatalogRecords,
  readAccessoryCoverageRecord,
  readCatalogRecords,
  writeCatalogRecords
} from "../server/repository";
import {
  CATALOG_CHANGE_LOG_PATH,
  DATA_DIR,
  readJson,
  removeGeneratedFile,
  writeJson
} from "../server/storage";

type ListedProduct = {
  productCode: string;
  name: string;
  url: string;
  priceWon?: number;
  imageUrl?: string;
  spec?: string;
};

type SnapshotPage = {
  page: number;
  pageSize: number;
  parserVersion: number;
  totalPages: number;
  totalCount: number;
  products: ListedProduct[];
  fetchedAt: string;
};

type SnapshotCategory = {
  category: AccessoryCategory;
  categoryId: string;
  label: string;
  pages: Record<string, SnapshotPage>;
  status: string;
  listedProductCount: number;
  uniqueProductCount: number;
};

type Snapshot = {
  schemaVersion: number;
  source: string;
  updatedAt: string;
  categories: Record<string, SnapshotCategory>;
};
type SortSupplementPage = {
  page: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  codes: string[];
  products: ListedProduct[];
  fetchedAt: string;
  rowCountMismatch?: { expected: number; received: number };
  sortMethod: string;
  sourcePath: "/list/";
  requestMethod: "POST";
  responseStatus?: number;
  responseContentType?: string;
};
type SortSupplementSnapshot = {
  schemaVersion: 1;
  source: "robots-allowed Danawa accessory list UI sort pages";
  updatedAt: string;
  categories: Record<string, {
    category: AccessoryCategory;
    categoryId: string;
    pagesBySort: Record<string, Record<string, SortSupplementPage>>;
  }>;
};
type SortSupplementPage = {
  page: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  codes: string[];
  products: ListedProduct[];
  fetchedAt: string;
  rowCountMismatch?: { expected: number; received: number };
  sortMethod: string;
  sourcePath: "/list/";
  requestMethod: "POST";
  responseStatus?: number;
  responseContentType?: string;
};
type SortSupplementSnapshot = {
  schemaVersion: 1;
  source: "robots-allowed Danawa accessory list UI sort pages";
  updatedAt: string;
  categories: Record<string, {
    category: AccessoryCategory;
    categoryId: string;
    pagesBySort: Record<string, Record<string, SortSupplementPage>>;
  }>;
};

type ReconciliationCategory = {
  category: AccessoryCategory;
  categoryId: string;
  sourceStatus: string;
  listCoverage: "partial" | "complete";
  pagesExpected: number;
  pagesVisited: number;
  listedProducts: number;
  uniqueProducts: number;
  supplementalPagesObserved?: number;
  supplementalProductsObserved?: number;
  supplementalNewUniqueProducts?: number;
  supplementalSortMethods?: string[];
  missingFromCapturedList: number;
  matchedExisting: number;
  inserted: number;
  sourceCategoryUpdated: number;
  priceObserved: number;
  priceChanged: number;
  coreCatalogOverlaps: Array<{ productCode: string; corePartId: string; coreCategory: string; coreName: string }>;
  movedFromCore: number;
  retainedExistingNotInSnapshot: number;
  sourceFetchedAt: string;
  report: AccessoryCrawlCategoryReport;
};

type CoreReclassificationArchiveItem = {
  productCode: string;
  category: AccessoryCategory;
  categoryId: string;
  accessoryId: string;
  evidence: "danawa-public-list-manifest" | "stored-accessory-source-category";
  originalCorePart: Part;
};

const { values, positionals } = parseArgs({
  options: {
    apply: { type: "boolean", default: false },
    "include-partial": { type: "boolean", default: false },
    "move-core-overlaps": { type: "boolean", default: false },
    category: { type: "string" },
    "product-code": { type: "string" }
  },
  strict: true,
  allowPositionals: true
});

if (positionals.length > 0) throw new Error("Use only --apply, --include-partial, --move-core-overlaps, --category=ACCESSORY_CATEGORY, and --product-code=PCODE.");
if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is required; the catalogs live only in PostgreSQL.");

const categoryFilter = values.category as AccessoryCategory | undefined;
const productCodeFilter = values["product-code"];
if (productCodeFilter !== undefined && !/^\d{5,}$/.test(productCodeFilter)) throw new Error("--product-code must be a numeric Danawa PCode with at least five digits.");
if (productCodeFilter && !categoryFilter) throw new Error("--product-code requires --category so source identity remains explicit.");
if (categoryFilter && !DANAWA_ACCESSORY_CATEGORIES.some((entry) => entry.category === categoryFilter)) {
  throw new Error(`Unknown accessory category: ${categoryFilter}`);
}

async function readRequiredJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function canonicalProductUrl(product: ListedProduct, categoryId: string) {
  const parsed = new URL(product.url);
  if (!isAllowedSourceUrl(parsed.href) || parsed.pathname !== "/info/" || parsed.searchParams.get("pcode") !== product.productCode) {
    throw new Error(`Invalid Danawa detail identity for product ${product.productCode}.`);
  }
  parsed.searchParams.set("cate", categoryId);
  return parsed.toString();
}

function definedSpecs(specs: PartSpecs): PartSpecs {
  return Object.fromEntries(Object.entries(specs).filter(([, value]) => value !== undefined)) as PartSpecs;
}

function validateCategorySnapshot(categoryId: string, entry: SnapshotCategory) {
  if (entry.categoryId !== categoryId || entry.category !== DANAWA_ACCESSORY_CATEGORIES.find((config) => config.categoryId === categoryId)?.category) {
    throw new Error(`Manifest category identity does not match configured source ${categoryId}.`);
  }
  const pages = Object.entries(entry.pages)
    .map(([key, page]) => ({ keyNumber: Number(key), page }))
    .sort((left, right) => left.keyNumber - right.keyNumber);
  if (pages.length === 0) throw new Error(`${entry.category}: manifest has no captured pages.`);

  const productCodes = new Set<string>();
  let listedProducts = 0;
  const expectedPageCount = pages[0].page.totalPages;
  const expectedProductCount = pages[0].page.totalCount;
  for (let index = 0; index < pages.length; index += 1) {
    const { keyNumber, page } = pages[index];
    if (keyNumber !== index + 1 || page.page !== keyNumber) throw new Error(`${entry.category}: page sequence is not contiguous from page 1.`);
    if (page.totalPages !== expectedPageCount || page.totalCount !== expectedProductCount) throw new Error(`${entry.category}: source total count changed inside this manifest.`);
    if (!Number.isSafeInteger(page.pageSize) || page.pageSize < 1) throw new Error(`${entry.category}: invalid page size on page ${page.page}.`);
    if (!Number.isFinite(Date.parse(page.fetchedAt))) throw new Error(`${entry.category}: page ${page.page} has no valid fetch timestamp.`);
    listedProducts += page.products.length;
    for (const product of page.products) {
      if (!/^\d+$/.test(product.productCode) || !product.name.trim()) throw new Error(`${entry.category}: invalid product identity on page ${page.page}.`);
      canonicalProductUrl(product, categoryId);
      productCodes.add(product.productCode);
    }
  }

  if (entry.listedProductCount !== listedProducts || entry.uniqueProductCount !== productCodes.size) {
    throw new Error(`${entry.category}: manifest row/unique totals do not match captured page contents.`);
  }
  const complete = entry.status === "complete"
    && pages.length === expectedPageCount
    && listedProducts === expectedProductCount
    && productCodes.size === expectedProductCount;
  if (entry.status === "complete" && !complete) throw new Error(`${entry.category}: manifest says complete but does not satisfy the source totals.`);
  if (entry.status !== "complete" && complete) throw new Error(`${entry.category}: manifest marks a complete snapshot as partial; inspect the source evidence before applying.`);

  return {
    pages: pages.map(({ page }) => page),
    products: pages.flatMap(({ page }) => page.products).filter((product, index, all) => all.findIndex((candidate) => candidate.productCode === product.productCode) === index),
    listedProducts,
    uniqueProducts: productCodes.size,
    expectedPageCount,
    expectedProductCount,
    complete,
    sourceFetchedAt: pages.map(({ page }) => page.fetchedAt).sort().at(-1)!
  };
}

function validateSortSupplement(categoryId: string, expectedProductCount: number, entry?: SortSupplementSnapshot["categories"][string]) {
  if (!entry) return [] as Array<{ product: ListedProduct; fetchedAt: string; sortMethod: string; page: number }>;
  const expectedCategory = DANAWA_ACCESSORY_CATEGORIES.find((config) => config.categoryId === categoryId)?.category;
  if (entry.categoryId !== categoryId || entry.category !== expectedCategory) throw new Error("Supplement category identity does not match configured source " + categoryId + ".");
  const supplements: Array<{ product: ListedProduct; fetchedAt: string; sortMethod: string; page: number }> = [];
  for (const [sortMethod, pages] of Object.entries(entry.pagesBySort)) {
    if (!["BEST", "LOW_PRICE", "HIGH_PRICE", "NEW", "REVIEW"].includes(sortMethod)) throw new Error(entry.category + ": unsupported supplemental sort " + sortMethod + ".");
    for (const [pageKey, page] of Object.entries(pages)) {
      const pageNumber = Number(pageKey);
      if (!Number.isSafeInteger(pageNumber) || page.page !== pageNumber || page.sortMethod !== sortMethod) {
        throw new Error(entry.category + ": supplemental page identity mismatch for " + sortMethod + "/" + pageKey + ".");
      }
      if (page.sourcePath !== "/list/" || page.requestMethod !== "POST" || page.responseStatus !== 200 || !page.responseContentType?.includes("text/x-component")) {
        throw new Error(entry.category + ": supplemental page " + sortMethod + "/" + pageNumber + " lacks public UI request/response evidence.");
      }
      if (page.page !== pageNumber || pageNumber < 1 || page.totalCount !== expectedProductCount || ![30, 60, 90].includes(page.pageSize)
        || !Number.isSafeInteger(page.totalPages) || pageNumber > page.totalPages
        || page.totalPages !== Math.ceil(page.totalCount / page.pageSize)) {
        throw new Error(entry.category + ": supplemental page " + sortMethod + "/" + pageNumber + " has a different source total or invalid page size.");
      }
      if (page.rowCountMismatch) throw new Error(entry.category + ": refusing supplemental page " + sortMethod + "/" + pageNumber + " with a source row-count mismatch.");
      const expectedRows = Math.min(page.pageSize, Math.max(0, expectedProductCount - (pageNumber - 1) * page.pageSize));
      if (page.products.length !== expectedRows || page.codes.length !== page.products.length) {
        throw new Error(entry.category + ": supplemental page " + sortMethod + "/" + pageNumber + " does not contain its exact expected rows.");
      }
      const pageCodes = new Set<string>();
      for (let index = 0; index < page.products.length; index += 1) {
        const product = page.products[index];
        if (!/^\d+$/.test(product.productCode) || !product.name.trim() || page.codes[index] !== product.productCode) {
          throw new Error(entry.category + ": invalid supplemental product identity on " + sortMethod + "/" + pageNumber + ".");
        }
        if (pageCodes.has(product.productCode)) throw new Error(entry.category + ": duplicate product " + product.productCode + " inside supplemental page " + sortMethod + "/" + pageNumber + ".");
        pageCodes.add(product.productCode);
        canonicalProductUrl(product, categoryId);
      }
      if (!Number.isFinite(Date.parse(page.fetchedAt))) throw new Error(entry.category + ": supplemental page " + sortMethod + "/" + pageNumber + " has no valid fetch timestamp.");
      supplements.push(...page.products.map((product) => ({ product, fetchedAt: page.fetchedAt, sortMethod, page: pageNumber })));
    }
  }
  return supplements;
}

function mergeListedProduct(existing: AccessoryItem, product: ListedProduct, categoryId: string, fetchedAt: string): AccessoryItem {
  const parsedSpecs = definedSpecs(parseAccessorySpecs(existing.category, `${product.name} ${product.spec ?? ""}`));
  const wasCreatedFromListOnlyAtThisSnapshot = existing.updatedAt === fetchedAt
    && existing.dataQuality === "live"
    && existing.missingFields.length === 0;
  return {
    ...existing,
    sourceCategoryId: categoryId,
    danawaUrl: canonicalProductUrl(product, categoryId),
    ...(existing.imageUrl || !product.imageUrl ? {} : { imageUrl: product.imageUrl }),
    ...(product.spec && !existing.rawSpecText ? { rawSpecText: product.spec } : {}),
    specs: { ...parsedSpecs, ...existing.specs },
    ...(wasCreatedFromListOnlyAtThisSnapshot ? { dataQuality: "incomplete" as const, missingFields: ["detail page"] } : {}),
    ...(product.priceWon !== undefined
      ? { priceWon: product.priceWon, priceCheckedAt: fetchedAt }
      : {})
  };
}

function newListItem(category: AccessoryCategory, categoryId: string, product: ListedProduct, fetchedAt: string, sourceCorePart?: Part): AccessoryItem {
  const rawSpecText = sourceCorePart?.rawSpecText || product.spec;
  const name = sourceCorePart?.name || product.name;
  return {
    id: `accessory-${category}-${product.productCode}`,
    category,
    name,
    brand: sourceCorePart?.brand ?? product.name.split(/\s+/)[0],
    model: sourceCorePart?.model || name,
    ...(product.imageUrl || sourceCorePart?.imageUrl ? { imageUrl: product.imageUrl ?? sourceCorePart?.imageUrl } : {}),
    danawaUrl: canonicalProductUrl(product, categoryId),
    source: "danawa",
    sourceProductCode: product.productCode,
    sourceCategoryId: categoryId,
    listingType: "accessory",
    ...(product.priceWon !== undefined
      ? { priceWon: product.priceWon, priceCheckedAt: fetchedAt }
      : sourceCorePart?.priceWon !== undefined
        ? { priceWon: sourceCorePart.priceWon, ...(sourceCorePart.priceCheckedAt ? { priceCheckedAt: sourceCorePart.priceCheckedAt } : {}) }
        : {}),
    ...(rawSpecText ? { rawSpecText } : {}),
    specs: definedSpecs(parseAccessorySpecs(category, `${name} ${rawSpecText ?? ""}`)),
    dataQuality: "incomplete",
    missingFields: ["detail page"],
    updatedAt: fetchedAt
  };
}

const manifestPath = join(DATA_DIR, "danawa-accessory-all-pages.json");
const manifest = await readRequiredJson<Snapshot>(manifestPath);
if (manifest.schemaVersion !== 1 || !manifest.source.includes("Danawa public accessory list pages")) {
  throw new Error("Unsupported accessory list manifest schema or source.");
}
const sortSupplementPath = join(DATA_DIR, "danawa-accessory-sort-pages.json");
const sortSupplement = await readJson<SortSupplementSnapshot>(sortSupplementPath, {
  schemaVersion: 1,
  source: "robots-allowed Danawa accessory list UI sort pages",
  updatedAt: "",
  categories: {}
});
if (sortSupplement.schemaVersion !== 1 || sortSupplement.source !== "robots-allowed Danawa accessory list UI sort pages") {
  throw new Error("Unsupported accessory sort supplement schema or source.");
}

const configs = DANAWA_ACCESSORY_CATEGORIES.filter((config) => !categoryFilter || config.category === categoryFilter);
const selected = configs.flatMap((config) => {
  const entry = manifest.categories[config.categoryId];
  if (!entry) throw new Error(`Missing source category ${config.category} (${config.categoryId}) in list manifest.`);
  const validated = validateCategorySnapshot(config.categoryId, entry);
  if (!validated.complete && !values["include-partial"]) return [];
  return [{ config, entry, ...validated }];
});
if (selected.length === 0) throw new Error("No categories selected. Partial list snapshots require --include-partial.");
const supplementalByCategory = new Map<string, ReturnType<typeof validateSortSupplement>>();
for (const source of selected) {
  supplementalByCategory.set(source.config.categoryId, validateSortSupplement(
    source.config.categoryId,
    source.expectedProductCount,
    sortSupplement.categories[source.config.categoryId]
  ));
}

const selectedProductsByCode = new Map<string, { category: AccessoryCategory; categoryId: string; product: ListedProduct; fetchedAt: string }>();
for (const source of selected) {
  for (const product of source.products) {
    if (productCodeFilter && product.productCode !== productCodeFilter) continue;
    const existing = selectedProductsByCode.get(product.productCode);
    if (existing && existing.category !== source.config.category) {
      throw new Error(`Product ${product.productCode} appears in multiple accessory categories; refusing ambiguous assignment.`);
    }
    if (!existing) selectedProductsByCode.set(product.productCode, {
      category: source.config.category,
      categoryId: source.config.categoryId,
      product,
      fetchedAt: source.sourceFetchedAt
    });
  }
}
for (const source of selected) {
  for (const observation of supplementalByCategory.get(source.config.categoryId) ?? []) {
    if (productCodeFilter && observation.product.productCode !== productCodeFilter) continue;
    const existing = selectedProductsByCode.get(observation.product.productCode);
    if (existing && existing.category !== source.config.category) {
      throw new Error("Supplemental product " + observation.product.productCode + " appears in multiple accessory categories; refusing ambiguous assignment.");
    }
    if (!existing) selectedProductsByCode.set(observation.product.productCode, {
      category: source.config.category,
      categoryId: source.config.categoryId,
      product: observation.product,
      fetchedAt: observation.fetchedAt
    });
  }
}
if (productCodeFilter && !selectedProductsByCode.has(productCodeFilter)) {
  throw new Error(`Product ${productCodeFilter} was not found in the captured ${categoryFilter} source list or its verified supplemental pages.`);
}

const [existingAccessorySnapshot, coreParts] = await Promise.all([
  readAccessoryCatalogRecords(),
  readCatalogRecords()
]);
const existingAccessories = existingAccessorySnapshot.items;
const coreByCode = new Map(coreParts.flatMap((part) => part.sourceProductCode ? [[part.sourceProductCode, part] as const] : []));
const coreConflictsByCategory = new Map<AccessoryCategory, Array<{ productCode: string; corePartId: string; coreCategory: string; coreName: string }>>();
for (const [code, source] of selectedProductsByCode) {
  const corePart = coreByCode.get(code);
  if (!corePart) continue;
  const conflicts = coreConflictsByCategory.get(source.category) ?? [];
  conflicts.push({ productCode: code, corePartId: corePart.id, coreCategory: corePart.category, coreName: corePart.name });
  coreConflictsByCategory.set(source.category, conflicts);
}

const accessoryRowsByCode = new Map<string, AccessoryItem[]>();
for (const item of existingAccessories) {
  if (!item.sourceProductCode) continue;
  const rows = accessoryRowsByCode.get(item.sourceProductCode) ?? [];
  rows.push(item);
  accessoryRowsByCode.set(item.sourceProductCode, rows);
}
const storedAccessoryCoreOverlaps = [...accessoryRowsByCode.entries()].flatMap(([productCode, rows]) => {
  if (selectedProductsByCode.has(productCode) || rows.length !== 1 || rows[0].source !== "danawa") return [];
  const accessory = rows[0];
  const config = DANAWA_ACCESSORY_CATEGORIES.find((candidate) => candidate.category === accessory.category && candidate.categoryId === accessory.sourceCategoryId);
  const corePart = coreByCode.get(productCode);
  return config && corePart
    ? [{ productCode, category: config.category, categoryId: config.categoryId, accessoryId: accessory.id, corePart }]
    : [];
});
for (const [code] of selectedProductsByCode) {
  const matches = accessoryRowsByCode.get(code) ?? [];
  if (matches.length > 1) throw new Error(`Existing accessory catalog contains duplicate product code ${code}; resolve it before importing.`);
  if (matches[0] && (matches[0].source !== "danawa" || matches[0].category !== selectedProductsByCode.get(code)!.category)) {
    throw new Error(`Existing product ${code} has a conflicting source/category; refusing to overwrite it.`);
  }
}

const nextById = new Map(existingAccessories.map((item) => [item.id, item]));
const matchedIds = new Set<string>();
const changeRecords = [];
const categoryResults: ReconciliationCategory[] = [];

for (const source of selected) {
  const primaryCodeSet = new Set(source.products.map(({ productCode }) => productCode));
  const supplementalRows = supplementalByCategory.get(source.config.categoryId) ?? [];
  const supplementalByCode = new Map<string, (typeof supplementalRows)[number]>();
  for (const observation of supplementalRows) {
    if (!supplementalByCode.has(observation.product.productCode)) supplementalByCode.set(observation.product.productCode, observation);
  }
  const supplementalNewUniqueProducts = [...supplementalByCode.keys()].filter((code) => !primaryCodeSet.has(code)).length;
  const combinedUniqueProducts = source.uniqueProducts + supplementalNewUniqueProducts;
  const combinedListedProducts = source.listedProducts + supplementalRows.length;
  const combinedListComplete = source.complete || combinedUniqueProducts === source.expectedProductCount;
  const sourceCodeSet = new Set([...primaryCodeSet, ...supplementalByCode.keys()]);
  const supplementalPagesObserved = new Set(supplementalRows.map((item) => item.sortMethod + ":" + item.page)).size;
  const supplementalSortMethods = [...new Set(supplementalRows.map((item) => item.sortMethod))].sort();
  const latestSupplementFetchedAt = supplementalRows.map((item) => item.fetchedAt).sort().at(-1);
  const latestFetchedAt = latestSupplementFetchedAt && Date.parse(latestSupplementFetchedAt) > Date.parse(source.sourceFetchedAt)
    ? latestSupplementFetchedAt
    : source.sourceFetchedAt;
  let matchedExisting = 0;
  let inserted = 0;
  let sourceCategoryUpdated = 0;
  let priceObserved = 0;
  let priceChanged = 0;
  let incompleteAfterReconcile = 0;
  const coreCatalogOverlaps = coreConflictsByCategory.get(source.config.category) ?? [];
  const coreConflictCodes = new Set(coreCatalogOverlaps.map(({ productCode }) => productCode));

  for (const product of source.products) {
    if (productCodeFilter && product.productCode !== productCodeFilter) continue;
    const current = (accessoryRowsByCode.get(product.productCode) ?? [])[0];
    if (coreConflictCodes.has(product.productCode) && !values["move-core-overlaps"]) continue;
    if (product.priceWon !== undefined) priceObserved += 1;
    if (!current) {
      const created = newListItem(source.config.category, source.config.categoryId, product, source.sourceFetchedAt, coreByCode.get(product.productCode));
      const existingId = nextById.get(created.id);
      if (existingId && existingId.sourceProductCode !== created.sourceProductCode) throw new Error(`New accessory ID ${created.id} conflicts with an unrelated existing row.`);
      nextById.set(created.id, created);
      inserted += 1;
      incompleteAfterReconcile += 1;
      continue;
    }
    matchedExisting += 1;
    matchedIds.add(current.id);
    const updated = mergeListedProduct(current, product, source.config.categoryId, source.sourceFetchedAt);
    if (current.sourceCategoryId !== updated.sourceCategoryId) sourceCategoryUpdated += 1;
    if (current.priceWon !== updated.priceWon) priceChanged += 1;
    if (updated.missingFields.length > 0) incompleteAfterReconcile += 1;
    nextById.set(updated.id, updated);
    const changedFields = meaningfulCatalogChangeFields(current, updated);
    if (changedFields.length > 0) changeRecords.push(catalogChangeRecord("accessory", current, updated, changedFields, { changedAt: source.sourceFetchedAt }));
  }

  for (const [productCode, observation] of supplementalByCode) {
    if (productCodeFilter && productCode !== productCodeFilter) continue;
    if (primaryCodeSet.has(productCode)) continue;
    const product = observation.product;
    const current = (accessoryRowsByCode.get(productCode) ?? [])[0];
    if (coreConflictCodes.has(productCode) && !values["move-core-overlaps"]) continue;
    if (product.priceWon !== undefined) priceObserved += 1;
    if (!current) {
      const created = newListItem(source.config.category, source.config.categoryId, product, observation.fetchedAt, coreByCode.get(productCode));
      const existingId = nextById.get(created.id);
      if (existingId && existingId.sourceProductCode !== created.sourceProductCode) throw new Error("New accessory ID " + created.id + " conflicts with an unrelated existing row.");
      nextById.set(created.id, created);
      inserted += 1;
      incompleteAfterReconcile += 1;
      continue;
    }
    matchedExisting += 1;
    matchedIds.add(current.id);
    const updated = mergeListedProduct(current, product, source.config.categoryId, observation.fetchedAt);
    if (current.sourceCategoryId !== updated.sourceCategoryId) sourceCategoryUpdated += 1;
    if (current.priceWon !== updated.priceWon) priceChanged += 1;
    if (updated.missingFields.length > 0) incompleteAfterReconcile += 1;
    nextById.set(updated.id, updated);
    const changedFields = meaningfulCatalogChangeFields(current, updated);
    if (changedFields.length > 0) changeRecords.push(catalogChangeRecord("accessory", current, updated, changedFields, { changedAt: observation.fetchedAt }));
  }

  const retainedExistingNotInSnapshot = existingAccessories.filter((item) => item.source === "danawa" && item.category === source.config.category && item.sourceProductCode && !sourceCodeSet.has(item.sourceProductCode)).length;
  const report: AccessoryCrawlCategoryReport = {
    category: source.config.category,
    categoryId: source.config.categoryId,
    totalProductCount: source.expectedProductCount,
    offset: 0,
    requestedLimit: combinedUniqueProducts,
    pagesExpected: source.expectedPageCount,
    pagesVisited: source.pages.length,
    listedProducts: combinedListedProducts,
    uniqueProducts: combinedUniqueProducts,
    detailFetched: 0,
    detailFailed: 0,
    missingProducts: Math.max(0, source.expectedProductCount - combinedUniqueProducts),
    incompleteSpecs: incompleteAfterReconcile,
    listCoverage: combinedListComplete ? "complete" : "partial",
    coverage: "partial",
    specCoverage: "partial"
  };
  categoryResults.push({
    category: source.config.category,
    categoryId: source.config.categoryId,
    sourceStatus: source.entry.status,
    listCoverage: report.listCoverage,
    pagesExpected: report.pagesExpected,
    pagesVisited: report.pagesVisited,
    listedProducts: report.listedProducts,
    uniqueProducts: report.uniqueProducts,
    supplementalPagesObserved,
    supplementalProductsObserved: supplementalRows.length,
    supplementalNewUniqueProducts,
    supplementalSortMethods,
    missingFromCapturedList: report.missingProducts,
    matchedExisting,
    inserted,
    sourceCategoryUpdated,
    priceObserved,
    priceChanged,
    coreCatalogOverlaps,
    movedFromCore: values["move-core-overlaps"] ? coreCatalogOverlaps.length : 0,
    retainedExistingNotInSnapshot,
    sourceFetchedAt: latestFetchedAt,
    report
  });
}

const nextAccessories = [...nextById.values()];
const movedCoreParts = values["move-core-overlaps"]
  ? [
      ...[...selectedProductsByCode.keys()].flatMap((code) => {
        const corePart = coreByCode.get(code);
        const target = selectedProductsByCode.get(code);
        return corePart && target
          ? [{ corePart, category: target.category, categoryId: target.categoryId, accessoryId: `accessory-${target.category}-${code}`, evidence: "danawa-public-list-manifest" as const }]
          : [];
      }),
      ...storedAccessoryCoreOverlaps.map((row) => ({ ...row, evidence: "stored-accessory-source-category" as const }))
    ]
  : [];
const movedCoreCodes = new Set(movedCoreParts.map(({ corePart }) => corePart.sourceProductCode).filter((code): code is string => Boolean(code)));
const nextCoreParts = coreParts.filter((part) => !part.sourceProductCode || !movedCoreCodes.has(part.sourceProductCode));
const auditPath = join(DATA_DIR, "accessory-list-reconciliation.json");
const priorAudit = await readJson<{
  schemaVersion: number;
  categories: ReconciliationCategory[];
  coreReclassification?: { updatedAt: string; items: CoreReclassificationArchiveItem[] };
}>(auditPath, { schemaVersion: 1, categories: [] });
const byCategory = new Map(priorAudit.categories.map((item) => [item.category, item]));
for (const result of categoryResults) byCategory.set(result.category, result);
const priorCoreArchives = new Map((priorAudit.coreReclassification?.items ?? []).map((item) => [item.productCode, {
  ...item,
  evidence: item.evidence ?? (selectedProductsByCode.has(item.productCode) ? "danawa-public-list-manifest" as const : "stored-accessory-source-category" as const)
}]));
for (const moved of movedCoreParts) {
  priorCoreArchives.set(moved.corePart.sourceProductCode!, {
    productCode: moved.corePart.sourceProductCode!,
    category: moved.category,
    categoryId: moved.categoryId,
    accessoryId: moved.accessoryId,
    evidence: moved.evidence,
    originalCorePart: moved.corePart
  });
}
const audit = {
  schemaVersion: 1,
  updatedAt: new Date().toISOString(),
  sourceManifest: "data/danawa-accessory-all-pages.json",
  supplementalSourceManifest: "data/danawa-accessory-sort-pages.json",
  sourceManifestUpdatedAt: manifest.updatedAt,
  evidenceMeaning: "List membership, listed prices, and list descriptions from the default and explicitly captured public UI sort views only; product detail fields and compatibility remain separate checks.",
  stalePolicy: "Existing products absent from captured lists are retained; partial categories are never treated as exhaustive.",
  categories: [...byCategory.values()].sort((left, right) => left.category.localeCompare(right.category)),
  storedAccessoryCoreOverlapCount: storedAccessoryCoreOverlaps.length,
  movedStoredAccessoryCoreOverlapCount: values["move-core-overlaps"] ? storedAccessoryCoreOverlaps.length : 0,
  coreReclassification: priorCoreArchives.size > 0 ? {
    updatedAt: new Date().toISOString(),
    items: [...priorCoreArchives.values()].sort((left, right) => left.productCode.localeCompare(right.productCode))
  } : undefined
};

const reportOutput = {
  mode: values.apply ? "apply" : "dry-run",
  dataDirectory: DATA_DIR,
  selectedCategories: categoryResults.map(({ report: _report, coreCatalogOverlaps, ...row }) => ({
    ...row,
    coreCatalogOverlapCount: coreCatalogOverlaps.length,
    coreCatalogOverlapExamples: coreCatalogOverlaps.slice(0, 5)
  })),
  catalog: {
    existingProducts: existingAccessories.length,
    projectedProducts: nextAccessories.length,
    insertedProducts: nextAccessories.length - existingAccessories.length,
    coreProductsBefore: coreParts.length,
    coreProductsAfter: nextCoreParts.length,
    movedCoreProducts: movedCoreParts.length,
    retainedExistingRows: existingAccessories.length - matchedIds.size,
    listPriceObservations: categoryResults.reduce((total, row) => total + row.priceObserved, 0),
    listPriceChanges: categoryResults.reduce((total, row) => total + row.priceChanged, 0),
    catalogChangeLogRecords: changeRecords.length
  },
  projectedAccessoryQuality: {
    live: nextAccessories.filter((item) => item.dataQuality === "live").length,
    incomplete: nextAccessories.filter((item) => item.dataQuality === "incomplete").length,
    seed: nextAccessories.filter((item) => item.dataQuality === "seed").length,
    manual: nextAccessories.filter((item) => item.dataQuality === "manual").length
  },
  storedAccessoryCoreOverlapCount: storedAccessoryCoreOverlaps.length,
  skippedCoreCatalogOverlaps: values["move-core-overlaps"] ? 0 : categoryResults.reduce((total, row) => total + row.coreCatalogOverlaps.length, 0) + storedAccessoryCoreOverlaps.length,
  detailCoverage: "unchanged; list membership does not mark a detail page or use-case specification as verified"
};

if (!values.apply) {
  console.log(JSON.stringify(reportOutput, null, 2));
} else {
  const backupDirectory = await mkdtemp(join(tmpdir(), "pc-supporter-accessory-list-reconcile-"));
  const paths = [CATALOG_CHANGE_LOG_PATH, auditPath];
  const backedUp = new Set<string>();
  for (const path of paths) {
    try {
      await copyFile(path, join(backupDirectory, path.split("/").at(-1)!));
      backedUp.add(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  await writeJson(join(backupDirectory, "accessories.json"), existingAccessories);
  await writeJson(join(backupDirectory, "catalog.json"), coreParts);
  const priorCoverage = await readAccessoryCoverageRecord();
  await writeJson(join(backupDirectory, "accessory-coverage.json"), priorCoverage);
  const nextAccessoryIds = new Set(nextAccessories.map((item) => item.id));
  const accessoryRemoveIds = existingAccessories.filter((item) => !nextAccessoryIds.has(item.id)).map((item) => item.id);
  const nextCoreIds = new Set(nextCoreParts.map((part) => part.id));
  const coreRemoveIds = coreParts.filter((part) => !nextCoreIds.has(part.id)).map((part) => part.id);
  try {
    await mutateAccessoryCatalogRecords(() => ({ items: nextAccessories, removeIds: accessoryRemoveIds }));
    if (movedCoreParts.length > 0) await writeCatalogRecords(nextCoreParts, { removeIds: coreRemoveIds });
    for (const category of categoryResults) {
      await recordAccessoryCoverage([category.report], {
        mode: "all",
        details: false,
        onlyIncomplete: false,
        lastCrawledAt: category.sourceFetchedAt
      });
    }
    await appendCatalogChangeRecords(changeRecords.sort((left, right) => right.changedAt.localeCompare(left.changedAt)));
    await writeJson(auditPath, audit);
    console.log(JSON.stringify({ ...reportOutput, backupDirectory, auditFile: auditPath }, null, 2));
  } catch (error) {
    const backupAccessories = JSON.parse(await readFile(join(backupDirectory, "accessories.json"), "utf8")) as AccessoryItem[];
    const backupAccessoryIds = new Set(backupAccessories.map((item) => item.id));
    const restoredSnapshot = await readAccessoryCatalogRecords();
    await mutateAccessoryCatalogRecords(() => ({
      items: backupAccessories,
      removeIds: restoredSnapshot.items.filter((item) => !backupAccessoryIds.has(item.id)).map((item) => item.id)
    }));
    if (movedCoreParts.length > 0) {
      const backupCatalog = JSON.parse(await readFile(join(backupDirectory, "catalog.json"), "utf8")) as Part[];
      const backupCoreIds = new Set(backupCatalog.map((part) => part.id));
      const currentCore = await readCatalogRecords();
      await writeCatalogRecords(backupCatalog, { removeIds: currentCore.filter((part) => !backupCoreIds.has(part.id)).map((part) => part.id) });
    }
    await mutateAccessoryCoverageRecord(() => JSON.parse(await readFile(join(backupDirectory, "accessory-coverage.json"), "utf8")));
    for (const path of paths) {
      const backupPath = join(backupDirectory, path.split("/").at(-1)!);
      if (backedUp.has(path)) await copyFile(backupPath, path);
      else await removeGeneratedFile(path);
    }
    throw new Error(`Reconciliation failed; prior state was restored from ${backupDirectory}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
