import "dotenv/config";
import { copyFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { CatalogSpecOverride, Part } from "../shared/types";
import { applyCatalogSpecOverrides, readCatalogSpecOverrides, saveCatalogSpecOverrides, validateCatalogSpecOverrideBatch } from "../server/catalog-spec-overrides";
import { appendCatalogChangeRecords, catalogChangeRecord, meaningfulCatalogChangeFields } from "../server/catalog-change-log";
import { catalogSpecSourceCheckBatchFor } from "../server/catalog-spec-source-check-batch";
import { appendCatalogSpecOverrideSourceCheckHistory } from "../server/catalog-spec-override-source-check-history";
import { CATALOG_CHANGE_LOG_PATH, CATALOG_PATH, CATALOG_SPEC_OVERRIDE_SOURCE_CHECK_HISTORY_PATH, CATALOG_SPEC_OVERRIDES_PATH, DATA_DIR, readJson, removeGeneratedFile, writeJson } from "../server/storage";

type OfficialCaseSpec = {
  productCode: string;
  hddBays: number;
  manufacturerModel: string;
  sourceUrl: string;
  sourceNote: string;
};

const OFFICIAL_CASE_SPECS: OfficialCaseSpec[] = [
  {
    productCode: "78530048",
    hddBays: 2,
    manufacturerModel: "DS500 RGB",
    sourceUrl: "https://darkflash.co.kr/article/%EB%B3%B4%EB%8F%84%EC%9E%90%EB%A3%8C/2/35637/",
    sourceNote: "공식 수입사 보도자료에 darkFlash DS500 RGB 블랙의 3.5형 HDD 최대 2개 장착을 명시합니다. 다나와 상품코드 78530048의 블랙 모델과 대조했습니다."
  },
  {
    productCode: "17357669",
    hddBays: 3,
    manufacturerModel: "FD-C-POA1A-01",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2022/06/Pop-Air-RGB-Pop-Air_Product-Sheet_EN.pdf",
    sourceNote: "제조사 Pop Air Black Solid 사양의 SKU FD-C-POA1A-01 및 결합 3.5/2.5형 드라이브 장착부 3개를 확인했습니다."
  },
  {
    productCode: "17357537",
    hddBays: 3,
    manufacturerModel: "FD-C-POA1A-02",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2022/06/Pop-Air-RGB-Pop-Air_Product-Sheet_EN.pdf",
    sourceNote: "제조사 Pop Air Black TG 사양의 SKU FD-C-POA1A-02 및 결합 3.5/2.5형 드라이브 장착부 3개를 확인했습니다."
  },
  {
    productCode: "17357018",
    hddBays: 3,
    manufacturerModel: "FD-C-POR1A-02",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2022/06/Pop-Air-RGB-Pop-Air_Product-Sheet_EN.pdf",
    sourceNote: "제조사 Pop Air RGB Cyan Core TG 사양의 SKU FD-C-POR1A-02 및 결합 3.5/2.5형 드라이브 장착부 3개를 확인했습니다."
  },
  {
    productCode: "17357132",
    hddBays: 3,
    manufacturerModel: "FD-C-POR1A-01",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2022/06/Pop-Air-RGB-Pop-Air_Product-Sheet_EN.pdf",
    sourceNote: "제조사 Pop Air RGB White TG 사양의 SKU FD-C-POR1A-01 및 결합 3.5/2.5형 드라이브 장착부 3개를 확인했습니다."
  },
  {
    productCode: "30499121",
    hddBays: 2,
    manufacturerModel: "0-761345-10017-5",
    sourceUrl: "https://www.antec.com/product/case/ax81",
    sourceNote: "Antec AX81 RGB Elite 공식 사양의 UPC 0-761345-10017-5와 3.5/2.5형 드라이브 장착부 2/1을 확인했습니다. 3.5형 HDD 장착부는 2개입니다."
  },
  {
    productCode: "72470105",
    hddBays: 4,
    manufacturerModel: "0-761345-10148-6",
    sourceUrl: "https://www.antec.com/product/case/flux-pro",
    sourceNote: "Antec FLUX PRO 공식 사양의 UPC 0-761345-10148-6과 3.5/2.5형 드라이브 장착부 4/4를 확인했습니다."
  },
  {
    productCode: "108421685",
    hddBays: 4,
    manufacturerModel: "FLUX PRO Noctua Edition",
    sourceUrl: "https://www.antec.com/product/case/flux-pro-noctua-edition",
    sourceNote: "Antec FLUX PRO Noctua Edition 공식 제품 페이지의 모델명과 3.5/2.5형 드라이브 장착부 4/4를 확인했습니다."
  },
  {
    productCode: "18538823",
    hddBays: 2,
    manufacturerModel: "LANCOOL 216X",
    sourceUrl: "https://lian-li.com/product/lancool-216/",
    sourceNote: "Lian Li LANCOOL 216 공식 규격표에서 모델 LANCOOL 216X와 Drive Cage의 3.5형 HDD 2개를 확인했습니다."
  },
  {
    productCode: "18538847",
    hddBays: 2,
    manufacturerModel: "LANCOOL 216RW",
    sourceUrl: "https://lian-li.com/product/lancool-216/",
    sourceNote: "Lian Li LANCOOL 216 공식 규격표에서 모델 LANCOOL 216RW와 Drive Cage의 3.5형 HDD 2개를 확인했습니다."
  },
  {
    productCode: "79556882",
    hddBays: 1,
    manufacturerModel: "H6 Series",
    sourceUrl: "https://cdn-g.nzxt.com/dl/1698993634-h6-flow_digital-manual_231027_v2-pdf.pdf",
    sourceNote: "NZXT 공식 H6 Flow (2023) 사양 문서에 화이트 SKU CC-H61FW-01과 3.5형 드라이브 베이 1개가 함께 명시돼 있고, 공식 H6 Series 매뉴얼도 3.5형 HDD 1개를 확인합니다."
  },
  {
    productCode: "79556969",
    hddBays: 1,
    manufacturerModel: "H6 Series",
    sourceUrl: "https://cdn-g.nzxt.com/dl/1698993634-h6-flow_digital-manual_231027_v2-pdf.pdf",
    sourceNote: "NZXT 공식 H6 Flow (2023) 사양 문서에 화이트 RGB SKU CC-H61FW-R1과 3.5형 드라이브 베이 1개가 함께 명시돼 있고, 공식 H6 Series 매뉴얼도 3.5형 HDD 1개를 확인합니다."
  },
  {
    productCode: "97308200",
    hddBays: 18,
    manufacturerModel: "AX700",
    sourceUrl: "https://br.thermaltake.com/ax700-super-tower-chassis.html",
    sourceNote: "Thermaltake AX700/AX700 TG 공식 매뉴얼의 drive bays 표에 HDD cage 12개와 메인보드 뒤 6개, 총 18개의 3.5/2.5형 장착부를 명시합니다."
  },
  {
    productCode: "97308263",
    hddBays: 18,
    manufacturerModel: "AX700 TG",
    sourceUrl: "https://br.thermaltake.com/ax700-tg-super-tower-chassis.html",
    sourceNote: "Thermaltake AX700/AX700 TG 공식 매뉴얼의 drive bays 표에 HDD cage 12개와 메인보드 뒤 6개, 총 18개의 3.5/2.5형 장착부를 명시합니다."
  },
  {
    productCode: "74012729",
    hddBays: 0,
    manufacturerModel: "NR100-KNNN-S00",
    sourceUrl: "https://www.coolermaster.com/en-global/products/ncore-100-air.html",
    sourceNote: "Cooler Master NCORE 100 AIR 공식 사양에서 블랙 모델 번호 NR100-KNNN-S00와 장착 베이 목록(2.5형 SSD 1개, 3.5형 HDD 베이 없음)을 확인했습니다."
  },
  {
    productCode: "20344595",
    hddBays: 0,
    manufacturerModel: "FD-C-TER1N-03",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2023/05/Terra_Product-sheet_EN.pdf",
    sourceNote: "Fractal Design Terra 공식 제품 사양서에서 Jade SKU FD-C-TER1N-03, 3.5/2.5형 장착부 0개를 확인했습니다."
  },
  {
    productCode: "40016345",
    hddBays: 2,
    manufacturerModel: "FD-C-NOR1X-03",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2025/03/North-XL_Product-Sheet_EN.pdf",
    sourceNote: "Fractal Design North XL 제품 시트에서 SKU FD-C-NOR1X-03과 3.5/2.5형 결합 드라이브 장착부 2개를 확인했습니다."
  },
  {
    productCode: "40016330",
    hddBays: 2,
    manufacturerModel: "FD-C-NOR1X-04",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2025/03/North-XL_Product-Sheet_EN.pdf",
    sourceNote: "Fractal Design North XL 제품 시트에서 SKU FD-C-NOR1X-04와 3.5/2.5형 결합 드라이브 장착부 2개를 확인했습니다."
  },
  {
    productCode: "90158345",
    hddBays: 2,
    manufacturerModel: "FD-C-NOR1X-06",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2025/03/North-XL_Product-Sheet_EN.pdf",
    sourceNote: "Fractal Design North XL 제품 시트에서 SKU FD-C-NOR1X-06과 3.5/2.5형 결합 드라이브 장착부 2개를 확인했습니다."
  },
  {
    productCode: "40016360",
    hddBays: 2,
    manufacturerModel: "FD-C-NOR1X-02",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2025/03/North-XL_Product-Sheet_EN.pdf",
    sourceNote: "Fractal Design North XL 제품 시트에서 SKU FD-C-NOR1X-02와 3.5/2.5형 결합 드라이브 장착부 2개를 확인했습니다."
  },
  {
    productCode: "108416156",
    hddBays: 2,
    manufacturerModel: "FD-C-NOR1X-07",
    sourceUrl: "https://assets.fractal-design.com/files/uxzbxy2o/production/2bf236b6a310d8abe38ff7d334bb592a0965dcb0.pdf",
    sourceNote: "Fractal Design North XL Momentum Edition 공식 사양의 SKU FD-C-NOR1X-07과 3.5/2.5형 결합 드라이브 장착부 2개를 확인했습니다."
  },
  {
    productCode: "18448688",
    hddBays: 2,
    manufacturerModel: "FD-C-NOR1C-01",
    sourceUrl: "https://assets.fractal-design.com/files/uxzbxy2o/production/23a01a08f4b1cecd7b3efda20f85d8dcee09d891.pdf",
    sourceNote: "Fractal Design North 공식 사양의 SKU FD-C-NOR1C-01에서 3.5/2.5형 결합 장착 위치 3개(2개 포함)를 확인했습니다. `hddBays`는 추가 장착부 없이 사용할 수 있는 포함 수량 2로 보수적으로 기록했습니다."
  },
  {
    productCode: "18448790",
    hddBays: 2,
    manufacturerModel: "FD-C-NOR1C-04",
    sourceUrl: "https://assets.fractal-design.com/files/uxzbxy2o/production/23a01a08f4b1cecd7b3efda20f85d8dcee09d891.pdf",
    sourceNote: "Fractal Design North Chalk White TG Clear 공식 사양의 SKU FD-C-NOR1C-04에서 3.5/2.5형 결합 장착 위치 3개(2개 포함)를 확인했습니다. `hddBays`는 추가 장착부 없이 사용할 수 있는 포함 수량 2로 보수적으로 기록했습니다."
  },
  {
    productCode: "108416054",
    hddBays: 2,
    manufacturerModel: "FD-C-NOR1C-05",
    sourceUrl: "https://assets.fractal-design.com/files/uxzbxy2o/production/9b2776d0cc8e0249db9357726411061d0d78df1b.pdf",
    sourceNote: "Fractal Design North Momentum Edition 공식 사양의 SKU FD-C-NOR1C-05와 3.5/2.5형 결합 드라이브 장착부 2개를 확인했습니다."
  },
  {
    productCode: "13489595",
    hddBays: 2,
    manufacturerModel: "FD-C-MES2C-01",
    sourceUrl: "https://assets.fractal-design.com/files/uxzbxy2o/production/957ad6ea3e40c76bf4dbae6baf505bad55f3984d.pdf",
    sourceNote: "Fractal Design Meshify 2 Compact Black 공식 사양의 SKU FD-C-MES2C-01과 3.5/2.5형 결합 드라이브 장착부 2개를 확인했습니다."
  },
  {
    productCode: "11479695",
    hddBays: 2,
    manufacturerModel: "FD-C-DEF7C-01",
    sourceUrl: "https://assets.fractal-design.com/files/uxzbxy2o/production/9469a1a218e61563c36ec487d1401fc21f583103.pdf",
    sourceNote: "Fractal Design Define 7 Compact Black Solid 공식 사양의 SKU FD-C-DEF7C-01과 3.5/2.5형 결합 드라이브 장착부 2개를 확인했습니다."
  }
];

const { values, positionals } = parseArgs({
  options: { apply: { type: "boolean", default: false } },
  strict: true,
  allowPositionals: true
});

if (positionals.length > 0) throw new Error("Only --apply is supported.");
if (process.env.DATABASE_URL?.trim()) throw new Error("This bounded backfill only supports the file-backed core catalog; unset DATABASE_URL.");
if (DATA_DIR !== resolve(process.cwd(), "data")) throw new Error("This backfill writes only this checkout's data folder; unset PC_SUPPORTER_DATA_DIR.");

const catalog = await readJson<Part[]>(CATALOG_PATH, []);
const existingOverrides = await readCatalogSpecOverrides();
const skipped: Array<{ productCode: string; reason: string }> = [];
const inputItems = OFFICIAL_CASE_SPECS.flatMap((entry) => {
  const part = catalog.find((candidate) => candidate.category === "case" && candidate.sourceProductCode === entry.productCode);
  if (!part) {
    skipped.push({ productCode: entry.productCode, reason: "해당 다나와 상품코드의 케이스가 현재 카탈로그에 없습니다." });
    return [];
  }
  const existing = existingOverrides[part.id];
  const existingCheckPassed = existing?.sourceCheck
    && (existing.sourceCheck.status === "reachable" || existing.sourceCheck.status === "redirected")
    && existing.sourceCheck.identityStatus === "matched";
  if (existing?.fields.hddBays === entry.hddBays
    && existing.manufacturerModel === entry.manufacturerModel
    && existing.sourceUrl === entry.sourceUrl
    && existing.sourceNote === entry.sourceNote
    && existingCheckPassed) {
    skipped.push({ productCode: entry.productCode, reason: "동일한 공식 제조사 정보와 모델 확인 결과가 이미 저장돼 있습니다." });
    return [];
  }
  if (!part.missingFields.includes("hddBays") && existingOverrides[part.id]?.fields.hddBays === undefined) {
    skipped.push({ productCode: entry.productCode, reason: "현재 HDD 베이가 누락 항목이 아니며 기존 보강값도 없습니다." });
    return [];
  }
  return [{
    partId: part.id,
    category: "case",
    fields: { hddBays: entry.hddBays },
    manufacturerModel: entry.manufacturerModel,
    sourceNote: entry.sourceNote,
    sourceUrl: entry.sourceUrl
  }];
});

const validation = inputItems.length > 0
  ? validateCatalogSpecOverrideBatch({ items: inputItems }, catalog, existingOverrides)
  : undefined;
if (validation?.errors.length) throw new Error(`Official case HDD-bay validation failed: ${validation.errors.join(" | ")}`);
const validationByPartId = new Map((validation?.items ?? []).map((item) => [item.partId, item]));
const candidateTargets = OFFICIAL_CASE_SPECS.flatMap((entry) => {
  const part = catalog.find((candidate) => candidate.category === "case" && candidate.sourceProductCode === entry.productCode);
  if (!part || !validationByPartId.get(part.id)?.valid) return [];
  return [{ part, entry }];
});

if (!values.apply) {
  console.log(JSON.stringify({
    mode: "dry-run",
    source: "official manufacturer case pages and manuals; only exact PCode/model-or-SKU matches; hddBays counts 3.5-inch HDD mounts",
    candidates: candidateTargets.map(({ part, entry }) => ({ partId: part.id, productCode: entry.productCode, name: part.name, hddBaysAfter: entry.hddBays, manufacturerModel: entry.manufacturerModel, sourceUrl: entry.sourceUrl, validation: validationByPartId.get(part.id)?.operation })),
    skipped,
    count: candidateTargets.length
  }, null, 2));
} else {
  if (candidateTargets.length === 0) {
    console.log(JSON.stringify({ mode: "apply", updated: 0, passedSourceChecks: 0, skipped }, null, 2));
  } else {
  const checks = await catalogSpecSourceCheckBatchFor(candidateTargets.map(({ part, entry }) => ({
    partId: part.id,
    partName: part.name,
    category: part.category,
    sourceUrl: entry.sourceUrl,
    manufacturerModel: entry.manufacturerModel
  })), { limit: 50, concurrency: 2 });
  const checkByPartId = new Map(checks.items.map((item) => [item.partId, item.sourceCheck]));
  const acceptedTargets = candidateTargets.filter(({ part }) => {
    const check = checkByPartId.get(part.id);
    return Boolean(check && (check.status === "reachable" || check.status === "redirected") && check.identityStatus === "matched");
  });
  const rejectedTargets = candidateTargets.filter(({ part }) => !acceptedTargets.some((accepted) => accepted.part.id === part.id));
  if (acceptedTargets.length === 0) {
    console.log(JSON.stringify({ mode: "apply", updated: 0, rejected: rejectedTargets.map(({ part, entry }) => ({ productCode: entry.productCode, name: part.name, sourceCheck: checkByPartId.get(part.id) })) }, null, 2));
    process.exitCode = 1;
  } else {
    const latestCatalog = await readJson<Part[]>(CATALOG_PATH, []);
    for (const { part, entry } of acceptedTargets) {
      const latest = latestCatalog.find((candidate) => candidate.id === part.id);
      if (!latest || latest.sourceProductCode !== entry.productCode || (!latest.missingFields.includes("hddBays") && existingOverrides[part.id]?.fields.hddBays === undefined)) {
        throw new Error(`Catalog changed after official source checks; re-run dry-run: ${entry.productCode}`);
      }
    }
    const acceptedPartIds = new Set(acceptedTargets.map(({ part }) => part.id));
    const acceptedValidation = validateCatalogSpecOverrideBatch({ items: inputItems.filter((item) => acceptedPartIds.has(item.partId)) }, latestCatalog, await readCatalogSpecOverrides());
    if (acceptedValidation.errors.length > 0) throw new Error(`Catalog changed after official source checks; validation failed: ${acceptedValidation.errors.join(" | ")}`);
    const checkedOverrides: CatalogSpecOverride[] = acceptedValidation.validOverrides.map((override) => {
      const sourceCheck = checkByPartId.get(override.partId);
      return sourceCheck ? { ...override, sourceCheck } : override;
    });
    const latestOverrideMap = await readCatalogSpecOverrides();
    const previouslyEffectiveCatalog = applyCatalogSpecOverrides(latestCatalog, latestOverrideMap);
    const combinedOverrideMap = { ...latestOverrideMap, ...Object.fromEntries(checkedOverrides.map((override) => [override.partId, override])) };
    const updatedCatalog = applyCatalogSpecOverrides(latestCatalog, combinedOverrideMap);
    const beforeById = new Map(latestCatalog.map((part) => [part.id, part]));
    const checkedAt = new Date().toISOString();
    const changeRecords = checkedOverrides.flatMap((override) => {
      const before = beforeById.get(override.partId);
      const after = updatedCatalog.find((part) => part.id === override.partId);
      if (!before || !after) return [];
      const changedFields = [...new Set(["수동 스펙 override", ...meaningfulCatalogChangeFields(before, after)])];
      return [catalogChangeRecord("part", before, after, changedFields, { changedAt: override.updatedAt || checkedAt })];
    });
    const backupDirectory = await mkdtemp(join(tmpdir(), "pc-supporter-case-hdd-bays-backfill-"));
    const backupPaths = [CATALOG_SPEC_OVERRIDES_PATH, CATALOG_CHANGE_LOG_PATH, CATALOG_SPEC_OVERRIDE_SOURCE_CHECK_HISTORY_PATH] as const;
    const backedUp = new Set<string>();
    for (const path of backupPaths) {
      try {
        await copyFile(path, join(backupDirectory, path.split("/").at(-1)!));
        backedUp.add(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    try {
      await saveCatalogSpecOverrides(checkedOverrides);
      for (const override of checkedOverrides) {
        const sourceCheck = checkByPartId.get(override.partId);
        if (sourceCheck) await appendCatalogSpecOverrideSourceCheckHistory(override.partId, sourceCheck);
      }
      await appendCatalogChangeRecords(changeRecords);
      console.log(JSON.stringify({
        mode: "apply",
        updated: checkedOverrides.length,
        passedSourceChecks: checkedOverrides.length,
        rejected: rejectedTargets.map(({ part, entry }) => ({ productCode: entry.productCode, name: part.name, sourceCheck: checkByPartId.get(part.id) })),
        skipped,
        completeCasesBefore: previouslyEffectiveCatalog.filter((part) => part.category === "case" && part.missingFields.length === 0).length,
        completeCasesAfter: updatedCatalog.filter((part) => part.category === "case" && part.missingFields.length === 0).length,
        changeLogRecords: changeRecords.length,
        backupDirectory
      }, null, 2));
    } catch (error) {
      for (const path of backupPaths) {
        if (backedUp.has(path)) await copyFile(join(backupDirectory, path.split("/").at(-1)!), path);
        else await removeGeneratedFile(path);
      }
      throw new Error(`Official case HDD-bay backfill failed; prior files were restored from ${backupDirectory}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
}
