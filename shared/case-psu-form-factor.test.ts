import { describe, expect, it } from "vitest";
import type { Part } from "./types";
import { casePsuFormFactorSupportFor } from "./case-psu-form-factor";

function computerCase(specs: Part["specs"], rawSpecText = ""): Part {
  return { id: "case", category: "case", name: "케이스", source: "manual", priceWon: 100000, specs, rawSpecText, dataQuality: "manual", missingFields: [], updatedAt: "2026-11-01T00:00:00.000Z" };
}

describe("case PSU form factor support", () => {
  it("prefers the explicit Danawa list", () => {
    expect(casePsuFormFactorSupportFor(computerCase({ supportedPsuFormFactors: ["SFX"] }))).toEqual({ formFactors: ["SFX"], inferred: false });
  });

  it("infers an ATX bay from a power bay at least 140mm long", () => {
    expect(casePsuFormFactorSupportFor(computerCase({ maxPsuLengthMm: 200 }))).toEqual({ formFactors: ["ATX"], inferred: true });
    expect(casePsuFormFactorSupportFor(computerCase({}, "ATX 케이스 / [호환성] 파워 장착 길이: 180~300mm / 파워 위치: 하단후면"))).toEqual({ formFactors: ["ATX"], inferred: true });
  });

  it("does not infer for short bays, SFX-only cases or missing lengths", () => {
    expect(casePsuFormFactorSupportFor(computerCase({ maxPsuLengthMm: 130 }))).toBeUndefined();
    expect(casePsuFormFactorSupportFor(computerCase({ maxPsuLengthMm: 160 }, "ITX 케이스 / SFX 파워 전용"))).toBeUndefined();
    expect(casePsuFormFactorSupportFor(computerCase({}))).toBeUndefined();
  });
});
