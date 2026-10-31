import type { PartSpecs } from "./types";

export type BuildConnectivityStatus = "pass" | "review" | "unknown" | "not_applicable";

export type BuildConnectivityItem = {
  id: "fan-headers" | "rgb-headers" | "rgb-voltage";
  ruleId: "case-fan-headers" | "case-rgb-headers" | "case-rgb-voltage";
  label: string;
  status: BuildConnectivityStatus;
  used?: number;
  capacity?: number;
  headroom?: number;
  detail: string;
};

export type BuildConnectivitySummary = {
  status: BuildConnectivityStatus;
  items: BuildConnectivityItem[];
};

function capacityItem(args: Omit<BuildConnectivityItem, "status" | "headroom"> & { used?: number; capacity?: number }) {
  const { used, capacity } = args;
  if (used === undefined || capacity === undefined) {
    return { ...args, status: "unknown" as const, detail: args.detail };
  }
  const headroom = capacity - used;
  return {
    ...args,
    status: headroom < 0 ? "review" as const : "pass" as const,
    headroom,
    detail: `${used}개 사용 / ${capacity}개 확인 / ${headroom >= 0 ? `${headroom}개 여유` : `${Math.abs(headroom)}개 부족`}`
  };
}

// 케이스 팬에 쓸 수 있는 메인보드 팬 헤더 수. CPU_FAN은 쿨러 몫이라 원래 세지 않고,
// 펌프 헤더는 공랭 쿨러일 때만 비어 있다. 쿨러 종류를 모르면 펌프 헤더를 빼고 센다.
// 선택한 쿨러 종류. 종류 표기가 없으면 라디에이터/높이 스펙으로 구분하고,
// 쿨러 없이 CPU 기본 쿨러를 쓰면 공랭이다.
export function buildCoolerTypeFor(cooler: PartSpecs | undefined, cpu: PartSpecs | undefined): "air" | "liquid" | undefined {
  if (cooler) return cooler.coolerType ?? (cooler.radiatorSizeMm !== undefined ? "liquid" : cooler.maxCoolerHeightMm !== undefined ? "air" : undefined);
  return cpu?.coolerIncluded === true ? "air" : undefined;
}

export function caseFanHeaderCapacityFor(motherboard: PartSpecs | undefined, coolerType?: "air" | "liquid") {
  const fanPortCount = motherboard?.fanPortCount;
  if (fanPortCount === undefined) return undefined;
  return fanPortCount + (coolerType === "air" ? motherboard?.pumpFanHeaderCount ?? 0 : 0);
}

