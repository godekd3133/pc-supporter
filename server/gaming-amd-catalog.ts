import snapshot from "./reference-data/gaming-amd-catalog.json";
import type { Part } from "../shared/types";
import { mergeReferenceCatalogPart } from "./reference-catalog-merge";

const PRODUCT_CODES = new Set(["95985854", "91909571", "77382623", "77378039"]);

/** Four exact domestic products captured from their public Danawa pages. */
export const gamingAmdVerifiedCatalog: readonly Part[] = (snapshot.parts as unknown as Part[]).filter((part) =>
  part.category === "gpu" && part.source === "danawa" && part.listingType === "retail"
  && part.sourceProductCode !== undefined && PRODUCT_CODES.has(part.sourceProductCode)
  && part.specs.gpuVendor === "amd" && typeof part.priceWon === "number" && part.priceWon > 0
);
export const GAMING_AMD_CATALOG_REFRESHED_AT = snapshot.refreshedAt;

function sourceIdentity(part: Part): string | undefined {
  return part.sourceProductCode ? `${part.category}:${part.sourceProductCode}` : undefined;
}

/** Newer live reads and separately reviewed physical specifications keep precedence. */
export function applyGamingAmdCatalogSnapshot(catalog: readonly Part[]): Part[] {
  const verified = new Map(gamingAmdVerifiedCatalog.map((part) => [sourceIdentity(part), part]));
  const matched = new Set<string>();
  const result = catalog.map((part) => {
    const identity = sourceIdentity(part);
    const source = identity ? verified.get(identity) : undefined;
    if (!identity || !source) return part;
    matched.add(identity);
    return mergeReferenceCatalogPart(part, source);
  });
  for (const part of gamingAmdVerifiedCatalog) {
    const identity = sourceIdentity(part)!;
    if (!matched.has(identity) && !result.some((existing) => existing.id === part.id)) result.push({ ...part, specs: { ...part.specs } });
  }
  return result;
}
