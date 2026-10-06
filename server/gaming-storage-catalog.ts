import snapshot from "./reference-data/gaming-storage-catalog.json";
import type { Part, PartCategory } from "../shared/types";
import { isQuoteBrandAllowed } from "../shared/domain/listing";
import { mergeReferenceCatalogPart } from "./reference-catalog-merge";

export const GAMING_STORAGE_SOURCE_PRODUCTS: ReadonlyArray<{ category: PartCategory; productCode: string }> = [
  { category: "ssd", productCode: "13190519" }, // Samsung 870 EVO 500GB, 2.5-inch SATA
  { category: "ssd", productCode: "13190630" }, // Samsung 870 EVO 2TB, 2.5-inch SATA
  { category: "hdd", productCode: "6545078" }, // Seagate BarraCuda ST2000DM008 2TB, 3.5-inch SATA
  { category: "hdd", productCode: "102550253" } // WD RED Plus WD40EFZZ 4TB, 3.5-inch SATA
];
const PRODUCT_IDENTITIES = new Set(GAMING_STORAGE_SOURCE_PRODUCTS.map((product) => `${product.category}:${product.productCode}`));
const HDD_BRANDS = new Set(["western", "western digital", "wd", "seagate", "씨게이트"]);

function sourceIdentity(part: Part): string | undefined {
  return part.sourceProductCode ? `${part.category}:${part.sourceProductCode}` : undefined;
}

/** Exact domestic product-page reads for SSD capacity and per-drive HDD adjustments. */
export const gamingStorageVerifiedCatalog: readonly Part[] = (snapshot.parts as unknown as Part[]).filter((part) => {
  const identity = sourceIdentity(part);
  return identity !== undefined && PRODUCT_IDENTITIES.has(identity)
    && part.source === "danawa" && part.listingType === "retail"
    && typeof part.priceWon === "number" && Number.isFinite(part.priceWon) && part.priceWon > 0
    && part.specs.interface === "SATA"
    && (part.category === "ssd"
      ? isQuoteBrandAllowed("ssd", part.brand) && part.specs.formFactor === "2.5인치" && [500, 2000].includes(part.specs.capacityGb ?? 0)
      : part.category === "hdd" && HDD_BRANDS.has((part.brand ?? "").trim().toLowerCase()) && part.specs.formFactor === "3.5인치" && [2000, 4000].includes(part.specs.capacityGb ?? 0));
});
export const GAMING_STORAGE_CATALOG_REFRESHED_AT = snapshot.refreshedAt;

/** Current prices, sales-stop observations, reviewed specs and catalog IDs retain precedence. */
export function applyGamingStorageCatalogSnapshot(catalog: readonly Part[]): Part[] {
  const verified = new Map(gamingStorageVerifiedCatalog.map((part) => [sourceIdentity(part), part]));
  const matched = new Set<string>();
  const result = catalog.map((part) => {
    const identity = sourceIdentity(part);
    const source = identity ? verified.get(identity) : undefined;
    if (!identity || !source) return part;
    matched.add(identity);
    return mergeReferenceCatalogPart(part, source);
  });
  for (const part of gamingStorageVerifiedCatalog) {
    const identity = sourceIdentity(part)!;
    if (!matched.has(identity) && !result.some((existing) => existing.id === part.id)) result.push({ ...part, specs: { ...part.specs } });
  }
  return result;
}
