import { useEffect, useMemo, useState } from "react";
import { FiActivity, FiArrowLeft, FiBox, FiCheck, FiDatabase, FiExternalLink, FiInfo, FiLoader, FiPlus, FiRefreshCw, FiSearch } from "react-icons/fi";
import type { BuildSelection, DataFreshness, DataQuality, ListingPolicy, Part, PartCategory, PriceAvailabilityFilter } from "../shared/types";
import { CATEGORY_LABELS, DATA_FRESHNESS_LABELS, isKnownPrice, LISTING_POLICY_LABELS, PART_CATEGORIES, PRICE_AVAILABILITY_LABELS } from "../shared/types";
import { classifyDataFreshness } from "../shared/data-freshness";
import { safeExternalUrl } from "../shared/safe-source-url";
import { ApiError, api } from "./api";

type CatalogSort = "price_asc" | "price_desc" | "name" | "updated";
type CatalogResponse = { items: Part[]; total: number; offset: number; limit: number; priceExcludedCount?: number; freshnessExcludedCount?: number };
const PAGE_SIZE = 24;
const QUALITY_LABELS: Record<DataQuality, string> = { live: "다나와 최신", seed: "프로젝트 데이터", manual: "수동 검수", incomplete: "일부 스펙 부족" };

function selectedPartIdsFor(build: BuildSelection, category: PartCategory) {
  if (category === "memory") return build.memory.map((item) => item.partId);
  if (category === "ssd") return build.ssd.map((item) => item.partId);
  if (category === "hdd") return build.hdd.map((item) => item.partId);
  const selection = build[category];
  return selection ? [selection.partId] : [];
}

function sourceLabel(source: Part["source"]) {
  return source === "danawa" ? "다나와 수집" : source === "manual" ? "수동 검수" : "프로젝트 데이터";
}

function freshnessLabel(part: Part) {
  const freshness = part.dataFreshness ?? classifyDataFreshness(part.updatedAt);
  return DATA_FRESHNESS_LABELS[freshness];
}

function priceLabel(priceWon: number | undefined) {
  return isKnownPrice(priceWon) ? `${priceWon.toLocaleString("ko-KR")}원` : "가격 확인 필요";
}

function compactSummary(part: Part) {
  const values = [
    part.specs.socket,
    part.specs.memoryType,
    part.specs.capacityGb !== undefined ? `${part.specs.capacityGb}GB` : undefined,
    part.specs.vramGb !== undefined ? `VRAM ${part.specs.vramGb}GB` : undefined,
    part.specs.wattageW !== undefined ? `${part.specs.wattageW}W` : undefined,
    part.specs.formFactor,
    part.specs.interface
  ].filter((value): value is string => typeof value === "string");
  return values.slice(0, 4).join(" · ") || "상세 스펙 확인 필요";
}

