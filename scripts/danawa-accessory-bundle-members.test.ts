import { describe, expect, it } from "vitest";
import {
  BUNDLE_MEMBERS_SOURCE,
  bundleProductEvidenceEdges,
  canonicalAccessoryDetailUrl,
  classifyDetailPageIdentity,
  createBundlePageObservation,
  detailPageMatchesPCode,
  detailPagePCodeEvidence,
  mergeBundlePageObservation,
  safeDetailPCodeSourceObjects,
  trustedDanawaImageUrl,
  validateBundlePageObservation,
  type BundleMembersArtifact
} from "./danawa-accessory-bundle-members";

const fetchedAt = "2026-09-30T04:00:00.000Z";
const requestEvidence = {
  sourcePath: "/list/",
  requestMethod: "POST",
  responseStatus: 200,
  responseContentType: "text/x-component; charset=utf-8"
};

function page(products: unknown[]) {
  return createBundlePageObservation({
    category: "cooling_fan",
    categoryId: "11336858",
    page: 1,
    pageSize: 90,
    totalPages: 25,
    totalCount: 2163,
    fetchedAt,
    sortMethod: "BEST",
    requestEvidence,
    products: [...products, ...Array.from({ length: 90 - products.length }, (_, index) => ({
      productCode: String(60000000 + index),
      bundleProductList: []
    }))]
  });
}

