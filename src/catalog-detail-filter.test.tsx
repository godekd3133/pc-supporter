import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CatalogDetailFilterPanel, catalogDetailFilterParamsFor } from "./catalog-detail-filter";

describe("public GPU filters", () => {
  it("renders exactly the three cumulative thickness checkboxes without numeric inputs", () => {
    const html = renderToStaticMarkup(<CatalogDetailFilterPanel category="gpu" filter={{}} facetOptions={{ partCount: 0, brandOptions: [], facetOptions: {}, priceRange: null }} loading={false} error={null} detailExcludedCount={0} detailDiagnostics={[]} onChange={() => {}} onReset={() => {}} onRetry={() => {}} />);
    for (const label of ["~41mm", "~51mm", "~61mm"]) expect(html).toContain(`catalog-detail-facet-thicknessMm-${label}`);
    for (const label of ["메모리 타입", "부스트 클럭", "로우프로파일", "소비 전력", "권장 파워", "카드 길이", "그래픽카드 두께 최소", "그래픽카드 두께 최대"]) expect(html).not.toContain(label);
  });
  it("serializes thickness choices and strips obsolete GPU conditions", () => {
    expect(catalogDetailFilterParamsFor("gpu", { numericRanges: { thicknessMm: [{ max: 41 }, { max: 61 }], lengthMm: [{ max: 300 }] }, specValues: { gpuMemoryType: ["GDDR7"] } })).toEqual({ "dr.thicknessMm": "-41;-61" });
  });
});
