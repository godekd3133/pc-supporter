/**
 * Reads the maximum number of storage devices an adapter can mount at once.
 *
 * This intentionally only accepts an explicit Korean mount-count label. A
 * capacity such as "최대 14TB 지원" is not a device count and must not be
 * turned into one by inference.
 */
export function parseAdapterStorageDeviceCount(text: string) {
  const match = text.match(/(?:보관\s*\(\s*장착\s*\)|보관|장착)\s*(?:가능\s*)?(?:개수|수)\s*[:：]?\s*(?:최대\s*)?(\d+)\s*개/i);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

/**
 * Reads an explicit PCIe connector width from a storage adapter description.
 *
 * A bare "M.2 → PCIe" label does not identify the electrical connector width,
 * so it intentionally remains unknown. Both "PCIe 3.0x4" and "PCI-E 4x"
 * forms are accepted because both occur in catalog source text.
 */
export function parseAdapterPcieSlotWidth(text: string) {
  const match = text.match(/PCI[- ]?e\s*(?:(?:[2-6](?:\.\d)?\s*)?x\s*(16|8|4|1)\b|(16|8|4|1)\s*x\b)/i);
  const value = Number(match?.[1] ?? match?.[2]);
  return value === 1 || value === 4 || value === 8 || value === 16 ? value : undefined;
}
