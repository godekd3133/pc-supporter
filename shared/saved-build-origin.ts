import { isRecommendationPriority, type RecommendationPriority } from "./types";

export const SAVED_BUILD_ORIGIN_KINDS = ["generated", "shared_generator_variants", "repair_plan", "candidate"] as const;
export type SavedBuildOriginKind = (typeof SAVED_BUILD_ORIGIN_KINDS)[number];

export interface SavedBuildOrigin {
  kind: SavedBuildOriginKind;
  sourceShareId?: string;
  sourceShareName?: string;
  sourcePriority?: RecommendationPriority;
  sourceCatalogSnapshotAt?: string;
  currentRecheckedAt?: string;
  generatedAt?: string;
}

export type SavedBuildOriginAvailability = "checking" | "active" | "unavailable";

function textValue(value: unknown, maximum: number) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maximum ? value.trim() : undefined;
}

function isoDateValue(value: unknown) {
  if (value === undefined) return undefined;
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

export function savedBuildOriginFromUnknown(value: unknown): SavedBuildOrigin | undefined {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (!SAVED_BUILD_ORIGIN_KINDS.includes(candidate.kind as SavedBuildOriginKind)) return undefined;
  const sourceShareId = candidate.sourceShareId === undefined ? undefined : textValue(candidate.sourceShareId, 120);
  const sourceShareName = candidate.sourceShareName === undefined ? undefined : textValue(candidate.sourceShareName, 160);
  const sourcePriority = candidate.sourcePriority === undefined ? undefined : isRecommendationPriority(candidate.sourcePriority) ? candidate.sourcePriority : undefined;
  const sourceCatalogSnapshotAt = isoDateValue(candidate.sourceCatalogSnapshotAt);
  const currentRecheckedAt = isoDateValue(candidate.currentRecheckedAt);
  const generatedAt = isoDateValue(candidate.generatedAt);
  if ((candidate.sourceShareId !== undefined && !sourceShareId)
    || (candidate.sourceShareName !== undefined && !sourceShareName)
    || (candidate.sourcePriority !== undefined && !sourcePriority)
    || (candidate.sourceCatalogSnapshotAt !== undefined && !sourceCatalogSnapshotAt)
    || (candidate.currentRecheckedAt !== undefined && !currentRecheckedAt)
    || (candidate.generatedAt !== undefined && !generatedAt)) return undefined;
  return {
    kind: candidate.kind as SavedBuildOriginKind,
    ...(sourceShareId ? { sourceShareId } : {}),
    ...(sourceShareName ? { sourceShareName } : {}),
    ...(sourcePriority ? { sourcePriority } : {}),
    ...(sourceCatalogSnapshotAt ? { sourceCatalogSnapshotAt } : {}),
    ...(currentRecheckedAt ? { currentRecheckedAt } : {}),
    ...(generatedAt ? { generatedAt } : {})
  };
}

export function savedBuildOriginLabelFor(origin: SavedBuildOrigin) {
  if (origin.kind === "shared_generator_variants") return origin.sourceShareName ? `공유 비교 · ${origin.sourceShareName}` : "공유 자동 구성 비교";
  if (origin.kind === "generated") return "자동 구성 결과";
  if (origin.kind === "repair_plan") return "수리 플랜 결과";
  return "비교 구성 결과";
}

export function savedBuildOriginDetailFor(origin: SavedBuildOrigin) {
  const priority = origin.sourcePriority === "budget" ? "가성비 우선" : origin.sourcePriority === "performance" ? "성능 우선" : origin.sourcePriority === "balanced" ? "균형형" : undefined;
  const details = [priority, origin.sourceCatalogSnapshotAt ? `공유 catalog ${new Date(origin.sourceCatalogSnapshotAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}` : undefined, origin.currentRecheckedAt ? `현재 catalog 재생성 ${new Date(origin.currentRecheckedAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}` : undefined, origin.sourceShareId ? `공유 ID ${origin.sourceShareId.slice(0, 8)}` : undefined].filter(Boolean);
  return details.length > 0 ? details.join(" · ") : undefined;
}

export function savedBuildOriginComparisonTextFor(before?: SavedBuildOrigin, after?: SavedBuildOrigin) {
  if (!before && !after) return "출처 기록 없음";
  if (!before || !after) return "한 버전에만 생성 출처 기록";
  const sameShare = Boolean(before.sourceShareId && after.sourceShareId && before.sourceShareId === after.sourceShareId);
  const samePriority = before.sourcePriority === after.sourcePriority;
  if (sameShare && samePriority) return "같은 공유 비교·priority에서 파생";
  const details = [sameShare ? "같은 공유 비교" : "공유 비교가 다름", samePriority ? undefined : "priority가 다름"].filter(Boolean);
  return details.join(" · ");
}

export function savedBuildOriginAvailabilityLabelFor(status: SavedBuildOriginAvailability | undefined) {
  if (status === "active") return "원본 비교 사용 가능";
  if (status === "unavailable") return "원본 비교 만료 또는 취소됨";
  if (status === "checking") return "원본 비교 상태 확인 중";
  return "상태 확인 안 됨";
}
