import { useEffect, useMemo, useState } from "react";
import { FiInfo, FiLoader, FiTrendingUp } from "react-icons/fi";
import type { AccessoryItem, BuildSelection, Part, PartCategory } from "../shared/types";
import type { BuildPriceSnapshot } from "../shared/build-price-summary";
import { CATEGORY_LABELS, PART_CATEGORIES, isKnownPrice } from "../shared/types";
import { priceTrendFor, type PriceTrendHistoryPoint, type PriceTrendWindow } from "../shared/price-trend";
import { api } from "./api";
import { accessorySelections, selectionList } from "./build-edit";
import { PriceTrendChart } from "./PriceTrendChart";

type PriceHistoryFailureNotice = { kind: "error"; message: string };

type PublicPriceHistoryItem = {
  kind: "part" | "accessory";
  itemId: string;
  points: PriceTrendHistoryPoint[];
};

type QuoteTrendRow = {
  key: string;
  kind: "part" | "accessory";
  itemId: string;
  label: string;
  quantity: number;
  currentPriceWon?: number;
};

function onlinePriceHistoryFailureNotice(): PriceHistoryFailureNotice {
  return { kind: "error", message: "가격 이력을 불러오지 못했습니다. 현재 합계만 표시합니다." };
}

function formatWon(value: number | undefined) {
  return value === undefined ? "-" : `${value.toLocaleString("ko-KR")}원`;
}

function formatDelta(value: number | undefined) {
  if (value === undefined) return "변화 정보 부족";
  if (value === 0) return "변화 없음";
  return `${value > 0 ? "+" : ""}${value.toLocaleString("ko-KR")}원`;
}

function selectionsFor(build: BuildSelection, partMap: ReadonlyMap<string, Part>, accessoryMap: ReadonlyMap<string, AccessoryItem>): QuoteTrendRow[] {
  const partRows = PART_CATEGORIES.flatMap((category: PartCategory) => selectionList(build, category).map((selection) => {
    const part = partMap.get(selection.partId);
    return {
      key: `part:${selection.partId}`,
      kind: "part" as const,
      itemId: selection.partId,
      label: part?.name ?? CATEGORY_LABELS[category],
      quantity: selection.quantity,
      ...(part && isKnownPrice(part.priceWon) ? { currentPriceWon: part.priceWon } : {})
    };
  }));
  const accessoryRows = accessorySelections(build).map((selection) => {
    const item = accessoryMap.get(selection.accessoryId);
    return {
      key: `accessory:${selection.accessoryId}`,
      kind: "accessory" as const,
      itemId: selection.accessoryId,
      label: item?.name ?? "주변 부품",
      quantity: selection.quantity,
      ...(item && isKnownPrice(item.priceWon) ? { currentPriceWon: item.priceWon } : {})
    };
  });
  return [...partRows, ...accessoryRows];
}

export function BuildPriceTrendPanel({ build, partMap, accessoryMap, snapshot }: { build: BuildSelection; partMap: ReadonlyMap<string, Part>; accessoryMap: ReadonlyMap<string, AccessoryItem>; snapshot: BuildPriceSnapshot }) {
  const [days, setDays] = useState<PriceTrendWindow>(30);
  const [histories, setHistories] = useState<Record<string, PublicPriceHistoryItem>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<PriceHistoryFailureNotice | null>(null);
  const rows = useMemo(() => selectionsFor(build, partMap, accessoryMap), [accessoryMap, build, partMap]);
  const requestRows = useMemo(() => rows.slice(0, 50), [rows]);
  const ids = useMemo(() => requestRows.map((row) => row.key).join(","), [requestRows]);
  const trend = useMemo(() => priceTrendFor(requestRows.map((row) => ({ ...row, points: histories[row.key]?.points ?? [] })), { days }), [days, histories, requestRows]);
  const driver = trend.drivers[0];

  useEffect(() => {
    if (!ids) {
      setHistories({});
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void api<{ items: PublicPriceHistoryItem[] }>(`/api/price-history?ids=${encodeURIComponent(ids)}&days=${days}`, { retry: 1, signal: controller.signal })
      .then((payload) => {
        if (cancelled) return;
        setHistories(Object.fromEntries(payload.items.map((item) => [`${item.kind}:${item.itemId}`, item])));
      })
      .catch(() => {
        if (cancelled) return;
        setError(onlinePriceHistoryFailureNotice());
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [days, ids]);

  if (rows.length === 0) return null;
  const chartReady = trend.points.length > 0 && trend.historicalSampleCount > 0;
  const noHistory = !loading && !error && !chartReady;
  const historyLoaded = Object.keys(histories).length > 0;
  const netPercent = trend.latestPriceWon !== undefined && trend.netDeltaWon !== undefined && trend.latestPriceWon - trend.netDeltaWon > 0
    ? (trend.netDeltaWon / (trend.latestPriceWon - trend.netDeltaWon)) * 100
    : undefined;
  const visibleDrivers = trend.drivers.slice(0, 4);

  return <section className={`build-price-trend-panel${noHistory ? " empty" : ""}`} aria-label="전체 견적 가격 변화" data-testid="build-price-trend-panel">
    <div className="build-price-trend-heading"><div><h2>견적 가격 변화</h2><p>선택한 부품의 가격 기록을 모아 기간별 변화를 보여줍니다.</p></div></div>
    <div className="build-price-trend-summary-row"><div className="build-price-trend-total"><div><span>{snapshot.priceComplete ? "현재 총견적" : "현재 총액"}</span><strong>{formatWon(snapshot.totalPriceWon || trend.latestPriceWon)}</strong></div>{chartReady && trend.netDeltaWon !== undefined && <em className={trend.netDeltaWon > 0 ? "increased" : trend.netDeltaWon < 0 ? "decreased" : "same"}>{formatDelta(trend.netDeltaWon)}{netPercent !== undefined ? ` · ${netPercent > 0 ? "+" : ""}${netPercent.toFixed(1)}%` : ""}</em>}</div>
      <div className="build-price-trend-range" role="group" aria-label="가격 확인 기간">{([7, 30, 90] as const).map((option) => <button className={days === option ? "selected" : ""} type="button" aria-pressed={days === option} data-testid={`build-price-trend-days-${option}`} onClick={() => setDays(option)} key={option}>{option}일</button>)}</div></div>
    {loading && !historyLoaded ? <div className="build-price-trend-state" role="status"><FiLoader className="spin" /> 가격 이력을 불러오는 중...</div> : error && !historyLoaded ? <div className={`build-price-trend-state${error.kind === "error" ? " error" : ""}`} role="status"><FiInfo /> {error.message}</div> : !chartReady ? <div className="build-price-trend-state"><FiInfo /> 이 기간에는 가격 기록이 없습니다.</div> : <PriceTrendChart points={trend.points} ariaLabel={`전체 견적 ${days}일 가격 변화`} testId="build-price-trend-chart" />}
    {driver && <div className="build-price-trend-insight"><span><FiTrendingUp /></span><div><strong>가격 변화가 가장 큰 부품은 {driver.label}입니다.</strong><small>최근 {days}일 · {formatDelta(driver.deltaWon)}</small></div></div>}
    {visibleDrivers.length > 0 && <div className="build-price-trend-items" aria-label="견적 가격 변화 부품"><div className="build-price-trend-items-heading"><strong>주요 부품별 변화</strong><span>현재 가격 기준</span></div>{visibleDrivers.map((item) => <div className="build-price-trend-item" key={item.key}><span>{item.label}</span><strong>{formatDelta(item.deltaWon)}</strong></div>)}</div>}
  </section>;
}
