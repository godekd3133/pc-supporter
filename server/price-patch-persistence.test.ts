import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AccessoryItem, Part } from "../shared/types";
import { truncatePostgresTables, withPostgresStore } from "./testkit/postgres";

describe("price-only catalog patches", () => {
  it("serializes with catalog upserts and changes only prices for current Danawa identities", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-price-patch-"));
    const previousDataDirectory = process.env.PC_SUPPORTER_DATA_DIR;
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    vi.resetModules();
    try {
      const [repository, { patchCatalogPrices, loadCatalog }, { patchAccessoryPrices, loadAccessories, upsertAccessories }] = await Promise.all([
        import("./repository"), import("./catalog"), import("./accessories")
      ]);
      await repository.initializePersistence();
      await truncatePostgresTables();
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
      await repository.writeCatalogRecords([part]);
      await upsertAccessories([accessory]);

      const patchedPart = await patchCatalogPrices([{
        id: part.id, sourceProductCode: part.sourceProductCode!, danawaUrl: part.danawaUrl!, priceWon: 175_000, priceCheckedAt: "2026-09-23T01:00:00.000Z"
      }]);
      const patchedAccessory = await patchAccessoryPrices([{
        id: accessory.id, sourceProductCode: accessory.sourceProductCode!, danawaUrl: accessory.danawaUrl!, priceWon: 15_000, priceCheckedAt: "2026-09-23T01:00:00.000Z"
      }]);

      expect(patchedPart[0]).toMatchObject({ before: part, after: { ...part, priceWon: 175_000, priceCheckedAt: "2026-09-23T01:00:00.000Z" } });
      expect(patchedAccessory[0]).toMatchObject({ before: accessory, after: { ...accessory, priceWon: 15_000, priceCheckedAt: "2026-09-23T01:00:00.000Z" } });
      expect((await repository.readCatalogRecords()).find(({ id }) => id === part.id)).toMatchObject({ name: part.name, specs: part.specs, updatedAt: part.updatedAt, priceWon: 175_000 });
      expect((await repository.readAccessoryCatalogRecords()).items.find(({ id }) => id === accessory.id)).toMatchObject({ name: accessory.name, specs: accessory.specs, updatedAt: accessory.updatedAt, priceWon: 15_000 });

      const mismatched = await patchCatalogPrices([{
        id: part.id, sourceProductCode: "wrong-code", danawaUrl: part.danawaUrl!, priceWon: 1, priceCheckedAt: "2026-09-23T02:00:00.000Z"
      }]);
      expect(mismatched).toEqual([]);
      expect((await loadCatalog()).find(({ id }) => id === part.id)?.priceWon).toBe(175_000);
      expect((await loadAccessories()).find(({ id }) => id === accessory.id)?.priceWon).toBe(15_000);
    } finally {
      if (previousDataDirectory === undefined) delete process.env.PC_SUPPORTER_DATA_DIR;
      else process.env.PC_SUPPORTER_DATA_DIR = previousDataDirectory;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("atomically removes unavailable prices, changes the catalog version and permits a later positive offer", async () => {
    await withPostgresStore(async ({ repository }) => {
      const part: Part = {
        id: "danawa-gpu-no-offers", category: "gpu", name: "MANLI RTX 5090 32GB", source: "danawa",
        sourceProductCode: "75656861", danawaUrl: "https://prod.danawa.com/info/?pcode=75656861",
        priceWon: 6344790, priceCheckedAt: "2026-10-04T00:00:00.000Z",
        specs: { vramGb: 32, lengthMm: 355, tdpW: 575 }, dataQuality: "live", missingFields: [], updatedAt: "2026-09-20T00:00:00.000Z"
      };
      await repository.writeCatalogRecords([part]);
      const { patchCatalogPrices, loadCatalog } = await import("./catalog");
      await loadCatalog();
      const beforeStamp = await repository.readCatalogVersionStamp();
      const unavailableAt = "2026-10-06T00:00:00.000Z";
      const patches = await patchCatalogPrices([{ id: part.id, sourceProductCode: part.sourceProductCode!, danawaUrl: part.danawaUrl!, priceUnavailableAt: unavailableAt }]);
      expect(patches[0]!.after).not.toHaveProperty("priceWon");
      expect(patches[0]!.after).toMatchObject({ specs: part.specs, updatedAt: part.updatedAt, priceCheckedAt: part.priceCheckedAt, priceUnavailableAt: unavailableAt });
      expect(await repository.readCatalogVersionStamp()).not.toBe(beforeStamp);
      expect((await loadCatalog()).find(({ id }) => id === part.id)?.priceWon).toBeUndefined();
      const mismatch = await patchCatalogPrices([{ id: part.id, sourceProductCode: "another", danawaUrl: part.danawaUrl!, priceUnavailableAt: unavailableAt }]);
      expect(mismatch).toEqual([]);
      const restored = await patchCatalogPrices([{ id: part.id, sourceProductCode: part.sourceProductCode!, danawaUrl: part.danawaUrl!, priceWon: 6230000, priceCheckedAt: "2026-10-06T01:00:00.000Z" }]);
      expect(restored[0]!.after).not.toHaveProperty("priceUnavailableAt");
      expect(restored[0]!.after).toMatchObject({ priceWon: 6230000, specs: part.specs, updatedAt: part.updatedAt });
      expect((await loadCatalog()).find(({ id }) => id === part.id)?.priceWon).toBe(6230000);
    });
  }, 15000);


  it("persists the full detail-refresh no-offer result without resurrecting the previous price", async () => {
    await withPostgresStore(async ({ repository }) => {
      const part: Part = {
        id: "danawa-gpu-full-refresh", category: "gpu", name: "Test RTX 5090 32GB", source: "danawa",
        sourceProductCode: "988999999", danawaUrl: "https://prod.danawa.com/info/?pcode=988999999",
        priceWon: 6344790, priceCheckedAt: "2026-10-04T00:00:00.000Z",
        rawSpecText: "RTX 5090 / 사용전력: 575W / 가로(길이): 355mm / 32GB / GDDR7 / 1000W 이상",
        specs: { vramGb: 32, lengthMm: 355, powerW: 575 }, dataQuality: "live", missingFields: [], updatedAt: "2026-09-20T00:00:00.000Z"
      };
      await repository.writeCatalogRecords([part]);
      const { upsertCatalog, loadCatalog, invalidateCatalogCache } = await import("./catalog");
      const { refreshDanawaPart } = await import("./part-refresh");
      const before = (await loadCatalog()).find(({ id }) => id === part.id)!;
      const html = `<html><head><title>${before.name} : 다나와 가격비교</title><link rel="canonical" href="${before.danawaUrl}"><meta property="og:description" content="최저가 0원"></head><body>판매점 0개<script>var nMinPrice = 0;</script></body></html>`;
      const refreshed = await refreshDanawaPart(before, { fetchHtml: async () => html });
      const saved = (await upsertCatalog([refreshed])).find(({ id }) => id === before.id)!;
      expect(saved).not.toHaveProperty("priceWon");
      expect(saved).toMatchObject({ priceUnavailableAt: refreshed.priceUnavailableAt, priceCheckedAt: before.priceCheckedAt, specs: before.specs, updatedAt: before.updatedAt });
      const persisted = (await repository.readCatalogRecords()).find(({ id }) => id === before.id)!;
      expect(persisted).not.toHaveProperty("priceWon");
      expect(persisted.priceUnavailableAt).toBe(refreshed.priceUnavailableAt);
      invalidateCatalogCache();
      expect((await loadCatalog()).find(({ id }) => id === before.id)).not.toHaveProperty("priceWon");
      const returned: Part = { ...saved, priceWon: 6230000, priceCheckedAt: new Date(Date.parse(refreshed.priceUnavailableAt!) + 1000).toISOString() };
      delete returned.priceUnavailableAt;
      const recovered = (await upsertCatalog([returned])).find(({ id }) => id === before.id)!;
      expect(recovered.priceWon).toBe(6230000);
      expect(recovered).not.toHaveProperty("priceUnavailableAt");
      await upsertCatalog([refreshed]);
      const final = (await repository.readCatalogRecords()).find(({ id }) => id === before.id)!;
      expect(final.priceWon).toBe(6230000);
      expect(final).not.toHaveProperty("priceUnavailableAt");
    });
  }, 15000);

});
