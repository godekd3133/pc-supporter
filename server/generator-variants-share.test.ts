import { describe, expect, it } from "vitest";
import { generatorVariantsExportPayloadFromUnknown, parseGeneratorVariantsShareInput, savedGeneratorVariantsFromUnknown } from "./generator-variants-share";

const draft = {
  priority: "balanced",
  profile: "general",
  status: "compatible",
  selection: {},
  lines: [{ category: "cpu", partId: "cpu-1", name: "테스트 CPU", quantity: 1, priceWon: 300_000 }]
};

function payload(items: Record<string, unknown>[] = [{ priority: "balanced", label: "균형형", status: "호환 가능", draft }]) {
  return { type: "pc-supporter-generator-variants", version: 1, exportedAt: "2026-09-17T00:00:00.000Z", items };
}

describe("generator variants share contract", () => {
  it("normalizes a valid payload and accepts only supported expiry values", () => {
    const parsed = parseGeneratorVariantsShareInput({ name: "자동 구성 비교", payload: payload(), expiresInDays: 30 });
    expect(parsed.errors).toEqual([]);
    expect(parsed.payload?.items).toHaveLength(1);
    expect(parsed.expiresInDays).toBe(30);
  });

  it("rejects duplicate priorities, contradictory draft priority, and invalid expiry", () => {
    expect(parseGeneratorVariantsShareInput({ name: "비교", payload: payload([{ priority: "balanced", label: "균형형", status: "호환 가능", draft }, { priority: "balanced", label: "균형형", status: "호환 가능", draft }]) }).errors).toContain("자동 구성 비교 payload 형식이 올바르지 않습니다.");
    expect(parseGeneratorVariantsShareInput({ name: "비교", payload: payload([{ priority: "performance", label: "성능 우선", status: "호환 가능", draft }]) }).errors).toContain("자동 구성 비교 payload 형식이 올바르지 않습니다.");
    expect(parseGeneratorVariantsShareInput({ name: "비교", payload: payload(), expiresInDays: 14 }).errors).toContain("공유 만료 기간은 7일 또는 30일이어야 합니다.");
  });

  it("preserves the generation request including gaming conditions", () => {
    const request = { profile: "gaming", priority: "performance", performanceTier: "top", budgetWon: 2_000_000, includeGpu: true, gamingResolution: "4k", gamingRefreshRate: 240, gamingGameIds: ["cyberpunk", "pubg"], gamingGraphicsPreset: "high", gamingRayTracing: true, gamingUpscaling: "quality", memoryCapacityGb: 64, storageCapacityGb: 2000, hddCapacityGb: 8000, hddCount: 2, includeNonRetail: true, listingPolicy: "all" };
    const parsed = parseGeneratorVariantsShareInput({ name: "비교", payload: payload(), request });
    expect(parsed.errors).toEqual([]);
    expect(parsed.request).toEqual(request);
  });

  it("rejects an invalid generation request at create and load", () => {
    expect(parseGeneratorVariantsShareInput({ name: "비교", payload: payload(), request: { profile: "gaming", budgetWon: 0, includeGpu: true } }).errors).toContain("자동 구성 비교 생성 조건 형식이 올바르지 않습니다.");
    expect(parseGeneratorVariantsShareInput({ name: "비교", payload: payload(), request: { profile: "gaming", budgetWon: 2_000_000, includeGpu: true, gamingGameIds: ["a", "b", "c", "d", "e", "f"] } }).errors).toContain("자동 구성 비교 생성 조건 형식이 올바르지 않습니다.");
    const record = { id: "variant-share-2", name: "비교", payload: payload(), catalogSnapshotAt: "2026-09-17T00:00:00.000Z", createdAt: "2026-09-17T00:00:00.000Z", updatedAt: "2026-09-17T00:00:00.000Z" };
    expect(savedGeneratorVariantsFromUnknown({ ...record, request: { profile: "bogus", budgetWon: 2_000_000, includeGpu: true } })).toBeUndefined();
    expect(savedGeneratorVariantsFromUnknown({ ...record, request: { profile: "gaming", budgetWon: 2_000_000, includeGpu: true, gamingUpscaling: "quality" } })?.request?.gamingUpscaling).toBe("quality");
  });

  it("preserves summary lines and rejects malformed summary lines", () => {
    const item = { priority: "balanced", label: "균형형", status: "호환 가능", draft, lines: [{ category: "cpu", label: "CPU", name: "테스트 CPU", partId: "cpu-1", quantity: 1 }] };
    const normalized = generatorVariantsExportPayloadFromUnknown(payload([item]));
    expect(normalized?.items[0].lines).toEqual([{ category: "cpu", label: "CPU", name: "테스트 CPU", partId: "cpu-1", quantity: 1 }]);
    expect(generatorVariantsExportPayloadFromUnknown(payload([{ ...item, lines: [{ category: "cpu", label: "CPU", name: "테스트 CPU", quantity: -1 }] }]))).toBeUndefined();
    expect(generatorVariantsExportPayloadFromUnknown(payload([{ ...item, lines: [{ category: "cpu" }] }]))).toBeUndefined();
    expect(generatorVariantsExportPayloadFromUnknown(payload([{ ...item, lines: "not-an-array" }]))).toBeUndefined();
  });

  it("rejects unsafe draft lines and invalid saved records", () => {
    expect(generatorVariantsExportPayloadFromUnknown(payload([{ priority: "balanced", label: "균형형", status: "호환 가능", draft: { ...draft, lines: [{ ...draft.lines[0], quantity: -1 }] } }]))).toBeUndefined();
    expect(savedGeneratorVariantsFromUnknown({ id: "variant-share-1", name: "비교", payload: payload(), catalogSnapshotAt: "2026-09-17T00:00:00.000Z", createdAt: "2026-09-17T00:00:00.000Z", updatedAt: "2026-09-17T00:00:00.000Z", ownerTokenHash: "bad" })).toBeUndefined();
  });
});
