import { GAMING_GRAPHICS_PRESET_LABELS, GAMING_REFRESH_RATE_LABELS, GAMING_RESOLUTION_LABELS, GAMING_UPSCALING_LABELS, RECOMMENDATION_PERFORMANCE_TIER_LABELS, RECOMMENDATION_PRIORITY_LABELS } from "./types";
import type { RecommendationPreferences } from "./types";

type PreferenceConditionSource = Pick<RecommendationPreferences, "profile" | "gamingMode" | "gamingTargetFps" | "gpuVendorPreference" | "performanceTier" | "gamingResolution" | "gamingRefreshRate" | "gamingGameIds" | "gamingGraphicsPreset" | "gamingRayTracing" | "gamingUpscaling">;

// 자동 구성 요청의 성능·게임 조건만 태그로 정리한다 — 프리셋 카드와 저장 견적
// 카드가 같은 표기 순서를 공유하도록 여기서 만든다. 하드웨어 수량·구매 조건·
// 예산처럼 저장 견적에 없는 필드는 여기서 다루지 않는다.
export function engineConditionTagsFor(preferences: PreferenceConditionSource): string[] {
  const tags: string[] = [];
  if (preferences.profile === "gaming") {
    if (preferences.gamingMode === "budget") {
      tags.push("GPU 성능 우선");
      if (preferences.gpuVendorPreference) tags.push(preferences.gpuVendorPreference.toUpperCase());
      return tags;
    }
    if (preferences.gamingResolution !== undefined) tags.push(GAMING_RESOLUTION_LABELS[preferences.gamingResolution]);
    if (preferences.gamingMode === "target_fps" && preferences.gamingTargetFps !== undefined) tags.push(`목표 ${preferences.gamingTargetFps} FPS`);
    else if (preferences.gamingRefreshRate !== undefined) tags.push(GAMING_REFRESH_RATE_LABELS[preferences.gamingRefreshRate]);
    if (preferences.gamingGraphicsPreset !== undefined) tags.push(GAMING_GRAPHICS_PRESET_LABELS[preferences.gamingGraphicsPreset]);
    if (preferences.gamingUpscaling !== undefined) tags.push(GAMING_UPSCALING_LABELS[preferences.gamingUpscaling]);
    if (preferences.gamingRayTracing === true) tags.push("레이 트레이싱");
    if (preferences.gamingGameIds && preferences.gamingGameIds.length > 0) tags.push(`게임 ${preferences.gamingGameIds.length}개`);
    if (preferences.gpuVendorPreference) tags.push(preferences.gpuVendorPreference.toUpperCase());
  } else if (preferences.profile === "general" && preferences.performanceTier !== undefined) {
    tags.push(RECOMMENDATION_PERFORMANCE_TIER_LABELS[preferences.performanceTier]);
  }
  return tags;
}

// 저장 견적 카드에 보여줄 "어떤 조건으로 만든 견적인지" 태그 —
// 카드의 meta 줄이 프로필·구매 조건을 이미 표시하므로 여기서는 우선순위·
// 예산·게임/성능 조건만 낸다.
export function savedBuildPreferenceTagsFor(preferences: RecommendationPreferences): string[] {
  const tags = [RECOMMENDATION_PRIORITY_LABELS[preferences.priority]];
  if (typeof preferences.budgetWon === "number" && Number.isFinite(preferences.budgetWon) && preferences.budgetWon > 0) tags.push(`예산 ${preferences.budgetWon.toLocaleString("ko-KR")}원`);
  return [...tags, ...engineConditionTagsFor(preferences)];
}
