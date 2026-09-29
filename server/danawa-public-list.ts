import { isAllowedSourceUrl, parseDanawaListPage, parseDanawaListPageInfo, type DanawaListItem } from "./danawa";

export type DanawaPublicListPage = {
  items: DanawaListItem[];
  totalProductCount?: number;
  currentPage: number;
  pageSize: number;
  totalPages?: number;
  source: "next-flight-productList-query" | "dom-parser-fallback";
};

function decodedFlightChunks(html: string) {
  const chunks: string[] = [];
  const marker = /self\.__next_f\.push\(\[\s*1\s*,\s*/g;
  for (const match of html.matchAll(marker)) {
    const start = match.index! + match[0].length;
    if (html[start] !== '"') continue;
    let end = start + 1;
    let slashCount = 0;
    for (; end < html.length; end += 1) {
      const character = html[end];
      if (character === "\\") { slashCount += 1; continue; }
      if (character === '"' && slashCount % 2 === 0) break;
      slashCount = 0;
    }
    if (end >= html.length) continue;
    try {
      const chunk = JSON.parse(html.slice(start, end + 1));
      if (typeof chunk === "string") chunks.push(chunk);
    } catch {
      // Ignore malformed Flight chunks and use the HTML list parser below.
    }
  }
  return chunks;
}

function matchingJsonEndIndex(text: string, start: number) {
  const opening = text[start];
  const closing = opening === "{" ? "}" : opening === "[" ? "]" : undefined;
  if (!closing) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === opening) depth += 1;
    else if (character === closing && --depth === 0) return index + 1;
  }
  return undefined;
}

function textFromSource(value: unknown, depth = 0): string {
  if (depth > 5 || value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) return value.map((item) => textFromSource(item, depth + 1)).filter(Boolean).join(" ").trim();
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    for (const key of ["ko-KR", "ko", "displayName", "productName", "name", "label", "text", "title", "value", "description"]) {
      const found = textFromSource(object[key], depth + 1);
      if (found) return found;
    }
    return Object.values(object).map((item) => textFromSource(item, depth + 1)).filter(Boolean).join(" ").trim();
  }
  return "";
}

function productUrlFor(value: unknown, code: string) {
  if (typeof value === "string" && isAllowedSourceUrl(value)) {
    try {
      const url = new URL(value);
      if (url.pathname === "/info/" && url.searchParams.get("pcode") === code) return value;
    } catch {
      // Use the canonical detail URL below.
    }
  }
  return `https://prod.danawa.com/info/?pcode=${code}`;
}

function itemsFromNextFlightProducts(products: unknown[]): DanawaListItem[] {
  return products.flatMap((raw): DanawaListItem[] => {
    if (!raw || typeof raw !== "object") return [];
    const product = raw as Record<string, unknown>;
    const code = String(product.id ?? product.productCode ?? "").trim();
    const name = textFromSource(product.productName ?? product.name ?? product.title);
    if (!/^\d+$/.test(code) || !name || name === "[object Object]") return [];
    const rawUrl = typeof product.productUrl === "string" ? product.productUrl : typeof product.productLink === "string" ? product.productLink : undefined;
    const priceRecord = product.price && typeof product.price === "object" ? product.price as Record<string, unknown> : undefined;
    const rawPrice = priceRecord?.min ?? priceRecord?.lowest ?? product.displayPrice;
    const parsedPrice = typeof rawPrice === "number" ? rawPrice : typeof rawPrice === "string" ? Number(rawPrice.replace(/[^\d]/g, "")) : undefined;
    const imageRecord = product.image && typeof product.image === "object" ? product.image as Record<string, unknown> : undefined;
    const rawImage = typeof imageRecord?.url === "string" ? imageRecord.url : typeof product.imageUrl === "string" ? product.imageUrl : undefined;
    const imageUrl = rawImage && isAllowedSourceUrl(rawImage) ? rawImage : undefined;
    const description = Array.isArray(product.descriptionSegments)
      ? product.descriptionSegments.map((segment) => segment && typeof segment === "object" ? textFromSource((segment as Record<string, unknown>).text) : "").filter(Boolean).join(" / ")
      : textFromSource(product.description);
    return [{
      name,
      url: productUrlFor(rawUrl, code),
      sourceProductCode: code,
      ...(Number.isFinite(parsedPrice) && parsedPrice! > 0 ? { priceWon: parsedPrice } : {}),
      ...(imageUrl ? { imageUrl } : {}),
      ...(description ? { rawSpecText: description } : {})
    }];
  });
}

