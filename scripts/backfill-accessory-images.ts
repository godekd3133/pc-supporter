import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type { AccessoryCategory, AccessoryItem } from "../shared/types";
import {
  crawlDanawaAccessoryCategory,
  DANAWA_ACCESSORY_CATEGORIES,
  parseDanawaAccessoryPage
} from "../server/accessory-crawler";
import { ACCESSORIES_PATH, readJson, writeJson } from "../server/storage";
import { fetchDanawaHtml, isAllowedSourceUrl, parseDanawaListPageInfo } from "../server/danawa";

const CATEGORY_IDS = new Map(DANAWA_ACCESSORY_CATEGORIES.map(({ category, categoryId }) => [category, categoryId]));
const TARGET_CATEGORIES: AccessoryCategory[] = ["storage_accessory", "cooling_fan"];
const MAX_PAGES_PER_CATEGORY = 100;
const REQUEST_DELAY_MS = 850;
const REQUEST_TIMEOUT_MS = 12_000;

type ImageBackfillReport = {
  mode: "dry-run" | "apply";
  sourceFile: string;
  detailsOnly: boolean;
  before: { total: number; withImage: number; missing: number; missingDanawa: number; missingManual: number };
  categories: Array<{
    category: AccessoryCategory;
    totalProductCount?: number;
    pagesExpected: number;
    pagesVisited: number;
    listProductCount: number;
    listImageCount: number;
    matchedMissing: number;
    imageUpdatesFromList: number;
    imageUpdatesFromDetails: number;
    detailAttempts: number;
    detailFailures: number;
    unresolved: number;
    listComplete: boolean;
  }>;
  imageUpdates: number;
  afterMissing?: number;
  backupPath?: string;
  progress?: { category: AccessoryCategory; pagesVisited: number; pagesExpected: number; uniqueProducts: number };
  errors: string[];
};

function productCodeFromUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    return new URL(value).searchParams.get("pcode") ?? undefined;
  } catch {
    return undefined;
  }
}

function productKey(category: AccessoryCategory, sourceProductCode: string) {
  return `${category}:${sourceProductCode}`;
}

function trustedImageUrl(value: string | undefined) {
  if (!value || !isAllowedSourceUrl(value)) return undefined;
  const host = new URL(value).hostname.toLowerCase();
  return host === "img.danuri.io" || host === "img.danawa.com" ? value : undefined;
}

function isMissingImage(item: AccessoryItem) {
  return !trustedImageUrl(item.imageUrl);
}

