import { describe, expect, it } from "vitest";
import type { Part } from "./types";
import { parseQuoteLine, quoteLineMappingCandidatesFor } from "./quote-audit";

function part(overrides: Partial<Part>): Part {
  return {
    id: "part",
    category: "cpu",
    name: "Part",
    source: "danawa",
    sourceProductCode: "100",
    danawaUrl: "https://prod.danawa.com/info/?pcode=100",
    dataQuality: "live",
    missingFields: [],
    updatedAt: "2026-09-16T00:00:00.000Z",
    specs: {},
    ...overrides
  };
}

function quotePart(name: string, category: Part["category"], model?: string): Part {
  return part({ id: "quote", category, name, ...(model ? { model } : {}), source: "manual", sourceProductCode: undefined, danawaUrl: undefined });
}

describe("parseQuoteLine", () => {
  it("splits a label, extracts price, and strips vendor suffixes and quantity tails", () => {
    expect(parseQuoteLine("메모리 | 삼성전자 DDR5-5600 (16GB) x2 | 98,000원")).toMatchObject({
      skipped: false,
      category: "memory",
      name: "삼성전자 DDR5-5600 (16GB)",
      model: "ddr55600",
      priceWon: 98_000
    });
    expect(parseQuoteLine("i7-14700K 벌크 55만")).toMatchObject({ category: "cpu", model: "14700k", priceWon: 550_000 });
    expect(parseQuoteLine("쿨러 | Thermalright Peerless Assassin 120 SE 서린")).toMatchObject({
      category: "cooler",
      name: "Thermalright Peerless Assassin 120 SE"
    });
  });

  it("skips non-part labels and skip values", () => {
    expect(parseQuoteLine("조립비 | 기본조립 + 1년 무상 출장AS").skipped).toBe(true);
    expect(parseQuoteLine("HDD | 별도구매 (추가선택가능)").skipped).toBe(true);
    expect(parseQuoteLine("케이블 | 리안리 STRIMER 24핀 케이블").skipped).toBe(true);
  });

  it("prefers a product model token over the capacity token for storage lines", () => {
    expect(parseQuoteLine("SSD | 마이크론 Crucial P3 Plus M.2 NVMe 대원씨티에스 (1TB)")).toMatchObject({ category: "ssd", model: "p3" });
    expect(parseQuoteLine("SSD | 키오시아 EXCERIA PLUS G4 M.2 NVMe (2TB)")).toMatchObject({ category: "ssd", model: "g4" });
  });

  it("keeps motherboard chipset variants glued together", () => {
    expect(parseQuoteLine("메인보드: B650M-K")).toMatchObject({ category: "motherboard", model: "b650mk" });
    expect(parseQuoteLine("메인보드 | GIGABYTE B850 AORUS ELITE WIFI7 제이씨현")).toMatchObject({ category: "motherboard", model: "b850" });
  });

  it("normalizes Korean GPU variant labels", () => {
    expect(parseQuoteLine("그래픽카드 | RTX4070 슈퍼")).toMatchObject({ category: "gpu", model: "4070super" });
  });
});

describe("quoteLineMappingCandidatesFor", () => {
  it("matches a Danawa row whose name only differs by a vendor suffix", () => {
    const quote = quotePart("Thermalright Peerless Assassin 120 SE", "cooler", "120");
    const candidates = quoteLineMappingCandidatesFor(quote, [
      part({ id: "peerless-se", category: "cooler", name: "Thermalright Peerless Assassin 120 SE 서린", model: "Thermalright Peerless Assassin 120 SE 서린" })
    ]);

    expect(candidates[0]).toMatchObject({ activePartId: "peerless-se", confidence: "high", reasons: expect.arrayContaining(["name_exact"]) });
  });

  it("never binds a base GPU model to a Ti/Super variant", () => {
    const quote = quotePart("RTX 5070", "gpu", "5070");
    const candidates = quoteLineMappingCandidatesFor(quote, [
      part({ id: "rtx5070ti", category: "gpu", name: "MSI 지포스 RTX 5070 Ti 게이밍 트리오 D7 12GB", model: "MSI 지포스 RTX 5070 Ti 게이밍 트리오 D7 12GB", specs: { gpuVendor: "nvidia" } })
    ]);

    expect(candidates.map((candidate) => candidate.activePartId)).toEqual([]);
  });

  it("rejects a same-spec memory product from a different product line", () => {
    const quote = quotePart("ESSENCORE KLEVV DDR5-6000 CL30 CRAS V RGB 패키지 (32GB(16Gx2))", "memory", "ddr56000");
    const candidates = quoteLineMappingCandidatesFor(quote, [
      part({ id: "patriot-6000", category: "memory", name: "PATRIOT DDR5-6000 CL30 SIGNATURE PREMIUM EVO 블랙 (16GB)", model: "PATRIOT DDR5-6000 CL30 SIGNATURE PREMIUM EVO 블랙 (16GB)" })
    ]);

    expect(candidates.map((candidate) => candidate.activePartId)).toEqual([]);
  });

  it("rejects a board whose wifi generation differs from the quote", () => {
    const quote = quotePart("GIGABYTE B850 AORUS ELITE WIFI7", "motherboard", "b850");
    const candidates = quoteLineMappingCandidatesFor(quote, [
      part({ id: "b850m-wifi6e", category: "motherboard", name: "GIGABYTE B850M AORUS ELITE WIFI6E ICE 피씨디렉트", model: "GIGABYTE B850M AORUS ELITE WIFI6E ICE 피씨디렉트" })
    ]);

    expect(candidates.map((candidate) => candidate.activePartId)).toEqual([]);
  });

  it("keeps a same-family capacity variant at review confidence only", () => {
    const quote = quotePart("키오시아 EXCERIA PLUS G4 M.2 NVMe (2TB)", "ssd", "g4");
    const candidates = quoteLineMappingCandidatesFor(quote, [
      part({ id: "exceria-g4-1tb", category: "ssd", name: "키오시아 EXCERIA PLUS G4 M.2 NVMe (1TB)", model: "키오시아 EXCERIA PLUS G4 M.2 NVMe (1TB)" })
    ]);

    expect(candidates[0]).toMatchObject({ activePartId: "exceria-g4-1tb", confidence: "review" });
  });

  it("binds a shop shorthand board name to the full product name at review level", () => {
    const quote = quotePart("B760 박격포", "motherboard", "b760");
    const candidates = quoteLineMappingCandidatesFor(quote, [
      part({ id: "b760m-mortar", category: "motherboard", name: "MSI MAG B760M 박격포 WIFI", model: "MSI MAG B760M 박격포 WIFI" })
    ]);

    expect(candidates[0]).toMatchObject({ activePartId: "b760m-mortar", confidence: "review" });
  });

  it("leaves spec-only unresolvable lines without a candidate", () => {
    const quote = quotePart("DDR5 32GB (16x2)", "memory");
    const candidates = quoteLineMappingCandidatesFor(quote, [
      part({ id: "samsung-5600", category: "memory", name: "삼성전자 DDR5-5600 16GB", model: "삼성전자 DDR5-5600 16GB" })
    ]);

    expect(candidates.filter((candidate) => candidate.confidence === "high")).toEqual([]);
  });
});
