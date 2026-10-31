// Home: price status of each saved build — saved total vs. today's prices for the same parts.
import { useEffect, useMemo, useState } from "react";
import { FiArrowRight } from "react-icons/fi";
import { PART_CATEGORIES, isKnownPrice, type Part, type SavedBuild } from "../shared/types";
import { api } from "./api";
import { selectionList } from "./build-edit";

const MAX_BUILDS = 5;
const BATCH_LIMIT = 100;

type Row = { saved: SavedBuild; savedTotal?: number; currentTotal?: number; complete: boolean };

function partIdsOf(saved: SavedBuild) {
  return PART_CATEGORIES.flatMap((category) => selectionList(saved.selection, category).map((selection) => selection.partId));
}

export function HomeSavedBuildPrices({ savedBuilds, compact = false, onOpenSavedBuild, onOpenHistory }: { savedBuilds: SavedBuild[]; compact?: boolean; onOpenSavedBuild?: (saved: SavedBuild) => void; onOpenHistory: () => void }) {
  const builds = useMemo(() => savedBuilds.slice(0, MAX_BUILDS), [savedBuilds]);
  const ids = useMemo(() => [...new Set(builds.flatMap(partIdsOf))].slice(0, BATCH_LIMIT), [builds]);
  const [prices, setPrices] = useState<Map<string, number | undefined> | null>(null);

  useEffect(() => {
    if (ids.length === 0) return undefined;
    let active = true;
    api<{ items: Part[] }>(`/api/parts/batch?ids=${encodeURIComponent(ids.join(","))}`, { retry: 1 })
      .then((payload) => { if (active) setPrices(new Map(payload.items.map((part) => [part.id, part.priceWon]))); })
      .catch(() => { if (active) setPrices(new Map()); });
    return () => { active = false; };
  }, [ids]);

  if (builds.length === 0) return null;

  const rows: Row[] = builds.map((saved) => {
    const lines = PART_CATEGORIES.flatMap((category) => selectionList(saved.selection, category));
    const current = prices ? lines.map((line) => ({ price: prices.get(line.partId), quantity: line.quantity })) : [];
    const complete = prices !== null && current.every((line) => isKnownPrice(line.price));
    const currentTotal = prices && complete ? current.reduce((total, line) => total + (line.price ?? 0) * line.quantity, 0) : undefined;
    const savedTotal = isKnownPrice(saved.summary?.coreTotalPriceWon) ? saved.summary!.coreTotalPriceWon : undefined;
    return { saved, savedTotal, currentTotal, complete };
  });

  return <section className={`home-saved-prices${compact ? " compact" : ""}`} aria-label="저장한 견적 가격" data-testid="home-saved-prices">
    <div className="home-saved-prices-heading">
      <h2>저장한 견적 가격</h2>
      <button className="text-button" type="button" onClick={onOpenHistory}>전체 보기 <FiArrowRight aria-hidden="true" /></button>
    </div>
    <ul>
      {rows.map(({ saved, savedTotal, currentTotal }) => {
        const delta = savedTotal !== undefined && currentTotal !== undefined ? currentTotal - savedTotal : undefined;
        const tone = delta === undefined ? "pending" : delta < 0 ? "down" : delta > 0 ? "up" : "same";
        return <li key={saved.id}>
          <button type="button" onClick={() => onOpenSavedBuild?.(saved)} disabled={!onOpenSavedBuild}>
            <span className="home-saved-prices-name"><strong>{saved.name}</strong><small>{new Date(saved.updatedAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })} 저장{savedTotal !== undefined ? ` / ${savedTotal.toLocaleString("ko-KR")}원` : ""}</small></span>
            <span className="home-saved-prices-now">{currentTotal !== undefined ? `${currentTotal.toLocaleString("ko-KR")}원` : prices ? "가격 일부 없음" : "확인 중"}</span>
            <span className={`home-saved-prices-delta ${tone}`}>{delta === undefined ? "" : delta === 0 ? "변동 없음" : `${delta < 0 ? "▼" : "▲"} ${Math.abs(delta).toLocaleString("ko-KR")}원`}</span>
          </button>
        </li>;
      })}
    </ul>
  </section>;
}
