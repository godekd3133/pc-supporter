import * as cheerio from "cheerio";
import type { AccessoryCategory } from "../shared/types";
import { isAllowedSourceUrl } from "../server/danawa";

export const BUNDLE_MEMBERS_SOURCE = "robots-allowed Danawa public accessory list UI bundle members";
export const BUNDLE_SORT_METHODS = ["BEST", "LOW_PRICE", "HIGH_PRICE", "NEW", "REVIEW"] as const;
export type BundleSortMethod = typeof BUNDLE_SORT_METHODS[number];

export type BundleMember = {
  memberProductCode: string;
  memberIndex: number;
  canonicalDetailUrl: string;
  sourceBundleName?: string;
  sourceMakerName?: string;
  sourceMakerCode?: number;
  sourceCategoryCodes?: Array<string | number>;
  sourceCategoryNames?: string[];
  unresolvedSourceFields?: Array<"price" | "image">;
};

export type UnresolvedBundleMember = {
  memberIndex: number;
  reason: "missing-or-invalid-product-code";
  sourceBundleName?: string;
  sourceFieldNames: string[];
};

export type BundleParentObservation = {
  parentProductCode: string;
  parentBundleName?: string;
  sourceCategoryCodes?: Array<string | number>;
  sourceCategoryNames?: string[];
  sourceBundleDictionaryCode?: string | number;
  bundleListPresent: boolean;
  bundleProductListLength: number;
  parentCodeIncluded: boolean;
  members: BundleMember[];
  unresolvedMembers: UnresolvedBundleMember[];
};

export type BundlePageObservation = {
  categoryId: string;
  page: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  fetchedAt: string;
  sortMethod: BundleSortMethod;
  sourcePath: "/list/";
  requestMethod: "POST";
  responseStatus: 200;
  responseContentType: string;
  parentProductCount: number;
  parents: BundleParentObservation[];
  unresolvedMemberCount: number;
};

export type BundleProductEvidenceEdge = {
  productCode: string;
  kind: "bundle_member" | "list_parent";
  parentProductCode: string;
  member?: BundleMember;
};

export type BundleMembersArtifact = {
  schemaVersion: 1;
  source: typeof BUNDLE_MEMBERS_SOURCE;
  updatedAt: string;
  categories: Record<string, {
    category: AccessoryCategory;
    categoryId: string;
    pagesBySort: Record<string, Record<string, BundlePageObservation>>;
  }>;
};

export type BundleCaptureRequestEvidence = {
  sourcePath: string;
  requestMethod: string;
  responseStatus: number;
  responseContentType: string;
};

export function isDanawaPCode(value: unknown): value is string {
  return typeof value === "string" && /^\d{5,16}$/.test(value);
}

export function canonicalAccessoryDetailUrl(productCode: string, categoryId: string) {
  if (!isDanawaPCode(productCode) || !/^\d{5,}$/.test(categoryId)) throw new Error("Invalid source PCode or category identity.");
  const url = new URL("https://prod.danawa.com/info/");
  url.searchParams.set("pcode", productCode);
  url.searchParams.set("cate", categoryId);
  return url.toString();
}

export function trustedDanawaImageUrl(value: string | undefined) {
  if (!value || !isAllowedSourceUrl(value)) return undefined;
  try {
    const url = new URL(value);
    if (url.username || url.password || !["img.danawa.com", "img.danuri.io"].includes(url.hostname.toLowerCase())) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function emptyBundleMembersArtifact(updatedAt = new Date().toISOString()): BundleMembersArtifact {
  return { schemaVersion: 1, source: BUNDLE_MEMBERS_SOURCE, updatedAt, categories: {} };
}

function normalizedCode(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const code = String(value);
  return isDanawaPCode(code) ? code : undefined;
}

function limitedText(value: unknown, maxLength = 240): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().slice(0, maxLength)
    : undefined;
}

function categoryFields(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const rawCodes = record.codes;
  const rawNames = record.names;
  const codes = Array.isArray(rawCodes)
    ? rawCodes.slice(0, 12).flatMap((entry) => {
      if (typeof entry === "number" && Number.isSafeInteger(entry)) return [entry];
      if (typeof entry === "string" && /^\d{1,16}$/.test(entry)) return [entry];
      return [];
    })
    : [];
  const names = Array.isArray(rawNames)
    ? rawNames.slice(0, 12).flatMap((entry) => {
      const text = limitedText(entry, 200);
      return text ? [text] : [];
    })
    : [];
  return {
    ...(codes.length ? { sourceCategoryCodes: codes } : {}),
    ...(names.length ? { sourceCategoryNames: names } : {})
  };
}

function sourceFieldNames(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value as Record<string, unknown>).slice(0, 40)
    : [];
}

