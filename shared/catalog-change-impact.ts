import type { CatalogChangeRecord, CatalogChangeValueDiff } from "./types";

export type CatalogChangeImpactKind = "compatibility" | "analysis" | "purchase" | "data";

export interface CatalogChangeImpact {
  id: string;
  kind: CatalogChangeImpactKind;
  label: string;
  summary: string;
  ruleIds: string[];
}

type ImpactDefinition = Omit<CatalogChangeImpact, "id">;

const SPEC_KEY_BY_LABEL: Record<string, string> = {
  "소켓": "socket",
  "코어": "cores",
  "스레드": "threads",
  "부스트 클럭": "boostClockGhz",
  "Cinebench R23 싱글": "cinebenchR23Single",
  "Cinebench R23 멀티": "cinebenchR23Multi",
  "메모리 지원 속도": "maxMemorySpeedMhz",
  "메모리 타입": "memoryType",
  "기본 쿨러 포함": "coolerIncluded",
  "TDP": "tdpW",
  "PPT": "pptW",
  "소비전력": "powerW",
  "권장 파워": "recommendedPsuW",
  "정격 출력": "wattageW",
  "용량": "capacityGb",
  "메모리 속도": "speedMhz",
  "CAS 레이턴시": "memoryCasLatency",
  "메모리 전압": "memoryVoltageV",
  "M.2 PCIe 세대": "m2PcieGeneration",
  "VRAM": "vramGb",
  "GPU 부스트 클럭": "gpuBoostClockMhz",
  "스트림 프로세서": "gpuStreamProcessors",
  "VRAM 대역폭": "gpuMemoryBandwidthGbps",
  "길이": "lengthMm",
  "두께": "thicknessMm",
  "GPU 허용 길이": "maxGpuLengthMm",
  "쿨러 허용 높이": "maxCoolerHeightMm",
  "지원 소켓": "supportedSockets",
  "메모리 프로파일": "memoryProfiles",
  "메모리 슬롯 규격": "memoryFormFactor",
  "킷당 모듈 수": "memoryModuleCountPerKit",
  "최대 메모리": "maxMemoryGb",
  "메모리 슬롯": "memorySlots",
  "M.2 슬롯": "m2Slots",
  "M.2 연결": "m2Interfaces",
  "PCIe x16 슬롯": "pcieX16Slots",
  "SATA 포트": "sataPorts",
  "인터페이스": "interface",
  "폼팩터": "formFactor",
  "순차 읽기": "sequentialReadMbps",
  "순차 쓰기": "sequentialWriteMbps",
  "읽기 IOPS": "ssdReadIops",
  "쓰기 IOPS": "ssdWriteIops",
  "SSD 컨트롤러": "ssdController",
  "NAND": "ssdNandType",
  "TBW": "ssdTbwTb",
  "GPU 제조사": "gpuVendor",
  "GPU 아키텍처": "gpuArchitectureFamily",
  "GPU 메모리": "gpuMemoryType",
  "GPU 보조전원 요구": "pciePowerOptions",
  "GPU 어댑터 전원 경로": "pciePowerAdapterOptions",
  "GPU 물리 슬롯 점유": "gpuSlotOccupancy",
  "GPU 케이블 굽힘 여유": "gpuCableBendClearanceMm",
  "PSU 보조전원 커넥터": "pciePowerConnectors",
  "지원 메인보드 규격": "motherboardFormFactors",
  "지원 파워 규격": "supportedPsuFormFactors",
  "PSU 허용 길이": "maxPsuLengthMm",
  "쿨러 타입": "coolerType",
  "라디에이터": "radiatorSizeMm",
  "지원 라디에이터": "radiatorSizesMm",
  "라디에이터 장착 위치": "radiatorPosition",
  "위치별 라디에이터 지원": "radiatorSupports",
  "HDD 베이": "hddBays",
  "SSD 베이": "ssdBays",
  "냉각 지원": "maxCoolingW",
  "효율": "efficiency",
  "PSU 폼팩터": "psuFormFactor",
  "PSU 케이블 구조": "psuCableType",
  "PSU 12V 레일": "psuRailType",
  "PSU 독립 PCIe 케이블 런": "psuIndependentPcieCableRuns",
  "PSU PCIe 케이블 분배 구조": "psuPcieCableTopology",
  "케이스 측면 케이블 여유": "caseSidePanelClearanceMm",
  "팬 수": "fanCount",
  "팬 헤더": "fanPortCount",
  "5V ARGB 헤더": "rgb5vPortCount",
  "12V RGB 헤더": "rgb12vPortCount",
  "RGB 전압": "rgbDeviceVoltage",
  "RGB 컨트롤러": "rgbControllerIncluded"
};

