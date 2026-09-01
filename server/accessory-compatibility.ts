import type { AccessoryCompatibilityFinding, AccessoryCompatibilityResult, AccessoryConnectivityPlan, AccessoryFanHubTargetRecommendation, AccessoryItem, AccessorySelection, BuildSelection, Part } from "../shared/types";
import { fanHubConnectionPlanFor, fanHubPowerInputFor, fanHubPortCountFor, hasRgbControllerEvidenceFor, rgbControllerConnectionPlanFor, rgbHubPortCountFor, rgbVoltageFor } from "./accessory-connectivity";
import { rgbFanDeviceCountFor, rgbFanVoltageFor } from "../shared/rgb-connectivity";

function selectedPart(catalog: Part[], partId: string | undefined) {
  return partId ? catalog.find((part) => part.id === partId) : undefined;
}

function rawText(item: Part | AccessoryItem | undefined) {
  return item ? `${item.name} ${item.rawSpecText ?? ""}` : "";
}

function caseFanSizesFor(computerCase: Part | undefined) {
  const sizes = [...rawText(computerCase).matchAll(/(?:전면|후면|상단|하단|측면|팬\s*크기)\s*[:：]?\s*(\d{2,3})\s*mm/gi)]
    .map((match) => Number(match[1]))
    .filter((size) => size >= 80 && size <= 200);
  return [...new Set(sizes)];
}

function caseFanCountFor(computerCase: Part | undefined) {
  const structuredCount = computerCase?.specs.fanCount;
  if (structuredCount !== undefined) return structuredCount;
  const parsedCount = Number(rawText(computerCase).match(/쿨링팬\s*:\s*총\s*(\d+)개/i)?.[1] ?? NaN);
  return Number.isFinite(parsedCount) && parsedCount > 0 ? parsedCount : undefined;
}

function accessoryFanSizeFor(item: AccessoryItem) {
  if (item.specs.lengthMm !== undefined) return item.specs.lengthMm;
  if (item.specs.widthMm !== undefined) return item.specs.widthMm;
  const parsedSize = Number(rawText(item).match(/(?:팬\s*크기|크기)\s*[:：]?\s*(\d{2,3})\s*mm/i)?.[1] ?? NaN);
  return Number.isFinite(parsedSize) && parsedSize >= 80 && parsedSize <= 200 ? parsedSize : undefined;
}

function normalizedM2FormFactor(value: string | undefined) {
  return value?.toLocaleLowerCase("ko-KR").replace(/[\s._-]/g, "") ?? "";
}

function m2FormFactorsFor(item: AccessoryItem | Part | undefined) {
  if (!item) return [];
  return [...new Set([item.specs.formFactor, ...(item.specs.supportedFormFactors ?? [])]
    .map(normalizedM2FormFactor)
    .filter((value) => value.startsWith("m2")))];
}

function m2FormFactorLabelsFor(item: AccessoryItem | Part | undefined) {
  if (!item) return [];
  return [...new Set([item.specs.formFactor, ...(item.specs.supportedFormFactors ?? [])]
    .filter((value): value is string => Boolean(value && normalizedM2FormFactor(value).startsWith("m2"))))];
}

function m2FormsOverlap(candidateForms: string[], selectedForms: string[]) {
  return candidateForms.some((candidate) => candidate === "m2" || selectedForms.some((selected) => selected === "m2" || selected === candidate));
}

function storageAdapterKindFor(item: AccessoryItem) {
  const text = rawText(item);
  if (!/m\.2/i.test(text)) return undefined;
  if (/m\.2[^/]{0,100}(?:→|to|->)\s*pci[- ]?e/i.test(text)) return "pcie" as const;
  if (item.specs.interface === "SATA" && /m\.2[^/]{0,100}(?:→|to|->)\s*(?:sata|2\.5)/i.test(text)) return "sata" as const;
  return undefined;
}

function storageAdapterSupportFor(item: AccessoryItem, kind: "pcie" | "sata") {
  const text = rawText(item);
  if (kind === "sata") return { nvme: false, sata: true };
  return {
    nvme: item.specs.interface === "NVMe" || /NVMe/i.test(text),
    sata: item.specs.interface === "SATA" || /SATA|NGFF/i.test(text)
  };
}

function storageAdapterConnectionLabel(kind: "pcie" | "sata") {
  return kind === "pcie" ? "M.2 → PCIe" : "M.2 → SATA/2.5형";
}

type SelectedM2Entry = { selection: BuildSelection["ssd"][number]; part: Part };

function targetM2SelectionsFor(selection: AccessorySelection, selectedM2: SelectedM2Entry[]) {
  if (!selection.targetPartId) return selectedM2;
  const target = selectedM2.find(({ part }) => part.id === selection.targetPartId);
  return target ? [target] : undefined;
}

function addFinding(
  findings: AccessoryCompatibilityFinding[],
  selection: AccessorySelection,
  item: AccessoryItem,
  relatedPartIds: string[],
  finding: Omit<AccessoryCompatibilityFinding, "id" | "accessoryId" | "accessoryName" | "relatedPartIds">
) {
  findings.push({
    ...finding,
    id: `${finding.ruleId}-${item.id}-${findings.length + 1}`,
    accessoryId: selection.accessoryId,
    accessoryName: item.name,
    relatedPartIds
  });
}

function combinedRgbVoltageFor(caseDeviceCount: number | undefined, caseVoltage: "5V" | "12V" | "mixed" | undefined, rgbFans: Array<{ count: number; voltage?: "5V" | "12V" | "mixed" }>) {
  const voltages = new Set<"5V" | "12V">();
  let unknown = false;
  const addVoltage = (count: number | undefined, voltage: "5V" | "12V" | "mixed" | undefined) => {
    if (!count || count <= 0) return;
    if (!voltage) {
      unknown = true;
      return;
    }
    if (voltage === "mixed") {
      voltages.add("5V");
      voltages.add("12V");
    } else {
      voltages.add(voltage);
    }
  };
  addVoltage(caseDeviceCount, caseVoltage);
  for (const fan of rgbFans) addVoltage(fan.count, fan.voltage);
  if (unknown || voltages.size === 0) return undefined;
  return voltages.size > 1 ? "mixed" as const : [...voltages][0];
}

