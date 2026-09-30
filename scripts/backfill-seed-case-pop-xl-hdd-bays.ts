import "dotenv/config";
import { copyFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Part } from "../shared/types";
import { appendCatalogChangeRecords, catalogChangeRecord, meaningfulCatalogChangeFields } from "../server/catalog-change-log";
import { CATALOG_CHANGE_LOG_PATH, CATALOG_PATH, DATA_DIR, readJson, removeGeneratedFile, writeJson } from "../server/storage";

const { values, positionals } = parseArgs({ options: { apply: { type: "boolean", default: false } }, strict: true, allowPositionals: true });
if (positionals.length > 0) throw new Error("Only --apply is supported.");
if (process.env.DATABASE_URL?.trim()) throw new Error("This bounded seed correction only supports the file-backed core catalog; unset DATABASE_URL.");
if (DATA_DIR !== resolve(process.cwd(), "data")) throw new Error("This correction writes only this checkout's data folder; unset PC_SUPPORTER_DATA_DIR.");

const partId = "case-full-airflow";
const productName = "Fractal Design Pop XL Air";
const sourceUrl = "https://www.fractal-design.com/products/cases/pop/pop-xl-air/rgb-black-tg-clear";
const productSheetUrl = "https://www.fractal-design.com/app/uploads/2022/06/Pop-XL-Air-RGB_Product-Sheet_EN.pdf";
const sourceText = "제조사 주요 사양은 HDD 최대 4개입니다. 현재 제품 페이지의 전용·겸용 장착부 표기와 제품 시트의 장착부 분류가 서로 달라 개별 장착부 합산값은 확정하지 않았습니다. HDD 최대 지원 수 4개를 사용합니다. " + sourceUrl + " " + productSheetUrl;
const catalog = await readJson<Part[]>(CATALOG_PATH, []);
const before = catalog.find((part) => part.id === partId);
if (!before || before.category !== "case" || before.source !== "seed") throw new Error("Expected seed case-full-airflow is missing or no longer a case.");
if (before.specs.hddBays !== 8 && before.specs.hddBays !== 6 && before.specs.hddBays !== 4) throw new Error(`Unexpected stored Pop XL HDD-bay count: ${before.specs.hddBays}. Review it before applying.`);

const changedAt = new Date().toISOString();
const after: Part = {
  ...before,
  name: productName,
  model: "Pop XL Air",
  rawSpecText: sourceText,
  specs: { ...before.specs, hddBays: 4 },
  updatedAt: changedAt
};
const changedFields = meaningfulCatalogChangeFields(before, after);
const changeRecords = changedFields.length > 0 ? [catalogChangeRecord("part", before, after, changedFields, { changedAt })] : [];

if (!values.apply) {
  console.log(JSON.stringify({ mode: "dry-run", item: { id: partId, nameBefore: before.name, nameAfter: after.name, hddBaysBefore: before.specs.hddBays, hddBaysAfter: after.specs.hddBays, sourceUrl, productSheetUrl, sourceBasis: "The manufacturer states a maximum of four HDDs. The product page and product sheet classify drive mounts differently, so their category counts are not added." }, catalogChangeRecords: changeRecords.length }, null, 2));
} else {
  if (changeRecords.length === 0) throw new Error("Pop XL seed case already matches the reviewed official specification.");
  const backupDirectory = await mkdtemp(join(tmpdir(), "pc-supporter-seed-case-pop-xl-backfill-"));
  await copyFile(CATALOG_PATH, join(backupDirectory, "catalog.json"));
  let hadChangeLog = false;
  try {
    await copyFile(CATALOG_CHANGE_LOG_PATH, join(backupDirectory, "catalog-change-log.json"));
    hadChangeLog = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    const latest = await readJson<Part[]>(CATALOG_PATH, []);
    const current = latest.find((part) => part.id === partId);
    if (!current || current.source !== "seed" || current.specs.hddBays !== before.specs.hddBays) throw new Error("Catalog changed after planning; re-run dry-run.");
    await writeJson(CATALOG_PATH, latest.map((part) => part.id === partId ? after : part));
    await appendCatalogChangeRecords(changeRecords);
    console.log(JSON.stringify({ mode: "apply", updated: partId, hddBaysBefore: before.specs.hddBays, hddBaysAfter: after.specs.hddBays, changedFields, backupDirectory }, null, 2));
  } catch (error) {
    await writeJson(CATALOG_PATH, JSON.parse(await readFile(join(backupDirectory, "catalog.json"), "utf8")));
    if (hadChangeLog) await copyFile(join(backupDirectory, "catalog-change-log.json"), CATALOG_CHANGE_LOG_PATH);
    else await removeGeneratedFile(CATALOG_CHANGE_LOG_PATH);
    throw new Error(`Pop XL seed case correction failed; prior files were restored from ${backupDirectory}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