const IMPACTS_BY_CATEGORY: Record<string, Record<string, ImpactDefinition>> = {
  cpu: {
    socket: { kind: "compatibility", label: "CPU·메인보드 소켓", summary: "CPU와 메인보드의 물리 장착 가능 여부를 다시 판정합니다.", ruleIds: ["cpu-motherboard-socket"] },
    tdpW: { kind: "compatibility", label: "CPU 전력·냉각", summary: "메인보드 전원부와 CPU 쿨러의 전력 여유를 다시 판정합니다.", ruleIds: ["cpu-motherboard-power", "cpu-cooler-capacity", "gpu-psu-power"] },
    pptW: { kind: "compatibility", label: "CPU 전력·냉각", summary: "메인보드 전원부와 CPU 쿨러의 전력 여유를 다시 판정합니다.", ruleIds: ["cpu-motherboard-power", "cpu-cooler-capacity", "gpu-psu-power"] },
    maxMemorySpeedMhz: { kind: "compatibility", label: "메모리 속도 상한", summary: "CPU와 메모리의 공식 지원 속도 조합을 다시 판정합니다.", ruleIds: ["memory-speed"] },
    integratedGraphics: { kind: "compatibility", label: "그래픽 출력", summary: "외장 GPU가 없을 때 CPU 내장 그래픽으로 화면을 출력할 수 있는지 다시 판정합니다.", ruleIds: ["display-output"] }
  },
  cooler: {
    supportedSockets: { kind: "compatibility", label: "CPU 쿨러 소켓", summary: "쿨러 브라켓이 CPU 소켓을 지원하는지 다시 판정합니다.", ruleIds: ["cpu-cooler-socket"] },
    maxCoolingW: { kind: "compatibility", label: "CPU 냉각 여유", summary: "CPU 기준 전력과 쿨러 냉각 용량의 여유를 다시 판정합니다.", ruleIds: ["cpu-cooler-capacity"] },
    maxCoolerHeightMm: { kind: "compatibility", label: "케이스·쿨러 높이", summary: "쿨러 높이와 케이스 측판 간섭 여부를 다시 판정합니다.", ruleIds: ["case-cooler-height"] },
    coolerType: { kind: "compatibility", label: "라디에이터 장착", summary: "수랭 쿨러라면 케이스 라디에이터 지원 여부를 다시 확인합니다.", ruleIds: ["case-radiator-support"] },
    radiatorSizeMm: { kind: "compatibility", label: "라디에이터 장착", summary: "수랭 라디에이터 크기와 케이스 지원 크기를 다시 판정합니다.", ruleIds: ["case-radiator-support"] },
    radiatorPosition: { kind: "compatibility", label: "라디에이터 장착", summary: "수랭 쿨러의 라디에이터 장착 위치와 케이스 지원 위치를 다시 판정합니다.", ruleIds: ["case-radiator-support"] }
  },
  motherboard: {
    socket: { kind: "compatibility", label: "CPU·메인보드 소켓", summary: "CPU와 메인보드의 물리 장착 가능 여부를 다시 판정합니다.", ruleIds: ["cpu-motherboard-socket"] },
    vrmCapacityW: { kind: "compatibility", label: "메인보드 전원부", summary: "CPU 요구 전력과 메인보드 전원부 공급 범위를 다시 판정합니다.", ruleIds: ["cpu-motherboard-power"] },
    pcieX16Slots: { kind: "compatibility", label: "GPU·PCIe 장착", summary: "그래픽카드 장착 폭과 메인보드 PCIe 슬롯을 다시 판정합니다.", ruleIds: ["gpu-motherboard-pcie"] },
    memoryType: { kind: "compatibility", label: "메모리 규격", summary: "CPU·메인보드와 RAM 세대가 맞는지 다시 판정합니다.", ruleIds: ["memory-type"] },
    memoryFormFactor: { kind: "compatibility", label: "메모리 물리 규격", summary: "RAM DIMM/SO-DIMM 장착 규격을 다시 판정합니다.", ruleIds: ["memory-form-factor"] },
    maxMemoryGb: { kind: "compatibility", label: "메모리 용량 한도", summary: "선택한 RAM 총 용량이 메인보드 한도를 넘는지 다시 판정합니다.", ruleIds: ["memory-capacity"] },
    memorySlots: { kind: "compatibility", label: "RAM 슬롯", summary: "RAM 물리 모듈 수와 메인보드 슬롯 수를 다시 판정합니다.", ruleIds: ["memory-slots"] },
    maxMemorySpeedMhz: { kind: "compatibility", label: "메모리 속도 상한", summary: "CPU·메인보드와 RAM의 공식 지원 속도 조합을 다시 판정합니다.", ruleIds: ["memory-speed"] },
    memoryProfiles: { kind: "compatibility", label: "메모리 프로파일", summary: "RAM의 XMP/EXPO와 메인보드 지원 프로파일을 다시 판정합니다.", ruleIds: ["memory-profile"] },
    m2Slots: { kind: "compatibility", label: "M.2 슬롯", summary: "선택한 M.2 SSD 수와 메인보드 슬롯 수를 다시 판정합니다.", ruleIds: ["m2-slots"] },
    m2Interfaces: { kind: "compatibility", label: "M.2 인터페이스", summary: "M.2 SSD의 NVMe/SATA 연결 방식 지원 여부를 다시 판정합니다.", ruleIds: ["m2-interface"] },
    m2PcieGenerations: { kind: "compatibility", label: "M.2 PCIe 세대", summary: "M.2 SSD와 슬롯의 PCIe 세대·링크 상한을 다시 판정합니다.", ruleIds: ["m2-pcie-generation", "m2-slot-pcie-generation", "m2-slot-topology"] },
    m2SlotProfiles: { kind: "compatibility", label: "M.2 슬롯 배치", summary: "슬롯별 인터페이스·세대·레인 공유 조건을 다시 판정합니다.", ruleIds: ["m2-slot-topology", "m2-slot-routing", "m2-slot-selection", "m2-slot-sharing"] },
    sataPorts: { kind: "compatibility", label: "SATA 포트", summary: "선택한 SATA SSD·HDD와 메인보드 포트 수를 다시 판정합니다.", ruleIds: ["sata-ports"] },
    formFactor: { kind: "compatibility", label: "케이스·메인보드 규격", summary: "메인보드 폼팩터와 케이스 지원 규격을 다시 판정합니다.", ruleIds: ["case-motherboard-form-factor"] },
    fanPortCount: { kind: "compatibility", label: "팬 헤더", summary: "케이스 팬 수와 메인보드 팬 헤더 수를 다시 판정합니다.", ruleIds: ["case-fan-headers"] },
    rgbPortCount: { kind: "compatibility", label: "RGB 헤더", summary: "케이스 RGB 장치와 메인보드 RGB 헤더 수를 다시 판정합니다.", ruleIds: ["case-rgb-headers"] },
    rgb5vPortCount: { kind: "compatibility", label: "5V ARGB 헤더", summary: "케이스 RGB 전압과 5V ARGB 헤더 연결 여부를 다시 판정합니다.", ruleIds: ["case-rgb-voltage"] },
    rgb12vPortCount: { kind: "compatibility", label: "12V RGB 헤더", summary: "케이스 RGB 전압과 12V RGB 헤더 연결 여부를 다시 판정합니다.", ruleIds: ["case-rgb-voltage"] }
  },
  memory: {
    memoryType: { kind: "compatibility", label: "메모리 규격", summary: "CPU·메인보드와 RAM 세대가 맞는지 다시 판정합니다.", ruleIds: ["memory-type"] },
    formFactor: { kind: "compatibility", label: "메모리 물리 규격", summary: "RAM DIMM/SO-DIMM 장착 규격을 다시 판정합니다.", ruleIds: ["memory-form-factor"] },
    capacityGb: { kind: "compatibility", label: "메모리 용량", summary: "RAM 총 용량이 메인보드 지원 범위에 맞는지 다시 판정합니다.", ruleIds: ["memory-capacity"] },
    memoryModuleCountPerKit: { kind: "compatibility", label: "RAM 물리 모듈", summary: "킷당 물리 모듈 수와 메인보드 슬롯 수를 다시 판정합니다.", ruleIds: ["memory-slots"] },
    speedMhz: { kind: "compatibility", label: "RAM 속도", summary: "RAM 속도와 CPU·메인보드 지원 상한을 다시 판정합니다.", ruleIds: ["memory-speed"] },
    memoryProfiles: { kind: "compatibility", label: "메모리 프로파일", summary: "RAM의 XMP/EXPO와 메인보드 지원 프로파일을 다시 판정합니다.", ruleIds: ["memory-profile"] }
  },
  gpu: {
    pcieSlotWidth: { kind: "compatibility", label: "GPU·PCIe 장착", summary: "그래픽카드 장착 폭과 메인보드 PCIe 슬롯을 다시 판정합니다.", ruleIds: ["gpu-motherboard-pcie"] },
    pciePowerOptions: { kind: "compatibility", label: "GPU 보조전원", summary: "GPU 요구 커넥터와 PSU 제공 커넥터를 다시 판정합니다.", ruleIds: ["gpu-psu-connector"] },
    pciePowerAdapterOptions: { kind: "compatibility", label: "GPU 어댑터 전원", summary: "GPU 원문에 명시된 보조전원 어댑터 경로와 PSU 커넥터를 다시 대조합니다.", ruleIds: ["gpu-psu-connector"] },
    gpuSlotOccupancy: { kind: "data", label: "GPU 물리 장착 근거", summary: "GPU가 차지하는 물리 슬롯 정보가 장착·간섭 설명에 반영됩니다. 메인보드 슬롯 배치는 별도 확인이 필요합니다.", ruleIds: [] },
    gpuCableBendClearanceMm: { kind: "compatibility", label: "GPU 케이블 측면 여유", summary: "검수된 GPU 케이블 굽힘 여유와 케이스 측면 공간을 다시 판정합니다.", ruleIds: ["gpu-cable-clearance"] },
    powerW: { kind: "compatibility", label: "GPU·PSU 전력", summary: "GPU 소비전력·권장 파워와 PSU 용량을 다시 판정합니다.", ruleIds: ["gpu-psu-power"] },
    recommendedPsuW: { kind: "compatibility", label: "GPU·PSU 전력", summary: "GPU 권장 파워와 PSU 용량을 다시 판정합니다.", ruleIds: ["gpu-psu-power"] },
    lengthMm: { kind: "compatibility", label: "GPU·케이스 길이", summary: "그래픽카드 길이와 케이스 허용 길이를 다시 판정합니다.", ruleIds: ["gpu-case-length"] },
    thicknessMm: { kind: "compatibility", label: "GPU 두께·슬롯 간섭", summary: "두꺼운 GPU의 인접 슬롯·케이스 간섭 경고를 다시 판정합니다.", ruleIds: ["gpu-thickness"] },
    vramGb: { kind: "analysis", label: "해상도별 GPU VRAM 분석", summary: "게이밍 해상도 권장 VRAM 충족 여부를 다시 계산합니다.", ruleIds: ["gpu-target-vram", "gpu-target-vram-unknown"] }
  },
  ssd: {
    interface: { kind: "compatibility", label: "SSD 연결 방식", summary: "M.2/SATA SSD와 메인보드 연결 조건을 다시 판정합니다.", ruleIds: ["m2-interface", "sata-ports"] },
    formFactor: { kind: "compatibility", label: "SSD 장착 규격", summary: "SSD 폼팩터와 M.2 슬롯·케이스 장착 조건을 다시 판정합니다.", ruleIds: ["m2-slots", "m2-interface"] },
    m2PcieGeneration: { kind: "compatibility", label: "M.2 PCIe 세대", summary: "SSD PCIe 세대와 메인보드 슬롯 링크 상한을 다시 판정합니다.", ruleIds: ["m2-pcie-generation", "m2-slot-pcie-generation"] }
  },
  hdd: {
    interface: { kind: "compatibility", label: "HDD 연결 방식", summary: "HDD 인터페이스와 메인보드 SATA 연결 조건을 다시 판정합니다.", ruleIds: ["hdd-interface", "sata-ports"] },
    formFactor: { kind: "compatibility", label: "HDD 장착 공간", summary: "HDD 폼팩터와 케이스 베이 조건을 다시 판정합니다.", ruleIds: ["case-hdd-bays"] }
  },
  case: {
    maxGpuLengthMm: { kind: "compatibility", label: "GPU·케이스 길이", summary: "그래픽카드 길이와 케이스 허용 길이를 다시 판정합니다.", ruleIds: ["gpu-case-length"] },
    maxCoolerHeightMm: { kind: "compatibility", label: "케이스·쿨러 높이", summary: "쿨러 높이와 케이스 측판 간섭 여부를 다시 판정합니다.", ruleIds: ["case-cooler-height"] },
    maxPsuLengthMm: { kind: "compatibility", label: "PSU·케이스 길이", summary: "파워 깊이와 케이스 허용 길이를 다시 판정합니다.", ruleIds: ["psu-case-length"] },
    supportedPsuFormFactors: { kind: "compatibility", label: "PSU·케이스 규격", summary: "파워 폼팩터와 케이스 지원 규격을 다시 판정합니다.", ruleIds: ["psu-case-form-factor"] },
    motherboardFormFactors: { kind: "compatibility", label: "케이스·메인보드 규격", summary: "메인보드 폼팩터와 케이스 지원 규격을 다시 판정합니다.", ruleIds: ["case-motherboard-form-factor"] },
    hddBays: { kind: "compatibility", label: "HDD 장착 공간", summary: "선택한 HDD 수와 케이스 베이 수를 다시 판정합니다.", ruleIds: ["case-hdd-bays"] },
    fanCount: { kind: "compatibility", label: "팬 헤더", summary: "케이스 팬 수와 메인보드 팬 헤더 수를 다시 판정합니다.", ruleIds: ["case-fan-headers"] },
    rgbDeviceVoltage: { kind: "compatibility", label: "RGB 전압", summary: "케이스 RGB 전압과 메인보드 헤더 전압을 다시 판정합니다.", ruleIds: ["case-rgb-voltage"] },
    radiatorSizesMm: { kind: "compatibility", label: "라디에이터 장착", summary: "케이스가 수랭 라디에이터 크기를 지원하는지 다시 판정합니다.", ruleIds: ["case-radiator-support"] },
    radiatorSupports: { kind: "compatibility", label: "라디에이터 장착", summary: "케이스의 위치별 수랭 라디에이터 지원 크기를 다시 판정합니다.", ruleIds: ["case-radiator-support"] },
    caseSidePanelClearanceMm: { kind: "compatibility", label: "GPU 케이블 측면 여유", summary: "케이스 측면 케이블 공간과 GPU 케이블 굽힘 요구를 다시 판정합니다.", ruleIds: ["gpu-cable-clearance"] }
  },
  psu: {
    wattageW: { kind: "compatibility", label: "GPU·PSU 전력", summary: "GPU 권장 파워와 PSU 용량을 다시 판정합니다.", ruleIds: ["gpu-psu-power"] },
    psuDepthMm: { kind: "compatibility", label: "PSU·케이스 길이", summary: "파워 깊이와 케이스 허용 길이를 다시 판정합니다.", ruleIds: ["psu-case-length"] },
    pciePowerConnectors: { kind: "compatibility", label: "GPU 보조전원", summary: "GPU 요구 커넥터와 PSU 제공 커넥터를 다시 판정합니다.", ruleIds: ["gpu-psu-connector"] },
    psuCableType: { kind: "data", label: "PSU 전원 구조 근거", summary: "PSU 케이블 구조 표기가 GPU 보조전원 설명에 반영됩니다. 독립 케이블 여부는 별도 확인이 필요합니다.", ruleIds: [] },
    psuRailType: { kind: "data", label: "PSU 전원 구조 근거", summary: "PSU 12V 레일 표기가 GPU 보조전원 설명에 반영됩니다. 실제 케이블별 전류 분배는 별도 확인이 필요합니다.", ruleIds: [] },
    psuIndependentPcieCableRuns: { kind: "compatibility", label: "GPU PCIe 케이블 구성", summary: "검수된 PSU 독립 PCIe 케이블 런 수와 GPU 연결 요구를 다시 확인합니다.", ruleIds: ["gpu-psu-cable-topology"] },
    psuPcieCableTopology: { kind: "compatibility", label: "GPU PCIe 케이블 구성", summary: "PSU PCIe 케이블 분배 구조와 GPU 연결 요구를 다시 확인합니다.", ruleIds: ["gpu-psu-cable-topology"] },
    psuFormFactor: { kind: "compatibility", label: "PSU·케이스 규격", summary: "파워 폼팩터와 케이스 지원 규격을 다시 판정합니다.", ruleIds: ["psu-case-form-factor"] }
  }
};

