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
    detail: `${used}개 사용 · ${capacity}개 확인 · ${headroom >= 0 ? `${headroom}개 여유` : `${Math.abs(headroom)}개 부족`}`
  };
}

export function buildConnectivitySummaryFor(motherboard: PartSpecs | undefined, computerCase: PartSpecs | undefined): BuildConnectivitySummary {
  if (!motherboard || !computerCase) return { status: "not_applicable", items: [] };

  const items: BuildConnectivityItem[] = [];
  const fanCount = computerCase.fanCount;
  const fanPortCount = motherboard.fanPortCount;
  items.push(fanCount === 0
    ? { id: "fan-headers", ruleId: "case-fan-headers", label: "케이스 기본 팬 연결", status: "pass", used: 0, capacity: fanPortCount, headroom: fanPortCount, detail: fanPortCount === undefined ? "등록된 케이스 기본 팬은 없지만 메인보드 팬 헤더 수는 확인 필요" : `등록된 케이스 기본 팬 없음 · 메인보드 팬 헤더 ${fanPortCount}개` }
    : fanCount === undefined || fanPortCount === undefined
      ? { id: "fan-headers", ruleId: "case-fan-headers", label: "케이스 기본 팬 연결", status: "unknown", used: fanCount, capacity: fanPortCount, detail: "케이스 기본 팬 또는 메인보드 팬 헤더 수를 확인할 수 없습니다. 팬 허브·컨트롤러 포함 여부를 확인하세요." }
      : capacityItem({ id: "fan-headers", ruleId: "case-fan-headers", label: "케이스 기본 팬 연결", used: fanCount, capacity: fanPortCount, detail: "" }));

  const rgbDeviceCount = computerCase.rgbDeviceCount;
  const rgbPortCount = motherboard.rgbPortCount;
  items.push(rgbDeviceCount === 0
    ? { id: "rgb-headers", ruleId: "case-rgb-headers", label: "케이스 RGB 헤더 연결", status: "pass", used: 0, capacity: rgbPortCount, headroom: rgbPortCount, detail: rgbPortCount === undefined ? "등록된 RGB 장치는 없지만 메인보드 RGB 헤더 수는 확인 필요" : `등록된 케이스 RGB 장치 없음 · 메인보드 RGB 헤더 ${rgbPortCount}개` }
    : rgbDeviceCount === undefined || rgbPortCount === undefined
      ? { id: "rgb-headers", ruleId: "case-rgb-headers", label: "케이스 RGB 헤더 연결", status: "unknown", used: rgbDeviceCount, capacity: rgbPortCount, detail: "케이스 RGB 장치 또는 메인보드 RGB 헤더 수를 확인할 수 없습니다. RGB 허브 포함 여부를 확인하세요." }
      : capacityItem({ id: "rgb-headers", ruleId: "case-rgb-headers", label: "케이스 RGB 헤더 연결", used: rgbDeviceCount, capacity: rgbPortCount, detail: "" }));

  const rgbVoltage = computerCase.rgbDeviceVoltage;
  if (rgbDeviceCount === 0) {
    items.push({ id: "rgb-voltage", ruleId: "case-rgb-voltage", label: "RGB 전압 연결", status: "pass", detail: "등록된 RGB 장치가 없어 전압 대조 대상이 없습니다." });
  } else if (rgbDeviceCount === undefined || !rgbVoltage) {
    items.push({ id: "rgb-voltage", ruleId: "case-rgb-voltage", label: "RGB 전압 연결", status: "unknown", detail: "케이스 RGB 장치 수 또는 5V/12V 전압을 확인할 수 없습니다." });
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
        ? `필요 전압 ${requiredVoltages.join(" + ")} · 메인보드 전압별 헤더 수 확인 필요`
        : missingHeaders.length > 0
          ? `필요 전압 ${requiredVoltages.join(" + ")} · ${missingHeaders.join("·")} 헤더 없음`
          : `필요 전압 ${requiredVoltages.join(" + ")} · 전압별 헤더 확인됨`
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
