import { describe, expect, it } from "vitest";
import type { BuildSelection } from "../shared/types";
import { seedAccessories } from "./seed-accessories";
import { seedCatalog } from "./seed-catalog";
import { validateBuildSelection } from "./build-validation";

const buildWithInvalidRelationships = (): BuildSelection => ({
  cpu: { partId: "missing-cpu", quantity: 1 },
  cooler: undefined,
  motherboard: undefined,
  memory: [],
  gpu: undefined,
  ssd: [],
  hdd: [],
  case: undefined,
  psu: undefined,
  accessories: [
    { accessoryId: "missing-accessory", quantity: 1, targetPartId: "missing-ssd" },
    { accessoryId: "accessory-seed-fan-120-pwm", quantity: 1, targetAccessoryId: "missing-hub" }
  ],
  rgbControllerAccessoryId: "missing-hub",
  useIntegratedGraphics: false
});

describe("build selection validation seam", () => {
  it("returns every catalog relationship error from one parsed build", () => {
    const validation = validateBuildSelection(buildWithInvalidRelationships(), seedCatalog, seedAccessories);

    expect(validation.invalidSelections.map((selection) => selection.partId)).toEqual(["missing-cpu"]);
    expect(validation.invalidAccessories.map((selection) => selection.accessoryId)).toEqual(["missing-accessory"]);
    expect(validation.invalidAccessoryTargets).toEqual(["missing-ssd"]);
    expect(validation.invalidAccessoryHubTargets).toEqual(["missing-hub"]);
    expect(validation.invalidRgbControllerAccessoryIds).toEqual(["missing-hub"]);
  });

  it("accepts a build whose part and accessory relationships are present", () => {
    const validation = validateBuildSelection({
      ...buildWithInvalidRelationships(),
      cpu: { partId: "cpu-7800x3d", quantity: 1 },
      accessories: [],
      rgbControllerAccessoryId: undefined
    }, seedCatalog, seedAccessories);

    expect(validation).toEqual({
      invalidSelections: [],
      invalidAccessories: [],
      invalidAccessoryTargets: [],
      invalidAccessoryHubTargets: [],
      invalidRgbControllerAccessoryIds: []
    });
  });
});
