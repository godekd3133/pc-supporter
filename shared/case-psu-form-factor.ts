import type { Part } from "./types";

/** ATX 규격 파워의 최소 깊이. 이보다 짧은 장착 공간은 SFX 계열만 받는다. */
export const ATX_PSU_MIN_DEPTH_MM = 140;

export type CasePsuFormFactorSupport = {
  formFactors: string[];
  /** true면 다나와 "지원파워규격" 항목이 아니라 파워 장착 길이로 추론한 값이다. */
  inferred: boolean;
};

function powerBayLengthMm(computerCase: Part) {
  if (computerCase.specs.maxPsuLengthMm !== undefined) return computerCase.specs.maxPsuLengthMm;
  // "파워 장착 길이: 180~300mm"처럼 범위면 최댓값을 쓴다.
  const match = (computerCase.rawSpecText ?? "").match(/파워\s*장착\s*길이\s*[:：]?\s*(?:[\d.]+\s*~\s*)?([\d.]+)\s*mm/i);
  const value = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(value) ? value : undefined;
}

/**
 * 케이스가 받는 파워 규격. 다나와는 "지원파워규격"을 따로 적지 않는 케이스가 많아,
 * 파워 장착 길이가 ATX 파워 최소 깊이(140mm) 이상이면 ATX 파워 장착 공간으로 추론한다.
 * SFX 전용이라고 적힌 케이스는 추론하지 않는다.
 */
export function casePsuFormFactorSupportFor(computerCase: Part): CasePsuFormFactorSupport | undefined {
  const explicit = computerCase.specs.supportedPsuFormFactors;
  if (explicit && explicit.length > 0) return { formFactors: explicit, inferred: false };
  const text = computerCase.rawSpecText ?? "";
  if (/SFX\s*(?:파워)?\s*전용/i.test(text)) return undefined;
  const bayLengthMm = powerBayLengthMm(computerCase);
  if (bayLengthMm === undefined || bayLengthMm < ATX_PSU_MIN_DEPTH_MM) return undefined;
  return { formFactors: ["ATX"], inferred: true };
}
