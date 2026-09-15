import { describe, expect, it } from "vitest";
import type { Part } from "../shared/types";
import { catalogSpecProvenanceFieldLabelsFor } from "./CatalogSpecProvenance";

function part(overrides: Partial<Part>): Part {
  return {
    id: "provenance-part",
    category: "gpu",
    name: "정보 GPU",
    source: "manual",
    specs: {},
    dataQuality: "manual",
    missingFields: [],
    updatedAt: "2026-09-03T00:00:00.000Z",
    ...overrides
  };
}

describe("catalog spec provenance presentation", () => {
  it("maps runtime override field keys to human-readable labels", () => {
    expect(catalogSpecProvenanceFieldLabelsFor(part({ specs: { catalogSpecProvenance: { manufacturerModel: "GPU", sourceNote: "문서", sourceUrl: "https://vendor.example", updatedAt: "2026-09-03T00:00:00.000Z", fields: ["powerW", "lengthMm", "unknownField"], baseDataQuality: "incomplete", baseMissingFields: ["powerW"], baseUpdatedAt: "2026-09-01T00:00:00.000Z", baseSpecValues: {} } } }))).toEqual(["소비전력", "GPU 길이", "unknownField"]);
    expect(catalogSpecProvenanceFieldLabelsFor(part({ specs: {} }))).toEqual([]);
  });
});
