import type { GeneratedPartTierAdjacency, Part, PartCategory } from "./types";
import { CATEGORY_LABELS } from "./types";
import { gpuGamingIndexFor, gpuVideoPerformanceRowFor } from "./relative-performance-index";
import { cpuGamingModelFor, cpuGamingScoreFor, gamingSsdFamilyAllowed, gamingFallbackSsdAllowed } from "./cpu-gaming-policy";
import { pciePowerMatchFor } from "./gpu-fit";
import { PHASE1_MOTHERBOARD_EVIDENCE, phase1CaseSupportsMotherboard, phase1CoolerSupportsCpu, phase1GpuPowerUpperBoundW, phase1MotherboardSupportsCpu } from "./phase1-hardware-evidence";

export const GAMING_PART_TIER_POLICY_VERSION = "gaming-part-tiers-2026-10-12";
export type GamingTierEvidence = "video_table" | "catalog_spec" | "project_policy" | "unknown";
export type GamingMinimumStatus = "met" | "unmet" | "unknown";
export type GamingAppropriateStatus = "met" | "below" | "excessive" | "unknown";

/** Numbers compare roles within one category, never physical compatibility. */
export interface GamingPartTier {
  category: PartCategory;
  tier?: number;
  key: string;
  label: string;
  order?: number;
  evidence: GamingTierEvidence;
  platform?: string;
  notes: string[];
}

export interface GamingTierContext {
  cpu?: Part;
  gpu?: Part;
  motherboard?: Part;
  cooler?: Part;
  psu?: Part;
  /** Number of retail kits, not number of DIMMs. */
  memoryQuantity?: number;
  memoryCapacityGb?: number;
  actualMemoryCapacityGb?: number;
  actualMemoryModuleCount?: number;
  hddCount?: number;
}

export interface GamingSupportRequirements {
  motherboard: { socket?: string; memoryType?: string; minimumTier?: number; appropriateTier?: number; tdpW?: number };
  cooler: { minimumTier?: number; appropriateTier?: number; stockAllowed: boolean };
  memory: { minimumCapacityGb: number; appropriateCapacityGb: number; memoryType?: string };
  psu: { minimumWattageW?: number; appropriateMaxWattageW?: number; gpuPowerEvidence: "catalog_spec" | "planning_upper_bound" | "unknown" | "not_applicable" };
  case: { motherboardFormFactor?: string; minimumGpuLengthMm?: number; gpuWidthMm?: number; gpuThicknessMm?: number; gpuSlotOccupancy?: number; gpuCableBendClearanceMm?: number; minimumCoolerHeightMm?: number; radiatorSizeMm?: number; minimumPsuLengthMm?: number };
}

export interface GamingTierCheck {
  code: string;
  status: GamingMinimumStatus;
  evidence: "catalog_spec" | "source_policy" | "unknown";
  detail: string;
}

export interface GamingPartSuitability {
  tier: GamingPartTier;
  minimum: GamingMinimumStatus;
  appropriate: GamingAppropriateStatus;
  checks: GamingTierCheck[];
  notes: string[];
}

export interface GamingTierAssessment {
  policyVersion: typeof GAMING_PART_TIER_POLICY_VERSION;
  requirements: GamingSupportRequirements;
  categories: Partial<Record<PartCategory, GamingPartSuitability>>;
}

export interface GamingPartTierAdjacency extends GeneratedPartTierAdjacency {
  upMemoryCapacityGb?: number;
  downMemoryCapacityGb?: number;
}

const SSD_CAPACITY_STEPS = [500, 1000, 2000, 4000] as const;
const HDD_CAPACITY_STEPS = [2000, 4000, 8000, 16000] as const;

/** A 512GB/1024GB drive occupies the same selectable capacity step as 500GB/1TB. */
function storageStepFor(capacityGb: number, steps: readonly number[]): number | undefined {
  return steps.find((step) => capacityGb === step || capacityGb === step * 1.024);
}

