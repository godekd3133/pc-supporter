import type { AccessoryConnectivityPlan, AccessoryConnectivityPlanStatus, AccessoryItem, AccessoryPowerRail, AccessoryRgbConnectionPlan, AccessorySelection, RgbDeviceLoadProvenance } from "../shared/types";
import { rgbFanDeviceCountFor, rgbFanVoltageFor } from "../shared/rgb-connectivity";
import { fanCurrentAFromText } from "../shared/fan-connectivity";

export type FanConnectorType = "dc_3pin" | "pwm_4pin" | "molex_4pin" | "proprietary";

function accessoryText(item: AccessoryItem) {
  return `${item.name} ${item.rawSpecText ?? ""}`;
}

export function fanHubPortCountFor(item: AccessoryItem) {
  if (item.specs.fanPortCount !== undefined) return item.specs.fanPortCount;
  const text = accessoryText(item);
  const parsed = Number(text.match(/팬\s*분배\s*[:：]?\s*(\d+)\s*개/i)?.[1] ?? NaN);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  const channelCount = Number(text.match(/(\d+)\s*(?:포트|channel|채널)/i)?.[1] ?? NaN);
  return Number.isFinite(channelCount) && channelCount > 0 ? channelCount : undefined;
}

export function fanHubPowerInputFor(item: AccessoryItem) {
  const text = accessoryText(item);
  if (/SATA\s*전원|SATA전원/i.test(text)) return "SATA";
  if (/(?:IDE|Molex)\s*(?:전원|4\s*(?:핀|pin))|IDE전원/i.test(text)) return "IDE/Molex";
  return undefined;
}

