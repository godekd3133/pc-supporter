/** Canonical model spelling without collapsing unrelated words or SKU boundaries. */
export function normalizeCatalogSearchText(value: string) {
  return value.toLocaleLowerCase("ko-KR").trim().replace(/\s+/g, " ")
    .replace(/\b(rtx|gtx|rx)\s*(\d{3,4})/g, "$1 $2")
    .replace(/\b(\d{3,4})\s*(ti|super|xtx|xt)(?=\b)/g, "$1$2");
}

export function catalogSearchMatches(haystack: string, query: string) {
  const normalized = normalizeCatalogSearchText(haystack);
  const needle = normalizeCatalogSearchText(query);
  if (!needle) return true;
  // A complete model must not also match its Ti/XT sibling or longer model IDs.
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const modelEnd = /\b\d{3,4}(?:ti|super|xtx|xt)?$/.test(needle);
  return modelEnd ? new RegExp(`(?:^|[^a-z0-9])${escaped}(?![a-z0-9])`, "i").test(normalized) : normalized.includes(needle);
}
