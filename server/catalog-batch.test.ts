import { describe, expect, it } from "vitest";
import { CATALOG_BATCH_ID_LIMIT, parseCatalogBatchIds, parseCatalogBatchQuery } from "./catalog-batch";

describe("catalog batch id request", () => {
  it("trims, deduplicates, and preserves requested order", () => {
    expect(parseCatalogBatchIds({ ids: [" part-2 ", "part-1", "part-2"] })).toEqual({ ids: ["part-2", "part-1"], errors: [] });
  });

  it("rejects malformed and oversized input", () => {
    expect(parseCatalogBatchIds(undefined).errors).toContain("ids 배열이 필요합니다.");
    expect(parseCatalogBatchIds({ ids: [] }).errors).toContain("조회할 카탈로그 ID가 없습니다.");
    expect(parseCatalogBatchIds({ ids: [""] }).errors[0]).toContain("ids[0]");
    const oversized = parseCatalogBatchIds({ ids: Array.from({ length: CATALOG_BATCH_ID_LIMIT + 1 }, (_, index) => `part-${index}`) });
    expect(oversized.ids).toHaveLength(CATALOG_BATCH_ID_LIMIT);
    expect(oversized.errors[0]).toContain(`최대 ${CATALOG_BATCH_ID_LIMIT}개`);
  });

  it("parses comma-separated GET query ids with the same validation", () => {
    expect(parseCatalogBatchQuery("cpu-1,cpu-2,cpu-1")).toEqual({ ids: ["cpu-1", "cpu-2"], errors: [] });
    expect(parseCatalogBatchQuery(["cpu-1,cpu-2", "cpu-3"]).ids).toEqual(["cpu-1", "cpu-2", "cpu-3"]);
  });
});
