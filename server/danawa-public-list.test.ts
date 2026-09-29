import { describe, expect, it } from "vitest";
import { parseDanawaPublicListPage } from "./danawa-public-list";

function nextFlightPage(categoryId: string, page: number, product: Record<string, unknown>) {
  const state = {
    dehydratedAt: "2026-09-29T00:00:00.000Z",
    queryKey: ["productList", categoryId, page, 30],
    state: {
      data: {
        products: [product],
        totalCount: 1020,
        currentPage: page,
        pageSize: 30,
        totalPages: 34
      }
    }
  };
  const chunk = JSON.stringify(state);
  return `<script>self.__next_f.push([1,${JSON.stringify(chunk)}]);</script>`;
}

describe("Danawa public list page parser", () => {
  it("reads the category's Next Flight product list and page coverage fields", () => {
    const html = nextFlightPage("11329818", 1, {
      id: "5738131",
      productName: "라이트컴 COMS M.2 NVMe to PCIe x4 변환 어댑터",
      productUrl: "https://prod.danawa.com/info/?pcode=5738131&cate=11329818",
      price: { min: 18500 },
      image: { url: "https://img.danawa.com/product/example.jpg" },
      descriptionSegments: [{ text: "M.2 NVMe to PCIe x4" }, { text: "SSD 전용" }]
    });

    expect(parseDanawaPublicListPage(html, "11329818")).toEqual({
      items: [{
        name: "라이트컴 COMS M.2 NVMe to PCIe x4 변환 어댑터",
        url: "https://prod.danawa.com/info/?pcode=5738131&cate=11329818",
        sourceProductCode: "5738131",
        priceWon: 18500,
        imageUrl: "https://img.danawa.com/product/example.jpg",
        rawSpecText: "M.2 NVMe to PCIe x4 / SSD 전용"
      }],
      totalProductCount: 1020,
      currentPage: 1,
      pageSize: 30,
      totalPages: 34,
      source: "next-flight-productList-query"
    });
  });

  it("does not use another category's hydrated list", () => {
    const html = nextFlightPage("112760", 1, { id: "1", productName: "SSD" });

    expect(parseDanawaPublicListPage(html, "11329818")).toMatchObject({
      items: [],
      currentPage: 1,
      source: "dom-parser-fallback"
    });
  });
});
