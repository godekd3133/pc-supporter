// 다나와 상세 페이지 pcode를 직접 지정해 카탈로그에 라이브 부품으로 추가한다 —
// 인기순 목록 크롤이 닿지 않는 품목(테스트 베드 지정 부품 등)을 수집할 때 쓴다.
// 사용법:
//   tsx scripts/import-danawa-pcodes.ts --part memory:11787049 [--part ...]                # dry-run
//   tsx scripts/import-danawa-pcodes.ts --part memory:112752:11787049 --apply            # 저장
// --part는 <category>:<pcode> 또는 <category>:<categoryId>:<pcode> 형식 — 범주 기본
// 다나와 categoryId는 CATEGORY_IDS에 있다.
// --spec 'maxCoolingW=300' 처럼 스펙 필드를 파싱 결과에 덮어쓸 수 있다(다나와 상세
// 스펙이 없는 항목 — 수랭 쿨러의 냉각 용량·펌프 높이 등 — 수동 보강용).
import { setTimeout as sleep } from "node:timers/promises";
import { PART_CATEGORIES, type Part, type PartCategory, type PartSpecs } from "../shared/types";
import { fetchDanawaHtml, parseDanawaProductPage, type DanawaListItem } from "../server/danawa";
import { upsertCatalog } from "../server/catalog";
import { withCatalogIngestionLease } from "../server/catalog-ingestion-coordinator";

const CATEGORY_IDS: Partial<Record<PartCategory, string>> = {
  cpu: "112747",
  memory: "112752",
  cooler: "11347549"
};

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const specs: Array<{ category: PartCategory; categoryId: string; pcode: string }> = [];
const specPatches = new Map<string, Record<string, unknown>>();
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--apply") continue;
  if (arg === "--spec") {
    const raw = args[index + 1];
    index += 1;
    const eq = (raw ?? "").indexOf("=");
    if (eq <= 0) throw new Error(`--spec은 <pcode>.<field>=<value> 형식이어야 합니다: ${raw}`);
    const target = (raw ?? "").slice(0, eq);
    const dot = target.lastIndexOf(".");
    if (dot <= 0) throw new Error(`--spec은 <pcode>.<field>=<value> 형식이어야 합니다: ${raw}`);
    const rawValue = (raw ?? "").slice(eq + 1);
    let value: unknown;
    try {
      value = JSON.parse(rawValue);
    } catch {
      value = rawValue;
    }
    const patch = specPatches.get(target.slice(0, dot)) ?? {};
    patch[target.slice(dot + 1)] = value;
    specPatches.set(target.slice(0, dot), patch);
    continue;
  }
  if (arg === "--part") {
    const raw = args[index + 1];
    index += 1;
    const segments = (raw ?? "").split(":");
    const category = segments[0];
    const pcode = segments[segments.length - 1];
    const categoryId = segments.length === 3 ? segments[1] : CATEGORY_IDS[category as PartCategory];
    if (!PART_CATEGORIES.includes(category as PartCategory)) throw new Error(`--part 값의 category가 올바르지 않습니다: ${raw}`);
    if (!/^\d+$/.test(categoryId ?? "")) throw new Error(`--part 값의 categoryId가 올바르지 않습니다: ${raw}`);
    if (!/^\d+$/.test(pcode ?? "")) throw new Error(`--part 값의 pcode가 올바르지 않습니다: ${raw}`);
    specs.push({ category: category as PartCategory, categoryId: categoryId!, pcode: pcode! });
    continue;
  }
  throw new Error(`알 수 없는 인자입니다: ${arg}`);
}
if (specs.length === 0) throw new Error("가져올 상품이 없습니다. --part <category>:<categoryId>:<pcode>를 하나 이상 지정해 주세요.");

const parts: Part[] = [];
for (const spec of specs) {
  const url = `https://prod.danawa.com/info/?pcode=${spec.pcode}`;
  const html = await fetchDanawaHtml(url, {});
  const item: DanawaListItem = { name: "", url, sourceProductCode: spec.pcode };
  const part = parseDanawaProductPage(spec.category, item, html, spec.categoryId);
  if (!part.name) throw new Error(`pcode=${spec.pcode} 상세 페이지에서 제품명을 읽지 못했습니다.`);
  const patch = specPatches.get(spec.pcode);
  if (patch) {
    part.specs = { ...part.specs, ...(patch as Partial<PartSpecs>) };
    part.missingFields = part.missingFields.filter((field) => !(field in patch));
    if (part.missingFields.length === 0) part.dataQuality = "live";
  }
  console.log(JSON.stringify({ pcode: spec.pcode, id: part.id, name: part.name, priceWon: part.priceWon, dataQuality: part.dataQuality, missingFields: part.missingFields, listingType: part.listingType }));
  parts.push(part);
  await sleep(400);
}

if (!apply) {
  console.log(JSON.stringify({ mode: "dry-run", parsed: parts.length, message: "검증만 수행했습니다. 저장하려면 --apply를 붙이세요." }));
  process.exit(0);
}

await withCatalogIngestionLease(async () => {
  const merged = await upsertCatalog(parts);
  console.log(JSON.stringify({ mode: "apply", applied: parts.length, catalogCount: merged.length }));
});
