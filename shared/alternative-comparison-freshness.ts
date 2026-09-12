import type { AlternativeComparisonSnapshot } from "./alternative-comparison-share";
import type { ServiceMeta } from "./types";

export type AlternativeComparisonFreshnessTone = "current" | "stale" | "unknown";

export interface AlternativeComparisonFreshness {
  tone: AlternativeComparisonFreshnessTone;
  label: string;
  detail: string;
}

export function alternativeComparisonFreshnessFor(snapshot: AlternativeComparisonSnapshot, currentMeta: ServiceMeta | null): AlternativeComparisonFreshness {
  if (!snapshot.catalogSnapshotAt && !snapshot.engineVersion) return { tone: "unknown", label: "공유 기준 기록 없음", detail: "legacy snapshot이라 공유 당시 카탈로그·엔진 기준을 비교할 수 없습니다." };
  if (!currentMeta) return { tone: "unknown", label: "현재 기준 확인 중", detail: "현재 카탈로그 기준과 검사 엔진 버전을 확인하는 중입니다." };
  const snapshotDate = snapshot.catalogSnapshotAt ? Date.parse(snapshot.catalogSnapshotAt) : Number.NaN;
  const currentDate = currentMeta.catalogUpdatedAt ? Date.parse(currentMeta.catalogUpdatedAt) : Number.NaN;
  if (snapshot.catalogSnapshotAt && !Number.isFinite(snapshotDate)) return { tone: "unknown", label: "카탈로그 기준 확인 필요", detail: "공유 snapshot의 카탈로그 기준 시점을 해석할 수 없습니다." };
  const catalogChanged = Number.isFinite(snapshotDate) && Number.isFinite(currentDate) && currentDate > snapshotDate;
  const engineChanged = Boolean(snapshot.engineVersion && currentMeta.engineVersion && snapshot.engineVersion !== currentMeta.engineVersion);
  if (catalogChanged || engineChanged) {
    const reasons = [
      catalogChanged ? `카탈로그 ${new Date(snapshotDate).toLocaleDateString("ko-KR")} → ${new Date(currentDate).toLocaleDateString("ko-KR")}` : undefined,
      engineChanged ? `엔진 ${snapshot.engineVersion} → ${currentMeta.engineVersion}` : undefined
    ].filter((value): value is string => Boolean(value));
    return { tone: "stale", label: "현재 기준 재확인 권장", detail: `${reasons.join(" · ")} · 공유 표는 당시 snapshot을 보존합니다.` };
  }
  return { tone: "current", label: "공유 기준과 현재 기준 동일", detail: `엔진 ${snapshot.engineVersion ?? "기록 없음"} · 카탈로그 기준 ${snapshot.catalogSnapshotAt ? new Date(snapshotDate).toLocaleDateString("ko-KR") : "기록 없음"}` };
}