async function sleep(ms: number) {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

const reportPath = process.env.PC_SUPPORTER_IMAGE_BACKFILL_REPORT?.trim()
  || join(tmpdir(), `pc-supporter-accessory-image-backfill-${process.pid}.json`);

let report: ImageBackfillReport;
async function writeProgressReport() {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function main() {
  const apply = process.argv.includes("--apply");
  const detailsOnly = process.argv.includes("--details-only");
  const useDetailFallback = process.argv.includes("--details") || detailsOnly;
  const detailLimitArgument = process.argv.find((argument) => argument.startsWith("--limit-details="))?.split("=")[1];
  const detailLimit = detailLimitArgument === undefined ? Number.MAX_SAFE_INTEGER : Number(detailLimitArgument);
  if (!Number.isInteger(detailLimit) || detailLimit < 1) throw new Error("--limit-details에는 1 이상의 정수를 지정해 주세요.");
  const beforeStat = await stat(ACCESSORIES_PATH);
  const original = await readJson<AccessoryItem[]>(ACCESSORIES_PATH, []);
  const missing = original.filter(isMissingImage);
  report = {
    mode: apply ? "apply" : "dry-run",
    sourceFile: ACCESSORIES_PATH,
    detailsOnly,
    before: {
      total: original.length,
      withImage: original.length - missing.length,
      missing: missing.length,
      missingDanawa: missing.filter((item) => item.source === "danawa" && Boolean(item.sourceProductCode && item.danawaUrl)).length,
      missingManual: missing.filter((item) => item.source === "manual" || item.source === "seed").length
    },
    categories: [],
    imageUpdates: 0,
    errors: []
  };
  const imageByProductCode = new Map<string, string>();
  const listItemByProductCode = new Map<string, { name: string; url: string; sourceProductCode: string; imageUrl?: string; rawSpecText?: string; priceWon?: number }>();
  const updateById = new Map<string, string>();
  const pendingById = new Map<string, string>();
  let latestStat = beforeStat;
  let backupPath: string | undefined;
  let appliedUpdates = 0;

  async function flushPendingUpdates() {
    if (!apply || pendingById.size === 0) return;
    let currentStat = await stat(ACCESSORIES_PATH);
    if (currentStat.mtimeMs !== latestStat.mtimeMs || currentStat.size !== latestStat.size) {
      throw new Error("주변 부품 원본 파일이 수집 도중 바뀌어 덮어쓰기를 중단했습니다.");
    }
    const current = await readJson<AccessoryItem[]>(ACCESSORIES_PATH, []);
    currentStat = await stat(ACCESSORIES_PATH);
    if (currentStat.mtimeMs !== latestStat.mtimeMs || currentStat.size !== latestStat.size) {
      throw new Error("주변 부품 원본 파일이 읽기 도중 바뀌어 덮어쓰기를 중단했습니다.");
    }
    let changed = 0;
    const merged = current.map((item) => {
      const imageUrl = pendingById.get(item.id);
      if (!imageUrl || !isMissingImage(item) || item.source !== "danawa" || productCodeFromUrl(item.danawaUrl) !== item.sourceProductCode) return item;
      changed += 1;
      return { ...item, imageUrl };
    });
    pendingById.clear();
    if (changed === 0) return;
    if (!backupPath) {
      backupPath = join(tmpdir(), `pc-supporter-accessories-before-image-backfill-${Date.now()}.json`);
      await copyFile(ACCESSORIES_PATH, backupPath);
    }
    await writeJson(ACCESSORIES_PATH, merged);
    latestStat = await stat(ACCESSORIES_PATH);
    appliedUpdates += changed;
    report.imageUpdates = appliedUpdates;
    report.afterMissing = merged.filter(isMissingImage).length;
    report.backupPath = backupPath;
    await writeProgressReport();
  }

  await writeProgressReport();

  for (const category of TARGET_CATEGORIES) {
    const categoryId = CATEGORY_IDS.get(category);
    if (!categoryId) throw new Error(`다나와 범주 설정이 없습니다: ${category}`);
    let totalProductCount: number | undefined;
    let pagesExpected = 0;
    let pagesVisited = 0;
    let uniqueProducts = 0;
    let crawlItems: Array<{ name: string; url: string; sourceProductCode: string; imageUrl?: string; rawSpecText?: string; priceWon?: number }> = [];
    let conflictingProductCodes = 0;
    if (!detailsOnly) {
      const firstPageHtml = await fetchDanawaHtml(`https://prod.danawa.com/list/?cate=${categoryId}`, {
        timeoutMs: REQUEST_TIMEOUT_MS,
        retries: 1,
        delayMs: REQUEST_DELAY_MS
      });
      const pageInfo = parseDanawaListPageInfo(firstPageHtml);
      if (!pageInfo.totalProductCount || !pageInfo.pageSize) {
        throw new Error(`${category} 범주의 전체 건수와 페이지 크기를 확인하지 못했습니다.`);
      }
      totalProductCount = pageInfo.totalProductCount;
      pagesExpected = Math.ceil(pageInfo.totalProductCount / pageInfo.pageSize);
      if (pagesExpected > MAX_PAGES_PER_CATEGORY) {
        throw new Error(`${category} 범주가 안전 상한 ${MAX_PAGES_PER_CATEGORY}페이지를 넘습니다 (${pagesExpected}).`);
      }
      const crawl = await crawlDanawaAccessoryCategory(category, categoryId, {
        pages: pagesExpected,
        limitPerCategory: Number.MAX_SAFE_INTEGER,
        details: false,
        delayMs: REQUEST_DELAY_MS,
        timeoutMs: REQUEST_TIMEOUT_MS,
        retries: 1,
        onProgress: async (progress) => {
          report.progress = { category, pagesVisited: progress.pagesVisited, pagesExpected, uniqueProducts: progress.uniqueProducts };
          if (progress.pagesVisited % 10 === 0) {
            console.log(`${category}: ${progress.pagesVisited}/${pagesExpected} list pages`);
            await writeProgressReport();
          }
        }
      });
      pagesVisited = crawl.pagesVisited;
      uniqueProducts = crawl.uniqueProducts;
      crawlItems = crawl.items;
    }

    for (const item of crawlItems) {
      if (productCodeFromUrl(item.url) !== item.sourceProductCode) continue;
      const key = productKey(category, item.sourceProductCode);
      listItemByProductCode.set(key, item);
      const imageUrl = trustedImageUrl(item.imageUrl);
      if (!imageUrl) continue;
      const existingImage = imageByProductCode.get(key);
      if (existingImage && existingImage !== imageUrl) {
        imageByProductCode.delete(key);
        conflictingProductCodes += 1;
      } else if (!imageByProductCode.has(key)) {
        imageByProductCode.set(key, imageUrl);
      }
    }

    const categoryMissing = missing.filter((item) => item.category === category && item.source === "danawa" && item.sourceProductCode);
    let imageUpdatesFromList = 0;
    for (const item of categoryMissing) {
      const key = productKey(category, item.sourceProductCode!);
      const imageUrl = imageByProductCode.get(key);
      const listItem = listItemByProductCode.get(key);
      if (!imageUrl || !listItem || productCodeFromUrl(listItem.url) !== item.sourceProductCode) continue;
      updateById.set(item.id, imageUrl);
      pendingById.set(item.id, imageUrl);
      imageUpdatesFromList += 1;
    }

    const detailTargets = useDetailFallback
      ? categoryMissing.filter((item) => !updateById.has(item.id) && productCodeFromUrl(item.danawaUrl) === item.sourceProductCode).slice(0, detailLimit)
      : [];
    detailTargets.sort((left, right) => {
      const leftPrice = typeof left.priceWon === "number" && left.priceWon > 0 ? left.priceWon : Number.MAX_SAFE_INTEGER;
      const rightPrice = typeof right.priceWon === "number" && right.priceWon > 0 ? right.priceWon : Number.MAX_SAFE_INTEGER;
      return leftPrice - rightPrice || left.name.localeCompare(right.name, "ko-KR");
    });
    let detailAttempts = 0;
    let detailFailures = 0;
    let blockedRequestStreak = 0;
    for (const item of detailTargets) {
      await sleep(REQUEST_DELAY_MS);
      detailAttempts += 1;
      try {
        const url = item.danawaUrl!;
        const html = await fetchDanawaHtml(url, { timeoutMs: REQUEST_TIMEOUT_MS, retries: 1, delayMs: REQUEST_DELAY_MS });
        const listItem = listItemByProductCode.get(productKey(category, item.sourceProductCode!)) ?? {
          name: item.name,
          url,
          sourceProductCode: item.sourceProductCode!,
          ...(item.priceWon ? { priceWon: item.priceWon } : {}),
          ...(item.rawSpecText ? { rawSpecText: item.rawSpecText } : {})
        };
        const parsed = parseDanawaAccessoryPage(category, listItem, html, categoryId);
        const imageUrl = trustedImageUrl(parsed.imageUrl);
        if (productCodeFromUrl(parsed.danawaUrl) === item.sourceProductCode && imageUrl) {
          updateById.set(item.id, imageUrl);
          pendingById.set(item.id, imageUrl);
          blockedRequestStreak = 0;
        } else {
          detailFailures += 1;
          blockedRequestStreak = 0;
        }
      } catch (error) {
        detailFailures += 1;
        const message = error instanceof Error ? error.message : String(error);
        if (/\b(403|429|5\d\d)\b|timed? ?out|abort/i.test(message)) blockedRequestStreak += 1;
        else blockedRequestStreak = 0;
        if (blockedRequestStreak >= 5) {
          report.errors.push(`${category}: stopped detail fallback after ${blockedRequestStreak} consecutive source blocks or timeouts.`);
        }
      }
      if (detailAttempts % 25 === 0) {
        report.categories = report.categories.filter((entry) => entry.category !== category);
        report.categories.push({
          category,
          totalProductCount,
          pagesExpected,
          pagesVisited,
          listProductCount: uniqueProducts,
          listImageCount: crawlItems.filter((item) => trustedImageUrl(item.imageUrl)).length,
          matchedMissing: categoryMissing.length,
          imageUpdatesFromList,
          imageUpdatesFromDetails: detailAttempts - detailFailures,
          detailAttempts,
          detailFailures,
          unresolved: categoryMissing.length - imageUpdatesFromList - (detailAttempts - detailFailures),
          listComplete: !detailsOnly && totalProductCount !== undefined && uniqueProducts >= totalProductCount && pagesVisited >= pagesExpected && conflictingProductCodes === 0
        });
        await writeProgressReport();
        await flushPendingUpdates();
        console.log(`${category}: ${detailAttempts}/${detailTargets.length} detail fallback pages`);
      }
      if (blockedRequestStreak >= 5) break;
    }

    report.categories.push({
      category,
      totalProductCount,
      pagesExpected,
      pagesVisited,
      listProductCount: uniqueProducts,
      listImageCount: crawlItems.filter((item) => trustedImageUrl(item.imageUrl)).length,
      matchedMissing: categoryMissing.length,
      imageUpdatesFromList,
      imageUpdatesFromDetails: detailAttempts - detailFailures,
      detailAttempts,
      detailFailures,
      unresolved: categoryMissing.length - imageUpdatesFromList - (detailAttempts - detailFailures),
      listComplete: !detailsOnly && totalProductCount !== undefined && uniqueProducts >= totalProductCount && pagesVisited >= pagesExpected && conflictingProductCodes === 0
    });
    if (conflictingProductCodes > 0) report.errors.push(`${category}: ${conflictingProductCodes} product codes had conflicting image URLs and were left unchanged.`);
    await flushPendingUpdates();
    await writeProgressReport();
  }

  report.imageUpdates = updateById.size;
  await flushPendingUpdates();
  if (report.afterMissing === undefined) report.afterMissing = report.before.missing - updateById.size;
  await writeProgressReport();
  console.log(JSON.stringify(report, null, 2));
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  void writeFile(`${reportPath}.error.txt`, `${message}\n`, "utf8").catch(() => undefined);
  process.exitCode = 1;
});
