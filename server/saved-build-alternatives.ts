import { createHash } from "node:crypto";
import { CATEGORY_LABELS } from "../shared/types";
import type { Part, PartCategory } from "../shared/types";
import type { SavedBuildMonitorAlert } from "../shared/saved-build-monitor-alerts";
import type { SavedBuildRecord } from "./build-share";

// "내 PC" 대안 감시 — 벤치마크 근거로 비교 가능한 카테고리만 대상으로 한다.
// 다른 카테고리는 근거 없는 "더 좋다" 주장이 되기 쉬워 감사 정체성과 어긋난다.
const ALTERNATIVE_WATCHES: Array<{ category: "cpu" | "gpu"; scoreKey: "cinebenchR23Multi" | "gpu3dmarkTimeSpyScore"; scoreLabel: string }> = [
  { category: "cpu", scoreKey: "cinebenchR23Multi", scoreLabel: "Cinebench R23 멀티" },
  { category: "gpu", scoreKey: "gpu3dmarkTimeSpyScore", scoreLabel: "3DMark Time Spy" }
];

// 이 하한을 넘는 성능 향상만 알림으로 만든다 — 소수점 수준의 갱신 알림은 소음이다.
const MIN_SCORE_GAIN = 1.08;
// 후보 가격이 현재 부품의 1.5배를 넘으면 "대안"이 아니라 다른 급의 제품이다.
const MAX_PRICE_RATIO = 1.5;
const MAX_ALTERNATIVE_ALERTS_PER_RUN = 2;

function partPriceFor(part: Part) {
  return typeof part.priceWon === "number" && Number.isFinite(part.priceWon) && part.priceWon > 0 ? part.priceWon : undefined;
}

function selectedPartIdFor(build: SavedBuildRecord, category: "cpu" | "gpu") {
  return category === "cpu" ? build.selection.cpu?.partId : build.selection.gpu?.partId;
}

export function savedBuildAlternativeAlertsFor(build: SavedBuildRecord, catalogParts: Part[], createdAt: string): SavedBuildMonitorAlert[] {
  const byId = new Map(catalogParts.map((part) => [part.id, part]));
  const alerts: SavedBuildMonitorAlert[] = [];
  for (const watch of ALTERNATIVE_WATCHES) {
    const currentId = selectedPartIdFor(build, watch.category);
    if (!currentId) continue;
    const current = byId.get(currentId);
    const currentScore = current?.specs[watch.scoreKey];
    if (!current || typeof currentScore !== "number" || !Number.isFinite(currentScore) || currentScore <= 0) continue;
    const currentPrice = partPriceFor(current);
    const best = catalogParts
      .filter((candidate) => {
        if (candidate.category !== watch.category || candidate.id === current.id) return false;
        const score = candidate.specs[watch.scoreKey];
        if (typeof score !== "number" || !Number.isFinite(score) || score < currentScore * MIN_SCORE_GAIN) return false;
        const price = partPriceFor(candidate);
        if (currentPrice !== undefined && price !== undefined && price > currentPrice * MAX_PRICE_RATIO) return false;
        return true;
      })
      .sort((a, b) => (b.specs[watch.scoreKey] ?? 0) - (a.specs[watch.scoreKey] ?? 0))[0];
    if (!best) continue;
    const bestScore = best.specs[watch.scoreKey] ?? 0;
    const gainPercent = Math.round((bestScore / currentScore - 1) * 100);
    const signature = createHash("sha256").update(`${build.id}:${watch.category}:${best.id}`).digest("hex").slice(0, 16);
    alerts.push({
      id: `build-monitor:${build.id}:alternative:${signature}`,
      buildId: build.id,
      buildName: build.name,
      kind: "alternative",
      title: `${CATEGORY_LABELS[watch.category]} 대안 등장`,
      message: `현재 ${current.name} 대비 ${best.name} — ${watch.scoreLabel} 약 +${gainPercent}% 빠릅니다.`,
      createdAt,
      checkedAt: createdAt
    });
    if (alerts.length >= MAX_ALTERNATIVE_ALERTS_PER_RUN) break;
  }
  return alerts;
}
