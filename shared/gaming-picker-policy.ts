import { gamingFallbackSsdAllowed, gamingSsdFamilyAllowed } from "./cpu-gaming-policy";
import { inferListingType, isQuoteBrandAllowed, isQuotePurchasable } from "./domain/listing";
import { phase1GpuPowerUpperBoundW } from "./phase1-hardware-evidence";
import { phase1GamingPartAllowed } from "./phase1-gaming-policy";
import type { Part } from "./types";

export type GamingPickerQuoteContext = "gaming_testbed";

/** A manual picker includes both platforms, so a choice may rebuild the board,
 * RAM and cooling. Current CPU/DDR/vendor preferences do not narrow this pool. */
export function gamingPickerPartAllowed(part: Part, catalog?: readonly Part[]): boolean {
  const listing = inferListingType(part);
  if (listing !== "retail" && listing !== "bulk") return false;
  const allowed = phase1GamingPartAllowed(part)
    || phase1GamingPartAllowed(part, "amd")
    || phase1GamingPartAllowed(part, undefined, "intel");
  if (!allowed) return false;
  if (part.category === "ssd" && !gamingSsdFamilyAllowed(part) && !gamingFallbackSsdAllowed(part)) return false;
  if (["psu", "hdd"].includes(part.category) && !isQuoteBrandAllowed(part.category, part.brand, part.name)) return false;
  const required = part.category === "gpu" ? ["recommendedPsuW", "lengthMm", "thicknessMm"]
    : part.category === "cooler" ? ["supportedSockets", part.specs.coolerType === "liquid" ? "radiatorSizeMm" : "maxCoolerHeightMm"]
    : part.category === "case" ? ["maxCoolerHeightMm", "motherboardFormFactors", "maxPsuLengthMm", "supportedPsuFormFactors"] : [];
  if (!required.every((field) => {
    const value = part.specs[field as keyof Part["specs"]];
    return value !== undefined && (!Array.isArray(value) || value.length > 0);
  })) return false;
  if (part.category === "gpu" && phase1GpuPowerUpperBoundW(part) === undefined) return false;
  // These categories may lack unrelated global metadata, while all fields
  // needed for the platform rebuild above are present. The engine validates
  // the selected pairing and its additional physical requirements afterward.
  const purchasable = required.length > 0 && part.dataQuality === "incomplete" && part.source !== "seed"
    ? { ...part, dataQuality: "live" as const } : part;
  return isQuotePurchasable(purchasable, catalog);
}
