import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Part } from "../shared/types";

describe("catalog spec override catalog persistence", () => {
  it("applies overrides at runtime but never persists the overlay into catalog.json", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-catalog-spec-override-"));
    const previousDataDirectory = process.env.PC_SUPPORTER_DATA_DIR;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    process.env.DATABASE_URL = "";
    vi.resetModules();
    try {
      const [{ CATALOG_PATH, CATALOG_SPEC_OVERRIDES_PATH, readJson, writeJson }, { loadCatalog, saveCatalog, upsertCatalog }] = await Promise.all([import("./storage"), import("./catalog")]);
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
      await writeJson(CATALOG_PATH, [basePart]);
      await writeJson(CATALOG_SPEC_OVERRIDES_PATH, {
        [basePart.id]: {
          partId: basePart.id,
          category: "gpu",
          fields: { powerW: 320 },
          manufacturerModel: "OVERLAY-GPU-16",
          sourceNote: "제조사 공식 사양서 4쪽",
          sourceUrl: "https://vendor.example/overlay-gpu",
          updatedAt: "2026-09-03T00:00:00.000Z"
        }
      });

      const loaded = await loadCatalog();
      const applied = loaded.find((part) => part.id === basePart.id);
      expect(applied).toMatchObject({ dataQuality: "manual", missingFields: [], updatedAt: "2026-09-03T00:00:00.000Z", specs: { vramGb: 16, powerW: 320, catalogSpecProvenance: { fields: ["powerW"] } } });

      await upsertCatalog([applied!]);
      const persistedAfterUpsert = (await readJson<Part[]>(CATALOG_PATH, [])).find((part) => part.id === basePart.id);
      expect(persistedAfterUpsert).toEqual(basePart);

      await saveCatalog([applied!]);
      const persistedAfterSave = (await readJson<Part[]>(CATALOG_PATH, [])).find((part) => part.id === basePart.id);
      expect(persistedAfterSave).toEqual(basePart);
    } finally {
      if (previousDataDirectory === undefined) delete process.env.PC_SUPPORTER_DATA_DIR;
      else process.env.PC_SUPPORTER_DATA_DIR = previousDataDirectory;
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
      await rm(directory, { recursive: true, force: true });
    }
  });
});
