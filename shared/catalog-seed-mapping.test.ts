import { describe, expect, it } from "vitest";
import type { Part } from "./types";
import { catalogSeedMappingCandidatesFor, catalogSeedMappingPreviewFor } from "./catalog-seed-mapping";

function part(overrides: Partial<Part>): Part {
  return {
    id: "cpu-starter",
    category: "cpu",
    name: "인텔 코어 i5-14세대 14500",
    brand: "Intel",
    model: "i5-14500",
    source: "seed",
    priceWon: 329_000,
    dataQuality: "seed",
    missingFields: [],
    updatedAt: "2026-09-03T00:00:00.000Z",
    specs: { socket: "LGA1700", cores: 14 },
    ...overrides
  };
}

describe("catalog seed mapping", () => {
  it("ranks a matching Danawa model ahead of a same-category distractor", () => {
    const starter = part({ id: "cpu-starter" });
    const candidates = catalogSeedMappingCandidatesFor(starter, [
      part({ id: "danawa-cpu-distractor", name: "인텔 코어 i5-14400F", model: "i5-14400F", source: "danawa", sourceProductCode: "100", danawaUrl: "https://prod.danawa.com/info/?pcode=100", dataQuality: "live", priceWon: 289_000 }),
      part({ id: "danawa-cpu-match", name: "Intel Core i5-14500", model: "i5-14500", source: "danawa", sourceProductCode: "200", danawaUrl: "https://prod.danawa.com/info/?pcode=200", dataQuality: "live", priceWon: 319_000 })
    ]);

    expect(candidates[0]).toMatchObject({ activePartId: "danawa-cpu-match", activeSourceProductCode: "200", confidence: "high", reasons: expect.arrayContaining(["model_match", "brand_match"]) });
    expect(candidates[0].score).toBeGreaterThan(candidates[1]?.score ?? 0);
  });

  it("does not confuse a base model with a suffix variant", () => {
    const starter = part({ id: "cpu-7600", name: "AMD 라이젠5 7600", brand: "AMD", model: "7600" });
    const candidates = catalogSeedMappingCandidatesFor(starter, [
      part({ id: "danawa-cpu-7600x", name: "AMD 라이젠5 7600X", model: "7600X", source: "danawa", sourceProductCode: "7600x", danawaUrl: "https://prod.danawa.com/info/?pcode=7600x", dataQuality: "live" }),
      part({ id: "danawa-cpu-7600", name: "AMD 라이젠5 7600 (라파엘)", model: "AMD 라이젠5 7600 (라파엘)", source: "danawa", sourceProductCode: "7600", danawaUrl: "https://prod.danawa.com/info/?pcode=7600", dataQuality: "live" })
    ]);

    expect(candidates.map((candidate) => candidate.activePartId)).toEqual(["danawa-cpu-7600"]);
  });

  it("rejects a same-number CPU from the wrong vendor family", () => {
    const starter = part({ id: "cpu-amd-7600", name: "AMD 라이젠5 7600", brand: "AMD", model: "7600", specs: { socket: "AM5", memoryType: "DDR5" } });
    const candidates = catalogSeedMappingCandidatesFor(starter, [
      part({ id: "danawa-intel-7600", name: "인텔 코어 i5-7세대 7600", brand: "Intel", model: "7600", source: "danawa", sourceProductCode: "intel-7600", danawaUrl: "https://prod.danawa.com/info/?pcode=intel-7600", dataQuality: "live", specs: { socket: "LGA1151", memoryType: "DDR4" } }),
      part({ id: "danawa-amd-7600", name: "AMD 라이젠5 7600 (라파엘)", brand: "AMD", model: "AMD Ryzen 5 7600", source: "danawa", sourceProductCode: "amd-7600", danawaUrl: "https://prod.danawa.com/info/?pcode=amd-7600", dataQuality: "live", specs: { socket: "AM5", memoryType: "DDR5" } })
    ]);

    expect(candidates.map((candidate) => candidate.activePartId)).toEqual(["danawa-amd-7600"]);
  });

  it("rejects a motherboard candidate with a conflicting socket or memory generation", () => {
    const starter = part({ id: "mb-b650", category: "motherboard", name: "ASUS TUF B650M WIFI", brand: "ASUS", model: "B650M WIFI", specs: { socket: "AM5", memoryType: "DDR5" } });
    const candidates = catalogSeedMappingCandidatesFor(starter, [
      part({ id: "danawa-b650-ddr4", category: "motherboard", name: "ASUS TUF B650M WIFI DDR4", brand: "ASUS", model: "B650M WIFI", source: "danawa", sourceProductCode: "b650-ddr4", danawaUrl: "https://prod.danawa.com/info/?pcode=b650-ddr4", dataQuality: "live", specs: { socket: "AM5", memoryType: "DDR4" } }),
      part({ id: "danawa-b650", category: "motherboard", name: "ASUS TUF B650M WIFI", brand: "ASUS", model: "B650M WIFI", source: "danawa", sourceProductCode: "b650", danawaUrl: "https://prod.danawa.com/info/?pcode=b650", dataQuality: "live", specs: { socket: "AM5", memoryType: "DDR5" } })
    ]);

    expect(candidates.map((candidate) => candidate.activePartId)).toEqual(["danawa-b650"]);
  });

  it("keeps mapping as a separate review registry and marks a missing active target stale", () => {
    const starter = [part({ id: "cpu-starter" }), part({ id: "gpu-starter", category: "gpu", name: "NVIDIA RTX 4070", brand: "NVIDIA", model: "RTX 4070", specs: { vramGb: 12 } })];
    const active = [part({ id: "danawa-cpu-match", name: "Intel Core i5-14500", model: "i5-14500", source: "danawa", sourceProductCode: "200", danawaUrl: "https://prod.danawa.com/info/?pcode=200", dataQuality: "live" })];
    const preview = catalogSeedMappingPreviewFor(starter, active, {
      generatedAt: "2026-09-03T00:00:00.000Z",
      reviews: {
        "cpu-starter": { starterPartId: "cpu-starter", category: "cpu", activePartId: "danawa-cpu-match", activeSourceProductCode: "200", status: "approved", reviewedAt: "2026-09-03T00:01:00.000Z" },
        "gpu-starter": { starterPartId: "gpu-starter", category: "gpu", activePartId: "danawa-gpu-gone", activeSourceProductCode: "404", status: "approved", reviewedAt: "2026-09-03T00:01:00.000Z" }
      }
    });

    expect(preview).toMatchObject({ schemaVersion: 1, kind: "catalog-seed-mapping-preview", readOnly: true, generatedAt: "2026-09-03T00:00:00.000Z", activeCatalogCount: 1, summary: { missingStarterCount: 2, candidateCount: 1, approvedCount: 1, staleCount: 1, pendingCount: 0 } });
    expect(preview.items.find((item) => item.starter.id === "cpu-starter")).toMatchObject({ status: "approved", approvedMapping: { activePartId: "danawa-cpu-match" } });
    expect(preview.items.find((item) => item.starter.id === "gpu-starter")).toMatchObject({ status: "stale" });
    expect(active[0].id).toBe("danawa-cpu-match");
  });

  it("does not treat a retained starter row as a completed source-code mapping", () => {
    const starter = [part({ id: "cpu-9600x", name: "AMD 라이젠5 9600X", model: "9600X" })];
    const active = [
      part({ id: "cpu-9600x", source: "seed", dataQuality: "seed" }),
      part({ id: "danawa-cpu-9600x", name: "AMD 라이젠5 9600X (그래니트 릿지)", model: "AMD 라이젠5 9600X (그래니트 릿지)", source: "danawa", sourceProductCode: "9600x", dataQuality: "live" })
    ];

    const preview = catalogSeedMappingPreviewFor(starter, active, { generatedAt: "2026-09-05T00:00:00.000Z" });

    expect(preview.activeCatalogCount).toBe(2);
    expect(preview.summary).toMatchObject({ missingStarterCount: 1, candidateCount: 1 });
    expect(preview.items[0]).toMatchObject({ starter: { id: "cpu-9600x" }, candidates: [{ activeSourceProductCode: "9600x" }] });
  });
});
