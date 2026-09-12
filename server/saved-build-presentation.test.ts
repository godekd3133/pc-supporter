import { describe, expect, it } from "vitest";
import type { AccessoryItem, BuildSelection } from "../shared/types";
import { savedBuildPresentationFor, savedBuildPresentationsFor, type SavedBuildPresentationContext } from "./saved-build-presentation";

const selection = (): BuildSelection => ({
  cpu: { partId: "cpu-1", quantity: 1 },
  cooler: undefined,
  motherboard: undefined,
  memory: [],
  gpu: undefined,
  ssd: [],
  hdd: [],
  case: undefined,
  psu: undefined,
  accessories: [],
  useIntegratedGraphics: false
});

const context: SavedBuildPresentationContext = {
  catalog: [{
    id: "cpu-1",
    category: "cpu",
    name: "Test CPU",
    priceWon: 100000,
    source: "seed",
    updatedAt: "2026-09-01T00:00:00.000Z",
    dataQuality: "seed",
    missingFields: [],
    listingType: "retail",
    specs: {}
  }],
  accessories: [] as AccessoryItem[]
};

const build = (id = "build-1") => ({
  id,
  name: "Saved build",
  selection: selection(),
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  ownerTokenHash: "private-hash"
});

describe("saved-build presentation seam", () => {
  it("keeps the public projection and current summary on one interface", () => {
    const presented = savedBuildPresentationFor(build(), context);

    expect(presented).toMatchObject({
      id: "build-1",
      name: "Saved build",
      summary: {
        totalPriceWon: 100000,
        coreLines: [{ category: "cpu", name: "Test CPU", quantity: 1 }]
      }
    });
    expect(presented).not.toHaveProperty("ownerTokenHash");
  });

  it("reuses one presentation context for list responses", () => {
    const presented = savedBuildPresentationsFor([build("build-1"), build("build-2")], context);

    expect(presented).toHaveLength(2);
    expect(presented.map((item) => item.id)).toEqual(["build-1", "build-2"]);
    expect(presented.every((item) => item.summary.coreLines[0]?.name === "Test CPU")).toBe(true);
  });
});
