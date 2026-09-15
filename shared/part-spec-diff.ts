import type { Part, PartCategory } from "./types";

export interface PartSpecDiffRow {
  key: string;
  label: string;
  before: string;
  after: string;
}

export interface PartSpecComparisonRow {
  key: string;
  label: string;
  values: string[];
  changed: boolean;
}

type SpecField = {
  key: string;
  label: string;
  get: (part: Part) => unknown;
  suffix?: string;
};

function valueText(value: unknown, suffix = ""): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (Array.isArray(value)) {
    const values = value.map((item) => valueText(item)).filter((item): item is string => Boolean(item));
    return values.length > 0 ? `${values.join(" · ")}${suffix}` : undefined;
  }
  if (typeof value === "boolean") return value ? "있음" : "없음";
  if (typeof value === "number" && !Number.isFinite(value)) return undefined;
  return `${String(value)}${suffix}`;
}

function aggregateValue(parts: Part[], field: SpecField) {
  const values = parts
    .map((part) => valueText(field.get(part), field.suffix))
    .filter((value): value is string => Boolean(value));
  const unique = [...new Set(values)];
  return unique.length > 0 ? unique.join(" / ") : "미확인";
}

const fieldsByCategory: Record<PartCategory, SpecField[]> = {
  cpu: [
    { key: "socket", label: "소켓", get: (part) => part.specs.socket },
    { key: "cores", label: "코어", get: (part) => part.specs.cores, suffix: "코어" },
    { key: "threads", label: "스레드", get: (part) => part.specs.threads, suffix: "스레드" },
    { key: "boostClockGhz", label: "부스트", get: (part) => part.specs.boostClockGhz, suffix: "GHz" },
    { key: "tdpW", label: "TDP", get: (part) => part.specs.tdpW, suffix: "W" },
    { key: "pptW", label: "PPT", get: (part) => part.specs.pptW, suffix: "W" },
    { key: "cinebenchR23Multi", label: "R23 멀티", get: (part) => part.specs.cinebenchR23Multi, suffix: "점" }
  ],
  cooler: [
    { key: "supportedSockets", label: "지원 소켓", get: (part) => part.specs.supportedSockets },
    { key: "coolerType", label: "쿨러 유형", get: (part) => part.specs.coolerType },
    { key: "maxCoolingW", label: "냉각 용량", get: (part) => part.specs.maxCoolingW, suffix: "W" },
    { key: "maxCoolerHeightMm", label: "최대 높이", get: (part) => part.specs.maxCoolerHeightMm, suffix: "mm" },
    { key: "radiatorSizeMm", label: "라디에이터", get: (part) => part.specs.radiatorSizeMm, suffix: "mm" },
    { key: "fanCount", label: "팬 수", get: (part) => part.specs.fanCount, suffix: "개" }
  ],
  motherboard: [
    { key: "socket", label: "소켓", get: (part) => part.specs.socket },
    { key: "motherboardFormFactors", label: "보드 규격", get: (part) => part.specs.motherboardFormFactors },
    { key: "memoryType", label: "메모리 세대", get: (part) => part.specs.memoryType },
    { key: "maxMemorySpeedMhz", label: "최대 메모리", get: (part) => part.specs.maxMemorySpeedMhz, suffix: "MHz" },
    { key: "m2Slots", label: "M.2 슬롯", get: (part) => part.specs.m2Slots, suffix: "개" },
    { key: "sataPorts", label: "SATA 포트", get: (part) => part.specs.sataPorts, suffix: "개" },
    { key: "pcieX16Slots", label: "PCIe x16", get: (part) => part.specs.pcieX16Slots, suffix: "개" },
    { key: "pcieX8Slots", label: "PCIe x8", get: (part) => part.specs.pcieX8Slots, suffix: "개" },
    { key: "pcieX4Slots", label: "PCIe x4", get: (part) => part.specs.pcieX4Slots, suffix: "개" },
    { key: "pcieX1Slots", label: "PCIe x1", get: (part) => part.specs.pcieX1Slots, suffix: "개" }
  ],
  memory: [
    { key: "memoryType", label: "메모리 세대", get: (part) => part.specs.memoryType },
    { key: "memoryFormFactor", label: "메모리 규격", get: (part) => part.specs.memoryFormFactor },
    { key: "capacityGb", label: "용량", get: (part) => part.specs.capacityGb, suffix: "GB" },
    { key: "speedMhz", label: "속도", get: (part) => part.specs.speedMhz, suffix: "MHz" },
    { key: "memoryCasLatency", label: "CAS", get: (part) => part.specs.memoryCasLatency, suffix: " CL" },
    { key: "memoryVoltageV", label: "전압", get: (part) => part.specs.memoryVoltageV, suffix: "V" },
    { key: "memoryProfiles", label: "프로파일", get: (part) => part.specs.memoryProfiles },
    { key: "memoryModuleCountPerKit", label: "킷 모듈", get: (part) => part.specs.memoryModuleCountPerKit, suffix: "개" }
  ],
  gpu: [
    { key: "gpuVendor", label: "GPU 제조사", get: (part) => part.specs.gpuVendor },
    { key: "gpuArchitectureFamily", label: "아키텍처", get: (part) => part.specs.gpuArchitectureFamily },
    { key: "vramGb", label: "VRAM", get: (part) => part.specs.vramGb, suffix: "GB" },
    { key: "gpuMemoryType", label: "메모리", get: (part) => part.specs.gpuMemoryType },
    { key: "gpuBoostClockMhz", label: "부스트", get: (part) => part.specs.gpuBoostClockMhz, suffix: "MHz" },
    { key: "gpu3dmarkTimeSpyScore", label: "Time Spy", get: (part) => part.specs.gpu3dmarkTimeSpyScore, suffix: "점" },
    { key: "powerW", label: "소비전력", get: (part) => part.specs.powerW, suffix: "W" },
    { key: "lengthMm", label: "길이", get: (part) => part.specs.lengthMm, suffix: "mm" },
    { key: "thicknessMm", label: "두께", get: (part) => part.specs.thicknessMm, suffix: "mm" }
  ],
  ssd: [
    { key: "interface", label: "연결 방식", get: (part) => part.specs.interface },
    { key: "capacityGb", label: "용량", get: (part) => part.specs.capacityGb, suffix: "GB" },
    { key: "sequentialReadMbps", label: "순차 읽기", get: (part) => part.specs.sequentialReadMbps, suffix: "MB/s" },
    { key: "sequentialWriteMbps", label: "순차 쓰기", get: (part) => part.specs.sequentialWriteMbps, suffix: "MB/s" },
    { key: "ssdReadIops", label: "읽기 IOPS", get: (part) => part.specs.ssdReadIops },
    { key: "ssdWriteIops", label: "쓰기 IOPS", get: (part) => part.specs.ssdWriteIops },
    { key: "m2PcieGeneration", label: "PCIe 세대", get: (part) => part.specs.m2PcieGeneration, suffix: "세대" },
    { key: "ssdTbwTb", label: "TBW", get: (part) => part.specs.ssdTbwTb, suffix: "TB" }
  ],
  hdd: [
    { key: "interface", label: "연결 방식", get: (part) => part.specs.interface },
    { key: "capacityGb", label: "용량", get: (part) => part.specs.capacityGb, suffix: "GB" },
    { key: "formFactor", label: "폼팩터", get: (part) => part.specs.formFactor },
    { key: "sataPorts", label: "SATA 포트", get: (part) => part.specs.sataPorts, suffix: "개" }
  ],
  case: [
    { key: "formFactor", label: "케이스 규격", get: (part) => part.specs.formFactor },
    { key: "maxGpuLengthMm", label: "GPU 허용", get: (part) => part.specs.maxGpuLengthMm, suffix: "mm" },
    { key: "maxCoolerHeightMm", label: "쿨러 허용", get: (part) => part.specs.maxCoolerHeightMm, suffix: "mm" },
    { key: "maxPsuLengthMm", label: "PSU 허용", get: (part) => part.specs.maxPsuLengthMm, suffix: "mm" },
    { key: "hddBays", label: "HDD 베이", get: (part) => part.specs.hddBays, suffix: "개" },
    { key: "ssdBays", label: "SSD 베이", get: (part) => part.specs.ssdBays, suffix: "개" },
    { key: "maxCoolingW", label: "냉각 용량", get: (part) => part.specs.maxCoolingW, suffix: "W" }
  ],
  psu: [
    { key: "wattageW", label: "정격 출력", get: (part) => part.specs.wattageW, suffix: "W" },
    { key: "psuFormFactor", label: "PSU 규격", get: (part) => part.specs.psuFormFactor },
    { key: "psuDepthMm", label: "깊이", get: (part) => part.specs.psuDepthMm, suffix: "mm" },
    { key: "efficiency", label: "효율", get: (part) => part.specs.efficiency },
    { key: "psuCableType", label: "케이블", get: (part) => part.specs.psuCableType },
    { key: "psuRailType", label: "레일", get: (part) => part.specs.psuRailType },
    { key: "psuIndependentPcieCableRuns", label: "독립 PCIe", get: (part) => part.specs.psuIndependentPcieCableRuns, suffix: "개" },
    { key: "psuPcieCableTopology", label: "PCIe 연결 방식", get: (part) => part.specs.psuPcieCableTopology }
  ]
};

export function partSpecDiffFor(category: PartCategory, currentParts: Part[], candidate: Part): PartSpecDiffRow[] {
  if (currentParts.length === 0) return [];
  return fieldsByCategory[category]
    .map((field) => {
      const before = aggregateValue(currentParts, field);
      const after = valueText(field.get(candidate), field.suffix) ?? "미확인";
      return before === after ? undefined : { key: field.key, label: field.label, before, after };
    })
    .filter((row): row is PartSpecDiffRow => Boolean(row))
    .slice(0, 8);
}

export function partSpecComparisonRowsFor(category: PartCategory, parts: Part[]): PartSpecComparisonRow[] {
  if (parts.length === 0) return [];
  return fieldsByCategory[category]
    .map((field) => {
      const values = parts.map((part) => valueText(field.get(part), field.suffix) ?? "미확인");
      return {
        key: field.key,
        label: field.label,
        values,
        changed: new Set(values).size > 1
      };
    })
    .filter((row) => row.values.some((value) => value !== "미확인"))
    .slice(0, 10);
}