export function createBundlePageObservation(input: {
  category: AccessoryCategory;
  categoryId: string;
  page: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  fetchedAt: string;
  sortMethod: string;
  requestEvidence: BundleCaptureRequestEvidence;
  products: unknown[];
}): BundlePageObservation {
  if (!BUNDLE_SORT_METHODS.includes(input.sortMethod as BundleSortMethod)) throw new Error("Unsupported bundle sort method.");
  if (input.requestEvidence.sourcePath !== "/list/" || input.requestEvidence.requestMethod !== "POST"
    || input.requestEvidence.responseStatus !== 200 || !input.requestEvidence.responseContentType.includes("text/x-component")) {
    throw new Error("Bundle capture lacks successful public list UI request evidence.");
  }
  if (!/^\d{5,}$/.test(input.categoryId) || !Number.isSafeInteger(input.page) || input.page < 1 || ![30, 60, 90].includes(input.pageSize)
    || !Number.isSafeInteger(input.totalCount) || input.totalCount < 0
    || input.totalPages !== Math.ceil(input.totalCount / input.pageSize) || input.page > input.totalPages
    || !Number.isFinite(Date.parse(input.fetchedAt))) {
    throw new Error("Bundle capture has invalid page totals, page size, or timestamp.");
  }
  const expectedRows = Math.min(input.pageSize, Math.max(0, input.totalCount - ((input.page - 1) * input.pageSize)));
  if (input.products.length !== expectedRows) throw new Error(`Bundle page ${input.page} row count ${input.products.length} does not match expected ${expectedRows}.`);

  const seenParentCodes = new Set<string>();
  const parents: BundleParentObservation[] = [];
  let unresolvedMemberCount = 0;
  for (const [rowIndex, rawProduct] of input.products.entries()) {
    if (!rawProduct || typeof rawProduct !== "object" || Array.isArray(rawProduct)) throw new Error(`Invalid parent row ${rowIndex} in bundle page ${input.page}.`);
    const product = rawProduct as Record<string, unknown>;
    const parentProductCode = normalizedCode(product.productCode ?? product.pcode ?? product.code);
    if (!parentProductCode || seenParentCodes.has(parentProductCode)) throw new Error(`Invalid or duplicate parent PCode in bundle page ${input.page}.`);
    seenParentCodes.add(parentProductCode);
    const bundleListPresent = Object.prototype.hasOwnProperty.call(product, "bundleProductList");
    const rawBundleList = product.bundleProductList;
    if (rawBundleList !== undefined && rawBundleList !== null && !Array.isArray(rawBundleList)) {
      throw new Error(`Parent ${parentProductCode} bundleProductList is not an array.`);
    }
    const bundleList = Array.isArray(rawBundleList) ? rawBundleList : [];
    const members: BundleMember[] = [];
    const unresolvedMembers: UnresolvedBundleMember[] = [];
    for (const [memberIndex, rawMember] of bundleList.entries()) {
      if (!rawMember || typeof rawMember !== "object" || Array.isArray(rawMember)) {
        unresolvedMembers.push({ memberIndex, reason: "missing-or-invalid-product-code", sourceFieldNames: [] });
        continue;
      }
      const member = rawMember as Record<string, unknown>;
      const memberProductCode = normalizedCode(member.productCode ?? member.pcode ?? member.pCode);
      const sourceBundleName = limitedText(member.bundleName);
      if (!memberProductCode) {
        unresolvedMembers.push({
          memberIndex,
          reason: "missing-or-invalid-product-code",
          ...(sourceBundleName ? { sourceBundleName } : {}),
          sourceFieldNames: sourceFieldNames(member)
        });
        continue;
      }
      const unresolvedSourceFields: Array<"price" | "image"> = [];
      if (member.price !== undefined && member.price !== null) unresolvedSourceFields.push("price");
      if (member.image !== undefined && member.image !== null) unresolvedSourceFields.push("image");
      members.push({
        memberProductCode,
        memberIndex,
        canonicalDetailUrl: canonicalAccessoryDetailUrl(memberProductCode, input.categoryId),
        ...(sourceBundleName ? { sourceBundleName } : {}),
        ...(limitedText(member.makerName, 120) ? { sourceMakerName: limitedText(member.makerName, 120) } : {}),
        ...(typeof member.makerCode === "number" && Number.isSafeInteger(member.makerCode) ? { sourceMakerCode: member.makerCode } : {}),
        ...categoryFields(member.category),
        ...(unresolvedSourceFields.length ? { unresolvedSourceFields } : {})
      });
    }
    if (members.length + unresolvedMembers.length !== bundleList.length) throw new Error(`Bundle member count invariant failed for parent ${parentProductCode}.`);
    unresolvedMemberCount += unresolvedMembers.length;
    const sourceDictionaryCode = product.bundleDictionaryCode;
    const sourceBundleDictionaryCode = typeof sourceDictionaryCode === "string" || (typeof sourceDictionaryCode === "number" && Number.isSafeInteger(sourceDictionaryCode))
      ? sourceDictionaryCode
      : undefined;
    parents.push({
      parentProductCode,
      ...(limitedText(product.productBundleName) ? { parentBundleName: limitedText(product.productBundleName) } : {}),
      ...categoryFields(product.category),
      ...(sourceBundleDictionaryCode !== undefined ? { sourceBundleDictionaryCode } : {}),
      bundleListPresent,
      bundleProductListLength: bundleList.length,
      parentCodeIncluded: members.some((member) => member.memberProductCode === parentProductCode),
      members,
      unresolvedMembers
    });
  }
  return {
    categoryId: input.categoryId,
    page: input.page,
    pageSize: input.pageSize,
    totalPages: input.totalPages,
    totalCount: input.totalCount,
    fetchedAt: input.fetchedAt,
    sortMethod: input.sortMethod as BundleSortMethod,
    sourcePath: "/list/",
    requestMethod: "POST",
    responseStatus: 200,
    responseContentType: input.requestEvidence.responseContentType,
    parentProductCount: parents.length,
    parents,
    unresolvedMemberCount
  };
}