export function buildConnectivitySummaryFor(motherboard: PartSpecs | undefined, computerCase: PartSpecs | undefined, coolerType?: "air" | "liquid"): BuildConnectivitySummary {
  if (!motherboard || !computerCase) return { status: "not_applicable", items: [] };

  const items: BuildConnectivityItem[] = [];
  const fanCount = computerCase.fanCount;
  const fanPortCount = caseFanHeaderCapacityFor(motherboard, coolerType);
  items.push(fanCount === 0
    ? { id: "fan-headers", ruleId: "case-fan-headers", label: "케이스 팬 연결", status: "pass", used: 0, capacity: fanPortCount, headroom: fanPortCount, detail: fanPortCount === undefined ? "케이스에 기본 팬은 없지만 메인보드 팬 연결 수를 확인해야 합니다." : `케이스 기본 팬 없음 / 메인보드 팬 연결 ${fanPortCount}개` }
    : computerCase.fanHubIncluded === true
      ? { id: "fan-headers", ruleId: "case-fan-headers", label: "케이스 팬 연결", status: "pass", used: fanCount, capacity: fanPortCount, detail: "케이스에 포함된 팬 허브로 연결" }
      : fanCount === undefined || fanPortCount === undefined
        ? { id: "fan-headers", ruleId: "case-fan-headers", label: "케이스 팬 연결", status: "unknown", used: fanCount, capacity: fanPortCount, detail: "케이스 기본 팬 수와 메인보드 팬 연결 수를 확인하세요. 팬 허브 포함 여부도 확인하세요." }
        : capacityItem({ id: "fan-headers", ruleId: "case-fan-headers", label: "케이스 팬 연결", used: fanCount, capacity: fanPortCount, detail: "" }));

  // 다나와는 RGB 헤더를 종류별로 한 번씩만 적고, ARGB/RGB 헤더 하나에 분배 케이블이나
  // 데이지 체인으로 여러 장치를 묶는 게 일반적이다. 장치 수와 헤더 수를 직접 비교하지
  // 않고, 헤더가 하나도 없을 때만 주의로 본다. 전압이 맞는지는 rgb-voltage가 따로 본다.
  const rgbDeviceCount = computerCase.rgbDeviceCount;
  const rgbPortCount = motherboard.rgbPortCount;
  items.push(rgbDeviceCount === 0
    ? { id: "rgb-headers", ruleId: "case-rgb-headers", label: "케이스 RGB 연결", status: "pass", used: 0, capacity: rgbPortCount, headroom: rgbPortCount, detail: rgbPortCount === undefined ? "케이스에 RGB 장치는 없지만 메인보드 RGB 연결 수를 확인해야 합니다." : `케이스 RGB 장치 없음 / 메인보드 RGB 연결 ${rgbPortCount}개` }
    : computerCase.rgbControllerIncluded === true
      ? { id: "rgb-headers", ruleId: "case-rgb-headers", label: "케이스 RGB 연결", status: "pass", used: rgbDeviceCount, capacity: rgbPortCount, detail: "케이스에 포함된 RGB 컨트롤러로 연결" }
      : rgbDeviceCount === undefined || rgbPortCount === undefined
        ? { id: "rgb-headers", ruleId: "case-rgb-headers", label: "케이스 RGB 연결", status: "unknown", used: rgbDeviceCount, capacity: rgbPortCount, detail: "케이스 RGB 장치 수와 메인보드 RGB 연결 수를 확인하세요. RGB 허브 포함 여부도 확인하세요." }
        : rgbPortCount > 0
          ? { id: "rgb-headers", ruleId: "case-rgb-headers", label: "케이스 RGB 연결", status: "pass", used: rgbDeviceCount, capacity: rgbPortCount, ...(rgbPortCount >= rgbDeviceCount ? { headroom: rgbPortCount - rgbDeviceCount } : {}), detail: rgbDeviceCount > rgbPortCount ? `${rgbDeviceCount}개 장치 / 메인보드 RGB 헤더 ${rgbPortCount}개 / 분배 케이블이나 데이지 체인으로 연결` : `${rgbDeviceCount}개 장치 / 메인보드 RGB 헤더 ${rgbPortCount}개` }
          : capacityItem({ id: "rgb-headers", ruleId: "case-rgb-headers", label: "케이스 RGB 연결", used: rgbDeviceCount, capacity: rgbPortCount, detail: "" }));

  const rgbVoltage = computerCase.rgbDeviceVoltage;
  if (rgbDeviceCount === 0) {
    items.push({ id: "rgb-voltage", ruleId: "case-rgb-voltage", label: "RGB 전압 연결", status: "pass", detail: "등록된 RGB 장치가 없어 비교할 대상이 없어요." });
  } else if (computerCase.rgbControllerIncluded === true) {
    items.push({ id: "rgb-voltage", ruleId: "case-rgb-voltage", label: "RGB 전압 연결", status: "pass", detail: "케이스 RGB 컨트롤러가 조명 전원을 맡아요." });
  } else if (rgbDeviceCount === undefined || !rgbVoltage) {
    items.push({ id: "rgb-voltage", ruleId: "case-rgb-voltage", label: "RGB 전압 연결", status: "unknown", detail: "케이스 RGB 장치의 연결 전압(5V 또는 12V)을 확인하세요." });
  } else {
    const requiredVoltages = rgbVoltage === "mixed" ? ["5V", "12V"] : [rgbVoltage];
    const headers: Record<string, number | undefined> = { "5V": motherboard.rgb5vPortCount, "12V": motherboard.rgb12vPortCount };
    const missingData = requiredVoltages.filter((voltage) => headers[voltage] === undefined);
    const missingHeaders = requiredVoltages.filter((voltage) => headers[voltage] === 0);
    items.push({
      id: "rgb-voltage",
      ruleId: "case-rgb-voltage",
      label: "RGB 전압 연결",
      status: missingData.length > 0 ? "unknown" : missingHeaders.length > 0 ? "review" : "pass",
      detail: missingData.length > 0
        ? `필요 전압 ${requiredVoltages.join(" + ")} / 메인보드의 해당 전압 연결 수 확인 필요`
        : missingHeaders.length > 0
          ? `필요 전압 ${requiredVoltages.join(" + ")} / ${missingHeaders.join("/")} 연결 단자 없음`
          : `필요 전압 ${requiredVoltages.join(" + ")} / 해당 전압 단자 확인됨`
    });
  }

  const activeItems = items.filter((item) => item.status !== "not_applicable");
  const status: BuildConnectivityStatus = activeItems.some((item) => item.status === "review")
    ? "review"
    : activeItems.some((item) => item.status === "unknown")
      ? "unknown"
      : activeItems.length > 0
        ? "pass"
        : "not_applicable";
  return { status, items };
}