function fanHubTargetRecommendationFor(fan: { selection: AccessorySelection; item: AccessoryItem }, selectedFanHubs: Array<{ selection: AccessorySelection; item: AccessoryItem }>, fansByHub: Map<string, Array<{ selection: AccessorySelection; item: AccessoryItem }>>): AccessoryFanHubTargetRecommendation {
  const fanCount = (fan.item.specs.fanCount ?? 1) * fan.selection.quantity;
  const candidates = selectedFanHubs.map(({ item: hub }) => {
    const plan = fanHubConnectionPlanFor(hub, [...(fansByHub.get(hub.id) ?? []), fan]);
    const blocked = plan.portIssue === "over_limit" || plan.connectorIssue === "molex_mismatch" || plan.currentIssue === "over_limit";
    const status = blocked ? "blocked" as const : plan.status;
    const portHeadroom = plan.hubFanPortCount !== undefined ? plan.hubFanPortCount - plan.fanCount : undefined;
    const score = (plan.portIssue === "none" ? 3 : plan.portIssue === "unknown" ? 0 : -8)
      + (plan.connectorIssue === "none" ? 3 : plan.connectorIssue === "control_mode" ? 1 : -8)
      + (plan.currentIssue === "none" ? 2 : plan.currentIssue === "unknown" ? 0 : -8)
      + (plan.externalPower ? 1 : 0)
      + (portHeadroom !== undefined ? Math.min(20, Math.max(0, portHeadroom)) / 100 : 0);
    const reason = [
      plan.portIssue === "none" ? `포트 여유 ${portHeadroom}개` : plan.portIssue === "over_limit" ? "포트 부족" : "포트 수 확인 필요",
      plan.connectorIssue === "none" ? "커넥터 일치" : plan.connectorIssue === "control_mode" ? "제어 방식 확인 필요" : plan.connectorIssue === "molex_mismatch" ? "커넥터 불일치" : "커넥터 확인 필요",
      plan.currentIssue === "none" ? "전류 범위 확인" : plan.currentIssue === "over_limit" ? "전류 초과" : "전류 확인 필요",
      plan.externalPower ? `외부 전원 ${plan.externalPower}` : "외부 전원 확인 필요"
    ].join(" · ");
    return {
      hubId: hub.id,
      hubName: hub.name,
      status,
      score,
      ...(portHeadroom !== undefined ? { portHeadroom } : {}),
      connectorStatus: plan.connectorStatus,
      currentStatus: plan.currentStatus,
      ...(plan.externalPower ? { externalPower: plan.externalPower } : {}),
      reason
    };
  }).sort((left, right) => right.score - left.score || left.hubName.localeCompare(right.hubName, "ko-KR"));
  const viableCandidates = candidates.filter((candidate) => candidate.status !== "blocked");
  const uniqueTopCandidate = viableCandidates.length > 0 && (viableCandidates.length === 1 || viableCandidates[0].score > viableCandidates[1].score);
  const suggestedHubId = uniqueTopCandidate
    ? viableCandidates[0].hubId
    : undefined;
  const recommendedHubId = suggestedHubId && viableCandidates[0].status === "pass" ? suggestedHubId : undefined;
  return {
    fanId: fan.item.id,
    fanName: fan.item.name,
    fanCount,
    ...(recommendedHubId ? { recommendedHubId } : {}),
    ...(suggestedHubId ? { suggestedHubId } : {}),
    candidates,
    summary: recommendedHubId
      ? `포트·커넥터·전류 근거가 모두 확인된 ${candidates.find((candidate) => candidate.hubId === recommendedHubId)?.hubName ?? "허브"}를 우선 연결 후보로 제안합니다.`
      : suggestedHubId
        ? `${candidates.find((candidate) => candidate.hubId === suggestedHubId)?.hubName ?? "허브"}가 현재 배치에서 우선 확인할 후보입니다. 전류 근거가 없으면 최종 안전성을 확정하지 않습니다.`
      : candidates.some((candidate) => candidate.status !== "blocked")
        ? "차단되지 않은 허브 후보가 있지만 전류·포트·커넥터 근거를 추가로 확인해야 합니다."
        : "현재 선택한 허브 중 추가 팬을 안전하게 배치할 후보를 확인하지 못했습니다."
  };
}