export function validateBundlePageObservation(page: BundlePageObservation, sortMethod: string, pageNumber: number, expectedCategoryId?: string) {
  if (page.sortMethod !== sortMethod || page.page !== pageNumber || pageNumber < 1
    || (expectedCategoryId !== undefined && page.categoryId !== expectedCategoryId)
    || page.sourcePath !== "/list/" || page.requestMethod !== "POST" || page.responseStatus !== 200
    || !page.responseContentType.includes("text/x-component")) throw new Error("Bundle page source identity or request evidence mismatch.");
  if (!Number.isSafeInteger(page.pageSize) || ![30, 60, 90].includes(page.pageSize)
    || !Number.isSafeInteger(page.totalCount) || page.totalCount < 0
    || page.totalPages !== Math.ceil(page.totalCount / page.pageSize) || pageNumber > page.totalPages
    || !Number.isFinite(Date.parse(page.fetchedAt))) throw new Error("Bundle page totals, size, or timestamp are invalid.");
  const expectedParents = Math.min(page.pageSize, Math.max(0, page.totalCount - ((pageNumber - 1) * page.pageSize)));
  if (page.parentProductCount !== expectedParents || page.parents.length !== page.parentProductCount) throw new Error("Bundle parent row count does not match declared source rows.");
  let unresolvedCount = 0;
  for (const parent of page.parents) {
    if (!isDanawaPCode(parent.parentProductCode) || parent.members.length + parent.unresolvedMembers.length !== parent.bundleProductListLength) {
      throw new Error(`Bundle member count/parent identity invariant failed for ${parent.parentProductCode}.`);
    }
    for (const member of parent.members) {
      if (!isDanawaPCode(member.memberProductCode)
        || member.canonicalDetailUrl !== canonicalAccessoryDetailUrl(member.memberProductCode, page.categoryId)) {
        throw new Error(`Invalid bundle member identity for ${parent.parentProductCode}.`);
      }
    }
    unresolvedCount += parent.unresolvedMembers.length;
  }
  if (unresolvedCount !== page.unresolvedMemberCount) throw new Error("Bundle page unresolved member count does not match nested rows.");
}

export function bundleProductEvidenceEdges(page: BundlePageObservation): BundleProductEvidenceEdge[] {
  return page.parents.flatMap((parent) => [
    { productCode: parent.parentProductCode, kind: "list_parent" as const, parentProductCode: parent.parentProductCode },
    ...parent.members.map((member) => ({
      productCode: member.memberProductCode,
      kind: "bundle_member" as const,
      parentProductCode: parent.parentProductCode,
      member
    }))
  ]);
}

