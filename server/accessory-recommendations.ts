import type { AccessoryItem, AccessoryRecommendation, BuildSelection, Part } from "../shared/types";
import { isKnownPrice } from "../shared/types";
import { buildConnectivitySummaryFor } from "../shared/build-connectivity";
import { fanHubPowerInputFor, fanHubPortCountFor, rgbHubPortCountFor, rgbVoltageFor } from "./accessory-connectivity";

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

  if (m2Count > 0) {
    addRecommendations(
      recommendations,
      accessories,
      "m2_heatsink",
      `M.2 SSD ${m2Count}개를 선택해 발열 관리를 위한 방열판 선택지를 제안합니다.`,
      `선택한 SSD 규격 ${m2FitLabel}과 일치하거나 규격이 일반 M.2로 표시된 후보를 우선합니다.`,
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

  if ((gpuLengthMm !== undefined && gpuLengthMm >= 300) || (gpuThicknessMm !== undefined && gpuThicknessMm >= 55)) {
    const gpuShape = gpuLengthMm !== undefined ? `길이 ${gpuLengthMm}mm` : `두께 ${gpuThicknessMm}mm`;
    addRecommendations(
      recommendations,
      accessories,
      "gpu_support",
      `그래픽카드 ${gpuShape}라 처짐 방지를 위한 지지대가 유용할 수 있습니다.`,
      "그래픽카드 길이·두께 기준으로 지지대 필요성을 판단한 선택지이며, 케이스 내부 간섭은 조립 전에 확인해야 합니다.",
      "recommended",
      "medium",
      () => true,
      priceAscending
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
      `케이스 원문에서 ${sizeLabel} 팬 장착 규격이 확인되어 추가·교체 흡·배기 팬 선택지를 제안합니다.`,
      `케이스 원문 팬 규격 ${sizeLabel}과 일치하는 팬 크기를 우선합니다.`,
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
      "CPU 쿨러 장착·재장착 때 사용할 수 있는 써멀그리스 소모품 선택지입니다.",
      "호환 부품 교체가 아니라 조립·정비 보완용 제품으로 제안합니다.",
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
      `확인된 CPU·GPU 전력 합계 ${expectedLoadW}W 기준으로 정전·순간전압 보호용 UPS를 제안합니다.`,
      `UPS 출력 ${targetOutputW}W 이상 후보를 우선하며, 실제 모니터·주변기기 소비전력은 별도로 더해야 합니다.`,
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
      `케이스 기본 팬 ${caseFanCount}개와 메인보드 팬 헤더 ${fanPortCount}개를 비교해 직접 연결이 ${fanHeaderDeficit}개 부족할 수 있어 팬 허브·컨트롤러를 제안합니다.`,
      `팬 허브 분배 포트 ${requiredFanCount}개 이상과 외부 전원 입력(SATA/IDE/Molex)을 원문에서 확인한 후보만 표시합니다.`,
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
      `케이스에 기본 팬 ${caseFanCount}개가 확인되어 팬 허브·컨트롤러를 제안합니다.`,
      `팬 분배 포트 ${caseFanCount}개 이상과 외부 전원 입력(SATA/IDE/Molex)이 확인된 허브를 우선합니다.`,
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
      `케이스 RGB 장치 ${caseRgbDeviceCount}개에 필요한 ${requiredVoltages.join(" + ")} 연결 여유가 부족할 수 있어 전용 RGB 컨트롤러를 제안합니다.`,
      `필요 전압 ${requiredVoltages.join(" + ")}을 지원하고 RGB 분배 포트 ${requiredRgbDeviceCount}개 이상, 외부 전원 입력까지 확인된 후보만 표시합니다.`,
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
