// Shared display formatting helpers. Pure functions used by the entry shell and lazy views.
import { similarityBasisLabelFor, similarityReferenceUsedCategoryFor } from "../shared/similarity-evidence";
import { type M2SlotProfile, type Part, type PartCategory, type SimilarityEvidence, isKnownPrice } from "../shared/types";

export function formatWon(value: number | undefined) {
  return !isKnownPrice(value) ? "가격 확인 중" : `${value.toLocaleString("ko-KR")}원`;
}

export function formatPriceDelta(value: number | undefined) {
  if (value === undefined) return "가격 확인 필요";
  if (value === 0) return "현재와 같은 가격";
  return `${value > 0 ? "+" : ""}${value.toLocaleString("ko-KR")}원`;
}

export function formatSignedPercent(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export function formatSpecValue(value: unknown) {
  if (value === undefined || value === null || value === "") return "확인 필요";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "있음" : "없음";
  return String(value);
}

export function pciePowerKindLabel(kind: string) {
  if (kind === "12v2x6") return "16핀(12V2x6)";
  if (kind === "12vhpwr") return "16핀(12VHPWR)";
  if (kind === "pcie_8pin_6plus2") return "8핀(6+2)";
  if (kind === "pcie_6pin") return "6핀";
  return kind;
}

export function formatPciePowerOptions(options: Array<Array<{ kind: string; count: number }>> | undefined) {
  if (options === undefined) return undefined;
  if (options.length === 0) return "없음";
  return options.map((option) => option.map((requirement) => `${pciePowerKindLabel(requirement.kind)} ${requirement.count}개`).join(" + ")).join(" 또는 ");
}

export function formatPciePowerAdapterOptions(options: Array<Array<{ kind: string; count: number }>> | undefined) {
  const formatted = formatPciePowerOptions(options);
  return formatted ? `어댑터 경로 · ${formatted}` : undefined;
}

export function formatPciePowerConnectors(connectors: Record<string, number | undefined> | undefined) {
  if (!connectors) return undefined;
  const values = Object.entries(connectors)
    .filter(([, count]) => count !== undefined)
    .map(([kind, count]) => `${pciePowerKindLabel(kind)} ${count}개`);
  return values.length > 0 ? values.join(" + ") : "확인된 커넥터 없음";
}

export function formatM2SharingScopes(scopes: string[] | undefined) {
  if (!scopes || scopes.length === 0) return undefined;
  const labels: Record<string, string> = { pcie: "PCIe", sata: "SATA", usb4: "USB4", m2: "M.2 간" };
  return scopes.map((scope) => labels[scope] ?? scope).join(", ");
}

export function formatM2SlotProfiles(profiles: M2SlotProfile[] | undefined) {
  if (!profiles || profiles.length === 0) return undefined;
  const connectionLabels: Record<string, string> = { cpu: "CPU", chipset: "칩셋", unknown: "연결 확인" };
  return profiles.map((profile) => `${profile.slotId} · ${profile.interfaces?.join("/") ?? "인터페이스 확인"}${profile.pcieGeneration !== undefined ? ` · PCIe ${profile.pcieGeneration.toFixed(1)}` : ""}${profile.connection ? ` · ${connectionLabels[profile.connection] ?? profile.connection}` : ""}`).join(" / ");
}

export function formatRadiatorPosition(position: string | undefined) {
  return position === "front" ? "전면" : position === "top" ? "상단" : position === "bottom" ? "하단" : position === "side" ? "측면" : position === "rear" ? "후면" : undefined;
}

export function formatRadiatorSupports(supports: Array<{ position?: unknown; sizesMm?: unknown }> | undefined) {
  if (!supports || supports.length === 0) return undefined;
  return supports.map((support) => {
    const position = typeof support.position === "string" ? support.position : "확인 필요";
    const sizes = Array.isArray(support.sizesMm) ? support.sizesMm.filter((size): size is number => typeof size === "number" && Number.isFinite(size)).map((size) => `${size}mm`).join(", ") : "확인 필요";
    return `${formatRadiatorPosition(position) ?? position} · ${sizes}`;
  }).join(" / ");
}

export function partSummary(part: Part | undefined) {
  if (!part) return "아직 선택하지 않았습니다.";
  const effectiveMemoryLatency = memoryEffectiveLatencyForDisplay(part);
  const values = [
    part.specs.socket,
    part.specs.memoryType,
    (part.category === "memory" || part.category === "motherboard") && part.specs.memoryProfiles?.length ? part.specs.memoryProfiles.join(" / ") : undefined,
    part.category === "memory" && part.specs.memoryModuleCountPerKit !== undefined ? `킷 ${part.specs.memoryModuleCountPerKit}개 모듈` : undefined,
    part.category === "memory" && part.specs.memoryTiming ? part.specs.memoryTiming : part.category === "memory" && part.specs.memoryCasLatency !== undefined ? `CL${part.specs.memoryCasLatency}` : undefined,
    part.category === "memory" && effectiveMemoryLatency !== undefined ? `실효 ${effectiveMemoryLatency.toFixed(2)}ns` : undefined,
    part.category === "memory" && part.specs.memoryVoltageV !== undefined ? `${part.specs.memoryVoltageV}V` : undefined,
    part.category === "cpu" && part.specs.cinebenchR23Multi !== undefined ? `R23 멀티 ${part.specs.cinebenchR23Multi.toLocaleString("ko-KR")}` : undefined,
    part.category === "gpu" && part.specs.vramGb !== undefined ? `VRAM ${part.specs.vramGb}GB` : undefined,
    part.category === "gpu" && part.specs.gpuMemoryType ? part.specs.gpuMemoryType : undefined,
    part.category === "gpu" && part.specs.gpuBoostClockMhz !== undefined ? `부스트 ${part.specs.gpuBoostClockMhz.toLocaleString("ko-KR")}MHz` : undefined,
    part.category === "gpu" && part.specs.pciePowerOptions !== undefined ? `보조전원 ${formatPciePowerOptions(part.specs.pciePowerOptions)}` : undefined,
    part.category === "gpu" && part.specs.pciePowerAdapterOptions !== undefined ? formatPciePowerAdapterOptions(part.specs.pciePowerAdapterOptions) : undefined,
    part.category === "gpu" && part.specs.gpuSlotOccupancy !== undefined ? `물리 슬롯 ${part.specs.gpuSlotOccupancy}` : undefined,
    part.category === "gpu" && part.specs.gpuCableBendClearanceMm !== undefined ? `케이블 여유 ${part.specs.gpuCableBendClearanceMm}mm` : undefined,
    part.category === "motherboard" && part.specs.m2PcieGenerations?.length ? `M.2 ${part.specs.m2PcieGenerations.map((generation) => `PCIe ${generation.toFixed(1)}`).join(" / ")}` : undefined,
    part.category === "motherboard" && part.specs.m2SlotProfiles?.length ? `슬롯별 M.2 매핑 ${part.specs.m2SlotProfiles.length}개` : undefined,
    part.category === "ssd" && part.specs.interface ? part.specs.interface : undefined,
    part.category === "ssd" && part.specs.capacityGb !== undefined ? `${part.specs.capacityGb}GB` : undefined,
    part.category === "ssd" && part.specs.m2PcieGeneration !== undefined ? `PCIe ${part.specs.m2PcieGeneration.toFixed(1)}` : undefined,
    part.category === "ssd" && part.specs.sequentialReadMbps !== undefined ? `읽기 ${part.specs.sequentialReadMbps.toLocaleString("ko-KR")}MB/s` : undefined,
    part.category === "ssd" && part.specs.ssdTbwTb !== undefined ? `TBW ${part.specs.ssdTbwTb}TB` : undefined,
    part.specs.wattageW ? `${part.specs.wattageW}W` : undefined,
    part.category === "psu" && part.specs.psuCableType ? `케이블 ${part.specs.psuCableType === "fully_modular" ? "풀모듈러" : part.specs.psuCableType === "semi_modular" ? "세미모듈러" : "일체형"}` : undefined,
    part.category === "psu" && part.specs.psuRailType ? `12V ${part.specs.psuRailType === "single" ? "싱글레일" : "다중레일"}` : undefined,
    part.category === "psu" && part.specs.psuIndependentPcieCableRuns !== undefined ? `독립 PCIe 런 ${part.specs.psuIndependentPcieCableRuns}개` : undefined,
    part.category === "psu" && part.specs.psuPcieCableTopology ? `PCIe ${part.specs.psuPcieCableTopology === "independent" ? "독립" : "분배"}` : undefined,
    part.category === "case" && part.specs.caseSidePanelClearanceMm !== undefined ? `케이블 측면 ${part.specs.caseSidePanelClearanceMm}mm` : undefined,
    part.specs.lengthMm ? `${part.specs.lengthMm}mm` : undefined,
    part.specs.formFactor
  ].filter(Boolean);
  return values.join(" · ") || "상세 스펙을 확인할 수 있습니다.";
}

export function memoryEffectiveLatencyForDisplay(part: Part) {
  if (part.category !== "memory") return undefined;
  const speedMhz = part.specs.speedMhz;
  const memoryCasLatency = part.specs.memoryCasLatency;
  if (speedMhz !== undefined && speedMhz > 0 && memoryCasLatency !== undefined) {
    return Number(((memoryCasLatency * 2000) / speedMhz).toFixed(2));
  }
  return part.specs.memoryEffectiveLatencyNs;
}

export function similarityEvidenceText(evidence?: SimilarityEvidence) {
  if (!evidence || evidence.totalDimensions === 0 || evidence.comparedDimensions === 0) return "공통 스펙 확인 불가";
  const confidenceLabel = evidence.confidence === "high" ? "정보 충분" : evidence.confidence === "limited" ? "정보 제한" : "확인 필요";
  const basisLabel = similarityBasisLabelFor(evidence);
  const referenceCategory = similarityReferenceUsedCategoryFor(evidence);
  const referenceLabel = referenceCategory ? ` · ${referenceCategory === "gpu" ? "GPU" : "CPU"} 계열 참조 사용` : "";
  return `${confidenceLabel}${basisLabel === "비교 정보 확인 필요" ? "" : ` · ${basisLabel}`} · 공통 스펙 ${evidence.comparedDimensions}/${evidence.totalDimensions}개${referenceLabel}`;
}

export function suggestionSpecRows(part: Part): Array<[string, unknown]> {
  const specs = part.specs;
  const rowsByCategory: Record<PartCategory, Array<[string, unknown]>> = {
    cpu: [["소켓", specs.socket], ["코어 / 스레드", specs.cores !== undefined && specs.threads !== undefined ? `${specs.cores} / ${specs.threads}` : undefined], ["부스트 클럭", specs.boostClockGhz !== undefined ? `${specs.boostClockGhz}GHz` : undefined], ["Cinebench R23 싱글", specs.cinebenchR23Single !== undefined ? specs.cinebenchR23Single.toLocaleString("ko-KR") : undefined], ["Cinebench R23 멀티", specs.cinebenchR23Multi !== undefined ? specs.cinebenchR23Multi.toLocaleString("ko-KR") : undefined], ["기준 전력", (specs.pptW ?? specs.tdpW) !== undefined ? `${specs.pptW ?? specs.tdpW}W` : undefined]],
    cooler: [["지원 소켓", specs.supportedSockets], ["냉각 지원", specs.maxCoolingW !== undefined ? `${specs.maxCoolingW}W` : undefined], ["최대 높이", specs.maxCoolerHeightMm !== undefined ? `${specs.maxCoolerHeightMm}mm` : undefined], ["라디에이터", specs.radiatorSizeMm !== undefined ? `${specs.radiatorSizeMm}mm` : undefined], ["라디에이터 위치", formatRadiatorPosition(specs.radiatorPosition)]],
    motherboard: [["소켓", specs.socket], ["메모리", specs.memoryType], ["메모리 프로파일", specs.memoryProfiles], ["메모리 슬롯 규격", specs.memoryFormFactor], ["최대 메모리", specs.maxMemoryGb !== undefined ? `${specs.maxMemoryGb}GB` : undefined], ["RAM 슬롯", specs.memorySlots], ["M.2 슬롯", specs.m2Slots], ["M.2 연결", specs.m2Interfaces], ["M.2 PCIe 세대", specs.m2PcieGenerations?.map((generation) => `PCIe ${generation.toFixed(1)}`)], ["M.2 슬롯별 연결", formatM2SlotProfiles(specs.m2SlotProfiles)], ["M.2 공유 범위", formatM2SharingScopes(specs.m2LaneSharingScopes)], ["PCIe x16 슬롯", specs.pcieX16Slots], ["PCIe x8 슬롯", specs.pcieX8Slots], ["PCIe x4 슬롯", specs.pcieX4Slots], ["PCIe x1 슬롯", specs.pcieX1Slots], ["5V ARGB 헤더", specs.rgb5vPortCount], ["12V RGB 헤더", specs.rgb12vPortCount], ["폼팩터", specs.formFactor]],
    memory: [["메모리", specs.memoryType], ["프로파일", specs.memoryProfiles], ["용량", specs.capacityGb !== undefined ? `${specs.capacityGb}GB` : undefined], ["모듈 수/킷", specs.memoryModuleCountPerKit !== undefined ? `${specs.memoryModuleCountPerKit}개` : undefined], ["속도", specs.speedMhz !== undefined ? `${specs.speedMhz}MHz` : undefined], ["메모리 타이밍", specs.memoryTiming], ["CAS 레이턴시", specs.memoryCasLatency !== undefined ? `CL${specs.memoryCasLatency}` : undefined], ["실효 CAS 지연(계산)", memoryEffectiveLatencyForDisplay(part) !== undefined ? `${memoryEffectiveLatencyForDisplay(part)!.toFixed(2)}ns` : undefined], ["전압", specs.memoryVoltageV !== undefined ? `${specs.memoryVoltageV}V` : undefined], ["규격", specs.formFactor]],
    gpu: [["GPU 계열", specs.gpuVendor && specs.gpuArchitectureFamily ? `${specs.gpuVendor.toUpperCase()} · ${specs.gpuArchitectureFamily}` : specs.gpuVendor?.toUpperCase()], ["GPU 메모리", specs.gpuMemoryType], ["VRAM", specs.vramGb !== undefined ? `${specs.vramGb}GB` : undefined], ["부스트 클럭", specs.gpuBoostClockMhz !== undefined ? `${specs.gpuBoostClockMhz.toLocaleString("ko-KR")}MHz` : undefined], ["스트림 프로세서", specs.gpuStreamProcessors !== undefined ? specs.gpuStreamProcessors.toLocaleString("ko-KR") : undefined], ["VRAM 대역폭", specs.gpuMemoryBandwidthGbps !== undefined ? `${specs.gpuMemoryBandwidthGbps.toLocaleString("ko-KR")}GB/s` : undefined], ["PCIe 장착 폭", specs.pcieSlotWidth !== undefined ? `x${specs.pcieSlotWidth}` : undefined], ["보조전원", formatPciePowerOptions(specs.pciePowerOptions)], ["어댑터 경로", formatPciePowerAdapterOptions(specs.pciePowerAdapterOptions)], ["소비전력", specs.powerW !== undefined ? `${specs.powerW}W` : undefined], ["권장 파워", specs.recommendedPsuW !== undefined ? `${specs.recommendedPsuW}W` : undefined], ["길이", specs.lengthMm !== undefined ? `${specs.lengthMm}mm` : undefined], ["두께", specs.thicknessMm !== undefined ? `${specs.thicknessMm}mm` : undefined], ["물리 슬롯 점유", specs.gpuSlotOccupancy !== undefined ? `${specs.gpuSlotOccupancy} 슬롯` : undefined], ["케이블 굽힘 여유", specs.gpuCableBendClearanceMm !== undefined ? `${specs.gpuCableBendClearanceMm}mm` : undefined]],
    ssd: [["인터페이스", specs.interface], ["폼팩터", specs.formFactor], ["PCIe 세대", specs.m2PcieGeneration !== undefined ? `PCIe ${specs.m2PcieGeneration.toFixed(1)}` : undefined], ["용량", specs.capacityGb !== undefined ? `${specs.capacityGb}GB` : undefined], ["순차 읽기", specs.sequentialReadMbps !== undefined ? `${specs.sequentialReadMbps}MB/s` : undefined], ["순차 쓰기", specs.sequentialWriteMbps !== undefined ? `${specs.sequentialWriteMbps}MB/s` : undefined], ["읽기 IOPS", specs.ssdReadIops !== undefined ? `${specs.ssdReadIops.toLocaleString("ko-KR")}` : undefined], ["쓰기 IOPS", specs.ssdWriteIops !== undefined ? `${specs.ssdWriteIops.toLocaleString("ko-KR")}` : undefined], ["컨트롤러", specs.ssdController], ["NAND", specs.ssdNandType], ["TBW", specs.ssdTbwTb !== undefined ? `${specs.ssdTbwTb}TB` : undefined]],
    hdd: [["인터페이스", specs.interface], ["폼팩터", specs.formFactor], ["용량", specs.capacityGb !== undefined ? `${specs.capacityGb}GB` : undefined]],
    case: [["지원 메인보드", specs.motherboardFormFactors], ["GPU 허용 길이", specs.maxGpuLengthMm !== undefined ? `${specs.maxGpuLengthMm}mm` : undefined], ["측면 케이블 여유", specs.caseSidePanelClearanceMm !== undefined ? `${specs.caseSidePanelClearanceMm}mm` : undefined], ["쿨러 허용 높이", specs.maxCoolerHeightMm !== undefined ? `${specs.maxCoolerHeightMm}mm` : undefined], ["PSU 허용 길이", specs.maxPsuLengthMm !== undefined ? `${specs.maxPsuLengthMm}mm` : undefined], ["지원 파워 규격", specs.supportedPsuFormFactors], ["위치별 라디에이터", formatRadiatorSupports(specs.radiatorSupports)], ["RGB 전압", specs.rgbDeviceVoltage], ["RGB 장치당 소비전류", specs.rgbDeviceCurrentA !== undefined ? `${specs.rgbDeviceCurrentA}A` : undefined], ["RGB 장치당 소비전력", specs.rgbDevicePowerW !== undefined ? `${specs.rgbDevicePowerW}W` : undefined], ["RGB 컨트롤러", specs.rgbControllerIncluded], ["HDD 베이", specs.hddBays]],
    psu: [["정격 출력", specs.wattageW !== undefined ? `${specs.wattageW}W` : undefined], ["PSU 깊이", specs.psuDepthMm !== undefined ? `${specs.psuDepthMm}mm` : undefined], ["PCIe 보조전원", formatPciePowerConnectors(specs.pciePowerConnectors)], ["케이블 구조", specs.psuCableType === "fully_modular" ? "풀모듈러" : specs.psuCableType === "semi_modular" ? "세미모듈러" : specs.psuCableType === "fixed" ? "케이블 일체형" : undefined], ["12V 레일", specs.psuRailType === "single" ? "싱글레일" : specs.psuRailType === "multi" ? "다중레일" : undefined], ["독립 PCIe 케이블 런", specs.psuIndependentPcieCableRuns !== undefined ? `${specs.psuIndependentPcieCableRuns}개` : undefined], ["PCIe 분배 구조", specs.psuPcieCableTopology === "independent" ? "독립 케이블" : specs.psuPcieCableTopology === "shared" ? "분배·공유 케이블" : undefined], ["효율", specs.efficiency], ["폼팩터", specs.psuFormFactor]]
  };
  return rowsByCategory[part.category].filter(([, value]) => value !== undefined && value !== "");
}
