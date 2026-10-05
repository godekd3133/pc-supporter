import type { Part, RadiatorMountRequirement, RadiatorSupport } from "../types";

export interface RadiatorClearanceFinding {
  severity: "blocker" | "unknown";
  label: string;
  actual: string;
  expected: string;
}

const dimensionLabels = {
  maxRadiatorThicknessMm: "라디에이터 두께",
  maxAssemblyThicknessMm: "라디에이터와 팬 합산 두께",
  maxMemoryHeightMm: "RAM 높이",
  maxRadiatorWidthMm: "라디에이터 실제 폭",
  maxRadiatorLengthMm: "라디에이터 실제 길이",
  maxGpuLengthMm: "그래픽카드 길이"
} as const;
type DimensionKey = keyof typeof dimensionLabels;
const knownDimension = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

function actualDimension(key: DimensionKey, cooler: Part, memory: Part[], gpu: Part | undefined) {
  switch (key) {
    case "maxRadiatorThicknessMm": return cooler.specs.radiatorThicknessMm;
    case "maxAssemblyThicknessMm": {
      const radiator = cooler.specs.radiatorThicknessMm;
      const fan = cooler.specs.radiatorFanThicknessMm;
      return knownDimension(radiator) && knownDimension(fan) ? radiator + fan : undefined;
    }
    case "maxMemoryHeightMm": {
      const heights = memory.map((part) => part.specs.memoryHeightMm).filter(knownDimension);
      return heights.length > 0 ? Math.max(...heights) : undefined;
    }
    case "maxRadiatorWidthMm": return cooler.specs.radiatorWidthMm;
    case "maxRadiatorLengthMm": return cooler.specs.radiatorLengthMm;
    case "maxGpuLengthMm": return gpu ? gpu.specs.lengthMm : 0;
  }
}

/** Missing measurements never satisfy a manufacturer clearance constraint. */
export function radiatorClearanceFindings(
  support: RadiatorSupport,
  radiatorSizeMm: number,
  cooler: Part,
  memory: Part[],
  gpu?: Part
): RadiatorClearanceFinding[] {
  const findings: RadiatorClearanceFinding[] = [];
  for (const requirement of support.requirements ?? []) {
    if (requirement.sizesMm && !requirement.sizesMm.includes(radiatorSizeMm)) continue;
    const configurationUnconfirmed = Boolean(requirement.configurationNote);
    if (configurationUnconfirmed) {
      findings.push({ severity: "unknown", label: "설치 조건", actual: "확인 필요", expected: requirement.configurationNote! });
    }
    for (const key of Object.keys(dimensionLabels) as DimensionKey[]) {
      const maximum = requirement[key as keyof RadiatorMountRequirement];
      if (!knownDimension(maximum)) continue;
      const actual = actualDimension(key, cooler, memory, gpu);
      const known = knownDimension(actual) || key === "maxGpuLengthMm" && actual === 0;
      const incompleteMemory = key === "maxMemoryHeightMm" && (memory.length === 0 || memory.some((part) => !knownDimension(part.specs.memoryHeightMm)));
      const expected = `${maximum}mm ${requirement.exclusiveUpperBound ? "미만" : "이하"}`;
      if (known && (requirement.exclusiveUpperBound ? actual >= maximum : actual > maximum)) {
        // A limit tied to an unconfirmed layout cannot establish incompatibility
        // in a different layout. Keep that entire conditional requirement open.
        findings.push({ severity: configurationUnconfirmed ? "unknown" : "blocker", label: dimensionLabels[key], actual: `${actual}mm`, expected });
      } else if (!known || incompleteMemory) {
        findings.push({ severity: "unknown", label: dimensionLabels[key], actual: incompleteMemory && known ? `일부 RAM 높이 정보 없음 (확인된 높이 ${actual}mm)` : "치수 정보 없음", expected });
      }
    }
  }
  return findings;
}