function specKeyForDiff(record: CatalogChangeRecord, diff: CatalogChangeValueDiff) {
  if (!diff.field.startsWith("정규화 스펙 · ")) return undefined;
  const label = diff.field.slice("정규화 스펙 · ".length);
  if (label === "M.2 PCIe 세대") return record.category === "motherboard" ? "m2PcieGenerations" : "m2PcieGeneration";
  return SPEC_KEY_BY_LABEL[label];
}

export function catalogChangeImpactsFor(record: CatalogChangeRecord, diff: CatalogChangeValueDiff): CatalogChangeImpact[] {
  if (diff.field === "가격") {
    return [{ id: "purchase-price", kind: "purchase", label: "구매 금액", summary: "가격 변화가 저장 견적 합계와 구매 준비도에 반영됩니다.", ruleIds: [] }];
  }
  if (diff.field === "데이터 품질" || diff.field === "누락 필드") {
    return [{ id: "data-confidence", kind: "data", label: "데이터 신뢰도", summary: "스펙 완성도 변화에 따라 호환성 판정이 확인 필요 상태가 될 수 있습니다.", ruleIds: [] }];
  }
  if (diff.field === "원문 스펙") {
    return [{ id: `${record.category}-raw-spec-review`, kind: "data", label: "원문 스펙 재검수", summary: "원문 스펙 변경이 감지되어 선택 견적을 다시 검사해야 합니다.", ruleIds: [] }];
  }
  const key = specKeyForDiff(record, diff);
  if (!key) return [];
  const definition = IMPACTS_BY_CATEGORY[record.category]?.[key];
  if (!definition) return [];
  return [{ id: `${record.category}-${key}`, ...definition }];
}