export function mergeBundlePageObservation(
  artifact: BundleMembersArtifact,
  category: AccessoryCategory,
  categoryId: string,
  page: BundlePageObservation
): BundleMembersArtifact {
  validateBundlePageObservation(page, page.sortMethod, page.page, categoryId);
  const currentCategory = artifact.categories[categoryId];
  if (currentCategory && (currentCategory.category !== category || currentCategory.categoryId !== categoryId)) {
    throw new Error("Bundle artifact category identity mismatch.");
  }
  const pagesBySort = currentCategory?.pagesBySort ?? {};
  const sortPages = pagesBySort[page.sortMethod] ?? {};
  return {
    ...artifact,
    categories: {
      ...artifact.categories,
      [categoryId]: {
        category,
        categoryId,
        pagesBySort: {
          ...pagesBySort,
          [page.sortMethod]: { ...sortPages, [String(page.page)]: page }
        }
      }
    }
  };
}

export function detailPagePCodeEvidence(html: string) {
  const $ = cheerio.load(html);
  const extractDetailUrl = (value: string | undefined) => {
    if (!value) return undefined;
    try {
      const url = new URL(value, "https://prod.danawa.com");
      return {
        origin: url.origin,
        pathname: url.pathname,
        pcode: url.searchParams.get("pcode") ?? undefined,
        categoryId: url.searchParams.get("cate") ?? undefined
      };
    } catch {
      return undefined;
    }
  };
  const canonicalValue = $("link[rel='canonical']").first().attr("href");
  const ogUrlValue = $("meta[property='og:url']").first().attr("content");
  const canonicalUrl = extractDetailUrl(canonicalValue);
  const ogUrl = extractDetailUrl(ogUrlValue);
  const primaryProductIdentities: Array<{
    source: "next-flight-primaryProduct" | "json-ld-product-offer";
    code?: string;
    urlOrigin?: string;
    urlPath?: string;
    urlPCode?: string;
    urlCategoryId?: string;
  }> = [];
  const rscPrimaryProductShapes: Array<{ source: "next-flight-primaryProduct"; path: string; keys: string[]; codeType: string; urlType: string }> = [];
  const pushPrimaryProduct = (value: unknown) => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
        try { pushPrimaryProduct(JSON.parse(trimmed)); } catch { /* Invalid nested source JSON is ignored. */ }
      }
      return;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const product = value as Record<string, unknown>;
    const codeType = product.code === null ? "null" : typeof product.code;
    const urlType = product.url === null ? "null" : typeof product.url;
    const code = normalizedCode(product.code);
    const productUrl = extractDetailUrl(typeof product.url === "string" ? product.url : undefined);
    rscPrimaryProductShapes.push({
      source: "next-flight-primaryProduct",
      path: "flight.primaryProduct",
      keys: Object.keys(product).slice(0, 40),
      codeType,
      urlType
    });
    primaryProductIdentities.push({
      source: "next-flight-primaryProduct",
      ...(code ? { code } : {}),
      ...(productUrl?.origin ? { urlOrigin: productUrl.origin } : {}),
      ...(productUrl?.pathname ? { urlPath: productUrl.pathname } : {}),
      ...(productUrl?.pcode ? { urlPCode: productUrl.pcode } : {}),
      ...(productUrl?.categoryId ? { urlCategoryId: productUrl.categoryId } : {})
    });
  };
  const visitPrimaryProducts = (value: unknown, depth: number) => {
    if (depth > 24 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const child of value.slice(0, 500)) visitPrimaryProducts(child, depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === "primaryProduct") pushPrimaryProduct(child);
      else visitPrimaryProducts(child, depth + 1);
    }
  };
  const matchingJsonEndIndex = (text: string, start: number) => {
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
      } else if (character === '"') inString = true;
      else if (character === opening) depth += 1;
      else if (character === closing && --depth === 0) return index + 1;
    }
    return undefined;
  };
  const scanFlightFrame = (frame: string) => {
    for (let index = 0; index < frame.length; index += 1) {
      if (frame[index] !== "{" && frame[index] !== "[") continue;
      const end = matchingJsonEndIndex(frame, index);
      if (!end) continue;
      try {
        visitPrimaryProducts(JSON.parse(frame.slice(index, end)), 0);
        index = end - 1;
      } catch {
        // Keep scanning in case a nested data object is still valid JSON.
      }
    }
  };
  const decodedFlightChunks: string[] = [];
  const flightMarker = /self\.__next_f\.push\(\[\s*1\s*,\s*/g;
  for (const match of html.matchAll(flightMarker)) {
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
      if (typeof chunk === "string") decodedFlightChunks.push(chunk);
    } catch { /* Ignore malformed Flight text. */ }
  }
  for (const chunk of decodedFlightChunks) {
    for (const line of chunk.split(/\r?\n/)) {
      const colon = line.indexOf(":");
      if (colon >= 0) scanFlightFrame(line.slice(colon + 1));
    }
  }
  const jsonLdText = $("script[type='application/ld+json']").first().contents().text();
  let jsonLdProductOfferShape: {
    source: "json-ld-product-offer";
    path: "json-ld[0]";
    productTypes: string[];
    productKeys: string[];
    offersTypes: string[];
    offersKeys: string[];
    productIsProduct: boolean;
    offersIsAggregateOffer: boolean;
    offersUrlOrigin?: string;
    offersUrlPath?: string;
    offersUrlPCode?: string;
    offersUrlCategoryId?: string;
  } | undefined;
  try {
    const parsed = JSON.parse(jsonLdText) as unknown;
    const root = Array.isArray(parsed) ? parsed[0] : parsed;
    if (root && typeof root === "object" && !Array.isArray(root)) {
      const product = root as Record<string, unknown>;
      const rawProductType = product["@type"];
      const productTypes = (Array.isArray(rawProductType) ? rawProductType : [rawProductType]).flatMap((type) => typeof type === "string" ? [type] : []).slice(0, 12);
      const offers = product.offers && typeof product.offers === "object" && !Array.isArray(product.offers) ? product.offers as Record<string, unknown> : undefined;
      const rawOffersType = offers?.["@type"];
      const offersTypes = (Array.isArray(rawOffersType) ? rawOffersType : [rawOffersType]).flatMap((type) => typeof type === "string" ? [type] : []).slice(0, 12);
      const offersUrl = extractDetailUrl(typeof offers?.url === "string" ? offers.url : undefined);
      const productIsProduct = productTypes.some((type) => type === "Product" || type.endsWith("/Product"));
      const offersIsAggregateOffer = offersTypes.some((type) => type === "AggregateOffer" || type.endsWith("/AggregateOffer"));
      jsonLdProductOfferShape = {
        source: "json-ld-product-offer",
        path: "json-ld[0]",
        productTypes,
        productKeys: Object.keys(product).slice(0, 40),
        offersTypes,
        offersKeys: offers ? Object.keys(offers).slice(0, 40) : [],
        productIsProduct,
        offersIsAggregateOffer,
        ...(offersUrl?.origin ? { offersUrlOrigin: offersUrl.origin } : {}),
        ...(offersUrl?.pathname ? { offersUrlPath: offersUrl.pathname } : {}),
        ...(offersUrl?.pcode ? { offersUrlPCode: offersUrl.pcode } : {}),
        ...(offersUrl?.categoryId ? { offersUrlCategoryId: offersUrl.categoryId } : {})
      };
      if (productIsProduct && offersIsAggregateOffer) {
        primaryProductIdentities.push({
          source: "json-ld-product-offer",
          ...(offersUrl?.pcode ? { code: offersUrl.pcode } : {}),
          ...(offersUrl?.origin ? { urlOrigin: offersUrl.origin } : {}),
          ...(offersUrl?.pathname ? { urlPath: offersUrl.pathname } : {}),
          ...(offersUrl?.pcode ? { urlPCode: offersUrl.pcode } : {}),
          ...(offersUrl?.categoryId ? { urlCategoryId: offersUrl.categoryId } : {})
        });
      }
    }
  } catch { /* Ignore malformed JSON-LD; no source identity is inferred. */ }
  return {
    ...(canonicalUrl?.pcode ? { canonicalPCode: canonicalUrl.pcode } : {}),
    ...(canonicalUrl?.origin ? { canonicalOrigin: canonicalUrl.origin } : {}),
    ...(canonicalUrl?.pathname ? { canonicalPath: canonicalUrl.pathname } : {}),
    ...(canonicalUrl?.categoryId ? { canonicalCategoryId: canonicalUrl.categoryId } : {}),
    ...(ogUrl?.pcode ? { ogUrlPCode: ogUrl.pcode } : {}),
    ...(ogUrl?.origin ? { ogUrlOrigin: ogUrl.origin } : {}),
    ...(ogUrl?.pathname ? { ogUrlPath: ogUrl.pathname } : {}),
    ...(ogUrl?.categoryId ? { ogUrlCategoryId: ogUrl.categoryId } : {}),
    primaryProductCount: primaryProductIdentities.length,
    primaryProductIdentities,
    rscPrimaryProductShapes,
    ...(jsonLdProductOfferShape ? { jsonLdProductOfferShape } : {})
  };
}

