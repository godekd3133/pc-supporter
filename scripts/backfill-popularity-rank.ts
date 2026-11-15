// 다나와 인기상품순(BEST) 목록 스냅샷(data/danawa-pc9-all-pages.json)의 목록 위치로
// catalog_parts.payload.popularityRank를 채운다. 순위 = (page-1)*pageSize + index + 1.
// 같은 범주에 여러 다나와 카테고리 스냅샷이 있으면(쿨러 등) 상품이 가장 많은 목록을 쓴다.
//
// 사용법: DATABASE_URL=... tsx scripts/backfill-popularity-rank.ts [--apply] [--file=path]
// --apply 없이 실행하면 변경 계획만 출력한다.
import { readFile } from "node:fs/promises";
import pg from "pg";
import { PART_CATEGORIES, type PartCategory } from "../shared/types";

type SnapshotProduct = { productCode?: string | number };
type SnapshotPage = { page?: number; pageSize?: number; products?: SnapshotProduct[] };
type SnapshotCategory = { category?: string; pages?: Record<string, SnapshotPage> };
type Snapshot = { categories?: Record<string, SnapshotCategory> };

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const fileArg = args.find((arg) => arg.startsWith("--file="));
const unknownArgs = args.filter((arg) => arg !== "--apply" && !arg.startsWith("--file="));
if (unknownArgs.length > 0) throw new Error(`Unknown option(s): ${unknownArgs.join(" ")}. Allowed: --apply, --file=<path>`);
const snapshotPath = fileArg?.slice("--file=".length) || "data/danawa-pc9-all-pages.json";

function isPartCategory(value: unknown): value is PartCategory {
  return typeof value === "string" && (PART_CATEGORIES as readonly string[]).includes(value);
}

/** 한 다나와 카테고리 스냅샷의 상품코드 → 인기 순위(첫 등장 위치). */
export function popularityRanksFromSnapshotCategory(entry: SnapshotCategory): Map<string, number> {
  const ranks = new Map<string, number>();
  const pages = Object.entries(entry.pages ?? {})
    .map(([key, page]) => ({ pageNumber: Number(page.page ?? key), page }))
    .filter(({ pageNumber }) => Number.isFinite(pageNumber) && pageNumber >= 1)
    .sort((a, b) => a.pageNumber - b.pageNumber);
  const firstPageSize = pages.find(({ page }) => typeof page.pageSize === "number" && page.pageSize > 0)?.page.pageSize;
  for (const { pageNumber, page } of pages) {
    const products = page.products ?? [];
    const pageSize = firstPageSize ?? page.pageSize ?? products.length;
    products.forEach((product, index) => {
      const code = product.productCode === undefined ? "" : String(product.productCode).trim();
      if (!code || ranks.has(code)) return;
      ranks.set(code, (Math.floor(pageNumber) - 1) * pageSize + index + 1);
    });
  }
  return ranks;
}

const snapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as Snapshot;
const ranksByCategory = new Map<PartCategory, { categoryId: string; ranks: Map<string, number> }>();
for (const [categoryId, entry] of Object.entries(snapshot.categories ?? {})) {
  if (!isPartCategory(entry.category)) continue;
  const ranks = popularityRanksFromSnapshotCategory(entry);
  const current = ranksByCategory.get(entry.category);
  if (!current || ranks.size > current.ranks.size) ranksByCategory.set(entry.category, { categoryId, ranks });
}

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required; the catalog lives only in PostgreSQL.");
const client = new pg.Client({ connectionString });
await client.connect();
try {
  const { rows } = await client.query<{ id: string; category: string; source_product_code: string | null; payload_code: string | null; rank: string | null }>(`
    SELECT id, category, source_product_code, payload->>'sourceProductCode' AS payload_code, payload->>'popularityRank' AS rank
    FROM catalog_parts
    WHERE source = 'danawa' OR id LIKE 'danawa-%'
  `);
  const updates: Array<{ id: string; rank: number | null }> = [];
  const summary = new Map<string, { categoryId: string; snapshotProducts: number; matched: number; cleared: number; unchanged: number }>();
  for (const row of rows) {
    if (!isPartCategory(row.category)) continue;
    const source = ranksByCategory.get(row.category);
    if (!source) continue;
    const stats = summary.get(row.category) ?? { categoryId: source.categoryId, snapshotProducts: source.ranks.size, matched: 0, cleared: 0, unchanged: 0 };
    summary.set(row.category, stats);
    const idCode = row.id.startsWith(`danawa-${row.category}-`) ? row.id.slice(`danawa-${row.category}-`.length) : undefined;
    const code = row.source_product_code ?? row.payload_code ?? idCode;
    const rank = code ? source.ranks.get(code) ?? null : null;
    const currentRank = row.rank === null ? null : Number(row.rank);
    if (rank !== null) stats.matched += 1;
    if (rank === currentRank) {
      stats.unchanged += 1;
      continue;
    }
    if (rank === null) stats.cleared += 1;
    updates.push({ id: row.id, rank });
  }
  console.table([...summary.entries()].map(([category, stats]) => ({ category, ...stats })));
  console.log(`${apply ? "Applying" : "Planned (dry-run)"}: ${updates.length} row updates (${updates.filter((update) => update.rank !== null).length} set, ${updates.filter((update) => update.rank === null).length} cleared).`);
  if (apply && updates.length > 0) {
    await client.query("BEGIN");
    try {
      // updated_at을 올려 실행 중인 API의 카탈로그 캐시(건수+최신 updated_at 스탬프)를 무효화한다.
      const setIds = updates.filter((update) => update.rank !== null);
      const clearIds = updates.filter((update) => update.rank === null).map((update) => update.id);
      if (setIds.length > 0) {
        await client.query(`
          UPDATE catalog_parts AS parts
          SET payload = jsonb_set(parts.payload, '{popularityRank}', to_jsonb(ranked.rank)), updated_at = now()
          FROM unnest($1::text[], $2::int[]) AS ranked(id, rank)
          WHERE parts.id = ranked.id
        `, [setIds.map((update) => update.id), setIds.map((update) => update.rank)]);
      }
      if (clearIds.length > 0) {
        await client.query(`UPDATE catalog_parts SET payload = payload - 'popularityRank', updated_at = now() WHERE id = ANY($1::text[])`, [clearIds]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    console.log("Done.");
  } else if (!apply) {
    console.log("Re-run with --apply to write the ranks.");
  }
} finally {
  await client.end();
}