function specRowsFor(part: Part) {
  const specs = part.specs;
  const rows: Array<[string, string]> = [];
  const add = (label: string, value: unknown, suffix = "") => {
    if (value === undefined || value === null || value === "") return;
    const text = Array.isArray(value) ? value.join(" · ") : typeof value === "boolean" ? value ? "있음" : "없음" : String(value);
    rows.push([label, `${text}${suffix}`]);
  };
  add("소켓", specs.socket);
  add("지원 소켓", specs.supportedSockets);
  add("메모리 세대", specs.memoryType);
  add("메모리 규격", specs.memoryFormFactor);
  add("코어", specs.cores, "코어");
  add("스레드", specs.threads, "스레드");
  add("부스트 클럭", specs.boostClockGhz, "GHz");
  add("TDP", specs.tdpW, "W");
  add("PPT", specs.pptW, "W");
  add("내장 그래픽", specs.integratedGraphics);
  add("CPU 싱글 점수", specs.cinebenchR23Single);
  add("CPU 멀티 점수", specs.cinebenchR23Multi);
  add("최대 메모리", specs.maxMemoryGb, "GB");
  add("메모리 슬롯", specs.memorySlots, "개");
  add("메모리 속도", specs.speedMhz, "MHz");
  add("킷 모듈 수", specs.memoryModuleCountPerKit, "개");
  add("메모리 타이밍", specs.memoryTiming);
  add("CAS 지연", specs.memoryCasLatency, "");
  add("용량", specs.capacityGb, "GB");
  add("연결 방식", specs.interface);
  add("폼팩터", specs.formFactor);
  add("순차 읽기", specs.sequentialReadMbps, "MB/s");
  add("순차 쓰기", specs.sequentialWriteMbps, "MB/s");
  add("컨트롤러", specs.ssdController);
  add("낸드", specs.ssdNandType);
  add("TBW", specs.ssdTbwTb, "TB");
  add("GPU 제조사", specs.gpuVendor);
  add("GPU 아키텍처", specs.gpuArchitectureFamily);
  add("VRAM", specs.vramGb, "GB");
  add("GPU 메모리", specs.gpuMemoryType);
  add("GPU 소비전력", specs.powerW, "W");
  add("권장 파워", specs.recommendedPsuW, "W");
  add("GPU 길이", specs.lengthMm, "mm");
  add("GPU 폭", specs.widthMm, "mm");
  add("GPU 두께", specs.thicknessMm, "mm");
  add("GPU 슬롯 점유", specs.gpuSlotOccupancy, "slot");
  add("Time Spy", specs.gpu3dmarkTimeSpyScore);
  add("Port Royal", specs.gpu3dmarkPortRoyalScore);
  add("메인보드 규격", specs.motherboardFormFactors);
  add("M.2 슬롯", specs.m2Slots, "개");
  add("SATA 포트", specs.sataPorts, "개");
  add("PCIe x16 슬롯", specs.pcieX16Slots, "개");
  add("최대 GPU 길이", specs.maxGpuLengthMm, "mm");
  add("최대 쿨러 높이", specs.maxCoolerHeightMm, "mm");
  add("최대 PSU 길이", specs.maxPsuLengthMm, "mm");
  add("HDD 베이", specs.hddBays, "개");
  add("SSD 베이", specs.ssdBays, "개");
  add("최대 냉각 용량", specs.maxCoolingW, "W");
  add("PSU 규격", specs.psuFormFactor);
  add("PSU 깊이", specs.psuDepthMm, "mm");
  add("정격 출력", specs.wattageW, "W");
  add("효율", specs.efficiency);
  add("케이블", specs.psuCableType === "fully_modular" ? "풀모듈러" : specs.psuCableType === "semi_modular" ? "세미모듈러" : specs.psuCableType === "fixed" ? "케이블 일체형" : undefined);
  add("레일", specs.psuRailType === "single" ? "싱글 레일" : specs.psuRailType === "multi" ? "멀티 레일" : undefined);
  add("팬 수", specs.fanCount, "개");
  add("팬 포트", specs.fanPortCount, "개");
  add("RGB 포트", specs.rgbPortCount, "개");
  return rows.filter(([, value], index, all) => all.findIndex(([, candidate]) => candidate === value) === index).slice(0, 18);
}