export function safeDetailPCodeSourceObjects(html: string, expectedPCode: string) {
  if (!isDanawaPCode(expectedPCode)) return [];
  const evidence = detailPagePCodeEvidence(html);
  return [
    ...evidence.rscPrimaryProductShapes.map((shape) => ({
      source: shape.source,
      path: shape.path,
      keys: shape.keys,
      scalarFieldTypes: { code: shape.codeType, url: shape.urlType },
      matchingCodeFields: evidence.primaryProductIdentities.filter((identity) => identity.source === shape.source && identity.code === expectedPCode).map(() => "code"),
      matchingUrlFields: evidence.primaryProductIdentities.filter((identity) => identity.source === shape.source && identity.urlPCode === expectedPCode).map(() => "url"),
      matchedProductCode: expectedPCode
    })),
    ...(evidence.jsonLdProductOfferShape ? [{
      source: evidence.jsonLdProductOfferShape.source,
      path: evidence.jsonLdProductOfferShape.path,
      keys: evidence.jsonLdProductOfferShape.productKeys,
      offersKeys: evidence.jsonLdProductOfferShape.offersKeys,
      productTypes: evidence.jsonLdProductOfferShape.productTypes,
      offersTypes: evidence.jsonLdProductOfferShape.offersTypes,
      offersUrlOrigin: evidence.jsonLdProductOfferShape.offersUrlOrigin,
      offersUrlPath: evidence.jsonLdProductOfferShape.offersUrlPath,
      offersUrlPCode: evidence.jsonLdProductOfferShape.offersUrlPCode,
      matchedProductCode: evidence.jsonLdProductOfferShape.offersUrlPCode === expectedPCode ? expectedPCode : undefined
    }] : [])
  ];
}

