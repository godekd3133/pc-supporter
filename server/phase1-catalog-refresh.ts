import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { fetchDanawaHtml, parseDanawaPriceFromHtml, parseDanawaProductPage, DANAWA_CATEGORIES } from "./danawa";
import type { Part, PartCategory } from "../shared/types";

/** Product identities deliberately limited to the director's first gaming testbed. */
export const PHASE1_SOURCE_PRODUCTS: ReadonlyArray<{ category: PartCategory; productCode: string }> = [
  { category: "cpu", productCode: "54218171" }, // 5500GT multipack, cooler included
  { category: "cpu", productCode: "16741211" }, // 5600 multipack, cooler included
  { category: "cpu", productCode: "21694499" }, // 7500F multipack, cooler included
  { category: "cpu", productCode: "19627934" }, // 7800X3D multipack
  { category: "cpu", productCode: "62794082" }, // 9700X multipack
  { category: "cpu", productCode: "70531547" }, // 9800X3D multipack
  { category: "cpu", productCode: "77790914" }, // 9950X3D multipack
  { category: "motherboard", productCode: "77706989" },
  { category: "motherboard", productCode: "11571368" },
  { category: "motherboard", productCode: "122697197" },
  { category: "motherboard", productCode: "75857021" },
  { category: "cooler", productCode: "106047347" },
  { category: "cooler", productCode: "16525058" },
  { category: "cooler", productCode: "70003022" }, // exact NAUTILUS 360 RS, non-ARGB
  { category: "memory", productCode: "11787091" },
  { category: "memory", productCode: "18965774" },
  { category: "memory", productCode: "95057837" },
  { category: "gpu", productCode: "71010053" },
  { category: "gpu", productCode: "78306452" },
  { category: "gpu", productCode: "93501767" }, // RTX 5050
  { category: "gpu", productCode: "90887702" }, // RTX 5060
  { category: "gpu", productCode: "98779298" }, // RTX 5060 Ti 8GB
  { category: "gpu", productCode: "77382785" }, // RTX 5070
  { category: "gpu", productCode: "99892193" }, // RTX 5070 Ti
  { category: "gpu", productCode: "75601394" }, // RTX 5080
  { category: "gpu", productCode: "75656861" }, // RTX 5090, air cooled
  { category: "case", productCode: "96308750" }, // ABKO C10M compact, real low-budget case
  { category: "case", productCode: "91348970" }, // ABKO UD20M, full mATX and single tower clearance
  { category: "ssd", productCode: "18041081" }, // PNY CS900 1TB, domestic distributor
  { category: "psu", productCode: "98760803" }, // Micronics COOLMAX ELITE II 500W
  { category: "cpu", productCode: "97705328" }, // captured 7400F alternative
  { category: "ssd", productCode: "90116603" }, // SK hynix Silver S32 1TB
  { category: "case", productCode: "98780594" } // TM40 mATX case
];

export async function fetchPhase1CatalogSnapshot(products = PHASE1_SOURCE_PRODUCTS): Promise<Part[]> {
  const parts: Part[] = [];
  // Sequential reads avoid opening a burst of requests to one public source.
  for (const { category, productCode } of products) {
    const url = `https://prod.danawa.com/info/?pcode=${productCode}`;
    const html = await fetchDanawaHtml(url, { timeoutMs: 15_000, retries: 1 });
    const priceWon = parseDanawaPriceFromHtml(html, productCode);
    if (!priceWon) throw new Error(`Verified price unavailable for ${category}:${productCode}`);
    const categoryId = DANAWA_CATEGORIES.find((entry) => entry.category === category)!.categoryId;
    const part = parseDanawaProductPage(category, { name: "", url, sourceProductCode: productCode }, html, categoryId);
    if (part.listingType !== "retail" || /해외|중고|병행|리퍼/.test(part.name)) {
      throw new Error(`Unsupported listing for ${category}:${productCode}: ${part.name}`);
    }
    parts.push({ ...part, priceWon, priceCheckedAt: part.updatedAt });
  }
  return parts;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const parts = await fetchPhase1CatalogSnapshot();
  const target = fileURLToPath(new URL("./reference-data/phase1-catalog.json", import.meta.url));
  await writeFile(target, `${JSON.stringify({ schemaVersion: 1, refreshedAt: new Date().toISOString(), parts }, null, 2)}\n`);
  console.log(JSON.stringify({ target, count: parts.length, prices: parts.map(({ id, priceWon }) => ({ id, priceWon })) }, null, 2));
}
