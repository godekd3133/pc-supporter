import snapshot from "./reference-data/gaming-support-catalog.json";
import type { Part, PartCategory } from "../shared/types";
import { isQuoteBrandAllowed } from "../shared/domain/listing";
import { mergeReferenceCatalogPart } from "./reference-catalog-merge";

/** Domestic support products needed to complete the restricted GPU test bed. */
export const GAMING_SUPPORT_SOURCE_PRODUCTS: ReadonlyArray<{ category: PartCategory; productCode: string }> = [
  { category: "psu", productCode: "98760842" }, // COOLMAX ELITE II 600W
  { category: "psu", productCode: "99732404" }, // COOLMAX FOCUS II 700W ATX3.1, native 12V2x6
  { category: "psu", productCode: "74484749" }, // WIZMAX 750W Silver ATX3.1
  { category: "psu", productCode: "74484791" }, // WIZMAX 850W Silver ATX3.1
  { category: "psu", productCode: "90643607" }, // WIZMAX G-1000W Gold ATX3.1
  { category: "case", productCode: "124217320" }, // 3RSYS L200 black, mATX, 410mm GPU / 167mm cooler
  { category: "case", productCode: "94088714" }, // ABKO G26 black, ATX, 400mm GPU / 165mm cooler
  { category: "case", productCode: "32861099" } // darkFlash DS900 black, ATX, 425mm GPU / 170mm cooler
];
const PRODUCT_IDENTITIES = new Set(GAMING_SUPPORT_SOURCE_PRODUCTS.map((product) => `${product.category}:${product.productCode}`));

function sourceIdentity(part: Part): string | undefined {
  return part.sourceProductCode ? `${part.category}:${part.sourceProductCode}` : undefined;
}

function applySupportManufacturerSpecs(part: Part): Part {
  if (part.category !== "case" || part.sourceProductCode !== "32861099" || !/^darkFlash\s+DS900\s+ARGB\s+강화유리\s+\(블랙\)$/i.test(part.name)) return part;
  if (part.specs.catalogSpecProvenance || part.specs.physicalEvidenceSourceUrl) return part;
  return {
    ...part,
    dataQuality: "manual",
    missingFields: part.missingFields.filter((field) => field !== "hddBays" && field !== "ssdBays"),
    specs: {
      ...part.specs,
      hddBays: 2,
      ssdBays: 2,
      radiatorSizesMm: [240, 360],
      radiatorSupports: [{ position: "top", sizesMm: [240, 360] }, { position: "side", sizesMm: [240] }],
      physicalEvidenceSourceUrl: "https://www.darkflash.com/product/ds900",
      physicalEvidenceManufacturerModel: "DS900 ATX / 32861099 black ARGB retail",
      physicalEvidenceUpdatedAt: "2026-10-04T22:17:52.000Z",
      physicalEvidenceSourceNote: "DS900 공식 표: 434×218×454mm, GPU 425mm, CPU 쿨러 170mm, 상단 라디에이터 240/360mm·측면 240mm, SSD/HDD 2/2. 다나와 해당 DS900 블랙 ARGB의 같은 외형·장착 치수와 2024년 8월 상단 라디에이터 변경 원문을 대조함. DS900M/Air/PRO 사양을 가져오지 않음. 라디에이터 두께·RAM 간섭·GPU 케이블 여유는 미확인."
    }
  };
}

/** Fresh public product-page captures; no private catalog or seed price fallback. */
export const gamingSupportVerifiedCatalog: readonly Part[] = (snapshot.parts as unknown as Part[]).filter((part) => {
  const identity = sourceIdentity(part);
  return identity !== undefined && PRODUCT_IDENTITIES.has(identity)
    && part.source === "danawa" && part.listingType === "retail"
    && typeof part.priceWon === "number" && Number.isFinite(part.priceWon) && part.priceWon > 0
    && (part.category !== "psu" || isQuoteBrandAllowed("psu", part.brand));
}).map(applySupportManufacturerSpecs);
export const GAMING_SUPPORT_CATALOG_REFRESHED_AT = snapshot.refreshedAt;

/** Newer live prices and separately reviewed case/PSU specifications win. */
export function applyGamingSupportCatalogSnapshot(catalog: readonly Part[]): Part[] {
  const verified = new Map(gamingSupportVerifiedCatalog.map((part) => [sourceIdentity(part), part]));
  const matched = new Set<string>();
  const result = catalog.map((part) => {
    const identity = sourceIdentity(part);
    const source = identity ? verified.get(identity) : undefined;
    if (!identity || !source) return part;
    matched.add(identity);
    return mergeReferenceCatalogPart(part, source);
  });
  for (const part of gamingSupportVerifiedCatalog) {
    const identity = sourceIdentity(part)!;
    if (!matched.has(identity) && !result.some((existing) => existing.id === part.id)) result.push({ ...part, specs: { ...part.specs } });
  }
  return result.map(applySupportManufacturerSpecs);
}
