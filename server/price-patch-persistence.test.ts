import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AccessoryItem, Part } from "../shared/types";

describe("price-only catalog patches", () => {
  it("serializes with catalog upserts and changes only prices for current Danawa identities", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-price-patch-"));
    const previousDataDirectory = process.env.PC_SUPPORTER_DATA_DIR;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    process.env.DATABASE_URL = "";
    vi.resetModules();
    try {
      const [{ CATALOG_PATH, ACCESSORIES_PATH, readJson, writeJson }, { patchCatalogPrices, loadCatalog }, { patchAccessoryPrices, loadAccessories }] = await Promise.all([
        import("./storage"), import("./catalog"), import("./accessories")
      ]);
      const part: Part = {
        id: "danawa-cpu-price-patch",
        category: "cpu",
        name: "AMD Ryzen Test",
        source: "danawa",
        sourceProductCode: "99123",
        danawaUrl: "https://prod.danawa.com/info/?pcode=99123",
        priceWon: 150_000,
        specs: { socket: "AM5", cores: 8, tdpW: 65 },
        dataQuality: "live",
        missingFields: [],
        updatedAt: "2026-09-20T00:00:00.000Z"
      };
      const accessory: AccessoryItem = {
        id: "danawa-fan-price-patch",
        category: "cooling_fan",
        name: "Test Fan",
        source: "danawa",
        sourceProductCode: "99124",
        danawaUrl: "https://prod.danawa.com/info/?pcode=99124",
        listingType: "accessory",
        priceWon: 12_000,
        specs: { fanCount: 1 },
        dataQuality: "live",
        missingFields: [],
        updatedAt: "2026-09-20T00:00:00.000Z"
      };
      await writeJson(CATALOG_PATH, [part]);
      await writeJson(ACCESSORIES_PATH, [accessory]);

      const patchedPart = await patchCatalogPrices([{
        id: part.id, sourceProductCode: part.sourceProductCode!, danawaUrl: part.danawaUrl!, priceWon: 175_000, priceCheckedAt: "2026-09-23T01:00:00.000Z"
      }]);
      const patchedAccessory = await patchAccessoryPrices([{
        id: accessory.id, sourceProductCode: accessory.sourceProductCode!, danawaUrl: accessory.danawaUrl!, priceWon: 15_000, priceCheckedAt: "2026-09-23T01:00:00.000Z"
      }]);

      expect(patchedPart[0]).toMatchObject({ before: part, after: { ...part, priceWon: 175_000, priceCheckedAt: "2026-09-23T01:00:00.000Z" } });
      expect(patchedAccessory[0]).toMatchObject({ before: accessory, after: { ...accessory, priceWon: 15_000, priceCheckedAt: "2026-09-23T01:00:00.000Z" } });
      expect((await readJson<Part[]>(CATALOG_PATH, [])).find(({ id }) => id === part.id)).toMatchObject({ name: part.name, specs: part.specs, updatedAt: part.updatedAt, priceWon: 175_000 });
      expect((await readJson<AccessoryItem[]>(ACCESSORIES_PATH, [])).find(({ id }) => id === accessory.id)).toMatchObject({ name: accessory.name, specs: accessory.specs, updatedAt: accessory.updatedAt, priceWon: 15_000 });

      const mismatched = await patchCatalogPrices([{
        id: part.id, sourceProductCode: "wrong-code", danawaUrl: part.danawaUrl!, priceWon: 1, priceCheckedAt: "2026-09-23T02:00:00.000Z"
      }]);
      expect(mismatched).toEqual([]);
      expect((await loadCatalog()).find(({ id }) => id === part.id)?.priceWon).toBe(175_000);
      expect((await loadAccessories()).find(({ id }) => id === accessory.id)?.priceWon).toBe(15_000);
    } finally {
      if (previousDataDirectory === undefined) delete process.env.PC_SUPPORTER_DATA_DIR;
      else process.env.PC_SUPPORTER_DATA_DIR = previousDataDirectory;
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
      await rm(directory, { recursive: true, force: true });
    }
  });
});
