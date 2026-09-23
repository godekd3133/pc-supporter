import type { AlternativeComparisonSnapshot } from "./alternative-comparison-share";
import type { ServiceMeta } from "./types";

export type AlternativeComparisonFreshnessTone = "current" | "stale" | "unknown";

export interface AlternativeComparisonFreshness {
  tone: AlternativeComparisonFreshnessTone;
  label: string;
  detail: string;
}

export function alternativeComparisonFreshnessFor(snapshot: AlternativeComparisonSnapshot, currentMeta: ServiceMeta | null): AlternativeComparisonFreshness {
  if (!snapshot.catalogSnapshotAt && !snapshot.engineVersion) return { tone: "unknown", label: "이전 확인 정보 없음", detail: "이전 저장본에는 부품 정보와 검사 버전이 기록되지 않았습니다." };
  if (!currentMeta) return { tone: "unknown", label: "현재 정보 확인 중", detail: "현재 부품 정보와 검사 버전을 확인하는 중입니다." };
  const snapshotDate = snapshot.catalogSnapshotAt ? Date.parse(snapshot.catalogSnapshotAt) : Number.NaN;
  const currentDate = currentMeta.catalogUpdatedAt ? Date.parse(currentMeta.catalogUpdatedAt) : Number.NaN;
  if (snapshot.catalogSnapshotAt && !Number.isFinite(snapshotDate)) return { tone: "unknown", label: "이전 확인일 확인 필요", detail: "공유 저장본의 부품 정보 확인일을 읽을 수 없습니다." };
  const catalogChanged = Number.isFinite(snapshotDate) && Number.isFinite(currentDate) && currentDate > snapshotDate;
  const engineChanged = Boolean(snapshot.engineVersion && currentMeta.engineVersion && snapshot.engineVersion !== currentMeta.engineVersion);
  if (catalogChanged || engineChanged) {
    const reasons = [
      catalogChanged ? `부품 정보 ${new Date(snapshotDate).toLocaleDateString("ko-KR")} → ${new Date(currentDate).toLocaleDateString("ko-KR")}` : undefined,
      engineChanged ? `검사 버전 ${snapshot.engineVersion} → ${currentMeta.engineVersion}` : undefined
    ].filter((value): value is string => Boolean(value));
    return { tone: "stale", label: "최신 정보 확인 권장", detail: `${reasons.join(" · ")} · 비교표에는 공유 당시 정보가 표시됩니다.` };
  }
  return { tone: "current", label: "공유 당시와 같은 정보", detail: `검사 버전 ${snapshot.engineVersion ?? "기록 없음"} · 부품 정보 확인일 ${snapshot.catalogSnapshotAt ? new Date(snapshotDate).toLocaleDateString("ko-KR") : "기록 없음"}` };
}