export function rgbHubPortCountFor(item: AccessoryItem) {
  if (item.specs.rgbPortCount !== undefined) return item.specs.rgbPortCount;
  const parsed = Number(accessoryText(item).match(/RGB\s*분배\s*[:：]?\s*(\d+)\s*개/i)?.[1] ?? NaN);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function rgbVoltageFor(item: AccessoryItem): "5V" | "12V" | "mixed" | undefined {
  if (item.specs.rgbDeviceVoltage) return item.specs.rgbDeviceVoltage;
  const text = accessoryText(item);
  if (item.category === "cooling_fan") return rgbFanVoltageFor(item);
  const distributionText = text.match(/분배단자\s*[:：]?\s*([^/]+)/i)?.[1] ?? "";
  const inputText = text.match(/입력단자\s*[:：]?\s*([^/]+)/i)?.[1] ?? "";
  const rgbContext = `${item.name} ${distributionText} ${inputText} ${text.replace(/작동전압\s*[:：]?\s*[^/]+/gi, "")}`;
  const has5v = /(?:5\s*V|5V)/i.test(rgbContext) && (/(?:ARGB|addressable)/i.test(rgbContext) || /ARGB\s*3\s*핀/i.test(rgbContext));
  const has12v = /(?:12\s*V|12V)/i.test(rgbContext) && /(?:RGB\s*4\s*핀|12\s*V\s*RGB|RGB\s*12\s*V)/i.test(rgbContext);
  const implied5v = /ARGB\s*3\s*핀/i.test(rgbContext);
  const implied12v = /RGB\s*4\s*핀/i.test(rgbContext);
  const resolved5v = has5v || implied5v;
  const resolved12v = has12v || implied12v;
  if (resolved5v && resolved12v) return "mixed";
  if (resolved5v) return "5V";
  if (resolved12v) return "12V";
  return undefined;
}

export function hasRgbControllerEvidenceFor(item: AccessoryItem) {
  return rgbHubPortCountFor(item) !== undefined
    || rgbVoltageFor(item) !== undefined
    || /(?:ARGB|RGB)\s*(?:컨트롤러|허브)|(?:ARGB|RGB)\s*\d\s*핀/i.test(accessoryText(item));
}

function uniqueConnectorTypes(types: FanConnectorType[]) {
  return [...new Set(types)];
}

function fanConnectorTypesFromText(text: string) {
  const types: FanConnectorType[] = [];
  if (/전용\s*커넥터/i.test(text)) types.push("proprietary");
  if (/(?:4\s*핀\s*\(\s*IDE\s*\)|IDE\s*(?:전원|4\s*(?:핀|pin))|Molex)/i.test(text)) types.push("molex_4pin");
  const withoutMolex = text.replace(/4\s*핀\s*\(\s*IDE\s*\)/gi, "");
  if (/(?:PWM|4\s*핀|4\s*pin)/i.test(withoutMolex)) types.push("pwm_4pin");
  if (/(?:3\s*핀|3\s*pin)/i.test(withoutMolex) && !/(?:ARGB|RGB)\s*(?:3\s*핀|3\s*pin)/i.test(withoutMolex)) types.push("dc_3pin");
  return uniqueConnectorTypes(types);
}

export function fanHubOutputConnectorTypesFor(item: AccessoryItem): FanConnectorType[] {
  const text = accessoryText(item);
  const distributionText = text.match(/분배단자\s*[:：]?\s*([^/]+)/i)?.[1]
    ?? (/팬\s*(?:제어|분배)|\d+\s*(?:포트|channel|채널)/i.test(text) ? text : "");
  if (!distributionText) return [];
  return fanConnectorTypesFromText(distributionText.replace(/(?:ARGB|RGB)\s*(?:3\s*핀|4\s*핀|3\s*pin|4\s*pin)/gi, ""));
}

export function fanConnectorTypesFor(item: AccessoryItem): FanConnectorType[] | undefined {
  const text = accessoryText(item);
  if (/3\s*[-~]\s*4\s*핀|3\s*[-~]\s*4\s*pin/i.test(text)) return undefined;
  const types = fanConnectorTypesFromText(text);
  return types.length > 0 ? types : undefined;
}

export function fanConnectorLabel(type: FanConnectorType) {
  return type === "dc_3pin" ? "3핀 DC" : type === "pwm_4pin" ? "4핀 PWM" : type === "molex_4pin" ? "4핀 IDE/Molex" : "전용 커넥터";
}

function maximumPowerTextFor(item: AccessoryItem) {
  const text = accessoryText(item);
  return text.match(/최대\s*(?:허용)?전력\s*[:：]?\s*([^/]+(?:\s*\/\s*(?=[(\d])[^/]+)*)/i)?.[1] ?? text;
}

function parsePowerNumber(value: string | undefined) {
  const parsed = Number(value?.replace(/,/g, "") ?? NaN);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function powerRailRoleFor(item: AccessoryItem, voltage: "5V" | "12V"): AccessoryPowerRail["role"] {
  const operationText = accessoryText(item).match(/작동전압\s*[:：]?\s*([^/]+)/i)?.[1] ?? "";
  const voltagePattern = voltage === "5V" ? "5\\s*V" : "12\\s*V";
  const fan = new RegExp(`팬\\s*${voltagePattern}`, "i").test(operationText);
  const rgb = new RegExp(`(?:LED|RGB|ARGB)\\s*${voltagePattern}`, "i").test(operationText);
  if (fan && rgb) return "shared";
  if (fan) return "fan";
  if (rgb) return "rgb";

  const controllerVoltage = rgbVoltageFor(item);
  if (controllerVoltage === voltage || controllerVoltage === "mixed") return "rgb";
  if (voltage === "12V" && fanHubPortCountFor(item) !== undefined) return "fan";
  return "unknown";
}

/**
 * Parses only explicit voltage-scoped power limits from the accessory's
 * maximum-power evidence. Generic values such as `5A, 60W` are deliberately
 * not assigned to a rail because their voltage and fan/RGB ownership are not
 * recoverable from the source text.
 */
export function accessoryPowerRailsFor(item: AccessoryItem): AccessoryPowerRail[] {
  const limitText = maximumPowerTextFor(item);
  const rails = new Map<AccessoryPowerRail["voltage"], AccessoryPowerRail>();
  const mergeRail = (voltage: AccessoryPowerRail["voltage"], maxPowerW?: number, maxCurrentA?: number) => {
    if (maxPowerW === undefined && maxCurrentA === undefined) return;
    const previous = rails.get(voltage);
    const resolvedPower = maxPowerW ?? previous?.maxPowerW;
    const resolvedCurrent = maxCurrentA ?? previous?.maxCurrentA ?? (resolvedPower !== undefined ? resolvedPower / Number(voltage.slice(0, -1)) : undefined);
    rails.set(voltage, {
      voltage,
      ...(resolvedPower !== undefined ? { maxPowerW: resolvedPower } : {}),
      ...(resolvedCurrent !== undefined ? { maxCurrentA: resolvedCurrent } : {}),
      role: powerRailRoleFor(item, voltage)
    });
  };

  for (const match of limitText.matchAll(/(?:\(\s*)?(5|12)\s*V\s*\)?\s*([\d,.]+)\s*W/gi)) {
    const voltage = `${match[1]}V` as AccessoryPowerRail["voltage"];
    const maxPowerW = parsePowerNumber(match[2]);
    mergeRail(voltage, maxPowerW, maxPowerW === undefined ? undefined : maxPowerW / Number(match[1]));
  }
  for (const match of limitText.matchAll(/([\d,.]+)\s*W\s*\(\s*(5|12)\s*V\s*\)/gi)) {
    const voltage = `${match[2]}V` as AccessoryPowerRail["voltage"];
    const maxPowerW = parsePowerNumber(match[1]);
    mergeRail(voltage, maxPowerW, maxPowerW === undefined ? undefined : maxPowerW / Number(match[2]));
  }
  for (const match of limitText.matchAll(/(?:\(\s*)?(5|12)\s*V\s*\)?\s*([\d,.]+)\s*A/gi)) {
    mergeRail(`${match[1]}V` as AccessoryPowerRail["voltage"], undefined, parsePowerNumber(match[2]));
  }
  for (const match of limitText.matchAll(/([\d,.]+)\s*A\s*\(\s*(5|12)\s*V\s*\)/gi)) {
    mergeRail(`${match[2]}V` as AccessoryPowerRail["voltage"], undefined, parsePowerNumber(match[1]));
  }
  return [...rails.values()].sort((left, right) => Number(left.voltage.slice(0, -1)) - Number(right.voltage.slice(0, -1)));
}

export function fanHubMaxCurrentAFor(item: AccessoryItem) {
  const twelveVoltRail = accessoryPowerRailsFor(item).find((rail) => rail.voltage === "12V");
  if (twelveVoltRail?.maxCurrentA !== undefined) return twelveVoltRail.maxCurrentA;
  const text = accessoryText(item);
  const limitText = maximumPowerTextFor(item);
  const explicitAmps = Number(limitText.match(/([\d,.]+)\s*A\b/i)?.[1]?.replace(/,/g, "") ?? NaN);
  return Number.isFinite(explicitAmps) && explicitAmps > 0 ? explicitAmps : undefined;
}

export function fanCurrentAFor(item: AccessoryItem) {
  return item.specs.fanCurrentA ?? fanCurrentAFromText(accessoryText(item));
}

export function fanHubConnectionPlanFor(hub: AccessoryItem, selectedFans: Array<{ selection: AccessorySelection; item: AccessoryItem }>): AccessoryConnectivityPlan {
  const hubOutputTypes = fanHubOutputConnectorTypesFor(hub);
  const hubFanPortCount = fanHubPortCountFor(hub);
  const fanPlans = selectedFans.map(({ selection, item }) => {
    const connectorTypes = fanConnectorTypesFor(item);
    const unitCount = item.specs.fanCount ?? 1;
    const currentA = fanCurrentAFor(item);
    return {
      accessoryId: item.id,
      name: item.name,
      quantity: selection.quantity,
      unitCount,
      totalFanCount: unitCount * selection.quantity,
      connectorTypes: connectorTypes?.map(fanConnectorLabel) ?? ["확인 필요"],
      ...(currentA !== undefined ? { currentA } : {}),
      ...(currentA !== undefined && item.specs.fanLoadProvenance ? { currentProvenance: item.specs.fanLoadProvenance } : {})
    } satisfies AccessoryConnectivityPlan["fans"][number];
  });
  const totalFanCount = fanPlans.reduce((total, fan) => total + fan.totalFanCount, 0);
  const portAssignments: AccessoryConnectivityPlan["portAssignments"] = [];
  const unassignedFanNames = new Set<string>();
  let assignedFanCount: number | undefined;
  let unassignedFanCount: number | undefined;
  if (hubFanPortCount !== undefined) {
    let nextPort = 1;
    assignedFanCount = 0;
    for (const fan of fanPlans) {
      const assignableCount = Math.max(0, Math.min(fan.totalFanCount, hubFanPortCount - nextPort + 1));
      if (assignableCount > 0) {
        portAssignments.push({
          accessoryId: fan.accessoryId,
          name: fan.name,
          portStart: nextPort,
          portEnd: nextPort + assignableCount - 1,
          fanCount: assignableCount
        });
        assignedFanCount += assignableCount;
        nextPort += assignableCount;
      }
      if (assignableCount < fan.totalFanCount) unassignedFanNames.add(fan.name);
    }
    unassignedFanCount = totalFanCount - assignedFanCount;
  }
  const portIssue: AccessoryConnectivityPlan["portIssue"] = hubFanPortCount === undefined
    ? "unknown"
    : totalFanCount > hubFanPortCount
      ? "over_limit"
      : "none";
  const portStatus: AccessoryConnectivityPlanStatus = portIssue === "over_limit" ? "blocked" : portIssue === "none" ? "pass" : "review";
  const hasUnknownConnector = hubOutputTypes.length === 0
    || selectedFans.some(({ item }) => fanConnectorTypesFor(item) === undefined)
    || hubOutputTypes.includes("proprietary")
    || selectedFans.some(({ item }) => fanConnectorTypesFor(item)?.includes("proprietary"));
  const hasMolexMismatch = selectedFans.some(({ item }) => fanConnectorTypesFor(item)?.includes("molex_4pin") && !hubOutputTypes.includes("molex_4pin"))
    || hubOutputTypes.length === 1 && hubOutputTypes[0] === "molex_4pin" && selectedFans.some(({ item }) => fanConnectorTypesFor(item)?.some((type) => type !== "molex_4pin"));
  const hasControlModeMismatch = selectedFans.some(({ item }) => fanConnectorTypesFor(item)?.includes("pwm_4pin") && hubOutputTypes.length > 0 && hubOutputTypes.every((type) => type === "dc_3pin"))
    || selectedFans.some(({ item }) => fanConnectorTypesFor(item)?.includes("dc_3pin") && hubOutputTypes.length > 0 && hubOutputTypes.every((type) => type === "pwm_4pin"));
  const connectorIssue: AccessoryConnectivityPlan["connectorIssue"] = hasUnknownConnector
    ? "unknown"
    : hasMolexMismatch
      ? "molex_mismatch"
      : hasControlModeMismatch
        ? "control_mode"
        : "none";
  const maxFanCurrentA = fanHubMaxCurrentAFor(hub);
  const powerRails = accessoryPowerRailsFor(hub);
  const missingFanCurrent = fanPlans.some((fan) => fan.currentA === undefined);
  const totalCurrentA = missingFanCurrent
    ? undefined
    : fanPlans.reduce((total, fan) => total + (fan.currentA ?? 0) * fan.totalFanCount, 0);
  const currentIssue: AccessoryConnectivityPlan["currentIssue"] = maxFanCurrentA === undefined || totalCurrentA === undefined
    ? "unknown"
    : totalCurrentA > maxFanCurrentA
      ? "over_limit"
      : "none";
  const connectorStatus: AccessoryConnectivityPlanStatus = connectorIssue === "molex_mismatch" ? "blocked" : connectorIssue === "none" ? "pass" : "review";
  const currentStatus: AccessoryConnectivityPlanStatus = currentIssue === "over_limit" ? "blocked" : currentIssue === "none" ? "pass" : "review";
  const status: AccessoryConnectivityPlanStatus = connectorStatus === "blocked" || currentStatus === "blocked" || portStatus === "blocked"
    ? "blocked"
    : connectorStatus === "review" || currentStatus === "review" || portStatus === "review"
      ? "review"
      : "pass";
  const hubFanOutputs = hubOutputTypes.map(fanConnectorLabel);
  const fanInputTypes = [...new Set(fanPlans.flatMap((fan) => fan.connectorTypes))];
  const currentSummary = totalCurrentA === undefined || maxFanCurrentA === undefined
    ? "전류 근거 확인 필요"
    : `${totalCurrentA.toFixed(2)}A / ${maxFanCurrentA.toFixed(2)}A · ${Math.max(0, maxFanCurrentA - totalCurrentA).toFixed(2)}A 여유`;
  const portSummary = hubFanPortCount === undefined
    ? "허브 포트 수 확인 필요"
    : `${assignedFanCount ?? 0}/${hubFanPortCount}포트 배치${unassignedFanCount ? ` · ${unassignedFanCount}개 미배치` : ""}`;
  const summary = status === "blocked"
    ? "허브 포트·연결 타입 또는 전류 한도를 초과해 현재 연결 계획을 사용할 수 없습니다."
    : status === "review"
      ? "연결 경로는 구성됐지만 커넥터·제어 방식·전류 근거를 추가로 확인해야 합니다."
      : "선택한 팬을 허브 출력에 연결할 수 있으며 확인된 전류 범위 안입니다.";
  return {
    id: `fan-hub-plan:${hub.id}`,
    hubId: hub.id,
    hubName: hub.name,
    hubFanOutputs,
    ...(hubFanPortCount !== undefined ? { hubFanPortCount } : {}),
    ...(fanHubPowerInputFor(hub) ? { externalPower: fanHubPowerInputFor(hub) } : {}),
    ...(maxFanCurrentA !== undefined ? { maxFanCurrentA } : {}),
    ...(powerRails.length > 0 ? { powerRails } : {}),
    fanCount: totalFanCount,
    ...(assignedFanCount !== undefined ? { assignedFanCount } : {}),
    ...(unassignedFanCount !== undefined ? { unassignedFanCount } : {}),
    ...(unassignedFanNames.size > 0 ? { unassignedFanNames: [...unassignedFanNames] } : {}),
    portAssignments,
    portStatus,
    portIssue,
    ...(totalCurrentA !== undefined ? { totalCurrentA } : {}),
    ...(totalCurrentA !== undefined && maxFanCurrentA !== undefined ? { currentHeadroomA: maxFanCurrentA - totalCurrentA } : {}),
    connectorStatus,
    currentStatus,
    status,
    connectorIssue,
    currentIssue,
    fans: fanPlans,
    summary: `${summary} ${totalFanCount}개 팬 · 허브 출력 ${hubFanOutputs.length > 0 ? hubFanOutputs.join(" · ") : "확인 필요"} · ${portSummary} · 팬 입력 ${fanInputTypes.join(" · ")} · ${currentSummary}`
  };
}

export type RgbDeviceLoadEvidence = {
  perDeviceCurrentA?: number;
  perDevicePowerW?: number;
  provenance?: RgbDeviceLoadProvenance;
  caseDeviceCount?: number;
  additionalFanDeviceCount?: number;
  devices?: Array<{
    id: string;
    name: string;
    kind: "case" | "cooling_fan";
    count: number;
    voltage?: "5V" | "12V" | "mixed";
    perDeviceCurrentA?: number;
    perDevicePowerW?: number;
  }>;
};

export function rgbControllerConnectionPlanFor(
  controller: AccessoryItem,
  deviceCount: number,
  deviceVoltage: "5V" | "12V" | "mixed" | undefined,
  deviceLoad: RgbDeviceLoadEvidence = {}
): AccessoryRgbConnectionPlan {
  const requiredVoltages = deviceVoltage === "mixed" ? ["5V", "12V"] : deviceVoltage ? [deviceVoltage] : [];
  const outputCount = rgbHubPortCountFor(controller);
  const controllerVoltage = rgbVoltageFor(controller);
  const externalPower = fanHubPowerInputFor(controller);
  const powerRails = accessoryPowerRailsFor(controller);
  const requiredVoltage = requiredVoltages.length === 1 ? requiredVoltages[0] as "5V" | "12V" : undefined;
  const targetRail = requiredVoltage ? powerRails.find((rail) => rail.voltage === requiredVoltage) : undefined;
  const loadItems = deviceLoad.devices && deviceLoad.devices.length > 0
    ? deviceLoad.devices
    : [{
        id: "rgb-device-total",
        name: "RGB 장치",
        kind: "case" as const,
        count: deviceCount,
        voltage: requiredVoltage,
        perDeviceCurrentA: deviceLoad.perDeviceCurrentA,
        perDevicePowerW: deviceLoad.perDevicePowerW
      }];
  const loadItemsMatchSingleRail = requiredVoltage !== undefined
    && loadItems.every((item) => item.voltage === requiredVoltage && (item.perDeviceCurrentA !== undefined || item.perDevicePowerW !== undefined));
  const rgbTotalCurrentA = loadItemsMatchSingleRail
    ? loadItems.reduce((total, item) => total + (item.perDeviceCurrentA !== undefined ? item.perDeviceCurrentA * item.count : (item.perDevicePowerW! * item.count) / Number(requiredVoltage!.slice(0, -1))), 0)
    : undefined;
  const rgbTotalPowerW = loadItemsMatchSingleRail
    ? loadItems.reduce((total, item) => total + (item.perDevicePowerW !== undefined ? item.perDevicePowerW * item.count : item.perDeviceCurrentA! * item.count * Number(requiredVoltage!.slice(0, -1))), 0)
    : undefined;
  const rgbPerDeviceCurrentA = deviceLoad.devices?.length === 1 ? deviceLoad.devices[0].perDeviceCurrentA : deviceLoad.perDeviceCurrentA;
  const rgbPerDevicePowerW = deviceLoad.devices?.length === 1 ? deviceLoad.devices[0].perDevicePowerW : deviceLoad.perDevicePowerW;
  const loadEvidenceKnown = rgbTotalCurrentA !== undefined && rgbTotalPowerW !== undefined;
  const railCapacityKnown = targetRail !== undefined && (targetRail.maxCurrentA !== undefined || targetRail.maxPowerW !== undefined);
  const currentOverLimit = loadEvidenceKnown && targetRail?.maxCurrentA !== undefined && rgbTotalCurrentA > targetRail.maxCurrentA;
  const powerOverLimit = loadEvidenceKnown && targetRail?.maxPowerW !== undefined && rgbTotalPowerW > targetRail.maxPowerW;
  const voltageMatches = requiredVoltages.length > 0 && controllerVoltage !== undefined
    && (controllerVoltage === "mixed" || requiredVoltages.every((voltage) => controllerVoltage === voltage));
  let issue: AccessoryRgbConnectionPlan["issue"] = "none";
  if (requiredVoltages.length === 0 || outputCount === undefined || controllerVoltage === undefined) issue = "unknown";
  else if (!voltageMatches) issue = "voltage_mismatch";
  else if (outputCount < deviceCount) issue = "output_shortage";
  else if (externalPower === undefined) issue = "power_unknown";
  else if (!loadEvidenceKnown) issue = "rgb_load_unknown";
  else if (!railCapacityKnown) issue = "rgb_capacity_unknown";
  else if (currentOverLimit || powerOverLimit) issue = "rgb_power_over_limit";
  const rgbLoadStatus: AccessoryRgbConnectionPlan["rgbLoadStatus"] = issue === "rgb_power_over_limit"
    ? "over_limit"
    : issue === "none"
      ? "known"
      : "unknown";
  const status: AccessoryConnectivityPlanStatus = issue === "voltage_mismatch" || issue === "rgb_power_over_limit" ? "blocked" : issue === "none" ? "pass" : "review";
  const controllerOutputs = controllerVoltage === undefined
    ? ["확인 필요"]
    : [controllerVoltage === "mixed" ? "5V + 12V RGB" : `${controllerVoltage} RGB`];
  const deviceSummary = deviceLoad.additionalFanDeviceCount
    ? `RGB 연결 장치 ${deviceCount}개 · 케이스 ${deviceLoad.caseDeviceCount ?? 0}개 + 추가 팬 RGB ${deviceLoad.additionalFanDeviceCount}개`
    : `케이스 RGB ${deviceCount}개`;
  const summary = issue === "voltage_mismatch"
    ? "컨트롤러 전압이 케이스 RGB 장치와 달라 직접 연결할 수 없습니다."
    : issue === "output_shortage"
      ? "컨트롤러 출력 포트가 케이스 RGB 장치보다 적어 전체 연결을 확정할 수 없습니다."
      : issue === "power_unknown"
        ? "RGB 출력과 전압은 맞지만 컨트롤러 외부 전원 입력을 확인해야 합니다."
        : issue === "rgb_load_unknown"
          ? "RGB 장치별 소비전력·전류 근거가 없어 해당 전원 레일의 실제 부하를 계산할 수 없습니다."
          : issue === "rgb_capacity_unknown"
            ? "RGB 장치 부하는 확인됐지만 컨트롤러의 해당 전원 레일 최대 용량을 확인할 수 없습니다."
            : issue === "rgb_power_over_limit"
              ? "RGB 장치 부하가 컨트롤러의 해당 전원 레일 허용치를 초과해 이 연결을 사용할 수 없습니다."
        : issue === "unknown"
          ? "컨트롤러의 RGB 출력·전압·케이스 정보를 더 확인해야 합니다."
          : "케이스 RGB 장치를 컨트롤러 출력에 연결할 수 있는 기준을 확인했습니다.";
  return {
    id: `rgb-controller-plan:${controller.id}`,
    controllerId: controller.id,
    controllerName: controller.name,
    controllerOutputs,
    ...(externalPower ? { externalPower } : {}),
    deviceCount,
    ...(deviceVoltage ? { deviceVoltage } : {}),
    requiredVoltages,
    ...(outputCount !== undefined ? { outputCount } : {}),
    ...(powerRails.length > 0 ? { powerRails } : {}),
    ...(deviceLoad.caseDeviceCount !== undefined ? { caseDeviceCount: deviceLoad.caseDeviceCount } : {}),
    ...(deviceLoad.additionalFanDeviceCount !== undefined ? { additionalFanDeviceCount: deviceLoad.additionalFanDeviceCount } : {}),
    ...(deviceLoad.devices ? { devices: deviceLoad.devices.map(({ id, name, kind, count, voltage }) => ({ id, name, kind, count, ...(voltage ? { voltage } : {}) })) } : {}),
    rgbLoadStatus,
    ...(rgbPerDeviceCurrentA !== undefined ? { rgbPerDeviceCurrentA } : {}),
    ...(rgbPerDevicePowerW !== undefined ? { rgbPerDevicePowerW } : {}),
    ...(rgbTotalCurrentA !== undefined ? { rgbTotalCurrentA } : {}),
    ...(rgbTotalPowerW !== undefined ? { rgbTotalPowerW } : {}),
    ...(targetRail?.maxCurrentA !== undefined && rgbTotalCurrentA !== undefined ? { rgbCurrentHeadroomA: targetRail.maxCurrentA - rgbTotalCurrentA } : {}),
    ...(targetRail?.maxPowerW !== undefined && rgbTotalPowerW !== undefined ? { rgbPowerHeadroomW: targetRail.maxPowerW - rgbTotalPowerW } : {}),
    ...(deviceLoad.provenance ? { rgbLoadProvenance: deviceLoad.provenance } : {}),
    status,
    issue,
    summary: `${summary} ${deviceSummary} · 컨트롤러 출력 ${controllerOutputs.join(" · ")}${outputCount !== undefined ? ` · ${outputCount}포트` : ""}`
  };
}
