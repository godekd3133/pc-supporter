export interface PriceAlertEntry {
  itemKey: string;
  itemName: string;
  targetPriceWon?: number;
}

export interface PriceObservation {
  priceWon?: number;
  status: "available" | "unavailable" | "error";
}

export interface PriceWatchAlert {
  id: string;
  itemKey: string;
  message: string;
  kind: "drop" | "target" | "availability";
  createdAt: string;
  readAt?: string;
}

export const PRICE_ALERT_DROP_THRESHOLDS = [0, 1, 5] as const;
export type PriceAlertDropThreshold = (typeof PRICE_ALERT_DROP_THRESHOLDS)[number];
export interface PriceAlertPolicy {
  targetReached: boolean;
  priceDrop: boolean;
  priceAvailability: boolean;
  minimumDropPercent: PriceAlertDropThreshold;
}

export const DEFAULT_PRICE_ALERT_POLICY: PriceAlertPolicy = {
  targetReached: true,
  priceDrop: true,
  priceAvailability: true,
  minimumDropPercent: 0
};

export function priceAlertPolicyFromUnknown(value: unknown): PriceAlertPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_PRICE_ALERT_POLICY;
  const candidate = value as Partial<PriceAlertPolicy>;
  const targetReached = candidate.targetReached === undefined ? true : candidate.targetReached;
  const priceDrop = candidate.priceDrop === undefined ? true : candidate.priceDrop;
  const priceAvailability = candidate.priceAvailability === undefined ? true : candidate.priceAvailability;
  const minimumDropPercent = candidate.minimumDropPercent === undefined ? 0 : candidate.minimumDropPercent;
  if (typeof targetReached !== "boolean" || typeof priceDrop !== "boolean" || typeof priceAvailability !== "boolean" || !PRICE_ALERT_DROP_THRESHOLDS.includes(minimumDropPercent as PriceAlertDropThreshold)) return DEFAULT_PRICE_ALERT_POLICY;
  return { targetReached, priceDrop, priceAvailability, minimumDropPercent: minimumDropPercent as PriceAlertDropThreshold };
}

export function priceAlertPolicyText(policy: PriceAlertPolicy = DEFAULT_PRICE_ALERT_POLICY) {
  const labels = [
    ...(policy.targetReached ? ["목표가 도달"] : []),
    ...(policy.priceDrop ? [`하락 ${policy.minimumDropPercent === 0 ? "모든 하락" : policy.minimumDropPercent + "% 이상"}`] : []),
    ...(policy.priceAvailability ? ["가격 상태 변화"] : [])
  ];
  return labels.length > 0 ? labels.join(" · ") : "알림 꺼짐";
}

export function priceAlertsFor(entries: PriceAlertEntry[], previous: Record<string, PriceObservation>, current: Record<string, PriceObservation>, createdAt: string, policy: PriceAlertPolicy = DEFAULT_PRICE_ALERT_POLICY): PriceWatchAlert[] {
  const alerts: PriceWatchAlert[] = [];
  entries.forEach((entry) => {
    const before = previous[entry.itemKey];
    const after = current[entry.itemKey];
    if (!before || !after || after.status === "error") return;
    if (policy.priceAvailability && before.status !== after.status && before.status !== "error") {
      alerts.push({ id: entry.itemKey + ":availability:" + createdAt, itemKey: entry.itemKey, kind: "availability", message: after.status === "available" ? entry.itemName + "의 가격을 다시 확인할 수 있습니다." : entry.itemName + "의 가격을 확인할 수 없습니다.", createdAt });
      return;
    }
    if (before.status !== "available" || after.status !== "available" || before.priceWon === undefined || after.priceWon === undefined) return;
    const reachedTarget = policy.targetReached && entry.targetPriceWon !== undefined && before.priceWon > entry.targetPriceWon && after.priceWon <= entry.targetPriceWon;
    const dropPercent = ((before.priceWon - after.priceWon) / before.priceWon) * 100;
    if (reachedTarget) {
      alerts.push({ id: entry.itemKey + ":target:" + createdAt, itemKey: entry.itemKey, kind: "target", message: entry.itemName + "이 목표가에 도달했습니다.", createdAt });
    } else if (policy.priceDrop && after.priceWon < before.priceWon && dropPercent >= policy.minimumDropPercent) {
      alerts.push({ id: entry.itemKey + ":drop:" + createdAt, itemKey: entry.itemKey, kind: "drop", message: entry.itemName + " 가격이 " + (before.priceWon - after.priceWon).toLocaleString("ko-KR") + "원 하락했습니다.", createdAt });
    }
  });
  return alerts;
}
