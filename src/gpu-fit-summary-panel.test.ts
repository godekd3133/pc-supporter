import { describe, expect, it } from "vitest";
import { gpuFitPassSummaryFor } from "./GpuFitSummaryPanel";

describe("gpu fit pass summary", () => {
  it("joins the two nouns with 과/와 on the first noun only", () => {
    expect(gpuFitPassSummaryFor("쿨러마스터 TD500", "마이크로닉스 Classic II")).toBe("쿨러마스터 TD500과 마이크로닉스 Classic II 조합은 현재 확인한 사양에서 GPU 장착·전원 문제를 찾지 못했어요.");
  });

  it("uses 와 after a vowel-final name and attaches 에 directly to the second noun", () => {
    expect(gpuFitPassSummaryFor("프랙탈 리지", "PSU")).toBe("프랙탈 리지와 PSU 조합은 현재 확인한 사양에서 GPU 장착·전원 문제를 찾지 못했어요.");
  });

  it("falls back to generic labels when parts are missing", () => {
    expect(gpuFitPassSummaryFor(undefined, undefined)).toBe("케이스와 PSU 조합은 현재 확인한 사양에서 GPU 장착·전원 문제를 찾지 못했어요.");
    expect(gpuFitPassSummaryFor("프랙탈 리지", undefined)).toBe("프랙탈 리지와 PSU 조합은 현재 확인한 사양에서 GPU 장착·전원 문제를 찾지 못했어요.");
  });
});
