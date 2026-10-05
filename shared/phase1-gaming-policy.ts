import type { EngineTargetFiltersConfig } from "./engine-target-filters";
import { inferListingType } from "./domain/listing";
import { gpuGamingIndexFor } from "./relative-performance-index";
import type { GpuVendor, Part } from "./types";

/** The first test bed is a product allowlist, independent of the general catalog. */
export const PHASE1_GAMING_NAME_PATTERNS = {
  cpu: ["(?:AMD|라이젠|Ryzen).*\\b[579]\\d{3}(?:[A-Z0-9]+)?\\b"],
  cooler: ["^DEEPCOOL\\s+AG400\\s+G2(?:\\s|$)", "^Thermalright\\s+Peerless\\s+Assassin\\s+120\\s+SE\\s+서린(?:\\s|$)", "^CORSAIR\\s+NAUTILUS\\s+360\\s+RS(?:\\s|$)"],
  motherboard: ["^GIGABYTE\\s+B850M\\s+GAMING\\s+X\\s+WIFI6E\\s+제이씨현(?:\\s|$)", "^MSI\\s+MAG\\s+X870E\\s+토마호크\\s+WIFI(?:\\s|$)", "^ASRock\\s+A520M-HVS\\s+대원씨티에스(?:\\s|$)", "^ASUS\\s+TUF\\s+Gaming\\s+B550M-PLUS\\s+STCOM(?:\\s|$)"],
  memory: ["^PATRIOT\\s+DDR5-8000\\s+CL38\\s+VIPER\\s+Xtreme5\\s+RGB\\s+패키지(?:\\s|$)", "^ESSENCORE\\s+KLEVV\\s+DDR5-5600\\s+CL46\\s+파인인포(?:\\s|$)", "^ESSENCORE\\s+KLEVV\\s+DDR4-3200\\s+CL22\\s+파인인포(?:\\s|$)"],
  gpu: ["\\bRTX\\s+50\\d{2}\\b", "^MSI\\s+지포스\\s+RTX\\s+3050\\s+벤투스\\s+2X\\s+E\\s+OC\\s+D6\\s+6GB(?:\\s|$)", "^AFOX\\s+라데온\\s+RX\\s+580\\s+2048SP\\s+D5\\s+8GB\\s+디앤디컴(?:\\s|$)"]
} as const;

export function phase1GamingPartAllowed(part: Part, vendor?: GpuVendor): boolean {
  // Packaging cannot make an overseas or used listing a domestic new product.
  if (part.dataQuality === "seed") return false;
  const listingType = inferListingType(part);
  if (listingType === "overseas" || listingType === "used" || listingType === "accessory") return false;
  const patterns = part.category === "gpu" ? gamingGpuNamePatterns(vendor) : PHASE1_GAMING_NAME_PATTERNS[part.category as keyof typeof PHASE1_GAMING_NAME_PATTERNS];
  if (!patterns) return true;
  return patterns.some((pattern) => new RegExp(pattern, "i").test(part.name));
}

function gamingGpuNamePatterns(vendor?: GpuVendor): readonly string[] {
  if (vendor === "amd") return ["\\bRX\\s+90\\d{2}\\b", PHASE1_GAMING_NAME_PATTERNS.gpu[2]];
  if (vendor === "nvidia") return PHASE1_GAMING_NAME_PATTERNS.gpu.slice(0, 2);
  if (vendor === "intel") return [];
  return PHASE1_GAMING_NAME_PATTERNS.gpu;
}

export function phase1GamingFilters(adminFilters?: EngineTargetFiltersConfig, vendor?: GpuVendor): EngineTargetFiltersConfig {
  const categories = adminFilters?.enabled ? { ...adminFilters.categories } : {};
  for (const [category, namePatterns] of Object.entries(PHASE1_GAMING_NAME_PATTERNS)) {
    const key = category as keyof typeof PHASE1_GAMING_NAME_PATTERNS;
    const adminRule = categories[key];
    // The catalog has already been intersected with the test-bed allowlist.
    // Keep any admin restrictions and expose explicit names so KLEVV and older
    // Ryzen models bypass the unrelated general-generation/brand policy.
    categories[key] = { ...adminRule, namePatterns: adminRule?.namePatterns?.length ? adminRule.namePatterns : [...(key === "gpu" ? gamingGpuNamePatterns(vendor) : namePatterns)] };
  }
  return { schemaVersion: 1, enabled: true, categories };
}

function cpuModelNumber(part: Part): string | undefined {
  return part.name.match(/\b([579]\d{3}(?:[a-z0-9]+)?)\b/i)?.[1].toUpperCase();
}

/** Internal gaming classes: extra cores alone are not a gaming upgrade. */
export function phase1CpuGamingClass(part: Part | undefined): number {
  if (!part) return 0;
  const model = cpuModelNumber(part);
  if (!model) return 0;
  const series = Number(model[0]);
  const base = series === 9 ? 3 : series === 7 ? 2 : 1;
  const cacheClass = /X3D/.test(model) ? 3 : 0;
  const entryPenalty = series === 5 && (/^5500/.test(model) || /G(?:T)?$/.test(model)) ? 0.5 : 0;
  return base + cacheClass - entryPenalty;
}

/** Model ordering only; these values are not benchmark percentages. */
export function phase1GpuGamingClass(part: Part | undefined): number {
  if (!part) return 0;
  const model = part.name.match(/\bRTX\s+(50\d{2})(?:\s*(TI|SUPER))?\b/i);
  if (model) return Number(model[1]) - 5_000 + (model[2] ? 5 : 0) + Math.min(part.specs.vramGb ?? 0, 32) / 100;
  if (/\bRX\s+90\d{2}\b/i.test(part.name)) return (gpuGamingIndexFor(part) ?? 0) / 2;
  if (/\bRTX\s+3050\b/i.test(part.name)) return 20;
  if (/\bRX\s+580\b/i.test(part.name)) return 10;
  return 0;
}
