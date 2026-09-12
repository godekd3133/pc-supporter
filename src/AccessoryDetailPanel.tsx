import { useEffect, useState } from "react";
import { FiCheck, FiClock, FiDatabase, FiExternalLink, FiInfo, FiLoader, FiPlus, FiRefreshCw, FiTool, FiXCircle } from "react-icons/fi";
import type { AccessoryItem, CatalogChangeValueDiff } from "../shared/types";
import { ACCESSORY_CATEGORY_LABELS, DATA_FRESHNESS_LABELS, DATA_QUALITY_LABELS, isKnownPrice } from "../shared/types";
import { priceWatchDecisionFor } from "../shared/price-watch-decision";
import type { PriceWatchDecisionHistory } from "../shared/price-watch-decision";
import { api } from "./api";
import { safeExternalUrl } from "./safe-source-url";
import { catalogPriceEvidenceDescriptionFor, catalogPriceEvidenceFor, catalogPriceEvidenceLabelFor } from "../shared/catalog-price-evidence";
import { CatalogRefreshDiffPanel } from "./CatalogRefreshDiffPanel";

function formatWon(value: number | undefined) {
  return isKnownPrice(value) ? `${value.toLocaleString("ko-KR")}원` : "가격 확인 필요";
}

function valueText(value: unknown, suffix = "") {
  if (value === undefined || value === null || value === "") return undefined;
  if (Array.isArray(value)) return value.length > 0 ? `${value.join(" · ")}${suffix}` : undefined;
  if (typeof value === "boolean") return value ? "있음" : "없음";
  return `${String(value)}${suffix}`;
}

function accessorySpecRowsFor(item: AccessoryItem) {
  const specs = item.specs;
  const rows: Array<[string, string | undefined]> = [
    ["연결 방식", valueText(specs.interface)],
    ["폼팩터", valueText(specs.formFactor)],
    ["지원 규격", valueText(specs.supportedFormFactors)],
    ["어댑터 동시 장착 최대", valueText(specs.adapterStorageDeviceCount, "개")],
    ["PCIe 요구 슬롯 폭", specs.adapterPcieSlotWidth === undefined ? undefined : `x${specs.adapterPcieSlotWidth}`],
    ["M.2 규격", valueText(specs.m2Interfaces)],
    ["M.2 PCIe 세대", valueText(specs.m2PcieGenerations?.map((generation) => `PCIe ${generation.toFixed(1)}`))],
    ["용량", valueText(specs.capacityGb, "GB")],
    ["크기", valueText(specs.lengthMm, "mm")],
    ["너비", valueText(specs.widthMm, "mm")],
    ["두께", valueText(specs.thicknessMm, "mm")],
    ["팬 크기", valueText(specs.fanCount, "개")],
    ["팬 소비전류", valueText(specs.fanCurrentA, "A")],
    ["팬 포트", valueText(specs.fanPortCount, "개")],
    ["RGB 포트", valueText(specs.rgbPortCount, "개")],
    ["5V ARGB 포트", valueText(specs.rgb5vPortCount, "개")],
    ["12V RGB 포트", valueText(specs.rgb12vPortCount, "개")],
    ["RGB 장치 수", valueText(specs.rgbDeviceCount, "개")],
    ["RGB 전압", valueText(specs.rgbDeviceVoltage)],
    ["RGB 소비전류", valueText(specs.rgbDeviceCurrentA, "A")],
    ["RGB 소비전력", valueText(specs.rgbDevicePowerW, "W")],
    ["출력", valueText(specs.outputW, "W")],
    ["용량", valueText(specs.capacityVa, "VA")],
    ["콘센트", valueText(specs.outletCount, "개")],
    ["열전도율", valueText(specs.thermalConductivityWmK, "W/(m·K)")]
  ];
  return rows.filter((row): row is [string, string] => row[1] !== undefined).slice(0, 16);
}

type AccessoryPriceHistory = {
  windowDays: 7 | 30 | 90;
  points: Array<{ changeId: string; changedAt: string; priceWon: number }>;
  summary: PriceWatchDecisionHistory & { maxPriceWon?: number };
};

function historyBarHeight(history: AccessoryPriceHistory, priceWon: number) {
  const prices = history.points.map((point) => point.priceWon);
  const minPriceWon = Math.min(...prices);
  const maxPriceWon = Math.max(...prices);
  if (maxPriceWon === minPriceWon) return 52;
  return 18 + ((priceWon - minPriceWon) / (maxPriceWon - minPriceWon)) * 82;
}

