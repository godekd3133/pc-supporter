import type { AccessoryItem, AccessoryRecommendation, BuildSelection, Part } from "../shared/types";
import { isKnownPrice } from "../shared/types";
import { buildConnectivitySummaryFor } from "../shared/build-connectivity";
import { fanHubPowerInputFor, fanHubPortCountFor, rgbHubPortCountFor, rgbVoltageFor } from "./accessory-connectivity";
import { m2FormsOverlap, m2FormFactorsFor, normalizedM2FormFactor, storageAdapterConnectionLabel, storageAdapterKindFor, storageAdapterSupportFor } from "./accessory-compatibility";

function selectedPart(catalog: Part[], selection: BuildSelection["cpu"] | undefined) {
  return selection ? catalog.find((part) => part.id === selection.partId) : undefined;
}

function selectedParts(catalog: Part[], selections: BuildSelection["memory"]) {
  return selections
    .map((selection) => ({ selection, part: selectedPart(catalog, selection) }))
    .filter((entry): entry is { selection: (typeof selections)[number]; part: Part } => Boolean(entry.part));
}

function rawText(item: Part | AccessoryItem | undefined) {
  return item ? `${item.name} ${item.rawSpecText ?? ""}` : "";
}

function parseFanSizes(part: Part | undefined) {
  const sizes = [...rawText(part).matchAll(/(?:전면|후면|상단|하단|측면|팬\s*크기)\s*[:：]?\s*(\d{2,3})\s*mm/gi)]
    .map((match) => Number(match[1]))
    .filter((size) => size >= 80 && size <= 200);
  return [...new Set(sizes)];
}

function parseCaseFanCount(part: Part | undefined) {
  const structuredCount = part?.specs.fanCount;
  if (structuredCount !== undefined) return structuredCount;
  return Number(rawText(part).match(/쿨링팬\s*:\s*총\s*(\d+)개/i)?.[1] ?? NaN) || undefined;
}

function addRecommendations(
  output: AccessoryRecommendation[],
  items: AccessoryItem[],
  category: AccessoryItem["category"],
  reason: string,
  fitBasis: string,
  priority: AccessoryRecommendation["priority"],
  confidence: AccessoryRecommendation["confidence"],
  predicate: (item: AccessoryItem) => boolean,
  sort: (a: AccessoryItem, b: AccessoryItem) => number
) {
  items
    .filter((item) => item.category === category && item.dataQuality !== "incomplete" && isKnownPrice(item.priceWon) && predicate(item))
    .sort(sort)
    .slice(0, 3)
    .forEach((item, index) => {
      output.push({
        id: `${category}-${item.id}-${index}`,
        category,
        item,
        priority,
        confidence,
        reason,
        fitBasis
      });
    });
}

function priceAscending(a: AccessoryItem, b: AccessoryItem) {
  return (a.priceWon ?? Number.MAX_SAFE_INTEGER) - (b.priceWon ?? Number.MAX_SAFE_INTEGER);
}