describe("Danawa accessory bundle member evidence", () => {
  it("preserves valid member identities and leaves unverified nested price/image schemas unresolved", () => {
    const captured = page([{
      productCode: 105679532,
      bundleDictionaryCode: 0,
      productBundleName: "source parent label",
      bundleProductList: [
        {
          productCode: 105679532,
          bundleName: "source parent label",
          makerCode: 1,
          makerName: "Maker",
          category: { codes: [862, "13665"], names: ["주변기기", "시스템 쿨러"] },
          price: { min: 12345 },
          image: { imageUrl: "https://img.danawa.com/prod_img/example.jpg?size=300" }
        },
        { productCode: 105679607, bundleName: "source option label", price: { min: 23456 } },
        { bundleName: "unidentified source member", price: { min: 34567 } }
      ]
    }]);

    const parent = captured.parents[0];
    expect(parent.parentProductCode).toBe("105679532");
    expect(parent.parentCodeIncluded).toBe(true);
    expect(parent.sourceBundleDictionaryCode).toBe(0);
    expect(parent.bundleProductListLength).toBe(3);
    expect(parent.members).toHaveLength(2);
    expect(parent.unresolvedMembers).toEqual([expect.objectContaining({
      memberIndex: 2,
      reason: "missing-or-invalid-product-code"
    })]);
    expect(parent.members[0]).toMatchObject({
      memberProductCode: "105679532",
      sourceBundleName: "source parent label",
      unresolvedSourceFields: ["price", "image"],
      sourceCategoryCodes: [862, "13665"],
      sourceCategoryNames: ["주변기기", "시스템 쿨러"],
      canonicalDetailUrl: canonicalAccessoryDetailUrl("105679532", "11336858")
    });
    expect("sourcePriceWon" in parent.members[0]).toBe(false);
    expect("sourceImageUrl" in parent.members[0]).toBe(false);
    expect(parent.members[1].unresolvedSourceFields).toEqual(["price"]);
    expect(captured.unresolvedMemberCount).toBe(1);
    expect(() => validateBundlePageObservation(captured, "BEST", 1)).not.toThrow();
  });

  it("rejects invalid source totals, page identity, and member accounting", () => {
    expect(() => createBundlePageObservation({
      category: "cooling_fan",
      categoryId: "11336858",
      page: 1,
      pageSize: 90,
      totalPages: 73,
      totalCount: 2163,
      fetchedAt,
      sortMethod: "BEST",
      requestEvidence,
      products: []
    })).toThrow(/row count|total/i);

    const captured = page([{ productCode: "105679532", bundleProductList: [{ productCode: "105679607" }] }]);
    const corrupted = {
      ...captured,
      parents: captured.parents.map((parent, index) => index === 0 ? { ...parent, bundleProductListLength: 2 } : parent)
    };
    expect(() => validateBundlePageObservation(corrupted, "BEST", 1)).toThrow(/member count/i);
    expect(() => validateBundlePageObservation(captured, "HIGH_PRICE", 1)).toThrow(/identity|evidence/i);
  });

  it("forms the observed PCode union from direct list parents and nested bundle members", () => {
    const captured = page([{
      productCode: 105679532,
      bundleProductList: [
        { productCode: 105679532, bundleName: "representative row" },
        { productCode: 105679607, bundleName: "missing option" }
      ]
    }]);
    const edges = bundleProductEvidenceEdges(captured);
    const directParent = edges.find((edge) => edge.productCode === "105679532" && edge.kind === "list_parent");
    const nestedSelf = edges.find((edge) => edge.productCode === "105679532" && edge.kind === "bundle_member");
    const nestedVariant = edges.find((edge) => edge.productCode === "105679607" && edge.kind === "bundle_member");
    expect(directParent?.parentProductCode).toBe("105679532");
    expect(nestedSelf?.parentProductCode).toBe("105679532");
    expect(nestedVariant?.parentProductCode).toBe("105679532");
    expect(new Set(edges.map((edge) => edge.productCode))).toContain("105679607");
  });

  it("merges a page without replacing unrelated category or sort evidence", () => {
    const current: BundleMembersArtifact = {
      schemaVersion: 1,
      source: BUNDLE_MEMBERS_SOURCE,
      updatedAt: "2026-09-30T03:00:00.000Z",
      categories: {
        "11336858": {
          category: "cooling_fan",
          categoryId: "11336858",
          pagesBySort: { LOW_PRICE: { "2": page([]) } }
        },
        "11336859": {
          category: "thermal_grease",
          categoryId: "11336859",
          pagesBySort: {}
        }
      }
    };
    const captured = page([{ productCode: "105679532", bundleProductList: [{ productCode: "105679607" }] }]);
    const merged = mergeBundlePageObservation(current, "cooling_fan", "11336858", captured);
    expect(merged.categories["11336858"].pagesBySort.BEST["1"]).toEqual(captured);
    expect(merged.categories["11336858"].pagesBySort.LOW_PRICE["2"]).toEqual(current.categories["11336858"].pagesBySort.LOW_PRICE["2"]);
    expect(merged.categories["11336859"]).toEqual(current.categories["11336859"]);
    expect(current.categories["11336858"].pagesBySort.BEST).toBeUndefined();
  });

  it("requires canonical and scoped Next Flight primaryProduct code/url evidence", () => {
    const primaryProduct = { code: "105679607", url: "https://prod.danawa.com/info/?pcode=105679607&cate=11336858" };
    const flight = `0:${JSON.stringify({ primaryProduct, relatedProducts: [{ productCode: "105679532", url: "https://prod.danawa.com/info/?pcode=105679532" }] })}`;
    const jsonLdProduct = { "@type": "Product", sku: "untrusted-sku", offers: { "@type": "AggregateOffer", url: "https://prod.danawa.com/info/?pcode=105679607&cate=11336858" } };
    const matchingHtml = `
      <link rel="canonical" href="https://prod.danawa.com/info/?pcode=105679607&cate=11336858">
      <script>self.__next_f.push([1,${JSON.stringify(flight)}]);</script>
      <script type="application/ld+json">${JSON.stringify(jsonLdProduct)}</script>
    `;
    const evidence = detailPagePCodeEvidence(matchingHtml);
    expect(evidence.canonicalPCode).toBe("105679607");
    expect(evidence.primaryProductCount).toBe(2);
    expect(evidence.primaryProductIdentities).toContainEqual(expect.objectContaining({
      source: "next-flight-primaryProduct",
      code: "105679607",
      urlPCode: "105679607",
      urlCategoryId: "11336858"
    }));
    expect(evidence.primaryProductIdentities).toContainEqual(expect.objectContaining({
      source: "json-ld-product-offer",
      code: "105679607",
      urlPCode: "105679607",
      urlCategoryId: "11336858"
    }));
    expect(detailPageMatchesPCode(matchingHtml, "105679607", "11336858")).toBe(true);
    expect(detailPageMatchesPCode(matchingHtml, "105679607", "11336859")).toBe(false);
    expect(detailPageMatchesPCode(matchingHtml, "105679532", "11336858")).toBe(false);
    expect(detailPageMatchesPCode(matchingHtml.replace(/<link rel="canonical" href="[^"]+">/, "<link rel=\"canonical\" href=\"https://prod.danawa.com/info/?pcode=105679532&cate=11336858\">"), "105679607", "11336858")).toBe(false);
    expect(detailPageMatchesPCode("<div>challenge</div>", "105679607", "11336858")).toBe(false);
  });

  it("accepts scoped JSON-LD primaryProduct and treats absent og:url as optional corroboration", () => {
    const primaryProduct = { "@type": "Product", sku: "sku-must-not-authorize-pcode", name: "primary", offers: { "@type": "AggregateOffer", url: "https://prod.danawa.com/info/?pcode=105679607" }, relatedProducts: [{ "@type": "Product", offers: { "@type": "AggregateOffer", url: "https://prod.danawa.com/info/?pcode=99999999" } }] };
    const html = `<link rel="canonical" href="https://prod.danawa.com/info/?pcode=105679607"><script type="application/ld+json">${JSON.stringify(primaryProduct)}</script>`;
    expect(detailPageMatchesPCode(html, "105679607", "11336858")).toBe(true);
    const mismatchedOffersUrl = html.replace("pcode=105679607", "pcode=105679532");
    expect(detailPageMatchesPCode(mismatchedOffersUrl, "105679607", "11336858")).toBe(false);
    const relatedProductOnly = `<link rel="canonical" href="https://prod.danawa.com/info/?pcode=105679607"><script type="application/ld+json">${JSON.stringify({ "@type": "WebPage", relatedProducts: [{ "@type": "Product", offers: { "@type": "AggregateOffer", url: "https://prod.danawa.com/info/?pcode=105679607" } }] })}</script>`;
    expect(detailPageMatchesPCode(relatedProductOnly, "105679607", "11336858")).toBe(false);
    const missingPrimary = `<link rel="canonical" href="https://prod.danawa.com/info/?pcode=105679607"><meta name="pcode" content="105679607">`;
    expect(detailPageMatchesPCode(missingPrimary, "105679607", "11336858")).toBe(false);
  });

  it("separates explicit identity contradictions from missing primary metadata", () => {
    const missingPrimary = `<link rel="canonical" href="https://prod.danawa.com/info/?pcode=124076184"><title>Sample product</title>`;
    expect(classifyDetailPageIdentity(missingPrimary, "124076184", "11336858")).toMatchObject({
      status: "quarantined",
      reason: "json-ld-primary-metadata-missing"
    });

    const productOffer = (code: string) => ({ "@type": "Product", offers: { "@type": "AggregateOffer", url: `https://prod.danawa.com/info/?pcode=${code}&cate=11336858` } });
    const mismatch = `<link rel="canonical" href="https://prod.danawa.com/info/?pcode=105679532&cate=11336858"><script type="application/ld+json">${JSON.stringify(productOffer("105679607"))}</script>`;
    expect(classifyDetailPageIdentity(mismatch, "105679607", "11336858")).toMatchObject({ status: "hard-stop", reason: "canonical-identity-mismatch" });

    const challenge = `<title>접근이 제한되었습니다</title><link rel="canonical" href="https://prod.danawa.com/info/?pcode=105679607"><script type="application/ld+json">${JSON.stringify(productOffer("105679607"))}</script>`;
    expect(classifyDetailPageIdentity(challenge, "105679607", "11336858")).toMatchObject({ status: "hard-stop", reason: "access-challenge" });

    const missingOfferUrl = `<link rel="canonical" href="https://prod.danawa.com/info/?pcode=105679607"><script type="application/ld+json">${JSON.stringify({ "@type": "Product", offers: { "@type": "AggregateOffer" } })}</script>`;
    expect(classifyDetailPageIdentity(missingOfferUrl, "105679607", "11336858")).toMatchObject({ status: "quarantined", reason: "json-ld-primary-offer-url-missing" });
  });

  it("reports safe Product/AggregateOffer schema keys without values", () => {
    const flight = `0:${JSON.stringify({ recommendations: [{ productCode: "105679607" }] })}`;
    const jsonLdProduct = { "@type": "Product", name: "do not log", offers: { "@type": "AggregateOffer", url: "https://prod.danawa.com/info/?pcode=105679607" } };
    const html = `<link rel="canonical" href="https://prod.danawa.com/info/?pcode=105679607"><script>self.__next_f.push([1,${JSON.stringify(flight)}]);</script><script type="application/ld+json">${JSON.stringify(jsonLdProduct)}</script>`;
    const diagnostic = safeDetailPCodeSourceObjects(html, "105679607");
    expect(diagnostic).toEqual([expect.objectContaining({
      source: "json-ld-product-offer",
      path: "json-ld[0]",
      productTypes: ["Product"],
      offersTypes: ["AggregateOffer"],
      offersUrlPCode: "105679607"
    })]);
    expect(JSON.stringify(diagnostic)).not.toContain("not logged");
    expect(detailPageMatchesPCode(html, "105679607", "11336858")).toBe(true);
  });

  it("retains only the two verified Danawa image CDN hosts", () => {
    expect(trustedDanawaImageUrl("https://img.danuri.io/catalog-image/fan.jpg"))
      .toBe("https://img.danuri.io/catalog-image/fan.jpg");
    expect(trustedDanawaImageUrl("https://img.danawa.com/prod_img/fan.jpg"))
      .toBe("https://img.danawa.com/prod_img/fan.jpg");
    expect(trustedDanawaImageUrl("https://prod.danawa.com/info/?pcode=105679607")).toBeUndefined();
    expect(trustedDanawaImageUrl("https://img.other.example/fan.jpg")).toBeUndefined();
    expect(trustedDanawaImageUrl("http://img.danuri.io/catalog-image/fan.jpg")).toBeUndefined();
  });
});
