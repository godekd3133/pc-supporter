import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Part } from "../shared/types";
import { truncatePostgresTables } from "./testkit/postgres";

describe("catalog spec override catalog persistence", () => {
  it("applies overrides at runtime but never persists the overlay into catalog rows", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-catalog-spec-override-"));
    const previousDataDirectory = process.env.PC_SUPPORTER_DATA_DIR;
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    vi.resetModules();
    try {
      const repository = await import("./repository");
      await repository.initializePersistence();
      await truncatePostgresTables();
      const [{ saveCatalogSpecOverrides }, { loadCatalog, saveCatalog, upsertCatalog }] = await Promise.all([import("./catalog-spec-overrides"), import("./catalog")]);
      const basePart: Part = {
        id: "manual-overlay-part",
        category: "gpu",
        name: "overlay GPU",
        source: "manual",
        specs: { vramGb: 16 },
        dataQuality: "incomplete",
        missingFields: ["powerW"],
        updatedAt: "2026-09-01T00:00:00.000Z"
      };
      await repository.writeCatalogRecords([basePart]);
      await saveCatalogSpecOverrides([{
        partId: basePart.id,
        category: "gpu",
        fields: { powerW: 320 },
        manufacturerModel: "OVERLAY-GPU-16",
        sourceNote: "제조사 공식 사양서 4쪽",
        sourceUrl: "https://vendor.example/overlay-gpu",
        updatedAt: "2026-09-03T00:00:00.000Z"
      }]);

      const loaded = await loadCatalog();
      const applied = loaded.find((part) => part.id === basePart.id);
      expect(applied).toMatchObject({ dataQuality: "manual", missingFields: [], updatedAt: "2026-09-03T00:00:00.000Z", specs: { vramGb: 16, powerW: 320, catalogSpecProvenance: { fields: ["powerW"] } } });

      await upsertCatalog([applied!]);
      const persistedAfterUpsert = (await repository.readCatalogRecords()).find((part) => part.id === basePart.id);
      expect(persistedAfterUpsert).toEqual(basePart);

      await saveCatalog([applied!]);
      const persistedAfterSave = (await repository.readCatalogRecords()).find((part) => part.id === basePart.id);
      expect(persistedAfterSave).toEqual(basePart);
    } finally {
      if (previousDataDirectory === undefined) delete process.env.PC_SUPPORTER_DATA_DIR;
      else process.env.PC_SUPPORTER_DATA_DIR = previousDataDirectory;
      await rm(directory, { recursive: true, force: true });
    }
  });
});