export function AccessoryDetailPanel({ item, selected, isWatched, isCachedFallback = false, cachedAt, refreshing = false, onRefresh, refreshMessage, refreshError, refreshDiffs, onAdd, onWatch, onOpenWatchlist, onClose }: { item: AccessoryItem; selected: boolean; isWatched: boolean; isCachedFallback?: boolean; cachedAt?: string; refreshing?: boolean; onRefresh?: () => void; refreshMessage?: string; refreshError?: string; refreshDiffs?: CatalogChangeValueDiff[]; onAdd: () => void; onWatch: () => boolean; onOpenWatchlist: () => void; onClose: () => void }) {
  const [watching, setWatching] = useState(isWatched);
  const [priceHistoryDays, setPriceHistoryDays] = useState<7 | 30 | 90>(30);
  const [priceHistory, setPriceHistory] = useState<AccessoryPriceHistory | null>(null);
  const [priceHistoryLoading, setPriceHistoryLoading] = useState(true);
  const [priceHistoryError, setPriceHistoryError] = useState<string | null>(null);
  const [priceHistoryRetryNonce, setPriceHistoryRetryNonce] = useState(0);
  const sourceUrl = safeExternalUrl(item.danawaUrl);
  const freshness = item.dataFreshness ?? "unknown";
  const rows = accessorySpecRowsFor(item);
  const priceEvidence = catalogPriceEvidenceFor(item);
  const decision = priceWatchDecisionFor({ currentStatus: isKnownPrice(item.priceWon) ? "available" : "unavailable", currentPriceWon: item.priceWon, history: priceHistory?.summary });
  const cachedDate = cachedAt ? new Date(cachedAt) : undefined;
  const cachedLabel = cachedDate && !Number.isNaN(cachedDate.getTime()) ? cachedDate.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" }) : "기록 시각 확인 필요";

  useEffect(() => setWatching(isWatched), [isWatched, item.id]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setPriceHistoryLoading(true);
    setPriceHistoryError(null);
    void api<{ items: AccessoryPriceHistory[] }>(`/api/price-history?ids=${encodeURIComponent(`accessory:${item.id}`)}&days=${priceHistoryDays}`, { retry: 1, signal: controller.signal })
      .then((payload) => { if (!cancelled) setPriceHistory(payload.items[0] ?? null); })
      .catch((reason: unknown) => { if (!cancelled) { setPriceHistory(null); setPriceHistoryError(reason instanceof Error ? reason.message : "주변 부품 가격 이력을 확인하지 못했습니다."); } })
      .finally(() => { if (!cancelled) setPriceHistoryLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [item.id, item.updatedAt, priceHistoryDays, priceHistoryRetryNonce]);

  return <section className="accessory-detail-panel" aria-label="선택한 주변 부품 상세" data-testid="accessory-detail-panel">
    <div className="accessory-detail-heading"><div><p className="eyebrow">PERIPHERAL DETAIL</p><h2>{item.name}</h2><p>{ACCESSORY_CATEGORY_LABELS[item.category]} · {item.brand ?? item.model ?? "주변 부품"}</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="주변 부품 상세 닫기"><FiXCircle /></button></div>
    {isCachedFallback && <div className="accessory-detail-cache-state" data-testid="accessory-detail-cache-state" role="status"><span><FiDatabase /></span><div><strong>캐시 기반 상세</strong><p>서버 목록이 복구되기 전까지 브라우저에 저장된 기본 정보로 표시합니다. 이 상태는 최신 원문·실시간 가격·호환성 확정이 아닙니다.</p><small>캐시 저장 {cachedLabel}</small></div>{onRefresh && <button className="button button-small button-light" type="button" data-testid="accessory-detail-refresh" onClick={onRefresh} disabled={refreshing}>{refreshing ? <><FiLoader className="spin" /> 원문 확인 중...</> : <><FiRefreshCw /> 원문 다시 확인</>}</button>}</div>}
    <div className="accessory-detail-badges"><span>{DATA_QUALITY_LABELS[item.dataQuality]}</span><span>{DATA_FRESHNESS_LABELS[freshness]}</span><span>주변 부품</span>{item.updatedAt && <span>갱신 {new Date(item.updatedAt).toLocaleDateString("ko-KR")}</span>}</div>
    {!isCachedFallback && onRefresh && <div className="accessory-detail-refresh" data-testid="accessory-detail-refresh-bar"><div><FiRefreshCw /><span><strong>원문·가격 재확인</strong><small>저장된 다나와 상품 페이지를 다시 읽고 변경 이력을 남깁니다.</small></span></div><button className="button button-small button-light" type="button" data-testid="accessory-detail-refresh" onClick={onRefresh} disabled={refreshing}>{refreshing ? <><FiLoader className="spin" /> 확인 중...</> : <><FiRefreshCw /> 지금 확인</>}</button></div>}
    {refreshMessage && <p className="accessory-detail-refresh-feedback success" data-testid="accessory-detail-refresh-success"><FiCheck /> {refreshMessage}</p>}
    {refreshError && <p className="accessory-detail-refresh-feedback error" data-testid="accessory-detail-refresh-error" role="alert"><FiXCircle /> {refreshError}</p>}
    {refreshDiffs !== undefined && <CatalogRefreshDiffPanel diffs={refreshDiffs} kind="accessory" />}
    <div className="accessory-detail-price"><div><span>현재 가격</span><small className={`accessory-detail-price-evidence ${priceEvidence}`} data-testid="accessory-price-evidence" title={catalogPriceEvidenceDescriptionFor(item)}>{catalogPriceEvidenceLabelFor(item)}</small></div><strong>{formatWon(item.priceWon)}</strong></div>
    <section className={`accessory-detail-price-history ${decision.state}`} aria-label="주변 부품 가격 이력" data-testid="accessory-detail-price-history"><div className="accessory-detail-price-history-heading"><div><strong>가격 이력·행동 상태</strong><small>{decision.label} · 현재 가격과 선택 기간의 카탈로그 변경을 분리해 표시합니다.</small></div><label><span>기간</span><select aria-label="주변 부품 가격 이력 기간" value={priceHistoryDays} onChange={(event) => setPriceHistoryDays(Number(event.target.value) as 7 | 30 | 90)}><option value={7}>7일</option><option value={30}>30일</option><option value={90}>90일</option></select></label></div>{priceHistoryLoading ? <p className="accessory-detail-price-history-state"><FiLoader className="spin" /> 최근 가격 이력을 확인하는 중...</p> : priceHistoryError ? <p className="accessory-detail-price-history-state error" role="alert"><FiXCircle /> {priceHistoryError} <button className="text-button" type="button" onClick={() => setPriceHistoryRetryNonce((current) => current + 1)}><FiRefreshCw /> 다시 확인</button></p> : !priceHistory || priceHistory.summary.sampleCount === 0 ? <p className="accessory-detail-price-history-state"><FiInfo /> 선택한 기간에 기록된 가격 변경이 없습니다. 현재 가격만 확인된 경우에도 추세를 추정하지 않습니다.</p> : <><div className="accessory-detail-price-history-summary"><span>최근 {priceHistory.windowDays}일 {priceHistory.summary.sampleCount}회</span>{priceHistory.summary.minPriceWon !== undefined && <span>최저 {formatWon(priceHistory.summary.minPriceWon)}</span>}{priceHistory.summary.maxPriceWon !== undefined && <span>최고 {formatWon(priceHistory.summary.maxPriceWon)}</span>}{priceHistory.summary.currentPositionPercent !== undefined && <span>현재 위치 {priceHistory.summary.currentPositionPercent.toFixed(1)}%</span>}</div>{priceHistory.points.length > 0 && <div className="accessory-detail-price-history-chart" role="img" aria-label={`${item.name} 최근 ${priceHistory.windowDays}일 가격 추세`}>{priceHistory.points.map((point) => <span key={point.changeId} style={{ height: historyBarHeight(priceHistory, point.priceWon) + "%" }} title={`${point.priceWon.toLocaleString("ko-KR")}원 · ${new Date(point.changedAt).toLocaleDateString("ko-KR")}`} />)}</div>}</>}</section>
    {rows.length > 0 ? <dl className="accessory-detail-specs">{rows.map(([label, value]) => <div key={`${label}-${value}`}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : <p className="accessory-detail-empty"><FiInfo /> 정규화된 규격을 확인하지 못했습니다. 원문 스펙을 확인해 주세요.</p>}
    {item.missingFields.length > 0 && <p className="accessory-detail-missing"><FiInfo /> 확인되지 않은 정보 {item.missingFields.slice(0, 5).join(", ")}{item.missingFields.length > 5 ? ` 외 ${item.missingFields.length - 5}개` : ""}</p>}
    {item.rawSpecText && <details className="accessory-detail-raw"><summary>저장된 원문 스펙 보기</summary><p>{item.rawSpecText}</p></details>}
    <div className="accessory-detail-actions"><button className={watching ? "text-button accessory-watch-button watched" : "text-button accessory-watch-button"} type="button" onClick={() => { if (onWatch()) setWatching(true); }} disabled={watching} aria-label={`${item.name} 가격 추적 ${watching ? "등록됨" : "등록"}`}><FiClock /> {watching ? "추적 중" : "가격 추적"}</button><button className="button button-light" type="button" onClick={onOpenWatchlist}><FiClock /> 가격 추적 화면</button><button className="button button-primary" type="button" onClick={onAdd} disabled={selected}>{selected ? <><FiCheck /> 견적에 추가됨</> : <><FiPlus /> 견적에 추가</>}</button>{sourceUrl && <a className="button button-light" href={sourceUrl} target="_blank" rel="noreferrer"><FiExternalLink /> 원문 열기</a>}</div>
    <p className="accessory-detail-note"><FiTool /> 주변 부품의 규격·가격·출처를 확인하는 화면입니다. 견적에 추가하면 전체 호환성 검사에서 본체·케이스·메인보드 연결 조건을 다시 계산합니다.</p>
  </section>;
}