function CatalogPartCard({ part, selected, onSelect, onAdd }: { part: Part; selected: boolean; onSelect: () => void; onAdd: () => void }) {
  const imageUrl = safeExternalUrl(part.imageUrl);
  const sourceUrl = safeExternalUrl(part.danawaUrl);
  return <article className={selected ? "catalog-part-card selected" : "catalog-part-card"}>
    <button className="catalog-part-card-main" type="button" data-testid={`catalog-part-${part.id}`} onClick={onSelect}>
      <span className="catalog-part-card-image">{imageUrl ? <img src={imageUrl} alt="" loading="lazy" /> : <FiBox />}</span>
      <span className="catalog-part-card-copy"><strong>{part.name}</strong><small>{part.brand ?? part.model ?? sourceLabel(part.source)}</small><span>{compactSummary(part)}</span><em>{QUALITY_LABELS[part.dataQuality]} · {freshnessLabel(part)}</em></span>
      <span className="catalog-part-card-price">{priceLabel(part.priceWon)}</span>
    </button>
    <div className="catalog-part-card-actions">{sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer" aria-label={`${part.name} 원문 보기`}>원문 <FiExternalLink /></a>}<button className="button button-small catalog-part-add" type="button" onClick={onAdd} disabled={selected}>{selected ? <><FiCheck /> 현재 선택</> : <><FiPlus /> 견적에 추가</>}</button></div>
  </article>;
}

function CatalogPartDetail({ part, onAdd, selected, onOpenBuild }: { part: Part; onAdd: () => void; selected: boolean; onOpenBuild: () => void }) {
  const sourceUrl = safeExternalUrl(part.danawaUrl);
  const imageUrl = safeExternalUrl(part.imageUrl);
  return <section className="catalog-detail" aria-label="선택한 부품 상세" data-testid="catalog-part-detail">
    <div className="catalog-detail-heading"><div><p className="eyebrow">PART DETAIL</p><h2>{part.name}</h2><p>{CATEGORY_LABELS[part.category]} · {part.brand ?? part.model ?? sourceLabel(part.source)}</p></div>{imageUrl ? <img src={imageUrl} alt="" loading="lazy" /> : <FiBox />}</div>
    <div className="catalog-detail-badges"><span>{QUALITY_LABELS[part.dataQuality]}</span><span>{freshnessLabel(part)}</span><span>{sourceLabel(part.source)}</span>{part.listingType && part.listingType !== "retail" && <span>{part.listingType === "bulk" ? "벌크" : part.listingType === "parallel_import" ? "병행수입" : "유통 조건 확인"}</span>}</div>
    <div className="catalog-detail-price"><span>현재 가격</span><strong>{priceLabel(part.priceWon)}</strong></div>
    <dl className="catalog-detail-specs">{specRowsFor(part).map(([label, value]) => <div key={`${label}-${value}`}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {part.missingFields.length > 0 && <p className="catalog-detail-missing"><FiInfo /> 확인되지 않은 스펙 {part.missingFields.slice(0, 5).join(", ")}{part.missingFields.length > 5 ? ` 외 ${part.missingFields.length - 5}개` : ""}</p>}
    {part.rawSpecText && <details className="catalog-detail-raw"><summary>저장된 원문 스펙 보기</summary><p>{part.rawSpecText}</p></details>}
    <div className="catalog-detail-actions"><button className="button button-primary" type="button" onClick={onAdd} disabled={selected}>{selected ? <><FiCheck /> 현재 견적에 선택됨</> : <><FiPlus /> 현재 견적에 추가</>}</button><button className="button button-light" type="button" onClick={onOpenBuild}><FiActivity /> 견적 검사로 이동</button>{sourceUrl && <a className="button button-light" href={sourceUrl} target="_blank" rel="noreferrer"><FiExternalLink /> 원문 열기</a>}</div>
    <p className="catalog-detail-note"><FiInfo /> 카탈로그의 스펙·가격·갱신 상태를 보여주는 화면입니다. 현재 견적에 추가한 뒤 전체 호환성 검사를 실행해야 실제 조합 판정을 확인할 수 있습니다.</p>
  </section>;
}

export function CatalogView({ build, onAddPart, onOpenBuild, onBack }: { build: BuildSelection; onAddPart: (part: Part) => void; onOpenBuild: () => void; onBack: () => void }) {
  const [category, setCategory] = useState<PartCategory>("cpu");
  const [query, setQuery] = useState("");
  const [quality, setQuality] = useState<DataQuality | "all">("all");
  const [freshness, setFreshness] = useState<DataFreshness | "all">("all");
  const [priceStatus, setPriceStatus] = useState<PriceAvailabilityFilter>("all");
  const [listingPolicy, setListingPolicy] = useState<ListingPolicy>("all");
  const [sort, setSort] = useState<CatalogSort>("price_asc");
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<Part[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const selectedIds = useMemo(() => new Set(selectedPartIdsFor(build, category)), [build, category]);
  const selectedPart = items.find((part) => part.id === selectedId) ?? null;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    setPage(0);
    setSelectedId(null);
  }, [category, quality, freshness, priceStatus, listingPolicy, sort, query]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ category, q: query.trim(), quality, freshness, priceStatus, listingPolicy, sort, offset: String(page * PAGE_SIZE), limit: String(PAGE_SIZE) });
      void api<CatalogResponse>(`/api/parts?${params.toString()}`, { retry: 2 })
        .then((payload) => { if (!cancelled) { setItems(payload.items); setTotal(payload.total); setSelectedId((current) => payload.items.some((item) => item.id === current) ? current : payload.items[0]?.id ?? null); } })
        .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof ApiError ? reason.message : reason instanceof Error ? reason.message : "부품 카탈로그를 불러오지 못했습니다."); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 220);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [category, freshness, listingPolicy, page, priceStatus, quality, query, retryNonce, sort]);

  function goToPage(nextPage: number) {
    setPage(Math.max(0, Math.min(pageCount - 1, nextPage)));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return <div className="catalog-page">
    <div className="workspace-heading"><div><button className="back-link" type="button" onClick={onBack}><FiArrowLeft /> 홈으로</button><p className="eyebrow">PART CATALOG</p><h1>부품 카탈로그 탐색</h1><p>전체 부품 목록에서 핵심 스펙·가격·데이터 상태를 확인하고 현재 견적에 추가합니다.</p></div><button className="button button-secondary" type="button" onClick={onOpenBuild}><FiActivity /> 현재 견적 보기</button></div>
    <section className="catalog-toolbar" aria-label="부품 카탈로그 필터"><form className="catalog-search" onSubmit={(event) => { event.preventDefault(); setPage(0); }}><FiSearch /><input aria-label="부품 카탈로그 검색" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="모델명·제조사·소켓·메모리 세대 검색" /><button className="button button-primary button-small" type="submit">검색</button></form><div className="catalog-filters"><label><span>범주</span><select aria-label="카탈로그 부품 범주" value={category} onChange={(event) => setCategory(event.target.value as PartCategory)}>{PART_CATEGORIES.map((item) => <option value={item} key={item}>{CATEGORY_LABELS[item]}</option>)}</select></label><label><span>데이터</span><select aria-label="카탈로그 데이터 품질" value={quality} onChange={(event) => setQuality(event.target.value as DataQuality | "all") }><option value="all">전체 데이터</option>{Object.entries(QUALITY_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>갱신 상태</span><select aria-label="카탈로그 갱신 상태" value={freshness} onChange={(event) => setFreshness(event.target.value as DataFreshness | "all")}><option value="all">전체 상태</option><option value="fresh">{DATA_FRESHNESS_LABELS.fresh}</option><option value="aging">{DATA_FRESHNESS_LABELS.aging}</option><option value="stale">{DATA_FRESHNESS_LABELS.stale}</option><option value="unknown">{DATA_FRESHNESS_LABELS.unknown}</option></select></label><label><span>가격</span><select aria-label="카탈로그 가격 상태" value={priceStatus} onChange={(event) => setPriceStatus(event.target.value as PriceAvailabilityFilter)}><option value="all">{PRICE_AVAILABILITY_LABELS.all}</option><option value="known">{PRICE_AVAILABILITY_LABELS.known}</option><option value="unknown">{PRICE_AVAILABILITY_LABELS.unknown}</option></select></label><label><span>구매 조건</span><select aria-label="카탈로그 구매 조건" value={listingPolicy} onChange={(event) => setListingPolicy(event.target.value as ListingPolicy)}>{Object.entries(LISTING_POLICY_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>정렬</span><select aria-label="카탈로그 정렬" value={sort} onChange={(event) => setSort(event.target.value as CatalogSort)}><option value="price_asc">가격 낮은 순</option><option value="price_desc">가격 높은 순</option><option value="name">이름 순</option><option value="updated">최근 갱신</option></select></label></div></section>
    <div className="catalog-layout"><section className="catalog-results" aria-label="부품 카탈로그 결과"><div className="catalog-results-heading"><div><p className="eyebrow">CATALOG RESULTS</p><h2>{CATEGORY_LABELS[category]} 목록</h2></div><span>{loading ? "불러오는 중" : `${total.toLocaleString("ko-KR")}개 결과 · ${page + 1}/${pageCount}페이지`}</span></div>{error ? <div className="catalog-state error" role="alert"><FiInfo /><div><strong>부품 목록을 불러오지 못했습니다.</strong><p>{error}</p></div><button className="button button-small button-light" type="button" onClick={() => setRetryNonce((current) => current + 1)}><FiRefreshCw /> 다시 시도</button></div> : loading ? <div className="catalog-state" role="status"><FiLoader className="spin" /> 부품 목록을 불러오는 중...</div> : items.length === 0 ? <div className="catalog-state"><FiSearch /> 조건에 맞는 부품이 없습니다.</div> : <div className="catalog-part-list">{items.map((part) => <CatalogPartCard key={part.id} part={part} selected={selectedIds.has(part.id)} onSelect={() => setSelectedId(part.id)} onAdd={() => onAddPart(part)} />)}</div>}{total > 0 && <div className="catalog-pagination"><button className="button button-light button-small" type="button" onClick={() => goToPage(page - 1)} disabled={page === 0 || loading}>이전</button><span>{page + 1} / {pageCount}</span><button className="button button-light button-small" type="button" onClick={() => goToPage(page + 1)} disabled={page >= pageCount - 1 || loading}>다음</button></div>}</section><aside>{selectedPart ? <CatalogPartDetail part={selectedPart} selected={selectedIds.has(selectedPart.id)} onAdd={() => onAddPart(selectedPart)} onOpenBuild={onOpenBuild} /> : <section className="catalog-detail-empty"><FiBox /><h2>부품을 선택하세요</h2><p>목록에서 부품을 누르면 상세 스펙·가격·데이터 상태와 현재 견적 추가 버튼을 확인할 수 있습니다.</p></section>}</aside></div>
    <p className="catalog-page-note"><FiDatabase /> 전체 카탈로그는 서버의 현재 데이터 기준으로 페이지 단위 조회합니다. 가격·스펙·원문·갱신 상태가 확인되지 않은 항목은 별도 상태로 표시하며, 카탈로그 탐색만으로 호환성을 확정하지 않습니다.</p>
  </div>;
}
