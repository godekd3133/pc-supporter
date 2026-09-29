import { useEffect, useState } from "react";
import { FiDatabase, FiInfo, FiRefreshCw, FiTrash2 } from "react-icons/fi";
import { ACCESSORY_CATALOG_CACHE_STORAGE_KEY } from "../shared/accessory-catalog-cache";
import { CATALOG_CACHE_CHANGED_EVENT, catalogCacheStatusFromStorage, type CatalogCacheStatus, type CatalogCacheKind } from "../shared/catalog-cache-status";
import { CATALOG_PICKER_CACHE_STORAGE_KEY } from "../shared/catalog-picker-cache";

const CACHE_ITEMS: Array<{ kind: CatalogCacheKind; key: string }> = [
  { kind: "parts", key: CATALOG_PICKER_CACHE_STORAGE_KEY },
  { kind: "accessories", key: ACCESSORY_CATALOG_CACHE_STORAGE_KEY }
];

function readCacheStatus(): CatalogCacheStatus {
  try {
    return catalogCacheStatusFromStorage((key) => window.localStorage.getItem(key));
  } catch {
    return catalogCacheStatusFromStorage(() => undefined);
  }
}

function cachedAtText(value: string | undefined) {
  if (!value) return "저장 시각을 확인할 수 없어요.";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? `이 기기에 저장한 시각 ${new Date(timestamp).toLocaleString("ko-KR")}`
    : "저장 시각을 확인할 수 없어요.";
}

function savedListAgeLabel(freshness: CatalogCacheStatus["parts"]["freshness"]) {
  if (freshness === "fresh") return "최근 저장";
  if (freshness === "aging") return "며칠 전 저장";
  if (freshness === "stale") return "오래전 저장";
  return "저장 시각 모름";
}

export function HomeCatalogCachePanel() {
  const [status, setStatus] = useState(readCacheStatus);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const refresh = () => setStatus(readCacheStatus());
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || CACHE_ITEMS.some((item) => item.key === event.key)) refresh();
    };
    window.addEventListener(CATALOG_CACHE_CHANGED_EVENT, refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CATALOG_CACHE_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  function clear(kind?: CatalogCacheKind) {
    const targetItems = CACHE_ITEMS.filter((item) => kind === undefined || item.kind === kind);
    const targetCount = targetItems.reduce((total, item) => total + status[item.kind].count, 0);
    if (targetCount === 0) return;
    const targetLabel = kind === "parts" ? "핵심 부품 목록" : kind === "accessories" ? "주변 부품 목록" : "부품 목록";
    const prompt = `${targetLabel}을 지울까요? 견적 초안, 저장 견적, 공유 링크와 가격 추적 목록은 유지됩니다.`;
    if (!window.confirm(prompt)) return;
    try {
      targetItems.forEach((item) => window.localStorage.removeItem(item.key));
      window.dispatchEvent(new Event(CATALOG_CACHE_CHANGED_EVENT));
      setStatus(readCacheStatus());
      setMessage(`${targetLabel}을 지웠어요.`);
    } catch {
      setMessage("이 기기에 저장된 목록을 지우지 못했어요.");
    }
  }

  const cacheEntries = [status.parts, status.accessories];
  return <section className={`home-catalog-cache${status.hasAny ? "" : " empty"}`} aria-label="최근 불러온 부품" data-testid="home-catalog-cache">
    <div className="home-catalog-cache-heading">
      <div>
        <p className="eyebrow">이 기기에 저장</p>
        <h2>최근 불러온 부품</h2>
        <p>인터넷이 불안할 때 최근 목록을 다시 볼 수 있어요. 가격과 재고는 저장한 시점과 다를 수 있어요.</p>
      </div>
      {status.hasAny && <span>{status.totalCount.toLocaleString("ko-KR")}개</span>}
    </div>
    {status.hasAny ? <>
      <div className="home-catalog-cache-grid">
      {cacheEntries.map((item) => <article className={`home-catalog-cache-item ${item.freshness}`} key={item.kind}>
        <div><span>{item.label}</span><strong>{item.count.toLocaleString("ko-KR")}개</strong></div>
        <em>{savedListAgeLabel(item.freshness)}</em>
        <small>{cachedAtText(item.cachedAt)}</small>
        <button className="text-button" type="button" data-testid={`home-catalog-cache-clear-${item.kind}`} onClick={() => clear(item.kind)} disabled={item.count === 0}><FiTrash2 /> {item.label} 목록 지우기</button>
      </article>)}
      </div>
      <div className="home-catalog-cache-actions">
        <button className="button button-light" type="button" data-testid="home-catalog-cache-clear-all" onClick={() => clear()}><FiRefreshCw /> 저장 목록 모두 지우기</button>
        <p><FiInfo /> 이 기기에 저장한 부품 목록만 지워져요. 견적과 가격 추적은 남아요.</p>
      </div>
    </> : <p className="home-catalog-cache-empty"><FiDatabase /> 아직 저장된 부품 목록이 없어요. 카탈로그를 열어 부품을 불러오면 여기에 표시됩니다.</p>}
    {message && <p className="home-catalog-cache-message" role="status">{message}</p>}
  </section>;
}