export function recommendAccessories(build: BuildSelection, catalog: Part[], accessories: AccessoryItem[]): AccessoryRecommendation[] {
  const recommendations: AccessoryRecommendation[] = [];
  const cpu = selectedPart(catalog, build.cpu);
  const gpu = selectedPart(catalog, build.gpu);
  const motherboard = selectedPart(catalog, build.motherboard);
  const computerCase = selectedPart(catalog, build.case);
  const memories = selectedParts(catalog, build.memory);
  const ssds = selectedParts(catalog, build.ssd);
  const m2Count = ssds.reduce((total, { selection, part }) => total + (part.specs.formFactor?.toLowerCase().includes("m.2") ? selection.quantity : 0), 0);
  const selectedM2FormFactors = [...new Set(ssds
    .map(({ part }) => part.specs.formFactor)
    .filter((formFactor): formFactor is string => Boolean(formFactor && formFactor.toLowerCase().includes("m.2") && formFactor.toLowerCase() !== "m.2")))];
  const m2FitLabel = selectedM2FormFactors.length > 0 ? selectedM2FormFactors.join(" · ") : "M.2";
  const cpuPowerW = cpu?.specs.pptW ?? cpu?.specs.tdpW ?? 0;
  const gpuPowerW = gpu?.specs.powerW ?? 0;
  const gpuLengthMm = gpu?.specs.lengthMm;
  const gpuThicknessMm = gpu?.specs.thicknessMm;
  const connectivitySummary = buildConnectivitySummaryFor(motherboard?.specs, computerCase?.specs);
  const selectedMemoryTypes = [...new Set(memories
    .map(({ part }) => part.specs.memoryType)
    .filter((memoryType): memoryType is string => Boolean(memoryType)))];
  const selectedMemoryModuleCount = memories.reduce(
    (total, { selection, part }) => total + selection.quantity * (part.specs.memoryModuleCountPerKit ?? 1),
    0
  );
  const verifiedMemorySpeeds = memories
    .map(({ part }) => part.specs.speedMhz)
    .filter((speed): speed is number => speed !== undefined && Number.isFinite(speed) && speed > 0);
  const maxMemorySpeedMhz = verifiedMemorySpeeds.length > 0 ? Math.max(...verifiedMemorySpeeds) : undefined;
  const memoryCoolingTriggered = maxMemorySpeedMhz !== undefined
    && (maxMemorySpeedMhz >= 6000 || (maxMemorySpeedMhz >= 5600 && selectedMemoryModuleCount >= 4));
  const selectedM2InterfaceValues = ssds
    .filter(({ part }) => part.specs.formFactor?.toLowerCase().includes("m.2"))
    .map(({ part }) => part.specs.interface?.toLocaleLowerCase("ko-KR"))
  const selectedM2Interfaces = [...new Set(selectedM2InterfaceValues.filter((value): value is string => Boolean(value)))];
  const hasUnknownM2Interface = selectedM2InterfaceValues.some((value) => !value);
  const motherboardM2Slots = motherboard?.specs.m2Slots;
  const m2OverflowCount = motherboardM2Slots !== undefined ? Math.max(0, m2Count - motherboardM2Slots) : 0;

  if (m2Count > 0) {
    addRecommendations(
      recommendations,
      accessories,
      "m2_heatsink",
      `M.2 SSD ${m2Count}개를 사용 중입니다. SSD에 맞는 방열판을 추가하면 발열을 줄이는 데 도움이 될 수 있습니다.`,
      `선택한 SSD 규격 ${m2FitLabel}에 맞는 제품을 고르세요.`,
      "optional",
      "high",
      (item) => {
        const candidateFormFactors = [...new Set(
          [item.specs.formFactor, ...(item.specs.supportedFormFactors ?? [])]
            .filter((formFactor): formFactor is string => Boolean(formFactor && formFactor.toLowerCase().includes("m.2")))
        )];
        return candidateFormFactors.length > 0
          && (selectedM2FormFactors.length === 0 || candidateFormFactors.some((candidateFormFactor) => candidateFormFactor.toLowerCase() === "m.2"
            || selectedM2FormFactors.some((selectedFormFactor) => selectedFormFactor.toLowerCase() === candidateFormFactor.toLowerCase())));
      },
      priceAscending
    );
  }

  if (m2OverflowCount > 0) {
    const slotLabel = motherboardM2Slots === 0 ? "M.2 슬롯 0개" : `M.2 슬롯 ${motherboardM2Slots}개`;
    addRecommendations(
      recommendations,
      accessories,
      "storage_accessory",
      `M.2 SSD ${m2Count}개 중 ${m2OverflowCount}개를 연결할 자리가 부족합니다. 변환 어댑터로 연결할 수 있는지 확인하세요.`,
      `한 어댑터에 SSD ${m2OverflowCount}개 이상을 장착할 수 있고 연결 방식도 맞는 제품을 고르세요. 메인보드 PCIe 슬롯, 다른 부품과의 대역폭 공유, 부팅 지원도 확인하세요.`,
      "recommended",
      "medium",
      (item) => {
        const adapterKind = storageAdapterKindFor(item);
        if (!adapterKind) return false;
        const adapterStorageDeviceCount = item.specs.adapterStorageDeviceCount;
        if (adapterStorageDeviceCount === undefined || adapterStorageDeviceCount < m2OverflowCount) return false;
        if (hasUnknownM2Interface) return false;
        const candidateForms = m2FormFactorsFor(item);
        const formFactorMatches = candidateForms.length > 0
          && (selectedM2FormFactors.length === 0 || m2FormsOverlap(candidateForms, selectedM2FormFactors.map(normalizedM2FormFactor)));
        if (!formFactorMatches) return false;
        const support = storageAdapterSupportFor(item, adapterKind);
        return selectedM2Interfaces.length > 0 && selectedM2Interfaces.every((value) => value === "nvme" ? support.nvme : value === "sata" ? support.sata : false);
      },
      (a, b) => {
        const aKind = storageAdapterKindFor(a);
        const bKind = storageAdapterKindFor(b);
        const preferredKind = selectedM2Interfaces.includes("nvme") ? "pcie" : selectedM2Interfaces.includes("sata") ? "sata" : undefined;
        return (aKind === preferredKind ? 0 : 1) - (bKind === preferredKind ? 0 : 1)
          || (a.specs.adapterStorageDeviceCount ?? Number.MAX_SAFE_INTEGER) - (b.specs.adapterStorageDeviceCount ?? Number.MAX_SAFE_INTEGER)
          || priceAscending(a, b);
      }
    );
  }

  if (memoryCoolingTriggered) {
    const memorySpeedLabel = `${maxMemorySpeedMhz}MHz`;
    addRecommendations(
      recommendations,
      accessories,
      "memory_cooler",
      `RAM 속도 ${memorySpeedLabel}${selectedMemoryModuleCount >= 4 ? ` · 메모리 ${selectedMemoryModuleCount}개` : ""} 구성에서는 메모리 쿨링팬이 도움이 될 수 있습니다.`,
      "RAM 높이와 CPU 쿨러에 걸리지 않는지 확인하세요. 메모리 종류가 맞는지도 살펴보세요.",
      "optional",
      "medium",
      (item) => {
        const text = rawText(item);
        const compactText = text.toLocaleLowerCase("ko-KR").replace(/\s+/g, "");
        const hasMemorySignal = /(?:메모리|램\b|RAM\b|DDR\s*[2345]|DIMM)/i.test(text);
        const hasCoolingSignal = item.specs.fanCount !== undefined || /(?:팬|쿨링|cool)/i.test(text);
        const hasSelectedMemoryType = selectedMemoryTypes.length === 0
          || selectedMemoryTypes.some((memoryType) => compactText.includes(memoryType.toLocaleLowerCase("ko-KR").replace(/\s+/g, "")));
        const hasOtherDdrType = /DDR\s*[2345]/i.test(text) && !hasSelectedMemoryType;
        return hasMemorySignal && hasCoolingSignal && !hasOtherDdrType;
      },
      (a, b) => (b.specs.fanCount ?? 0) - (a.specs.fanCount ?? 0) || priceAscending(a, b)
    );
  }

  if ((gpuLengthMm !== undefined && gpuLengthMm >= 300) || (gpuThicknessMm !== undefined && gpuThicknessMm >= 55)) {
    const gpuShape = gpuLengthMm !== undefined ? `길이 ${gpuLengthMm}mm` : `두께 ${gpuThicknessMm}mm`;
    addRecommendations(
      recommendations,
      accessories,
      "gpu_support",
      `그래픽카드 ${gpuShape}라 처짐 방지를 위한 지지대가 유용할 수 있습니다.`,
      "그래픽카드가 길거나 두꺼우면 지지대가 도움이 될 수 있습니다. 케이스 안에 들어가는지도 확인하세요.",
      "recommended",
      "medium",
      () => true,
      priceAscending
    );
  }

  if (gpuPowerW >= 300 || (gpuThicknessMm !== undefined && gpuThicknessMm >= 55)) {
    const gpuLoadLabel = gpuPowerW >= 300 ? `전력 ${gpuPowerW}W` : `두께 ${gpuThicknessMm}mm`;
    addRecommendations(
      recommendations,
      accessories,
      "gpu_cooler",
      `그래픽카드 ${gpuLoadLabel} 구성입니다. 그래픽카드용 추가 냉각 제품을 살펴볼 수 있습니다.`,
      "그래픽카드 쿨러를 바꾸는 제품은 아닙니다. 주변 슬롯을 가리는지, 팬 크기와 케이스 통풍에 맞는지 확인하세요.",
      "optional",
      "medium",
      (item) => {
        const text = rawText(item);
        return /(?:그래픽\s*카드|그래픽카드|GPU|VGA|PCI\s*슬롯)/i.test(text)
          && (item.specs.fanCount !== undefined || /(?:쿨러|쿨링|냉각|fan|팬)/i.test(text));
      },
      (a, b) => (b.specs.fanCount ?? 0) - (a.specs.fanCount ?? 0) || priceAscending(a, b)
    );
  }

  const fanSizes = parseFanSizes(computerCase);
  const caseFanCount = parseCaseFanCount(computerCase);
  if (fanSizes.length > 0) {
    const sizeLabel = fanSizes.map((size) => `${size}mm`).join("·");
    const fanPriority: AccessoryRecommendation["priority"] = caseFanCount === undefined || caseFanCount < 4 ? "recommended" : "optional";
    addRecommendations(
      recommendations,
      accessories,
      "cooling_fan",
      `케이스에 ${sizeLabel} 팬을 장착할 수 있습니다. 통풍을 보완하거나 기존 팬을 바꿀 때 참고하세요.`,
      `케이스에 맞는 ${sizeLabel} 팬을 고르세요.`,
      fanPriority,
      "high",
      (item) => item.specs.lengthMm === undefined || fanSizes.includes(item.specs.lengthMm),
      (a, b) => {
        const aMatch = a.specs.lengthMm !== undefined && fanSizes.includes(a.specs.lengthMm) ? 0 : 1;
        const bMatch = b.specs.lengthMm !== undefined && fanSizes.includes(b.specs.lengthMm) ? 0 : 1;
        return aMatch - bMatch || priceAscending(a, b);
      }
    );
  }

  if (cpu || build.cooler) {
    addRecommendations(
      recommendations,
      accessories,
      "thermal_grease",
      "CPU 쿨러를 처음 달거나 다시 달 때 써멀그리스를 사용할 수 있습니다.",
      "부품 교체용이 아니라 조립·정비에 쓰는 제품입니다.",
      "optional",
      "low",
      (item) => !/(conductonaut|liquid\s*metal|액체\s*금속|리퀴드\s*메탈|전도성)/i.test(`${item.name} ${item.rawSpecText ?? ""}`),
      (a, b) => (b.specs.thermalConductivityWmK ?? 0) - (a.specs.thermalConductivityWmK ?? 0) || priceAscending(a, b)
    );
  }

  const expectedLoadW = cpuPowerW + gpuPowerW;
  if (expectedLoadW > 0) {
    const targetOutputW = Math.ceil(expectedLoadW * 1.25);
    addRecommendations(
      recommendations,
      accessories,
      "ups",
      `확인된 CPU·그래픽카드 전력 합계는 ${expectedLoadW}W입니다. 정전이나 순간 전압 변화에 대비할 UPS를 살펴보세요.`,
      `출력 ${targetOutputW}W 이상인 제품을 골라보세요. 모니터와 주변기기 전력도 따로 더해야 합니다.`,
      "optional",
      "medium",
      (item) => item.specs.outputW !== undefined && item.specs.outputW >= targetOutputW,
      (a, b) => (a.specs.outputW ?? Number.MAX_SAFE_INTEGER) - (b.specs.outputW ?? Number.MAX_SAFE_INTEGER) || priceAscending(a, b)
    );
  }

  const fanPortCount = motherboard?.specs.fanPortCount;
  const fanHeaderDeficit = caseFanCount !== undefined && fanPortCount !== undefined
    ? Math.max(0, caseFanCount - fanPortCount)
    : 0;
  if (fanHeaderDeficit > 0 && caseFanCount !== undefined && fanPortCount !== undefined) {
    const requiredFanCount = caseFanCount;
    addRecommendations(
      recommendations,
      accessories,
      "fan_hub",
      `케이스 기본 팬 ${caseFanCount}개 중 ${fanHeaderDeficit}개는 메인보드에 바로 연결하기 어렵습니다. 팬 허브를 살펴보세요.`,
      `팬 ${requiredFanCount}개를 연결할 수 있고 SATA·IDE·Molex 전원을 쓰는 제품만 표시합니다.`,
      "recommended",
      "high",
      (item) => (fanHubPortCountFor(item) ?? 0) >= requiredFanCount && fanHubPowerInputFor(item) !== undefined,
      (a, b) => (fanHubPortCountFor(a) ?? Number.MAX_SAFE_INTEGER) - (fanHubPortCountFor(b) ?? Number.MAX_SAFE_INTEGER) || priceAscending(a, b)
    );
  } else if (caseFanCount !== undefined && caseFanCount >= 5) {
    const requiredFanCount = caseFanCount;
    addRecommendations(
      recommendations,
      accessories,
      "fan_hub",
      `케이스 기본 팬이 ${caseFanCount}개입니다. 한꺼번에 연결하려면 팬 허브가 필요할 수 있습니다.`,
      `팬 ${caseFanCount}개를 연결할 수 있고 SATA·IDE·Molex 전원을 쓰는 제품을 골라보세요.`,
      "optional",
      "medium",
      (item) => (fanHubPortCountFor(item) ?? 0) >= requiredFanCount && fanHubPowerInputFor(item) !== undefined,
      (a, b) => (fanHubPortCountFor(a) ?? Number.MAX_SAFE_INTEGER) - (fanHubPortCountFor(b) ?? Number.MAX_SAFE_INTEGER) || priceAscending(a, b)
    );
  }

  const caseRgbDeviceCount = computerCase?.specs.rgbDeviceCount;
  const caseRgbVoltage = computerCase?.specs.rgbDeviceVoltage;
  const rgbConnectivity = connectivitySummary.items.filter((item) => item.id === "rgb-headers" || item.id === "rgb-voltage");
  const rgbNeedsController = computerCase?.specs.rgbControllerIncluded !== true
    && caseRgbDeviceCount !== undefined
    && caseRgbDeviceCount > 0
    && caseRgbVoltage !== undefined
    && rgbConnectivity.some((item) => item.status === "review");
  if (rgbNeedsController && caseRgbDeviceCount !== undefined && caseRgbVoltage !== undefined) {
    const requiredRgbDeviceCount = caseRgbDeviceCount;
    const requiredVoltages = caseRgbVoltage === "mixed" ? ["5V", "12V"] : [caseRgbVoltage];
    addRecommendations(
      recommendations,
      accessories,
      "fan_hub",
      `케이스 RGB 장치 ${caseRgbDeviceCount}개를 연결할 ${requiredVoltages.join(" + ")} 단자가 부족할 수 있습니다. RGB 컨트롤러가 필요할 수 있습니다.`,
      `${requiredVoltages.join(" + ")}을 지원하고 RGB 장치 ${requiredRgbDeviceCount}개를 연결할 수 있는 제품만 표시합니다. 외부 전원 연결도 확인하세요.`,
      "recommended",
      "high",
      (item) => {
        const candidateVoltage = rgbVoltageFor(item);
        const candidatePortCount = rgbHubPortCountFor(item);
        return candidateVoltage !== undefined
          && candidatePortCount !== undefined
          && candidatePortCount >= requiredRgbDeviceCount
          && fanHubPowerInputFor(item) !== undefined
          && (candidateVoltage === "mixed" || requiredVoltages.every((voltage) => candidateVoltage === voltage));
      },
      (a, b) => (rgbHubPortCountFor(a) ?? Number.MAX_SAFE_INTEGER) - (rgbHubPortCountFor(b) ?? Number.MAX_SAFE_INTEGER) || priceAscending(a, b)
    );
  }

  return recommendations;
}
