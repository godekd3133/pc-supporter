import type { BuildSelection, Part, PartCategory, PartSelection } from "./types";

export type CompatibilityFilterPresetValues = {
  socket?: string;
  memoryType?: string;
  formFactor?: string;
  minVramGb?: string;
  minCapacityGb?: string;
  minWattageW?: string;
  minMemorySpeedMhz?: string;
  minMemorySlots?: string;
  minM2Slots?: string;
  minSataPorts?: string;
  minHddBays?: string;
  minMaxGpuLengthMm?: string;
  minMaxCoolerHeightMm?: string;
  minMaxPsuLengthMm?: string;
  minCoolingW?: string;
  maxLengthMm?: string;
  maxPsuDepthMm?: string;
  storageInterface?: "all" | "NVMe" | "SATA";
};

export type CompatibilityFilterPreset = {
  values: CompatibilityFilterPresetValues;
  labels: string[];
  omitted: string[];
};

function selectionListFor(build: BuildSelection, category: PartCategory): PartSelection[] {
  if (category === "memory") return build.memory;
  if (category === "ssd") return build.ssd;
  if (category === "hdd") return build.hdd;
  const selection = build[category];
  return selection ? [selection] : [];
}

function selectedPartFor(build: BuildSelection, category: PartCategory, partMap: ReadonlyMap<string, Part>) {
  const selection = selectionListFor(build, category)[0];
  return selection ? partMap.get(selection.partId) : undefined;
}

function sameKnownValue<T>(parts: Array<Part | undefined>, getValue: (part: Part) => T | undefined) {
  if (parts.length === 0 || parts.some((part) => !part)) return undefined;
  const values = parts.map((part) => getValue(part!));
  if (values.some((value) => value === undefined || value === null || value === "")) return undefined;
  return values.every((value) => value === values[0]) ? values[0] : undefined;
}

function roundedMinimum(value: number | undefined) {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.ceil(value) : undefined;
}

