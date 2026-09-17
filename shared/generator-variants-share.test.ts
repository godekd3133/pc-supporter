import { describe, expect, it } from "vitest";
import { GENERATOR_VARIANTS_EXPORT_TYPE, GENERATOR_VARIANTS_EXPORT_VERSION, generatorVariantsConditionsSearchFor, generatorVariantsDraftTransferFromUnknown, generatorVariantsShareExpired } from "./generator-variants-share";

describe("generator variants share contract", () => {
  it("keeps the export envelope versioned", () => {
    expect(GENERATOR_VARIANTS_EXPORT_TYPE).toBe("pc-supporter-generator-variants");
    expect(GENERATOR_VARIANTS_EXPORT_VERSION).toBe(1);
  });

  it("treats missing expiry as active and invalid or past expiry as expired", () => {
    expect(generatorVariantsShareExpired({})).toBe(false);
    expect(generatorVariantsShareExpired({ expiresAt: "2026-09-17T00:00:00.000Z" }, Date.parse("2026-09-16T23:59:59.000Z"))).toBe(false);
    expect(generatorVariantsShareExpired({ expiresAt: "2026-09-17T00:00:00.000Z" }, Date.parse("2026-09-17T00:00:00.000Z"))).toBe(true);
    expect(generatorVariantsShareExpired({ expiresAt: "not-a-date" })).toBe(true);
  });

  it("serializes shared generation conditions into the /recommend query contract", () => {
    const params = new URLSearchParams(generatorVariantsConditionsSearchFor({ profile: "gaming", priority: "performance", budgetWon: 2_000_000, includeGpu: true, gamingResolution: "4k", gamingRefreshRate: 240, gamingGameIds: ["cyberpunk", "pubg"], gamingGraphicsPreset: "high", gamingRayTracing: true, gamingUpscaling: "quality", memoryCapacityGb: 64, storageCapacityGb: 2000, hddCapacityGb: 8000, hddCount: 2, includeNonRetail: true, listingPolicy: "all" }));
    expect(params.get("profile")).toBe("gaming");
    expect(params.get("priority")).toBe("performance");
    expect(params.get("resolution")).toBe("4k");
    expect(params.get("refresh")).toBe("240");
    expect(params.get("games")).toBe("cyberpunk,pubg");
    expect(params.get("graphics")).toBe("high");
    expect(params.get("rt")).toBe("1");
    expect(params.get("upscaling")).toBe("quality");
    expect(params.get("ram")).toBe("64");
    expect(params.get("budget")).toBe("2000000");
    expect(params.get("gpu")).toBeNull();
    expect(params.get("ssd")).toBe("2000");
    expect(params.get("hdd")).toBe("2");
    expect(params.get("hddCapacity")).toBe("8000");
    expect(params.get("listingPolicy")).toBe("all");
  });

  it("omits defaults and reader-unsupported priorities from the conditions link", () => {
    const params = new URLSearchParams(generatorVariantsConditionsSearchFor({ profile: "general", priority: "reliability", budgetWon: 800_000, includeGpu: false, memoryCapacityGb: 32, storageCapacityGb: 1000, hddCount: 0, listingPolicy: "retail_only" }));
    expect(params.get("profile")).toBe("general");
    expect(params.get("priority")).toBeNull();
    expect(params.get("gpu")).toBe("0");
    expect(params.get("ram")).toBeNull();
    expect(params.get("ssd")).toBeNull();
    expect(params.get("hdd")).toBeNull();
    expect(params.get("resolution")).toBeNull();
    expect(params.get("listingPolicy")).toBeNull();
  });
});

describe("generatorVariantsDraftTransferFromUnknown", () => {
  const draft = {
    priority: "balanced",
    profile: "gaming",
    status: "compatible",
    selection: { cpu: { partId: "cpu-1", quantity: 1 }, memory: [], ssd: [], hdd: [], useIntegratedGraphics: false },
    lines: [{ category: "cpu", partId: "cpu-1", name: "테스트 CPU", quantity: 1, priceWon: 300_000 }]
  };
  const payload = {
    type: "pc-supporter-generator-variants",
    version: 1,
    exportedAt: "2026-09-17T00:00:00.000Z",
    items: [
      { priority: "balanced", label: "균형형", status: "호환 가능", draft },
      { priority: "budget", label: "가성비 우선", status: "생성 실패", error: "예산 부족" }
    ]
  };

  it("accepts a producer-shaped envelope and returns the matching draft with its mode", () => {
    for (const mode of ["edit", "check", "save"] as const) {
      const transfer = generatorVariantsDraftTransferFromUnknown({ source: "shared-generator-variants", payload, priority: "balanced", mode });
      expect(transfer?.mode).toBe(mode);
      expect(transfer?.draft.priority).toBe("balanced");
      expect(transfer?.draft.selection.cpu).toEqual({ partId: "cpu-1", quantity: 1 });
    }
  });

  it("carries the shared snapshot origin only for a validated transfer envelope", () => {
    const transfer = generatorVariantsDraftTransferFromUnknown({ payload, priority: "balanced", mode: "save", origin: { shareId: "share-123", shareName: "공유 비교", catalogSnapshotAt: "2026-09-17T00:00:00.000Z", currentRecheckedAt: "2026-09-17T01:00:00.000Z" } });
    expect(transfer?.origin).toEqual({ shareId: "share-123", shareName: "공유 비교", catalogSnapshotAt: "2026-09-17T00:00:00.000Z", currentRecheckedAt: "2026-09-17T01:00:00.000Z" });
    expect(generatorVariantsDraftTransferFromUnknown({ payload, priority: "balanced", mode: "save", origin: { shareId: "share-123", catalogSnapshotAt: "invalid" } })).toBeUndefined();
  });

  it("rejects envelopes whose payload, priority, or mode cannot be applied", () => {
    expect(generatorVariantsDraftTransferFromUnknown(null)).toBeUndefined();
    expect(generatorVariantsDraftTransferFromUnknown({ payload, priority: "balanced" })).toBeUndefined();
    expect(generatorVariantsDraftTransferFromUnknown({ payload, priority: "balanced", mode: "steal" })).toBeUndefined();
    expect(generatorVariantsDraftTransferFromUnknown({ payload, priority: "reliability", mode: "edit" })).toBeUndefined();
    expect(generatorVariantsDraftTransferFromUnknown({ payload, priority: "budget", mode: "edit" })).toBeUndefined();
    expect(generatorVariantsDraftTransferFromUnknown({ payload: { type: "other" }, priority: "balanced", mode: "edit" })).toBeUndefined();
    expect(generatorVariantsDraftTransferFromUnknown({ payload: "not-an-object", priority: "balanced", mode: "edit" })).toBeUndefined();
  });

  it("rejects drafts whose selection the build-transfer parser cannot normalize", () => {
    const badDraft = { ...draft, selection: { ...draft.selection, ssd: "not-an-array" } };
    const badPayload = { ...payload, items: [{ ...payload.items[0], draft: badDraft }] };
    expect(generatorVariantsDraftTransferFromUnknown({ payload: badPayload, priority: "balanced", mode: "edit" })).toBeUndefined();
  });
});
