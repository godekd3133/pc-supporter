import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CatalogDetailFilterPanel, catalogDetailFilterParamsFor } from "./catalog-detail-filter";
import { PUBLIC_CATALOG_FILTER_FACETS } from "../shared/public-catalog-filters";
import { engineFilterOptionLabelFor } from "../shared/engine-target-filters";
import { pickerShowsBrandSearch } from "./PartPicker";

describe("public GPU filters", () => {
  it("renders exactly the three cumulative thickness checkboxes without numeric inputs", () => {
    const html = renderToStaticMarkup(<CatalogDetailFilterPanel category="gpu" filter={{}} facetOptions={{ partCount: 0, brandOptions: [], facetOptions: {}, priceRange: null }} loading={false} error={null} detailExcludedCount={0} detailDiagnostics={[]} onChange={() => {}} onReset={() => {}} onRetry={() => {}} />);
    for (const label of ["~41mm", "~51mm", "~61mm"]) expect(html).toContain(`catalog-detail-facet-thicknessMm-${label}`);
    for (const label of ["메모리 타입", "부스트 클럭", "로우프로파일", "소비 전력", "카드 길이", "그래픽카드 두께 최소", "그래픽카드 두께 최대"]) expect(html).not.toContain(label);
  });
  it("serializes thickness/length choices and strips GPU conditions Danawa does not offer", () => {
    expect(catalogDetailFilterParamsFor("gpu", { numericRanges: { thicknessMm: [{ max: 41 }, { max: 61 }], lengthMm: [{ max: 299 }] }, specValues: { gpuMemoryType: ["GDDR7"] } })).toEqual({ "dr.thicknessMm": "-41;-61", "dr.lengthMm": "-299" });
  });
});

describe("Danawa-ordered detail filters", () => {
  it("starts the motherboard panel with CPU 소켓 / 세부 칩셋 / 폼팩터 and has no 제조사 group", () => {
    expect(PUBLIC_CATALOG_FILTER_FACETS.motherboard.slice(0, 3).map((facet) => facet.label)).toEqual(["CPU 소켓", "세부 칩셋", "폼팩터"]);
    expect(PUBLIC_CATALOG_FILTER_FACETS.motherboard.some((facet) => facet.kind === "brands")).toBe(false);
    expect(pickerShowsBrandSearch("motherboard")).toBe(false);
    expect(pickerShowsBrandSearch("cpu")).toBe(true);
  });
  it("mirrors Danawa group labels and ends every category with 가격대", () => {
    expect(PUBLIC_CATALOG_FILTER_FACETS.cpu.map((facet) => facet.label)).toEqual(["제조사별", "CPU 시리즈", "소켓 구분", "코어 수", "스레드 수", "내장그래픽", "가격대"]);
    expect(PUBLIC_CATALOG_FILTER_FACETS.psu.map((facet) => facet.label)).toEqual(["제조사별", "제품 분류", "정격출력", "80PLUS인증", "케이블연결", "가격대"]);
    for (const facets of Object.values(PUBLIC_CATALOG_FILTER_FACETS)) expect(facets.at(-1)?.kind).toBe("price");
  });
  it("labels CPU series the way Danawa does", () => {
    expect(engineFilterOptionLabelFor("cpuSeries", "Core Ultra 200")).toBe("코어 울트라 시리즈2");
    expect(engineFilterOptionLabelFor("cpuSeries", "Core 14")).toBe("코어 14세대");
    expect(engineFilterOptionLabelFor("cpuSeries", "Ryzen 9000")).toBe("라이젠 9000시리즈");
  });
  it("keeps the motherboard chipset condition when serializing", () => {
    expect(catalogDetailFilterParamsFor("motherboard", { specValues: { chipset: ["B850"] }, brands: ["ASUS"] })).toEqual({ "dv.chipset": "B850" });
  });
});