function positive(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function boardIndexFor(part: Part): number {
  const text = `${part.name} ${part.model ?? ""}`;
  if (/ASRock\s+A520M-HVS\s+대원씨티에스/i.test(text)) return 0;
  if (/ASUS\s+TUF\s+Gaming\s+B550M-PLUS\s+STCOM/i.test(text)) return 1;
  if (/GIGABYTE\s+B850M\s+GAMING\s+X\s+WIFI6E\s+제이씨현/i.test(text)) return 2;
  if (/MSI\s+MAG\s+X870E\s+(?:토마호크|TOMAHAWK)\s+WIFI\b/i.test(text)) return 3;
  return -1;
}

/** Stock is a CPU package option; it is not an invented zero-price catalog part. */
export function gamingCoolerTierFor(cooler: Part | undefined, cpu?: Part): number | undefined {
  if (!cooler) return cpu?.specs.coolerIncluded === true && positive(cpu.specs.pptW ?? cpu.specs.tdpW) && (cpu.specs.pptW ?? cpu.specs.tdpW)! <= 100 ? 0 : undefined;
  const text = `${cooler.name} ${cooler.model ?? ""}`;
  if (/DEEPCOOL\s+AG400\s+G2\b/i.test(text)) return 1;
  if (/Thermalright\s+Peerless\s+Assassin\s+120\s+SE\s+서린/i.test(text)) return 2;
  if (/CORSAIR\s+NAUTILUS\s+360\s+RS(?:\s|$)/i.test(text) && !/ARGB|LCD/i.test(text)) return 3;
  return undefined;
}

/** GPU-first policy: capacity goes to 32GB after an upper GPU is retained. */
export function gamingAppropriateMemoryCapacityGb(gpu: Part | undefined, requestedMinimumGb = 16): number {
  const minimum = positive(requestedMinimumGb) ? Math.max(16, requestedMinimumGb) : 16;
  const upperGpu = gpu ? (gpuGamingIndexFor(gpu) ?? 0) >= 160 : false;
  return Math.max(minimum, upperGpu ? 32 : 16);
}

export function gamingPartTierFor(part: Part, context: GamingTierContext = {}): GamingPartTier {
  const base: GamingPartTier = { category: part.category, key: `${part.category}:unknown:${part.id}`, label: `${CATEGORY_LABELS[part.category]} 사양 확인 필요`, evidence: "unknown", notes: [] };
  if (part.category === "cpu") {
    const model = cpuGamingModelFor(part);
    if (!model) return base;
    const series = Number(model[0]);
    const cached = /X3D/.test(model);
    const entry = series === 5 && (/^5500|^5300/.test(model) || /G(?:T)?$/.test(model));
    const tier = cached ? series === 9 ? 5 : series === 7 ? 4 : 3 : series === 9 ? 2 : series === 7 ? 2 : entry ? 0 : 1;
    return { ...base, tier, key: `cpu:${model}`, platform: part.specs.socket, label: /Intel|인텔|코어/i.test(part.name) ? `Intel Core ${model}` : `Ryzen ${series}000${cached ? " / 3D V-Cache" : /G(?:T)?$/.test(model) ? " / 내장 그래픽" : ""}`, order: cpuGamingScoreFor(part), evidence: "project_policy", notes: ["영상의 GPU별 게임 상대 성능과 파생 추천 규칙으로 비교합니다. CPU 수동 변경 순서는 별도로 유지합니다."] };
  }
  if (part.category === "gpu") {
    const index = gpuGamingIndexFor(part);
    if (index === undefined) return base;
    const verified = gpuVideoPerformanceRowFor(part);
    const tier = index >= 250 ? 6 : index >= 190 ? 5 : index >= 170 ? 4 : index >= 130 ? 3 : index >= 95 ? 2 : index >= 65 ? 1 : 0;
    const chip = part.name.match(/\b(?:RTX|RX)\s*\d+\s*(?:Ti|XT|XTX|SUPER)?\b/i)?.[0].replace(/\s+/g, "").toUpperCase() ?? part.model ?? part.name;
    const chipLabel = part.name.match(/\b(?:RTX|RX)\s*\d+\s*(?:Ti|XT|XTX|SUPER)?\b/i)?.[0].replace(/\s+/g, " ").trim() ?? part.model ?? part.name;
    return { ...base, tier, key: `gpu:${chip}:${part.specs.vramGb ?? "?"}`, label: `${chipLabel}${positive(part.specs.vramGb) ? ` / ${part.specs.vramGb}GB` : ""}`, order: index, evidence: verified ? "video_table" : "project_policy", notes: verified ? [] : ["해당 영상에 없는 GPU는 예상 성능으로 비교합니다."] };
  }
  if (part.category === "motherboard") {
    const index = boardIndexFor(part);
    if (index < 0) return base;
    const evidence = PHASE1_MOTHERBOARD_EVIDENCE[index];
    const tier = index === 0 ? 0 : index === 3 ? 2 : 1;
    return { ...base, tier, key: `motherboard:${evidence.socket}:${tier}`, platform: evidence.socket, label: `${evidence.socket} / ${["A520", "B550", "B850", "X870E"][index]}`, order: tier, evidence: "project_policy", notes: [`이 견적에서는 CPU를 기본 설정으로 사용하며 TDP ${evidence.conservativeMaxTdpW}W까지 선택합니다.`, "CPU 소켓과 보드 소켓이 같아야 합니다. 전원부 전류(A)를 출력(W)으로 바꾸지 않습니다."] };
  }
  if (part.category === "cooler") {
    const tier = gamingCoolerTierFor(part);
    return tier === undefined ? base : { ...base, tier, key: `cooler:${tier}`, label: ["기본 쿨러", "싱글 타워", "듀얼 타워", "3열 수랭"][tier], order: tier, evidence: "catalog_spec", notes: ["쿨러 크기/소켓/장착 키트/라디에이터 장착 위치를 따로 확인합니다."] };
  }
  if (part.category === "memory") {
    const capacity = part.specs.capacityGb;
    if (!positive(capacity) || !part.specs.memoryType) return base;
    const quantity = positive(context.memoryQuantity) ? context.memoryQuantity : 1;
    const total = positive(context.actualMemoryCapacityGb) ? context.actualMemoryCapacityGb : capacity * quantity;
    const tier = total >= 64 ? 3 : total >= 32 ? 2 : total >= 16 ? 1 : 0;
    // DDR5 is a platform characteristic, not permission to outrank a larger DDR4 kit.
    return { ...base, tier, key: `memory:${part.specs.memoryType}:${total}:${part.specs.speedMhz ?? "?"}`, platform: part.specs.memoryType, label: `${total}GB ${part.specs.memoryType}`, order: total, evidence: "catalog_spec", notes: (part.specs.speedMhz ?? 0) >= 8000 ? ["DDR5-8000은 오버클럭 프로파일입니다. CPU/보드/DIMM 구성의 실제 8000MT/s 동작을 보장하지 않습니다."] : [] };
  }
  if (part.category === "psu") {
    const watts = part.specs.wattageW;
    if (!positive(watts)) return base;
    const tier = watts <= 500 ? 0 : watts <= 650 ? 1 : watts <= 850 ? 2 : watts <= 1000 ? 3 : 4;
    return { ...base, tier, key: `psu:${watts}`, label: `${watts}W`, order: watts, evidence: "catalog_spec", notes: ["용량 단계이며 제품 품질 등급이 아닙니다. GPU 전원 커넥터/독립 케이블/케이스 장착 길이를 따로 확인합니다."] };
  }
  if (part.category === "ssd" || part.category === "hdd") {
    const capacity = part.specs.capacityGb;
    if (!positive(capacity)) return base;
    const steps = part.category === "ssd" ? SSD_CAPACITY_STEPS : HDD_CAPACITY_STEPS;
    const step = storageStepFor(capacity, steps);
    return { ...base, tier: step === undefined ? undefined : steps.findIndex((value) => value === step), key: `${part.category}:${step ?? capacity}`, label: `${capacity >= 1000 && capacity % 1000 === 0 ? `${capacity / 1000}TB` : `${capacity}GB`} ${part.category.toUpperCase()}`, order: capacity, evidence: "catalog_spec", notes: [] };
  }
  if (part.category === "case") {
    const length = part.specs.maxGpuLengthMm;
    if (!positive(length)) return base;
    const tier = length <= 300 ? 0 : length <= 350 ? 1 : 2;
    return { ...base, tier, key: `case:${length}:${part.specs.maxCoolerHeightMm ?? "?"}:${part.specs.radiatorSizesMm?.join(",") ?? "?"}`, label: `GPU ${length}mm까지`, order: length, evidence: "catalog_spec", notes: ["비싼 케이스가 게임 성능을 높이지 않습니다. 보드 크기/GPU 두께/전원 케이블 공간은 따로 확인합니다."] };
  }
  return base;
}

export function gamingSupportRequirementsFor(context: GamingTierContext): GamingSupportRequirements {
  const { cpu, gpu, motherboard, cooler, psu } = context;
  const tdp = cpu?.specs.tdpW;
  const socket = cpu?.specs.socket;
  const boardTier = positive(tdp) ? socket === "AM4" ? tdp <= 65 ? 0 : tdp <= 105 ? 1 : undefined : socket === "AM5" ? tdp <= 120 ? 1 : tdp <= 170 ? 2 : undefined : undefined : undefined;
  const stockAllowed = gamingCoolerTierFor(undefined, cpu) === 0;
  const minimumCooler = stockAllowed ? 0 : positive(tdp) ? tdp <= 120 ? 1 : tdp <= 170 ? 2 : undefined : undefined;
  const cpuPower = cpu?.specs.pptW ?? tdp;
  const gpuPower = gpu ? phase1GpuPowerUpperBoundW(gpu) : 0;
  const gpuRecommendation = gpu?.specs.recommendedPsuW;
  const systemPower = positive(cpuPower) && gpuPower !== undefined ? cpuPower + gpuPower + 150 : undefined;
  const minimumWattageW = systemPower !== undefined && (!gpu || positive(gpuRecommendation)) ? Math.max(gpu ? gpuRecommendation! : 400, systemPower) : undefined;
  const minimumCapacityGb = Math.max(16, positive(context.memoryCapacityGb) ? context.memoryCapacityGb : 16);
  return {
    motherboard: { socket, memoryType: cpu?.specs.memoryType ?? (socket === "AM4" ? "DDR4" : socket === "AM5" ? "DDR5" : undefined), minimumTier: boardTier, appropriateTier: boardTier, tdpW: tdp },
    cooler: { minimumTier: minimumCooler, appropriateTier: minimumCooler, stockAllowed },
    memory: { minimumCapacityGb, appropriateCapacityGb: gamingAppropriateMemoryCapacityGb(gpu, minimumCapacityGb), memoryType: motherboard?.specs.memoryType ?? cpu?.specs.memoryType },
    psu: { minimumWattageW, appropriateMaxWattageW: systemPower === undefined ? undefined : Math.max(systemPower * 1.25, (gpuRecommendation ?? 0) + 50, 500), gpuPowerEvidence: !gpu ? "not_applicable" : positive(gpu.specs.powerW) ? "catalog_spec" : gpuPower !== undefined ? "planning_upper_bound" : "unknown" },
    case: { motherboardFormFactor: motherboard?.specs.formFactor, minimumGpuLengthMm: gpu?.specs.lengthMm, gpuWidthMm: gpu?.specs.widthMm, gpuThicknessMm: gpu?.specs.thicknessMm, gpuSlotOccupancy: gpu?.specs.gpuSlotOccupancy, gpuCableBendClearanceMm: gpu?.specs.gpuCableBendClearanceMm, minimumCoolerHeightMm: cooler?.specs.coolerType === "air" ? cooler.specs.maxCoolerHeightMm : undefined, radiatorSizeMm: cooler?.specs.coolerType === "liquid" ? cooler.specs.radiatorSizeMm : undefined, minimumPsuLengthMm: psu?.specs.psuDepthMm }
  };
}

/** A failed known requirement dominates unknowns; unknown source fields remain unknown. */
export function gamingPartSuitabilityFor(part: Part, context: GamingTierContext): GamingPartSuitability {
  const tier = gamingPartTierFor(part, context);
  const requirements = gamingSupportRequirementsFor(context);
  const checks: GamingTierCheck[] = [];
  const notes = [...tier.notes];
  let appropriate: GamingAppropriateStatus = "met";
  const check = (code: string, result: boolean | undefined, detail: string, sourcePolicy = false) => checks.push({ code, status: result === undefined ? "unknown" : result ? "met" : "unmet", evidence: result === undefined ? "unknown" : sourcePolicy ? "source_policy" : "catalog_spec", detail });
  const atLeast = (code: string, value: number | undefined, minimum: number | undefined, detail: string) => check(code, positive(value) && positive(minimum) ? value >= minimum : undefined, detail);
  if (part.category === "motherboard") {
    check("board-socket", part.specs.socket && requirements.motherboard.socket ? part.specs.socket === requirements.motherboard.socket : undefined, "CPU 소켓과 보드 소켓이 같아야 합니다.");
    const hasInputs = context.cpu && positive(context.cpu.specs.tdpW) && boardIndexFor(part) >= 0 && part.specs.socket && context.cpu.specs.socket;
    check("board-cpu-source-policy", hasInputs ? phase1MotherboardSupportsCpu(context.cpu!, part) : undefined, "CPU 지원 목록과 전원부를 확인한 보드만 선택합니다. BIOS 버전은 구매 시 확인하세요.", true);
    if (tier.tier !== undefined && requirements.motherboard.appropriateTier !== undefined && tier.tier > requirements.motherboard.appropriateTier) appropriate = "excessive";
  } else if (part.category === "cooler") {
    check("cooler-socket", context.cpu?.specs.socket && part.specs.supportedSockets ? part.specs.supportedSockets.includes(context.cpu.specs.socket) : undefined, "CPU 소켓용 장착 키트가 필요합니다.");
    check("cooler-cpu-source-policy", context.cpu && positive(context.cpu.specs.tdpW) && tier.tier !== undefined ? phase1CoolerSupportsCpu(part, context.cpu) : undefined, "CPU를 기본 설정으로 사용할 때 필요한 쿨러입니다. 실제 온도는 사용 환경에 따라 달라집니다.", true);
    if (tier.tier !== undefined && requirements.cooler.appropriateTier !== undefined && tier.tier > requirements.cooler.appropriateTier) appropriate = "excessive";
  } else if (part.category === "memory") {
    const quantity = positive(context.memoryQuantity) ? context.memoryQuantity : 1;
    const capacity = positive(context.actualMemoryCapacityGb) ? context.actualMemoryCapacityGb : positive(part.specs.capacityGb) ? part.specs.capacityGb * quantity : undefined;
    check("memory-generation", part.specs.memoryType && requirements.memory.memoryType ? part.specs.memoryType === requirements.memory.memoryType : undefined, "CPU/보드의 DDR 세대와 같아야 합니다.");
    atLeast("memory-minimum", capacity, requirements.memory.minimumCapacityGb, `최소 RAM ${requirements.memory.minimumCapacityGb}GB입니다.`);
    const moduleCount = part.specs.memoryModuleCountPerKit;
    const totalModules = positive(context.actualMemoryModuleCount) ? context.actualMemoryModuleCount : positive(moduleCount) ? moduleCount * quantity : undefined;
    const slots = context.motherboard?.specs.memorySlots;
    check("memory-slot-count", positive(totalModules) && positive(slots) ? totalModules <= slots : undefined, "키트 수와 키트당 DIMM 수가 실제 보드 슬롯 이내여야 합니다.");
    if (context.motherboard) check("memory-max-capacity", positive(capacity) && positive(context.motherboard.specs.maxMemoryGb) ? capacity <= context.motherboard.specs.maxMemoryGb : undefined, "보드 최대 메모리 용량 이내여야 합니다.");
    if (capacity !== undefined) appropriate = capacity < requirements.memory.appropriateCapacityGb ? "below" : capacity > requirements.memory.appropriateCapacityGb ? "excessive" : "met";
    if ((part.specs.speedMhz ?? 0) >= 8000) check("memory-oc-validation", undefined, "DDR5-8000 프로파일의 CPU/보드 QVL/실제 DIMM 구성 안정성을 추가 확인해야 합니다.");
  } else if (part.category === "ssd" || part.category === "hdd") {
    const minimumCapacityGb = part.category === "ssd" ? SSD_CAPACITY_STEPS[0] : HDD_CAPACITY_STEPS[0];
    atLeast(`${part.category}-capacity`, part.specs.capacityGb, minimumCapacityGb, `저장장치 1개당 최소 ${minimumCapacityGb}GB입니다. 연결 방식과 슬롯은 호환 검사에서 확인합니다.`);
  } else if (part.category === "psu") {
    atLeast("psu-wattage", part.specs.wattageW, requirements.psu.minimumWattageW, "GPU 권장 파워와 CPU/GPU 전력 예산 중 더 큰 값이 최소입니다.");
    if (context.gpu) {
      const options = context.gpu.specs.pciePowerOptions;
      const allOptions = options ? [...options, ...(context.gpu.specs.pciePowerAdapterOptions ?? [])] : undefined;
      const result = allOptions ? pciePowerMatchFor(allOptions, part.specs.pciePowerConnectors) : undefined;
      check("psu-gpu-connectors", result?.status === "compatible" ? true : result?.status === "blocker" ? false : undefined, "GPU 본체 또는 확인한 동봉 어댑터의 전원 커넥터 개수와 일치해야 합니다.");
      const matchedOption = result?.matchedOptionIndex !== undefined ? allOptions?.[result.matchedOptionIndex] : undefined;
      const eightPinCount = matchedOption?.reduce((sum, entry) => entry.kind === "pcie_8pin_6plus2" ? sum + entry.count : sum, 0) ?? 0;
      if (eightPinCount > 1) check("psu-independent-cables", part.specs.psuPcieCableTopology === "shared" ? false : positive(part.specs.psuIndependentPcieCableRuns) ? part.specs.psuIndependentPcieCableRuns >= eightPinCount : undefined, "GPU가 요구하는 8핀 독립 케이블 수를 확인합니다.");
    }
    if (positive(part.specs.wattageW) && positive(requirements.psu.appropriateMaxWattageW) && part.specs.wattageW > requirements.psu.appropriateMaxWattageW) appropriate = "excessive";
    if (requirements.psu.gpuPowerEvidence === "planning_upper_bound") notes.push("GPU 소비전력 실측이 없어 확인한 커넥터의 전력 상한을 예산으로만 사용합니다.");
  } else if (part.category === "case") {
    const board = context.motherboard;
    check("case-board-form", board?.specs.formFactor && part.specs.motherboardFormFactors ? part.specs.motherboardFormFactors.includes(board.specs.formFactor) : undefined, "보드 외형과 케이스의 지원 외형이 같아야 합니다.");
    if (board) check("case-board-dimensions", phase1CaseSupportsMotherboard(part, board), "C10M은 모든 mATX 보드를 지원하지 않으므로 확인한 작은 보드만 허용합니다.", true);
    if (context.gpu) {
      atLeast("case-gpu-length", part.specs.maxGpuLengthMm, context.gpu.specs.lengthMm, "GPU 본체 길이가 실제 케이스 장착 공간 이내여야 합니다.");
      check("case-gpu-profile", part.specs.lowProfileOnly === true ? context.gpu.specs.lowProfileBracket : true, "LP 전용 케이스는 LP 브래킷이 확인된 GPU만 허용합니다.");
      if ((context.gpu.specs.thicknessMm ?? 0) > 55 || (context.gpu.specs.gpuSlotOccupancy ?? 0) > 2) check("case-gpu-thickness-clearance", undefined, "두꺼운 GPU의 실제 점유 슬롯과 하단 보드/케이스 간섭은 물리 장착 근거를 추가 확인해야 합니다.");
      const bend = context.gpu.specs.gpuCableBendClearanceMm;
      const width = context.gpu.specs.widthMm;
      const side = part.specs.caseSidePanelClearanceMm;
      if (context.gpu.specs.pciePowerOptions?.some((option) => option.some((entry) => entry.kind === "12vhpwr" || entry.kind === "12v2x6"))) check("case-gpu-cable-clearance", positive(bend) && positive(width) && positive(side) ? width + bend <= side : undefined, "GPU 폭과 16핀 케이블 굽힘 여유를 합쳐 측면 공간을 확인합니다.");
    }
    if (context.cooler?.specs.coolerType === "air") atLeast("case-cooler-height", part.specs.maxCoolerHeightMm, context.cooler.specs.maxCoolerHeightMm, "공랭 쿨러 높이가 케이스 허용 높이 이내여야 합니다.");
    if (context.cooler?.specs.coolerType === "liquid") {
      const radiator = context.cooler.specs.radiatorSizeMm;
      const supports = part.specs.radiatorSupports;
      const sizes = part.specs.radiatorSizesMm;
      check("case-radiator-mount", positive(radiator) && (supports || sizes) ? supports?.some((support) => (!context.cooler?.specs.radiatorPosition || support.position === context.cooler.specs.radiatorPosition) && support.sizesMm.includes(radiator)) ?? sizes!.includes(radiator) : undefined, "지정 위치에 해당 길이 라디에이터가 장착되어야 합니다. RAM/보드/GPU 간섭은 별도 호환 검사로 확인합니다.");
    }
    if (context.psu) {
      atLeast("case-psu-length", part.specs.maxPsuLengthMm, context.psu.specs.psuDepthMm, "파워 본체와 케이블을 넣을 공간을 확인합니다.");
      check("case-psu-form", context.psu.specs.psuFormFactor && part.specs.supportedPsuFormFactors ? part.specs.supportedPsuFormFactors.includes(context.psu.specs.psuFormFactor) : undefined, "파워 외형이 케이스의 지원 외형과 같아야 합니다.");
    }
    if ((context.hddCount ?? 0) > 0) atLeast("case-hdd-bays", part.specs.hddBays, context.hddCount, "HDD 수에 맞는 실제 장착 베이가 필요합니다.");
  }
  const minimum: GamingMinimumStatus = checks.some((item) => item.status === "unmet") ? "unmet" : checks.some((item) => item.status === "unknown") || checks.length === 0 && tier.tier === undefined ? "unknown" : "met";
  if (minimum === "unmet") appropriate = "below";
  else if (minimum === "unknown") appropriate = "unknown";
  return { tier, minimum, appropriate, checks, notes };
}

/** Compact result metadata; compatibility-evaluator remains the authoritative gate. */
export function gamingTierAssessmentFor(parts: Partial<Record<PartCategory, Part | undefined>>, options: Pick<GamingTierContext, "memoryQuantity" | "memoryCapacityGb" | "actualMemoryCapacityGb" | "actualMemoryModuleCount" | "hddCount"> = {}): GamingTierAssessment {
  const context: GamingTierContext = { ...options, cpu: parts.cpu, gpu: parts.gpu, motherboard: parts.motherboard, cooler: parts.cooler, psu: parts.psu };
  const categories: Partial<Record<PartCategory, GamingPartSuitability>> = {};
  for (const category of ["cpu", "gpu", "motherboard", "memory", "cooler", "psu", "case", "ssd", "hdd"] as const) {
    const part = parts[category];
    if (part) categories[category] = gamingPartSuitabilityFor(part, context);
  }
  return { policyVersion: GAMING_PART_TIER_POLICY_VERSION, requirements: gamingSupportRequirementsFor(context), categories };
}

/** Manual steps are stable product identities, independent of benchmark/price rank. */
export const GAMING_CPU_MANUAL_STEPS = ["5500GT", "5600", "7500F", "7600", "9600", "9600X", "9700X", "7500X3D", "7700X3D", "7800X3D", "9800X3D", "9850X3D", "9900X3D", "9950X3D"] as const;
export const GAMING_INTEL_CPU_MANUAL_STEPS = ["12100F", "14100F", "13400F", "14400F", "14600KF", "250KF", "265K", "265KF"] as const;
export const GAMING_NVIDIA_MANUAL_STEPS = ["RTX3050", "RTX5050", "RTX5060", "RTX5060TI", "RTX5070", "RTX5070TI", "RTX5080", "RTX5090"] as const;
export const GAMING_RADEON_MANUAL_STEPS = ["RX580", "RX9060", "RX9060XT", "RX9070", "RX9070XT"] as const;
const MEMORY_CAPACITY_STEPS = [16, 32, 64, 128] as const;
const PSU_WATTAGE_STEPS = [400, 450, 500, 550, 600, 650, 700, 750, 800, 850, 900, 1000, 1200, 1300, 1500, 1600] as const;

function gpuManualModelFor(part: Part): string | undefined {
  return `${part.name} ${part.model ?? ""}`.match(/\b(?:RTX|RX)\s*\d+\s*(?:TI|XTX|XT|SUPER)?\b/i)?.[0].replace(/\s+/g, "").toUpperCase();
}

/** The next policy step must exist and fit; filtering must never jump over it. */
export function gamingPartTierAdjacencyFor(parts: readonly Part[], currentId: string, context: GamingTierContext = {}): GamingPartTierAdjacency {
  const current = parts.find((part) => part.id === currentId);
  if (!current) return {};
  const result: GamingPartTierAdjacency = {};
  const available = parts.filter((part) => part.category === current.category && positive(part.priceWon) && !part.priceUnavailableAt);
  const choose = (candidates: Part[], direction: "up" | "down", label: string) => {
    const fitting = candidates.filter((part) => !["motherboard", "cooler", "psu", "case"].includes(part.category) || gamingPartSuitabilityFor(part, context).minimum !== "unmet");
    const target = fitting.sort((a,b) => (a.priceWon ?? Infinity) - (b.priceWon ?? Infinity) || a.id.localeCompare(b.id))[0];
    if (!target) result[`${direction}UnavailableReason`] = candidates.length ? `${label} 단계가 현재 구성의 필수 조건을 충족하지 않습니다.` : `${label} 단계의 판매 가능한 부품이 없습니다.`;
    else result[`${direction}Id`] = target.id;
    return target;
  };
  const visit = <T extends string | number>(steps: readonly T[], key: T, action: (next: T, direction: "up" | "down") => void) => {
    for (const direction of ["up", "down"] as const) {
      // String ladders use their declared positions, never lexicographic comparison.
      const index = steps.indexOf(key);
      const target = typeof key === "string"
        ? index >= 0 ? steps[index + (direction === "up" ? 1 : -1)] : undefined
        : (direction === "up" ? [...steps] : [...steps].reverse()).find((step) => direction === "up" ? step > key : step < key);
      if (target !== undefined) action(target, direction);
    }
  };
  if (current.category === "cpu" || current.category === "gpu") {
    const key = current.category === "cpu" ? cpuGamingModelFor(current) : gpuManualModelFor(current);
    const steps: readonly string[] = current.category === "cpu" ? /Intel|인텔|코어/i.test(current.name) ? GAMING_INTEL_CPU_MANUAL_STEPS : GAMING_CPU_MANUAL_STEPS : key?.startsWith("RX") ? GAMING_RADEON_MANUAL_STEPS : GAMING_NVIDIA_MANUAL_STEPS;
    if (!key || !steps.includes(key)) return { upUnavailableReason: "수동 단계표에 없는 모델입니다. 부품을 직접 선택해 주세요.", downUnavailableReason: "수동 단계표에 없는 모델입니다. 부품을 직접 선택해 주세요." };
    visit(steps, key, (next, direction) => {
      let candidates = available.filter((part) => (current.category === "cpu" ? cpuGamingModelFor(part) : gpuManualModelFor(part)) === next);
      // VRAM variants share one model step. Retain the current VRAM capacity when
      // that model offers it; a lower-VRAM variant cannot masquerade as an upgrade.
      if (current.category === "gpu" && positive(current.specs.vramGb)) {
        const sameCapacity = candidates.filter((part) => part.specs.vramGb === current.specs.vramGb);
        if (sameCapacity.length) candidates = sameCapacity;
      }
      choose(candidates, direction, next);
    });
    return result;
  }
  if ((current.category === "ssd" || current.category === "hdd") && positive(current.specs.capacityGb)) {
    const category = current.category;
    const steps = category === "ssd" ? SSD_CAPACITY_STEPS : HDD_CAPACITY_STEPS;
    const key = storageStepFor(current.specs.capacityGb, steps) ?? current.specs.capacityGb;
    result.currentCapacityGb = current.specs.capacityGb;
    visit(steps, key, (next, direction) => {
      let candidates = available.filter((part) => storageStepFor(part.specs.capacityGb ?? 0, steps) === next);
      if (category === "ssd") {
        const fixed = candidates.filter(gamingSsdFamilyAllowed);
        candidates = fixed.length ? fixed : candidates.filter(gamingFallbackSsdAllowed);
      }
      if (choose(candidates, direction, `${next >= 1000 ? `${next / 1000}TB` : `${next}GB`} ${category.toUpperCase()}`)) {
        if (category === "ssd") result[`${direction}StorageCapacityGb`] = next;
        else result[`${direction}HddCapacityGb`] = next;
      }
    });
    return result;
  }
  if (current.category === "memory" && positive(current.specs.capacityGb)) {
    const currentCapacity = context.actualMemoryCapacityGb ?? current.specs.capacityGb * (positive(context.memoryQuantity) ? context.memoryQuantity : 1);
    result.currentCapacityGb = currentCapacity;
    visit(MEMORY_CAPACITY_STEPS, currentCapacity, (next, direction) => {
      const candidates = available.filter((part) => part.specs.memoryType === current.specs.memoryType && positive(part.specs.capacityGb)).map((part) => {
        const quantity = next / part.specs.capacityGb!;
        return { part, quantity, price: part.priceWon! * quantity };
      }).filter(({ part, quantity }) => Number.isInteger(quantity) && quantity >= 1
        && (!positive(part.specs.memoryModuleCountPerKit) || !positive(context.motherboard?.specs.memorySlots) || part.specs.memoryModuleCountPerKit * quantity <= context.motherboard.specs.memorySlots)
        && (!positive(context.motherboard?.specs.maxMemoryGb) || next <= context.motherboard.specs.maxMemoryGb));
      const target = candidates.sort((a,b) => a.price - b.price || a.part.id.localeCompare(b.part.id))[0];
      if (target) { result[`${direction}Id`] = target.part.id; result[`${direction}MemoryCapacityGb`] = next; }
      else result[`${direction}UnavailableReason`] = `RAM ${next}GB 단계의 판매 가능한 구성 또는 보드 슬롯이 없습니다.`;
    });
    return result;
  }
  if (current.category === "cooler") {
    const key = gamingCoolerTierFor(current);
    if (key === undefined) return {};
    visit([0,1,2,3], key, (next, direction) => {
      if (next === 0) {
        if (gamingCoolerTierFor(undefined, context.cpu) === 0) result.downUseIncludedCooler = true;
        else result.downUnavailableReason = "이 CPU 패키지에는 사용할 수 있는 기본 쿨러가 없습니다.";
      } else choose(available.filter((part) => gamingCoolerTierFor(part) === next), direction, ["기본 쿨러", "싱글 타워", "듀얼 타워", "3열 수랭"][next]);
    });
    return result;
  }
  if (current.category === "motherboard") {
    const index = boardIndexFor(current);
    const steps = current.specs.socket === "AM4" ? [0,1] : current.specs.socket === "AM5" ? [2,3] : [];
    if (index >= 0) visit(steps, index, (next, direction) => choose(available.filter((part) => boardIndexFor(part) === next), direction, ["A520", "B550", "B850", "X870E"][next]));
    else return { upUnavailableReason: "이 CPU/RAM 플랫폼에 등록한 보드 단계가 없습니다. 부품을 직접 선택해 주세요.", downUnavailableReason: "이 CPU/RAM 플랫폼에 등록한 보드 단계가 없습니다. 부품을 직접 선택해 주세요." };
    return result;
  }
  if (current.category === "psu" && positive(current.specs.wattageW)) {
    visit(PSU_WATTAGE_STEPS, current.specs.wattageW, (next, direction) => choose(available.filter((part) => part.specs.wattageW === next), direction, `${next}W 파워`));
    return result;
  }
  if (current.category === "case" && positive(current.specs.maxGpuLengthMm)) {
    // Case steps are physical space, never price or an invented game FPS tier.
    // Build the space ladder before fit filtering so an incompatible intermediate
    // size disables the action instead of silently selecting a much larger case.
    const steps = [...new Set(parts.filter((part) => part.category === "case" && positive(part.specs.maxGpuLengthMm)).map((part) => part.specs.maxGpuLengthMm!))].sort((a,b) => a-b);
    visit(steps, current.specs.maxGpuLengthMm, (next,direction) => choose(available.filter((part) => part.specs.maxGpuLengthMm === next), direction, `GPU 공간 ${next}mm 케이스`));
  }
  return result;
}

/** Release the whole dependency chain so adjusted pins cannot retain an old platform. */
export { gamingAdjustmentDependentCategories } from "./gaming-adjustment-dependencies";