export function detailPageMatchesPCode(html: string, expectedPCode: string, expectedCategoryId?: string) {
  if (!isDanawaPCode(expectedPCode)) return false;
  const evidence = detailPagePCodeEvidence(html);
  const jsonLdProductIdentity = evidence.primaryProductIdentities.filter((identity) => identity.source === "json-ld-product-offer");
  const rscPrimaryProductIdentities = evidence.primaryProductIdentities.filter((identity) => identity.source === "next-flight-primaryProduct");
  return evidence.canonicalPCode === expectedPCode
    && evidence.canonicalPath === "/info/"
    && evidence.canonicalOrigin === "https://prod.danawa.com"
    && (evidence.ogUrlPCode === undefined || evidence.ogUrlPCode === expectedPCode)
    && (evidence.ogUrlOrigin === undefined || evidence.ogUrlOrigin === "https://prod.danawa.com")
    && (evidence.ogUrlPath === undefined || evidence.ogUrlPath === "/info/")
    && (expectedCategoryId === undefined || (evidence.canonicalCategoryId === undefined || evidence.canonicalCategoryId === expectedCategoryId))
    && (expectedCategoryId === undefined || (evidence.ogUrlCategoryId === undefined || evidence.ogUrlCategoryId === expectedCategoryId))
    && evidence.jsonLdProductOfferShape?.productIsProduct === true
    && evidence.jsonLdProductOfferShape?.offersIsAggregateOffer === true
    && jsonLdProductIdentity.length === 1
    && jsonLdProductIdentity.every((primary) => primary.code === expectedPCode
      && primary.urlPCode === expectedPCode
      && primary.urlOrigin === "https://prod.danawa.com"
      && primary.urlPath === "/info/"
      && (expectedCategoryId === undefined || primary.urlCategoryId === undefined || primary.urlCategoryId === expectedCategoryId))
    && rscPrimaryProductIdentities.every((primary) => primary.code === expectedPCode
      && primary.urlPCode === expectedPCode
      && primary.urlOrigin === "https://prod.danawa.com"
      && primary.urlPath === "/info/"
      && (expectedCategoryId === undefined || primary.urlCategoryId === undefined || primary.urlCategoryId === expectedCategoryId));
}
