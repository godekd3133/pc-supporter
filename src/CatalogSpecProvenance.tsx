import { catalogMissingFieldLabelFor } from "../shared/catalog-spec-coverage";
import type { Part } from "../shared/types";

export function catalogSpecProvenanceFieldLabelsFor(part: Part) {
  return (part.specs.catalogSpecProvenance?.fields ?? []).map((field) => catalogMissingFieldLabelFor(field));
}