export function accessoryCompatibilityFor(build: BuildSelection, catalog: Part[], accessories: AccessoryItem[]): AccessoryCompatibilityResult {
  const findings: AccessoryCompatibilityFinding[] = [];
  const accessoryMap = new Map(accessories.map((item) => [item.id, item]));
  const cpu = selectedPart(catalog, build.cpu?.partId);
  const gpu = selectedPart(catalog, build.gpu?.partId);
  const computerCase = selectedPart(catalog, build.case?.partId);
  const motherboard = selectedPart(catalog, build.motherboard?.partId);
  const allSelectedM2 = build.ssd
    .map((selection) => ({ selection, part: selectedPart(catalog, selection.partId) }))
    .filter((entry): entry is { selection: BuildSelection["ssd"][number]; part: Part } => Boolean(entry.part && entry.part.specs.formFactor?.toLocaleLowerCase("ko-KR").includes("m.2")));
  const caseFanSizes = caseFanSizesFor(computerCase);
  const caseFanCount = caseFanCountFor(computerCase);
  const cpuPowerW = cpu?.specs.pptW ?? cpu?.specs.tdpW;
  const gpuPowerW = gpu?.specs.powerW;
  const knownSystemPowerW = [cpuPowerW, gpuPowerW].filter((power): power is number => power !== undefined).reduce((total, power) => total + power, 0);
  const powerBasisPartIds = [cpu?.id, gpu?.id].filter((partId): partId is string => Boolean(partId));
  const selectedAccessoryEntries = (build.accessories ?? [])
    .map((selection) => ({ selection, item: accessoryMap.get(selection.accessoryId) }))
    .filter((entry): entry is { selection: AccessorySelection; item: AccessoryItem } => Boolean(entry.item));
  const selectedCoolingFans = selectedAccessoryEntries.filter(({ item }) => item.category === "cooling_fan");
  const selectedFanHubs = selectedAccessoryEntries.filter(({ item }) => item.category === "fan_hub");
  const caseRgbDeviceCount = computerCase?.specs.rgbDeviceCount;
  const selectedRgbFans = selectedCoolingFans.map(({ selection, item }) => ({
    selection,
    item,
    count: rgbFanDeviceCountFor(item) ?? 0,
    voltage: rgbFanVoltageFor(item)
  })).filter(({ count }) => count > 0);
  const additionalRgbFanDeviceCount = selectedRgbFans.reduce((total, fan) => total + fan.count * fan.selection.quantity, 0);
  const rgbDeviceCount = caseRgbDeviceCount === undefined && additionalRgbFanDeviceCount === 0
    ? undefined
    : (caseRgbDeviceCount ?? 0) + additionalRgbFanDeviceCount;
  const rgbDeviceVoltage = rgbDeviceCount !== undefined
    ? combinedRgbVoltageFor(caseRgbDeviceCount, computerCase?.specs.rgbDeviceVoltage, selectedRgbFans.map((fan) => ({ count: fan.count * fan.selection.quantity, voltage: fan.voltage })))
    : undefined;
  const rgbDeviceSources = [
    ...(caseRgbDeviceCount !== undefined && caseRgbDeviceCount > 0 && computerCase ? [{
      id: computerCase.id,
      name: computerCase.name,
      kind: "case" as const,
      count: caseRgbDeviceCount,
      voltage: computerCase.specs.rgbDeviceVoltage,
      perDeviceCurrentA: computerCase.specs.rgbDeviceCurrentA,
      perDevicePowerW: computerCase.specs.rgbDevicePowerW
    }] : []),
    ...selectedRgbFans.map((fan) => ({
      id: fan.item.id,
      name: fan.item.name,
      kind: "cooling_fan" as const,
      count: fan.count * fan.selection.quantity,
      voltage: fan.voltage,
      perDeviceCurrentA: fan.item.specs.rgbDeviceCurrentA,
      perDevicePowerW: fan.item.specs.rgbDevicePowerW
    }))
  ];
  const rgbDeviceLoad = {
    perDeviceCurrentA: selectedRgbFans.length === 0 ? computerCase?.specs.rgbDeviceCurrentA : undefined,
    perDevicePowerW: selectedRgbFans.length === 0 ? computerCase?.specs.rgbDevicePowerW : undefined,
    caseDeviceCount: caseRgbDeviceCount,
    additionalFanDeviceCount: additionalRgbFanDeviceCount > 0 ? additionalRgbFanDeviceCount : undefined,
    devices: rgbDeviceSources,
    provenance: selectedRgbFans.length === 0 ? computerCase?.specs.rgbDeviceLoadProvenance : undefined
  };
  const rgbCapableFanHubs = selectedFanHubs.filter(({ item }) => hasRgbControllerEvidenceFor(item));
  const explicitRgbController = build.rgbControllerAccessoryId ? selectedFanHubs.find(({ selection }) => selection.accessoryId === build.rgbControllerAccessoryId) : undefined;
  const explicitRgbControllerValid = Boolean(explicitRgbController && hasRgbControllerEvidenceFor(explicitRgbController.item));
  const implicitRgbController = !build.rgbControllerAccessoryId && rgbCapableFanHubs.length === 1 ? rgbCapableFanHubs[0] : undefined;
  const activeRgbControllerId = explicitRgbControllerValid
    ? explicitRgbController!.selection.accessoryId
    : implicitRgbController?.selection.accessoryId;
  const rgbTargetNeedsSelection = rgbDeviceCount !== undefined
    && rgbDeviceCount > 0
    && (build.rgbControllerAccessoryId ? !explicitRgbControllerValid : rgbCapableFanHubs.length > 1);
  const rgbConnectionPlans: NonNullable<AccessoryCompatibilityResult["rgbConnectionPlans"]> = [];

  for (const selection of build.accessories ?? []) {
    const item = accessoryMap.get(selection.accessoryId);
    if (!item) {
      findings.push({
        id: `accessory-missing-${selection.accessoryId}-${findings.length + 1}`,
        ruleId: "accessory-selection",
        severity: "unknown",
        accessoryId: selection.accessoryId,
        accessoryName: selection.accessoryId,
        relatedPartIds: [],
        title: "선택한 주변 부품 정보를 확인할 수 없습니다.",
        message: "저장된 주변 부품 ID가 현재 액세서리 카탈로그에 없어 호환 여부를 확정할 수 없습니다.",
        facts: [{ label: "주변 부품 ID", actual: selection.accessoryId }],
        action: "주변 부품 목록을 다시 확인하세요."
      });
      continue;
    }

    const isM2RelatedAccessory = item.category === "m2_heatsink" || (item.category === "storage_accessory" && storageAdapterKindFor(item) !== undefined);
    const targetedM2 = isM2RelatedAccessory ? targetM2SelectionsFor(selection, allSelectedM2) : allSelectedM2;
    if (isM2RelatedAccessory && targetedM2 === undefined) {
      addFinding(findings, selection, item, [], {
        ruleId: "accessory-m2-target",
        severity: "unknown",
        title: "주변 부품의 연결 대상 SSD를 찾을 수 없습니다.",
        message: "지정한 연결 대상 SSD가 현재 견적에 없거나 M.2 SSD가 아니어서 주변 부품 호환을 확정할 수 없습니다.",
        facts: [{ label: "지정한 대상 SSD", actual: selection.targetPartId ?? "확인 필요" }],
        action: "현재 선택한 M.2 SSD를 연결 대상으로 다시 지정하세요."
      });
      continue;
    }
    const selectedM2 = targetedM2 ?? [];
    const selectedM2Count = selectedM2.reduce((total, entry) => total + entry.selection.quantity, 0);
    const selectedM2Forms = [...new Set(selectedM2.flatMap(({ part }) => m2FormFactorsFor(part)))];

    if (item.category === "storage_accessory") {
      const adapterKind = storageAdapterKindFor(item);
      if (adapterKind) {
        const adapterForms = m2FormFactorsFor(item);
        const adapterSupport = storageAdapterSupportFor(item, adapterKind);
        const selectedInterfaces = [...new Set(selectedM2.map(({ part }) => part.specs.interface?.toLocaleLowerCase("ko-KR")))];
        const selectedInterfaceLabels = selectedInterfaces.filter((value): value is string => Boolean(value)).map((value) => value === "nvme" ? "NVMe" : value.toUpperCase());
        const supportedInterfaceLabels = [adapterSupport.nvme ? "NVMe" : undefined, adapterSupport.sata ? "SATA" : undefined].filter((value): value is string => Boolean(value));
        if (selectedM2Count === 0) {
          addFinding(findings, selection, item, [], {
            ruleId: "accessory-storage-adapter",
            severity: "unknown",
            title: "M.2 변환 어댑터를 확인할 대상 SSD가 없습니다.",
            message: "현재 견적에 M.2 SSD가 없어 변환 어댑터의 연결 타입·길이 규격을 비교할 수 없습니다.",
            facts: [
              { label: "어댑터 연결 방식", actual: storageAdapterConnectionLabel(adapterKind) },
              { label: "선택한 M.2 SSD", expected: "확인 필요" }
            ],
            action: "대상 M.2 SSD와 메인보드 연결 조건을 선택한 뒤 다시 확인하세요."
          });
        } else if (adapterForms.length === 0 || selectedM2Forms.length === 0 || selectedInterfaces.length !== selectedM2.length) {
          addFinding(findings, selection, item, selectedM2.map(({ part }) => part.id), {
            ruleId: "accessory-storage-adapter",
            severity: "unknown",
            title: "M.2 변환 어댑터와 SSD의 연결 규격을 확정할 수 없습니다.",
            message: "어댑터 또는 선택한 SSD의 폼팩터·인터페이스 정보가 부족해 실제 연결 가능 여부를 확정할 수 없습니다.",
            facts: [
              { label: "어댑터 연결 방식", actual: storageAdapterConnectionLabel(adapterKind) },
              { label: "어댑터 지원 규격", expected: m2FormFactorLabelsFor(item).join(" · ") || "확인 필요" },
              { label: "선택한 SSD 규격", actual: selectedM2.map(({ part }) => part.specs.formFactor ?? part.name).join(" · ") },
              { label: "지원 인터페이스", expected: supportedInterfaceLabels.join(" · ") || "확인 필요" }
            ],
            action: "어댑터 원문에서 M.2 Key·길이·NVMe/SATA 지원 여부를 확인하세요."
          });
        } else if (!m2FormsOverlap(adapterForms, selectedM2Forms)) {
          addFinding(findings, selection, item, selectedM2.map(({ part }) => part.id), {
            ruleId: "accessory-storage-adapter",
            severity: "warning",
            title: "M.2 변환 어댑터 길이 규격이 선택한 SSD와 다릅니다.",
            message: `현재 선택한 M.2 SSD와 함께 사용할 경우 ${storageAdapterConnectionLabel(adapterKind)} 어댑터의 지원 길이가 맞지 않습니다.`,
            facts: [
              { label: "선택한 SSD 규격", actual: selectedM2.map(({ part }) => part.specs.formFactor ?? part.name).join(" · ") },
              { label: "어댑터 지원 규격", expected: m2FormFactorLabelsFor(item).join(" · ") || "확인 필요" }
            ],
            action: "대상 SSD 길이를 지원하는 어댑터인지 확인하거나 다른 어댑터를 선택하세요."
          });
        } else if (supportedInterfaceLabels.length === 0) {
          addFinding(findings, selection, item, selectedM2.map(({ part }) => part.id), {
            ruleId: "accessory-storage-adapter",
            severity: "unknown",
            title: "M.2 변환 어댑터의 지원 인터페이스를 확인할 수 없습니다.",
            message: "어댑터 연결 방식은 확인됐지만 NVMe/SATA 지원 여부가 원문에 없어 선택 SSD와의 신호 호환을 확정할 수 없습니다.",
            facts: [
              { label: "선택한 SSD 인터페이스", actual: selectedInterfaceLabels.join(" · ") },
              { label: "어댑터 지원 인터페이스", expected: "확인 필요" }
            ],
            action: "어댑터 원문에서 NVMe/SATA 지원 신호를 확인하세요."
          });
        } else if (selectedInterfaces.some((value) => value === "nvme" && !adapterSupport.nvme) || selectedInterfaces.some((value) => value === "sata" && !adapterSupport.sata)) {
          addFinding(findings, selection, item, selectedM2.map(({ part }) => part.id), {
            ruleId: "accessory-storage-adapter",
            severity: "warning",
            title: "M.2 변환 어댑터의 인터페이스가 선택한 SSD와 다릅니다.",
            message: `현재 선택한 SSD와 함께 사용할 경우 ${storageAdapterConnectionLabel(adapterKind)} 어댑터가 해당 NVMe/SATA 신호를 지원하지 않을 수 있습니다.`,
            facts: [
              { label: "선택한 SSD 인터페이스", actual: selectedInterfaceLabels.join(" · ") },
              { label: "어댑터 지원 인터페이스", expected: supportedInterfaceLabels.join(" · ") || "확인 필요" }
            ],
            action: "M.2 Key와 NVMe/SATA 지원 여부를 제조사 원문에서 확인하세요."
          });
        }
      }
    }

    if (item.category === "m2_heatsink") {
      if (selectedM2Count === 0) {
        addFinding(findings, selection, item, [], {
          ruleId: "accessory-m2-heatsink-form-factor",
          severity: "unknown",
          title: "M.2 방열판을 확인할 선택 SSD가 없습니다.",
          message: "현재 견적에 M.2 SSD가 없거나 규격을 확인할 수 없어 방열판의 적용 대상을 확정할 수 없습니다.",
          facts: [
            { label: "선택한 M.2 SSD", expected: "확인 필요" },
            { label: "방열판 지원 규격", expected: m2FormFactorLabelsFor(item).join(" · ") || "확인 필요" }
          ],
          action: "M.2 SSD를 선택한 뒤 방열판 규격을 다시 확인하세요."
        });
      } else {
        const candidateForms = m2FormFactorsFor(item);
        if (candidateForms.length === 0 || selectedM2Forms.length === 0) {
        addFinding(findings, selection, item, selectedM2.map(({ part }) => part.id), {
          ruleId: "accessory-m2-heatsink-form-factor",
          severity: "unknown",
          title: "M.2 방열판과 SSD 규격을 확인할 수 없습니다.",
          message: "선택한 M.2 SSD 또는 방열판의 세부 규격이 부족해 실제 장착 가능 여부를 확정할 수 없습니다.",
          facts: [
            { label: "선택한 M.2 SSD", actual: selectedM2.map(({ part }) => part.specs.formFactor ?? part.name).join(" · ") },
            { label: "방열판 지원 규격", expected: m2FormFactorLabelsFor(item).join(" · ") || "확인 필요" }
          ],
          action: "M.2 SSD와 방열판의 길이·두께를 제조사 원문에서 확인하세요."
        });
        } else if (!m2FormsOverlap(candidateForms, selectedM2Forms)) {
        addFinding(findings, selection, item, selectedM2.map(({ part }) => part.id), {
          ruleId: "accessory-m2-heatsink-form-factor",
          severity: "blocker",
          title: "M.2 방열판 규격이 선택한 SSD와 맞지 않습니다.",
          message: "선택한 방열판이 현재 M.2 SSD의 길이 규격을 지원하지 않아 그대로 장착할 수 없습니다.",
          facts: [
            { label: "선택한 SSD 규격", actual: selectedM2.map(({ part }) => part.specs.formFactor ?? part.name).join(" · ") },
            { label: "방열판 지원 규격", expected: m2FormFactorLabelsFor(item).join(" · ") || "확인 필요" }
          ],
          action: "M.2 SSD 규격에 맞는 방열판으로 바꾸세요."
        });
        } else if (selection.quantity < selectedM2Count) {
        addFinding(findings, selection, item, selectedM2.map(({ part }) => part.id), {
          ruleId: "accessory-m2-heatsink-quantity",
          severity: "warning",
          title: "M.2 SSD 수보다 방열판 수량이 적습니다.",
          message: "방열판 수량이 선택한 M.2 SSD 전체 수보다 적어 일부 SSD에는 방열판이 없습니다.",
          facts: [
            { label: "M.2 SSD 수", actual: `${selectedM2Count}개` },
            { label: "방열판 수량", actual: `${selection.quantity}개` }
          ],
          action: "필요한 M.2 SSD 수만큼 방열판 수량을 조정하세요."
        });
        }
      }
    }

    if (item.category === "cooling_fan") {
      const fanSize = accessoryFanSizeFor(item);
      if (!computerCase) {
        addFinding(findings, selection, item, [], {
          ruleId: "accessory-cooling-fan-size",
          severity: "unknown",
          title: "쿨링팬을 확인할 케이스가 없습니다.",
          message: "케이스가 선택되지 않아 쿨링팬의 실제 장착 가능 여부를 확정할 수 없습니다.",
          facts: [
            { label: "선택한 케이스", expected: "확인 필요" },
            { label: "선택한 팬 크기", actual: fanSize === undefined ? "확인 필요" : `${fanSize}mm` }
          ],
          action: "케이스를 선택한 뒤 팬 장착 규격을 다시 확인하세요."
        });
      } else if (caseFanSizes.length === 0 || fanSize === undefined) {
        addFinding(findings, selection, item, [computerCase.id], {
          ruleId: "accessory-cooling-fan-size",
          severity: "unknown",
          title: "쿨링팬과 케이스 장착 규격을 확인할 수 없습니다.",
          message: "케이스 또는 선택한 쿨링팬의 장착 크기가 부족해 실제 장착 가능 여부를 확정할 수 없습니다.",
          facts: [
            { label: "케이스 지원 팬 크기", expected: caseFanSizes.length > 0 ? caseFanSizes.map((size) => `${size}mm`).join(" · ") : "확인 필요" },
            { label: "선택한 팬 크기", actual: fanSize === undefined ? "확인 필요" : `${fanSize}mm` }
          ],
          action: "케이스 도면에서 팬 장착 위치와 나사 간격을 확인하세요."
        });
      } else if (!caseFanSizes.includes(fanSize)) {
        addFinding(findings, selection, item, [computerCase.id], {
          ruleId: "accessory-cooling-fan-size",
          severity: "blocker",
          title: "쿨링팬 크기가 케이스 장착 규격과 맞지 않습니다.",
          message: "선택한 쿨링팬 크기가 케이스 원문에서 확인된 장착 규격과 일치하지 않습니다.",
          facts: [
            { label: "케이스 지원 팬 크기", expected: caseFanSizes.map((size) => `${size}mm`).join(" · ") },
            { label: "선택한 팬 크기", actual: `${fanSize}mm` }
          ],
          action: "케이스 지원 크기의 쿨링팬으로 바꾸세요."
        });
      }
    }

    if (item.category === "fan_hub") {
      const fanPortCount = fanHubPortCountFor(item);
      const rgbPortCount = rgbHubPortCountFor(item);
      const rgbVoltage = rgbVoltageFor(item);
      const hasFanEvidence = fanPortCount !== undefined;
      const hasRgbEvidence = hasRgbControllerEvidenceFor(item);
      const relatedPartIds = [computerCase?.id, ...(motherboard ? [motherboard.id] : [])].filter((partId): partId is string => Boolean(partId));
      if (!hasFanEvidence && !hasRgbEvidence) {
        addFinding(findings, selection, item, relatedPartIds, {
          ruleId: "accessory-fan-hub-ports",
          severity: "unknown",
          title: "팬 허브를 확인할 분배 포트 정보가 없습니다.",
          message: "선택한 주변 부품의 팬·RGB 분배 포트 정보가 부족해 연결 가능 여부를 확정할 수 없습니다.",
          facts: [
            { label: "케이스 기본 팬", actual: caseFanCount === undefined ? "확인 필요" : `${caseFanCount}개` },
            { label: "팬 허브 분배 포트", expected: "확인 필요" },
            { label: "RGB 분배 포트", expected: "확인 필요" }
          ],
          action: "팬 허브 원문에서 팬·RGB 분배 포트와 전원 방식을 확인하세요."
        });
      } else if (hasFanEvidence && (!computerCase || caseFanCount === undefined)) {
        addFinding(findings, selection, item, relatedPartIds, {
          ruleId: "accessory-fan-hub-ports",
          severity: "unknown",
          title: "팬 허브를 확인할 케이스 팬 정보가 없습니다.",
          message: "케이스가 없거나 기본 팬 수가 확인되지 않아 선택한 팬 허브의 필요 포트 수를 확정할 수 없습니다.",
          facts: [
            { label: "케이스 기본 팬", expected: "확인 필요" },
            { label: "팬 허브 분배 포트", actual: `${fanPortCount}개` }
          ],
          action: "케이스 기본 팬 수와 팬 허브 전원·분배 포트를 원문에서 확인하세요."
        });
      } else if (hasFanEvidence && caseFanCount !== undefined && fanPortCount < caseFanCount) {
        addFinding(findings, selection, item, relatedPartIds, {
          ruleId: "accessory-fan-hub-ports",
          severity: "warning",
          title: "팬 허브 포트 수가 케이스 기본 팬보다 적습니다.",
          message: "선택한 팬 허브만으로 케이스 기본 팬 전체를 분배할 수 없어 연결 구성을 추가로 확인해야 합니다.",
          facts: [
            { label: "케이스 기본 팬", actual: `${caseFanCount}개` },
            { label: "팬 허브 분배 포트", actual: `${fanPortCount}개` }
          ],
          action: "더 많은 포트의 허브를 선택하거나 팬 연결 구성을 확인하세요."
        });
      }
      const shouldCheckRgbController = hasRgbEvidence && rgbDeviceCount !== undefined && rgbDeviceCount > 0 && activeRgbControllerId === item.id;
      if (shouldCheckRgbController) {
        const rgbPlan = rgbControllerConnectionPlanFor(item, rgbDeviceCount, rgbDeviceVoltage, rgbDeviceLoad);
        rgbConnectionPlans.push(rgbPlan);
        if (rgbPlan.issue === "unknown") {
          addFinding(findings, selection, item, relatedPartIds, {
            ruleId: "accessory-rgb-controller",
            severity: "unknown",
            title: "RGB 컨트롤러와 케이스 연결 규격을 확정할 수 없습니다.",
            message: "케이스 RGB 장치 수·전압 또는 선택한 컨트롤러의 출력·전압 정보가 부족해 연결 가능 여부를 확정할 수 없습니다.",
            facts: [
              { label: "케이스 RGB 장치", actual: `${rgbDeviceCount}개` },
              { label: "케이스 RGB 전압", actual: rgbDeviceVoltage ?? "확인 필요" },
              { label: "컨트롤러 RGB 분배 포트", actual: rgbPortCount === undefined ? "확인 필요" : `${rgbPortCount}개` },
              { label: "컨트롤러 RGB 전압", actual: rgbVoltage ?? "확인 필요" }
            ],
            action: "RGB 컨트롤러 원문에서 출력 포트·5V/12V 전압·전원 입력을 확인하세요."
          });
        } else if (rgbPlan.issue === "voltage_mismatch") {
          addFinding(findings, selection, item, relatedPartIds, {
            ruleId: "accessory-rgb-controller-voltage",
            severity: "blocker",
            title: "RGB 컨트롤러 전압이 케이스 RGB 장치와 맞지 않습니다.",
            message: "케이스 RGB 장치와 다른 전압의 컨트롤러를 직접 연결하면 손상될 수 있어 함께 사용할 수 없습니다.",
            facts: [
              { label: "케이스 RGB 전압", actual: rgbPlan.requiredVoltages.join(" + ") },
              { label: "컨트롤러 RGB 전압", actual: rgbVoltage ?? "확인 필요" }
            ],
            action: "케이스와 같은 5V ARGB 또는 12V RGB 전압의 컨트롤러로 바꾸세요."
          });
        } else if (rgbPlan.issue === "output_shortage") {
          addFinding(findings, selection, item, relatedPartIds, {
            ruleId: "accessory-rgb-controller-ports",
            severity: "warning",
            title: "RGB 컨트롤러 출력 수가 케이스 RGB 장치보다 적습니다.",
            message: "선택한 RGB 컨트롤러만으로 케이스 RGB 장치 전체를 연결할 수 없어 연결 구성을 추가로 확인해야 합니다.",
            facts: [
              { label: "케이스 RGB 장치", actual: `${rgbDeviceCount}개` },
              { label: "컨트롤러 RGB 분배 포트", actual: rgbPlan.outputCount === undefined ? "확인 필요" : `${rgbPlan.outputCount}개` }
            ],
            action: "더 많은 출력 포트의 같은 전압 컨트롤러를 선택하세요."
          });
        } else if (rgbPlan.issue === "rgb_load_unknown") {
          addFinding(findings, selection, item, relatedPartIds, {
            ruleId: "accessory-rgb-controller-power",
            severity: "unknown",
            title: "RGB 전원 레일의 실제 부하를 확정할 수 없습니다.",
            message: "RGB 장치 수·전압은 확인됐지만 장치당 소비전력 또는 소비전류가 원문에 없어 컨트롤러 레일의 잔여 용량을 계산할 수 없습니다.",
            facts: [
              { label: "케이스 RGB 장치", actual: `${rgbPlan.deviceCount}개` },
              { label: "필요 전압", actual: rgbPlan.requiredVoltages.join(" + ") || "확인 필요" },
              { label: "장치당 RGB 부하", expected: "제조사 원문 확인 필요" },
              { label: "컨트롤러 전원 레일", actual: rgbPlan.powerRails?.map((rail) => `${rail.voltage} ${rail.maxPowerW === undefined ? "용량 확인 필요" : `${rail.maxPowerW.toFixed(2)}W`}`).join(" · ") ?? "확인 필요" }
            ],
            action: "케이스 RGB 장치의 개당 소비전류·소비전력과 컨트롤러 해당 레일 한도를 제조사 원문에서 확인하세요."
          });
        } else if (rgbPlan.issue === "rgb_capacity_unknown") {
          addFinding(findings, selection, item, relatedPartIds, {
            ruleId: "accessory-rgb-controller-power",
            severity: "unknown",
            title: "RGB 컨트롤러의 해당 전원 레일 용량을 확인할 수 없습니다.",
            message: "RGB 장치 부하는 확인됐지만 필요한 전압의 컨트롤러 최대 W/A가 없어 전원 여유를 확정할 수 없습니다.",
            facts: [
              { label: "필요 전압", actual: rgbPlan.requiredVoltages.join(" + ") },
              { label: "RGB 장치 총 부하", actual: rgbPlan.rgbTotalPowerW === undefined ? `${rgbPlan.rgbTotalCurrentA?.toFixed(2) ?? "확인 필요"}A` : `${rgbPlan.rgbTotalPowerW.toFixed(2)}W` },
              { label: "컨트롤러 해당 레일", expected: "최대 W/A 원문 확인 필요" }
            ],
            action: "컨트롤러의 필요한 RGB 전압 레일 최대 허용 W/A를 제조사 원문에서 확인하세요."
          });
        } else if (rgbPlan.issue === "rgb_power_over_limit") {
          addFinding(findings, selection, item, relatedPartIds, {
            ruleId: "accessory-rgb-controller-power",
            severity: "blocker",
            title: "RGB 장치 부하가 컨트롤러 전원 레일 허용치를 초과합니다.",
            message: "계산된 RGB 장치 부하가 컨트롤러의 해당 전압 레일 최대 W/A보다 커서 이 연결 계획을 사용할 수 없습니다.",
            facts: [
              { label: "RGB 장치 총 부하", actual: rgbPlan.rgbTotalPowerW === undefined ? `${rgbPlan.rgbTotalCurrentA?.toFixed(2) ?? "확인 필요"}A` : `${rgbPlan.rgbTotalPowerW.toFixed(2)}W` },
              { label: "전원 레일 여유", actual: rgbPlan.rgbPowerHeadroomW !== undefined ? `${rgbPlan.rgbPowerHeadroomW.toFixed(2)}W` : `${rgbPlan.rgbCurrentHeadroomA?.toFixed(2) ?? "확인 필요"}A` },
              { label: "필요 전압", actual: rgbPlan.requiredVoltages.join(" + ") }
            ],
            action: "RGB 장치 수를 줄이거나 더 높은 허용 W/A의 같은 전압 컨트롤러로 바꾸세요."
          });
        }
      }
      if (fanHubPowerInputFor(item) === undefined) {
        addFinding(findings, selection, item, relatedPartIds, {
          ruleId: "accessory-fan-hub-power",
          severity: "unknown",
          title: "팬 허브·RGB 컨트롤러 전원 입력을 확인할 수 없습니다.",
          message: "분배 포트·RGB 전압과 별도로 허브가 SATA·IDE/Molex 전원을 받는지 확인할 정보가 부족합니다.",
          facts: [{ label: "외부 전원 입력", expected: "SATA·IDE/Molex 확인 필요" }],
          action: "제품 원문에서 외부 전원 입력과 연결할 케이블을 확인하세요."
        });
      }
    }

    if (item.category === "ups") {
      const outputW = item.specs.outputW ?? item.specs.wattageW;
      const relatedPartIds = [...powerBasisPartIds];
      if (knownSystemPowerW <= 0) {
        addFinding(findings, selection, item, relatedPartIds, {
          ruleId: "accessory-ups-capacity",
          severity: "unknown",
          title: "UPS를 확인할 CPU·GPU 전력 정보가 없습니다.",
          message: "CPU·GPU의 확인된 전력 정보가 없어 UPS 출력 여유를 계산할 수 없습니다.",
          facts: [
            { label: "확인된 CPU·GPU 전력", expected: "확인 필요" },
            { label: "UPS 출력", actual: outputW === undefined ? "확인 필요" : `${outputW}W` }
          ],
          action: "CPU·GPU 전력과 UPS 출력(W)을 원문에서 확인하세요. VA는 역률 정보 없이 W로 환산하지 않습니다."
        });
      } else if (outputW === undefined) {
        addFinding(findings, selection, item, relatedPartIds, {
          ruleId: "accessory-ups-capacity",
          severity: "unknown",
          title: "UPS 출력 여유를 확인할 수 없습니다.",
          message: "UPS의 출력(W)이 없어 확인된 시스템 전력과 비교할 수 없습니다.",
          facts: [
            { label: "확인된 CPU·GPU 전력", actual: `${knownSystemPowerW}W` },
            { label: "UPS 출력", expected: "W 단위 출력 확인 필요" },
            ...(item.specs.capacityVa !== undefined ? [{ label: "UPS 용량", actual: `${item.specs.capacityVa}VA` }] : [])
          ],
          action: "UPS 출력(W)과 역률·실제 소비전력을 제조사 원문에서 확인하세요."
        });
      } else {
        const recommendedOutputW = Math.ceil(knownSystemPowerW * 1.25);
        if (outputW < knownSystemPowerW) {
          addFinding(findings, selection, item, relatedPartIds, {
            ruleId: "accessory-ups-capacity",
            severity: "warning",
            title: "UPS 출력이 확인된 CPU·GPU 전력보다 낮습니다.",
            message: "현재 확인된 CPU·GPU 전력만으로도 UPS 출력에 가까워 실제 모니터·주변기기를 포함하면 과부하가 발생할 수 있습니다.",
            facts: [
              { label: "확인된 CPU·GPU 전력", actual: `${knownSystemPowerW}W` },
              { label: "UPS 출력", actual: `${outputW}W` },
              { label: "권장 최소 여유 출력", expected: `${recommendedOutputW}W 이상` }
            ],
            action: "더 높은 출력의 UPS를 선택하고 모니터·주변기기 소비전력도 더해 확인하세요."
          });
        } else if (outputW < recommendedOutputW) {
          addFinding(findings, selection, item, relatedPartIds, {
            ruleId: "accessory-ups-capacity",
            severity: "warning",
            title: "UPS 출력 여유가 권장 기준보다 작습니다.",
            message: "CPU·GPU의 확인된 전력은 감당하지만 모니터·주변기기까지 포함한 여유가 충분하지 않을 수 있습니다.",
            facts: [
              { label: "확인된 CPU·GPU 전력", actual: `${knownSystemPowerW}W` },
              { label: "UPS 출력", actual: `${outputW}W` },
              { label: "권장 최소 여유 출력", expected: `${recommendedOutputW}W 이상` }
            ],
            action: "모니터·주변기기 소비전력을 더한 뒤 UPS 여유를 확인하세요."
          });
        }
      }
    }
  }

  if (rgbTargetNeedsSelection) {
    const targetId = build.rgbControllerAccessoryId;
    const targetEntry = targetId ? selectedFanHubs.find(({ selection }) => selection.accessoryId === targetId) : undefined;
    const availableControllers = rgbCapableFanHubs.map(({ item }) => item.name).join(" · ") || "없음";
    findings.push({
      id: `accessory-rgb-controller-target-${targetId ?? "missing"}`,
      ruleId: "accessory-rgb-controller-target",
      severity: "unknown",
      accessoryId: targetId ?? "rgb-controller-target",
      accessoryName: targetEntry?.item.name ?? "RGB 연결 컨트롤러",
      relatedPartIds: [computerCase?.id, ...(motherboard ? [motherboard.id] : [])].filter((partId): partId is string => Boolean(partId)),
      title: "케이스 RGB 장치의 연결 컨트롤러를 지정해야 합니다.",
      message: targetId ? "지정한 RGB 연결 컨트롤러가 선택되지 않았거나 RGB 출력·전압 근거가 없어 케이스 RGB 장치 연결을 확정할 수 없습니다." : "RGB 기능이 있는 허브가 여러 개 선택되어 케이스 RGB 장치를 어느 컨트롤러에 연결할지 확정할 수 없습니다.",
      facts: [
        { label: "케이스 RGB 장치", actual: `${rgbDeviceCount}개` },
        { label: "지정한 RGB 컨트롤러", actual: targetEntry?.item.name ?? targetId ?? "미지정" },
        { label: "RGB 기능 확인 허브", actual: availableControllers }
      ],
      action: "카트에서 케이스 RGB 연결 컨트롤러를 하나 지정한 뒤 다시 검사하세요."
    });
  }

  const selectedFanHubIds = new Set(selectedFanHubs.map(({ selection }) => selection.accessoryId));
  const fansByHub = new Map<string, Array<{ selection: AccessorySelection; item: AccessoryItem }>>();
  const unassignedFans: Array<{ selection: AccessorySelection; item: AccessoryItem }> = [];
  for (const fan of selectedCoolingFans) {
    const targetHubId = fan.selection.targetAccessoryId;
    if (targetHubId && selectedFanHubIds.has(targetHubId)) {
      fansByHub.set(targetHubId, [...(fansByHub.get(targetHubId) ?? []), fan]);
    } else if (!targetHubId && selectedFanHubs.length === 1) {
      const onlyHubId = selectedFanHubs[0].selection.accessoryId;
      fansByHub.set(onlyHubId, [...(fansByHub.get(onlyHubId) ?? []), fan]);
    } else if (selectedFanHubs.length > 0 || targetHubId) {
      unassignedFans.push(fan);
    }
  }
  const allocationFansByHub = new Map(fansByHub);
  const fanHubTargetRecommendations: AccessoryFanHubTargetRecommendation[] = [];
  for (const fan of unassignedFans) {
    const recommendation = fanHubTargetRecommendationFor(fan, selectedFanHubs, allocationFansByHub);
    fanHubTargetRecommendations.push(recommendation);
    if (recommendation.suggestedHubId) allocationFansByHub.set(recommendation.suggestedHubId, [...(allocationFansByHub.get(recommendation.suggestedHubId) ?? []), fan]);
  }
  for (const { selection: fanSelection, item: fan } of unassignedFans) {
    const relatedPartIds = [computerCase?.id, ...(motherboard ? [motherboard.id] : [])].filter((partId): partId is string => Boolean(partId));
    const availableHubs = selectedFanHubs.map(({ item }) => item.name).join(" · ") || "없음";
    addFinding(findings, fanSelection, fan, relatedPartIds, {
      ruleId: "accessory-fan-hub-target",
      severity: "unknown",
      title: "추가 팬의 연결 대상 팬 허브를 지정해야 합니다.",
      message: "팬 허브가 여러 개 선택되었거나 지정한 대상 허브를 찾을 수 없어 어느 허브 출력에 연결할지 확정할 수 없습니다.",
      facts: [
        { label: "추가 팬", actual: fan.name },
        { label: "지정한 대상 허브", actual: fanSelection.targetAccessoryId ?? "미지정" },
        { label: "현재 선택한 팬 허브", actual: availableHubs },
        ...(fanHubTargetRecommendations.find((recommendation) => recommendation.fanId === fan.id)?.candidates.length ? [{ label: "허브 후보", actual: fanHubTargetRecommendations.find((recommendation) => recommendation.fanId === fan.id)!.candidates.slice(0, 3).map((candidate) => `${candidate.hubName} · ${candidate.status === "pass" ? "추천" : candidate.status === "blocked" ? "차단" : "확인 필요"}`).join(" · ") }] : [])
      ],
      action: "추가한 주변 부품에서 이 팬의 연결 대상 팬 허브를 지정한 뒤 다시 검사하세요."
    });
  }
  const connectionPlans: AccessoryConnectivityPlan[] = [];
  for (const { selection: hubSelection, item: hub } of selectedFanHubs) {
    const fansForHub = fansByHub.get(hubSelection.accessoryId) ?? [];
    if (fansForHub.length === 0) continue;
    const plan = fanHubConnectionPlanFor(hub, fansForHub);
    connectionPlans.push(plan);
    const relatedPartIds = [computerCase?.id, ...(motherboard ? [motherboard.id] : [])].filter((partId): partId is string => Boolean(partId));
    const hubConnectorLabels = plan.hubFanOutputs.length > 0 ? plan.hubFanOutputs.join(" · ") : "확인 필요";
    const fanConnectorLabels = [...new Set(plan.fans.flatMap((fan) => fan.connectorTypes))].join(" · ");
    if (plan.connectorIssue === "unknown") {
      addFinding(findings, hubSelection, hub, relatedPartIds, {
        ruleId: "accessory-fan-hub-topology",
        severity: "unknown",
        title: "팬 허브와 추가 팬의 연결 타입을 확정할 수 없습니다.",
        message: "허브의 팬 출력 또는 추가 팬의 3핀·4핀 입력 타입이 부족해 실제 연결 경로와 PWM 제어 가능 여부를 확정할 수 없습니다.",
        facts: [
          { label: "허브 팬 출력", actual: hubConnectorLabels },
          { label: "추가 팬 입력", actual: fanConnectorLabels }
        ],
        action: "허브 분배단자와 팬 입력 커넥터가 3핀 DC·4핀 PWM·IDE/Molex 중 무엇인지 원문에서 확인하세요."
      });
    } else if (plan.connectorIssue === "molex_mismatch") {
      addFinding(findings, hubSelection, hub, relatedPartIds, {
        ruleId: "accessory-fan-hub-connector",
        severity: "blocker",
        title: "팬 허브 출력 커넥터가 추가 팬과 맞지 않습니다.",
        message: "IDE/Molex 전원 팬과 메인보드용 3핀·4핀 PWM 출력은 같은 연결 타입으로 직접 사용할 수 없습니다.",
        facts: [
          { label: "허브 팬 출력", actual: hubConnectorLabels },
          { label: "추가 팬 입력", actual: fanConnectorLabels }
        ],
        action: "같은 커넥터 타입을 지원하는 허브·팬 조합으로 바꾸거나 제조사 변환 경로를 확인하세요."
      });
    } else if (plan.connectorIssue === "control_mode") {
      addFinding(findings, hubSelection, hub, relatedPartIds, {
        ruleId: "accessory-fan-hub-connector",
        severity: "warning",
        title: "팬 허브와 추가 팬의 제어 방식이 다를 수 있습니다.",
        message: "3핀 DC 팬과 4핀 PWM 출력이 섞이면 팬은 회전해도 메인보드 PWM 제어 또는 속도 표시가 제한될 수 있습니다.",
        facts: [
          { label: "허브 팬 출력", actual: hubConnectorLabels },
          { label: "추가 팬 입력", actual: fanConnectorLabels }
        ],
        action: "팬과 허브의 3핀 DC·4핀 PWM 제어 방식을 맞추거나 실제 제어 가능 여부를 확인하세요."
      });
    }

    if (plan.portIssue === "unknown") {
      addFinding(findings, hubSelection, hub, relatedPartIds, {
        ruleId: "accessory-fan-hub-output-ports",
        severity: "unknown",
        title: "팬 허브의 추가 팬 출력 포트를 확정할 수 없습니다.",
        message: "허브의 팬 분배 포트 수가 부족해 선택한 추가 팬을 어느 출력에 배치할지 확정할 수 없습니다.",
        facts: [
          { label: "추가 팬 연결 수", actual: `${plan.fanCount}개` },
          { label: "허브 팬 출력 포트", actual: "확인 필요" }
        ],
        action: "팬 허브 원문에서 팬 분배 포트 수를 확인하세요."
      });
    } else if (plan.portIssue === "over_limit") {
      addFinding(findings, hubSelection, hub, relatedPartIds, {
        ruleId: "accessory-fan-hub-output-ports",
        severity: "blocker",
        title: "추가 팬 수가 팬 허브 출력 포트보다 많습니다.",
        message: "선택한 추가 팬 전체를 현재 허브에 연결할 포트가 없어 이 연결 계획을 그대로 사용할 수 없습니다.",
        facts: [
          { label: "추가 팬 연결 수", actual: `${plan.fanCount}개` },
          { label: "허브 팬 출력 포트", actual: plan.hubFanPortCount === undefined ? "확인 필요" : `${plan.hubFanPortCount}개` },
          { label: "미배치 팬", actual: plan.unassignedFanCount === undefined ? "확인 필요" : `${plan.unassignedFanCount}개` }
        ],
        action: "더 많은 팬 포트의 허브를 선택하거나 추가 팬 수를 줄이세요."
      });
    }

    if (plan.currentIssue === "unknown") {
      addFinding(findings, hubSelection, hub, relatedPartIds, {
        ruleId: "accessory-fan-hub-current",
        severity: "unknown",
        title: "팬 허브와 추가 팬의 전류 여유를 확정할 수 없습니다.",
        message: "허브 최대 허용전류 또는 개별 팬 소비전류가 부족해 연결된 팬 전체의 전류 합계를 계산할 수 없습니다.",
        facts: [
          { label: "허브 최대 허용전류", actual: plan.maxFanCurrentA === undefined ? "확인 필요" : `${plan.maxFanCurrentA.toFixed(2)}A` },
          { label: "추가 팬 소비전류", actual: plan.totalCurrentA === undefined ? "개별 팬 원문 확인 필요" : `${plan.totalCurrentA.toFixed(2)}A` }
        ],
        action: "허브의 채널·전체 최대 허용전류와 팬별 소비전류를 제조사 원문에서 확인하세요."
      });
    } else if (plan.currentIssue === "over_limit" && plan.totalCurrentA !== undefined && plan.maxFanCurrentA !== undefined) {
      addFinding(findings, hubSelection, hub, relatedPartIds, {
        ruleId: "accessory-fan-hub-current",
        severity: "blocker",
        title: "연결한 팬의 전류 합계가 허브 허용치를 초과합니다.",
        message: "선택한 팬 전체의 소비전류가 허브의 확인된 최대 허용전류보다 커서 해당 연결을 사용할 수 없습니다.",
        facts: [
          { label: "연결 팬 전류 합계", actual: `${plan.totalCurrentA.toFixed(2)}A` },
          { label: "허브 최대 허용전류", expected: `${plan.maxFanCurrentA.toFixed(2)}A 이상` }
        ],
        action: "팬 수를 줄이거나 더 높은 허용전류의 허브를 선택하세요."
      });
    }
  }

  const blockerCount = findings.filter((finding) => finding.severity === "blocker").length;
  const warningCount = findings.filter((finding) => finding.severity === "warning").length;
  const unknownCount = findings.filter((finding) => finding.severity === "unknown").length;
  return {
    status: blockerCount > 0 ? "incompatible" : warningCount > 0 || unknownCount > 0 ? "needs_review" : "compatible",
    blockerCount,
    warningCount,
    unknownCount,
    findings,
    ...(connectionPlans.length > 0 ? { connectionPlans } : {}),
    ...(fanHubTargetRecommendations.length > 0 ? { fanHubTargetRecommendations } : {}),
    ...(rgbConnectionPlans.length > 0 ? { rgbConnectionPlans } : {})
  };
}