function embeddedListStats(html: string) {
  const pattern = /(?:\\?")totalCount(?:\\?")\s*:\s*(\d+)\s*,\s*(?:\\?")currentPage(?:\\?")\s*:\s*(\d+)\s*,\s*(?:\\?")pageSize(?:\\?")\s*:\s*(\d+)\s*,\s*(?:\\?")totalPages(?:\\?")\s*:\s*(\d+)/g;
  for (const match of html.matchAll(pattern)) {
    const [totalProductCount, currentPage, pageSize, totalPages] = match.slice(1).map(Number);
    if ([totalProductCount, currentPage, pageSize, totalPages].every(Number.isSafeInteger) && totalProductCount >= 0 && currentPage >= 1 && pageSize >= 1 && totalPages >= 1) {
      return { totalProductCount, currentPage, pageSize, totalPages };
    }
  }
  return undefined;
}

export function parseDanawaPublicListPage(html: string, categoryId: string, requestedPage = 1): DanawaPublicListPage {
  for (const chunk of decodedFlightChunks(html)) {
    let offset = 0;
    while (true) {
      const queryKeyIndex = chunk.indexOf('"queryKey":', offset);
      if (queryKeyIndex < 0) break;
      const keyStart = queryKeyIndex + '"queryKey":'.length;
      const keyEnd = matchingJsonEndIndex(chunk, keyStart);
      if (!keyEnd) { offset = keyStart; continue; }
      offset = keyEnd;
      let key: unknown;
      try { key = JSON.parse(chunk.slice(keyStart, keyEnd)); } catch { continue; }
      if (!Array.isArray(key) || key[0] !== "productList" || String(key[1]) !== categoryId || Number(key[2]) !== requestedPage) continue;
      const objectStart = chunk.lastIndexOf('{"dehydratedAt":', queryKeyIndex);
      if (objectStart < 0) continue;
      const objectEnd = matchingJsonEndIndex(chunk, objectStart);
      if (!objectEnd) continue;
      try {
        const candidate = JSON.parse(chunk.slice(objectStart, objectEnd)) as Record<string, unknown>;
        const state = candidate.state as Record<string, unknown> | undefined;
        const data = state?.data as Record<string, unknown> | undefined;
        if (!data || !Array.isArray(data.products)) continue;
        const pageInfo = {
          totalProductCount: typeof data.totalCount === "number" ? data.totalCount : undefined,
          currentPage: typeof data.currentPage === "number" ? data.currentPage : typeof key[2] === "number" ? key[2] : requestedPage,
          pageSize: typeof data.pageSize === "number" ? data.pageSize : undefined,
          totalPages: typeof data.totalPages === "number" ? data.totalPages : undefined
        };
        return {
          items: itemsFromNextFlightProducts(data.products),
          ...pageInfo,
          currentPage: pageInfo.currentPage,
          pageSize: pageInfo.pageSize ?? (data.products.length || 30),
          source: "next-flight-productList-query"
        };
      } catch {
        // Continue searching a later Flight chunk or use the DOM fallback.
      }
    }
  }

  const items = parseDanawaListPage(html);
  const info = parseDanawaListPageInfo(html);
  const embedded = embeddedListStats(html);
  return {
    items,
    totalProductCount: embedded?.totalProductCount ?? info.totalProductCount,
    currentPage: embedded?.currentPage ?? requestedPage,
    pageSize: embedded?.pageSize ?? info.pageSize ?? items.length,
    totalPages: embedded?.totalPages,
    source: "dom-parser-fallback"
  };
}
