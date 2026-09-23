// Shared part/accessory visual components and watch predicates.
import { catalogMissingFieldLabelFor } from "../shared/catalog-spec-coverage";
import { CATALOG_WATCHLIST_STORAGE_KEY, catalogWatchlistContains, catalogWatchlistFromJson } from "../shared/catalog-watchlist";
import { type AccessoryItem, type Part, type PartCategory, isKnownPrice } from "../shared/types";
import { safeExternalUrl } from "./safe-source-url";
import { useEffect, useState } from "react";
import type { IconType } from "react-icons";
import { FiBox, FiClock, FiCpu, FiDatabase, FiHardDrive, FiInfo, FiMonitor, FiServer, FiTool, FiZap } from "react-icons/fi";
import { formatSpecValue, formatWon, suggestionSpecRows } from "./app-format";

export type PartWatchHandler = (part: Part) => boolean;

export type CategoryMeta = {
  label: string;
  helper: string;
  required: boolean;
  multiple: boolean;
  Icon: IconType;
};

export const CATEGORY_META: Record<PartCategory, CategoryMeta> = {
  cpu: {
    label: "CPU",
    helper: "프로세서와 소켓 규격을 선택하세요.",
    required: true,
    multiple: false,
    Icon: FiCpu
  },
  cooler: {
    label: "CPU 쿨러",
    helper: "CPU 소켓과 냉각 여유를 검사합니다.",
    required: true,
    multiple: false,
    Icon: FiTool
  },
  motherboard: {
    label: "메인보드",
    helper: "CPU, RAM, 저장장치 슬롯의 기준입니다.",
    required: true,
    multiple: false,
    Icon: FiServer
  },
  memory: {
    label: "RAM",
    helper: "메모리 규격, 총 용량, 슬롯 수를 검사합니다.",
    required: true,
    multiple: true,
    Icon: FiDatabase
  },
  gpu: {
    label: "그래픽카드",
    helper: "전력과 케이스 장착 길이를 검사합니다.",
    required: false,
    multiple: false,
    Icon: FiMonitor
  },
  ssd: {
    label: "SSD",
    helper: "M.2 슬롯과 SATA 포트 사용량을 검사합니다.",
    required: false,
    multiple: true,
    Icon: FiHardDrive
  },
  hdd: {
    label: "HDD",
    helper: "케이스 베이와 SATA 포트 사용량을 검사합니다.",
    required: false,
    multiple: true,
    Icon: FiHardDrive
  },
  case: {
    label: "케이스",
    helper: "메인보드, GPU, 쿨러, 저장장치 공간을 검사합니다.",
    required: true,
    multiple: false,
    Icon: FiBox
  },
  psu: {
    label: "파워서플라이",
    helper: "시스템 전력 공급 여유와 데이터 상태를 검사합니다.",
    required: true,
    multiple: false,
    Icon: FiZap
  }
};

export function partIsWatched(part: Part) {
  if (typeof window === "undefined") return false;
  return catalogWatchlistContains(catalogWatchlistFromJson(window.localStorage.getItem(CATALOG_WATCHLIST_STORAGE_KEY)), { kind: "part", itemId: part.id });
}

export function accessoryIsWatched(item: AccessoryItem) {
  if (typeof window === "undefined") return false;
  return catalogWatchlistContains(catalogWatchlistFromJson(window.localStorage.getItem(CATALOG_WATCHLIST_STORAGE_KEY)), { kind: "accessory", itemId: item.id });
}

export function PartEvidence({ part }: { part: Part }) {
  return <div className="part-evidence" aria-label={`${part.name} 상세 스펙`}>
    <div className="part-evidence-price"><span>예상 가격</span><strong>{isKnownPrice(part.priceWon) ? formatWon(part.priceWon) : "가격 정보 없음"}</strong></div>
    <div className="part-evidence-grid">{suggestionSpecRows(part).map(([label, value]) => <div className="part-evidence-row" key={label}><span>{label}</span><strong>{formatSpecValue(value)}</strong></div>)}</div>
    {part.missingFields.length > 0 && <p className="part-evidence-missing"><FiInfo /> 사양 정보 없음: {part.missingFields.map((field) => catalogMissingFieldLabelFor(field)).join(", ")}</p>}
  </div>;
}

export function AccessoryVisual({ item }: { item: AccessoryItem }) {
  const [failed, setFailed] = useState(false);
  const imageUrl = safeExternalUrl(item.imageUrl);
  if (imageUrl && !failed) return <img src={imageUrl} alt="" loading="lazy" onError={() => setFailed(true)} />;
  return <FiTool />;
}

export function CategoryIcon({ category }: { category: PartCategory }) {
  const Icon = CATEGORY_META[category].Icon;
  return <Icon />;
}

export function PartWatchButton({ part, onWatch }: { part: Part; onWatch: PartWatchHandler }) {
  const [watching, setWatching] = useState(() => partIsWatched(part));
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== CATALOG_WATCHLIST_STORAGE_KEY) return;
      setWatching(catalogWatchlistContains(catalogWatchlistFromJson(event.newValue), { kind: "part", itemId: part.id }));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [part.id]);
  function addToWatchlist() {
    if (onWatch(part)) setWatching(true);
  }
  return <button className={watching ? "text-button part-watch-button watched" : "text-button part-watch-button"} type="button" data-item-id={part.id} onClick={addToWatchlist} disabled={watching} aria-label={`${part.name} 가격 추적 ${watching ? "등록됨" : "등록"}`}><FiClock /> {watching ? "추적 중" : "가격 추적"}</button>;
}

export function PartVisual({ part }: { part: Part }) {
  const [failed, setFailed] = useState(false);
  const imageUrl = safeExternalUrl(part.imageUrl);
  if (imageUrl && !failed) return <img src={imageUrl} alt="" loading="lazy" onError={() => setFailed(true)} />;
  return <CategoryIcon category={part.category} />;
}