function roundedMaximum(value: number | undefined) {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

export function compatibilityFilterPresetFor(category: PartCategory, build: BuildSelection, partMap: ReadonlyMap<string, Part>): CompatibilityFilterPreset {
  const values: CompatibilityFilterPresetValues = {};
  const labels: string[] = [];
  const omitted: string[] = [];
  const cpu = selectedPartFor(build, "cpu", partMap);
  const cooler = selectedPartFor(build, "cooler", partMap);
  const motherboard = selectedPartFor(build, "motherboard", partMap);
  const memoryParts = selectionListFor(build, "memory").map((selection) => partMap.get(selection.partId));
  const ssdParts = selectionListFor(build, "ssd").map((selection) => partMap.get(selection.partId));
  const hddParts = selectionListFor(build, "hdd").map((selection) => partMap.get(selection.partId));
  const gpu = selectedPartFor(build, "gpu", partMap);
  const computerCase = selectedPartFor(build, "case", partMap);
  const psu = selectedPartFor(build, "psu", partMap);
  const storageEntries = [
    ...selectionListFor(build, "ssd").map((selection, index) => ({ selection, part: ssdParts[index] })),
    ...selectionListFor(build, "hdd").map((selection, index) => ({ selection, part: hddParts[index] }))
  ];
  const m2Count = ssdParts.length > 0 && ssdParts.every((part) => part?.specs.formFactor)
    ? ssdParts.reduce((total, part, index) => total + (/m\.2/i.test(part!.specs.formFactor!) ? selectionListFor(build, "ssd")[index].quantity : 0), 0)
    : undefined;
  const sataCount = storageEntries.length > 0 && storageEntries.every(({ part }) => part?.specs.interface)
    ? storageEntries.filter(({ part }) => part!.specs.interface === "SATA").reduce((total, { selection }) => total + selection.quantity, 0)
    : undefined;
  const physicalMemoryModules = memoryParts.length > 0 && memoryParts.every((part) => part)
    ? memoryParts.reduce((total, part, index) => total + selectionListFor(build, "memory")[index].quantity * (part!.specs.memoryModuleCountPerKit ?? 1), 0)
    : undefined;

  function addText(key: "socket" | "memoryType" | "formFactor", value: string | undefined, label: string) {
    if (!value?.trim()) return;
    values[key] = value.trim();
    labels.push(`${label} ${value.trim()}`);
  }

  function addNumber(key: Exclude<keyof CompatibilityFilterPresetValues, "socket" | "memoryType" | "formFactor" | "storageInterface">, value: number | undefined, label: string, direction: "min" | "max") {
    if (value === undefined || !Number.isFinite(value) || value <= 0) return;
    const rounded = direction === "min" ? roundedMinimum(value) : roundedMaximum(value);
    if (rounded === undefined || rounded <= 0) return;
    values[key] = String(rounded);
    labels.push(`${label} ${direction === "min" ? "≥" : "≤"} ${rounded}${key.includes("Length") || key.includes("Height") || key.includes("Depth") ? "mm" : key.includes("Wattage") || key.includes("Cooling") ? "W" : key.includes("Vram") || key.includes("Capacity") ? "GB" : "개"}`);
  }

  function addInterface(parts: Array<Part | undefined>) {
    const value = sameKnownValue(parts, (part) => part.specs.interface);
    if (value === "NVMe" || value === "SATA") {
      values.storageInterface = value;
      labels.push(`연결 방식 ${value}`);
    }
  }

  switch (category) {
    case "cpu":
      addText("socket", motherboard?.specs.socket, "소켓");
      addText("memoryType", motherboard?.specs.memoryType, "메모리 세대");
      break;
    case "cooler":
      addText("socket", cpu?.specs.socket, "소켓");
      addNumber("minCoolingW", cpu?.specs.pptW ?? cpu?.specs.tdpW, "냉각 용량", "min");
      break;
    case "motherboard":
      addText("socket", cpu?.specs.socket, "소켓");
      addText("memoryType", cpu?.specs.memoryType ?? sameKnownValue(memoryParts, (part) => part.specs.memoryType), "메모리 세대");
      addNumber("minMemorySlots", physicalMemoryModules, "RAM 슬롯", "min");
      if (build.ssd.length > 0 && m2Count === undefined) omitted.push("M.2 SSD 연결 방식 확인 필요");
      else addNumber("minM2Slots", m2Count, "M.2 슬롯", "min");
      if (storageEntries.length > 0 && sataCount === undefined) omitted.push("SATA 저장장치 연결 방식 확인 필요");
      else addNumber("minSataPorts", sataCount, "SATA 포트", "min");
      break;
    case "memory":
      addText("memoryType", motherboard?.specs.memoryType ?? cpu?.specs.memoryType, "메모리 세대");
      addText("formFactor", sameKnownValue(memoryParts, (part) => part.specs.formFactor), "폼팩터");
      addNumber("minCapacityGb", Math.max(...memoryParts.map((part) => part?.specs.capacityGb ?? 0)), "모듈 용량", "min");
      addNumber("minMemorySpeedMhz", Math.max(...memoryParts.map((part) => part?.specs.speedMhz ?? 0)), "속도", "min");
      break;
    case "gpu":
      addNumber("maxLengthMm", computerCase?.specs.maxGpuLengthMm, "GPU 길이", "max");
      addNumber("minVramGb", gpu?.specs.vramGb, "VRAM", "min");
      break;
    case "ssd":
      addText("formFactor", sameKnownValue(ssdParts, (part) => part.specs.formFactor), "폼팩터");
      addInterface(ssdParts);
      addNumber("minCapacityGb", Math.max(...ssdParts.map((part) => part?.specs.capacityGb ?? 0)), "용량", "min");
      break;
    case "hdd":
      addText("formFactor", sameKnownValue(hddParts, (part) => part.specs.formFactor), "폼팩터");
      addInterface(hddParts);
      addNumber("minCapacityGb", Math.max(...hddParts.map((part) => part?.specs.capacityGb ?? 0)), "용량", "min");
      break;
    case "case":
      addText("formFactor", motherboard?.specs.formFactor, "메인보드 폼팩터");
      addNumber("minMaxGpuLengthMm", gpu?.specs.lengthMm, "GPU 허용 길이", "min");
      addNumber("minMaxCoolerHeightMm", cooler?.specs.maxCoolerHeightMm, "쿨러 허용 높이", "min");
      addNumber("minHddBays", build.hdd.reduce((total, selection) => total + selection.quantity, 0), "HDD 베이", "min");
      addNumber("minMaxPsuLengthMm", psu?.specs.psuDepthMm, "PSU 허용 길이", "min");
      break;
    case "psu":
      addText("formFactor", psu?.specs.psuFormFactor, "폼팩터");
      addNumber("minWattageW", gpu?.specs.recommendedPsuW, "정격 출력", "min");
      addNumber("maxPsuDepthMm", computerCase?.specs.maxPsuLengthMm, "PSU 깊이", "max");
      break;
  }

  return { values, labels, omitted };
}
