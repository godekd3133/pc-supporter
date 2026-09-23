// Shared recommendation preference controls used by the editor and result views.
import { type GamingResolution, type GamingRefreshRate, type ListingPolicy, type RecommendationProfile, type RecommendationPreferences, GAMING_REFRESH_RATE_LABELS, GAMING_RESOLUTION_LABELS, LISTING_POLICY_LABELS, RECOMMENDATION_PRIORITY_DESCRIPTIONS, RECOMMENDATION_PRIORITY_LABELS, RECOMMENDATION_PROFILE_LABELS } from "../shared/types";
import { useEffect, useState } from "react";
import { FiActivity } from "react-icons/fi";


export function RecommendationControls({ preferences, onChange, onCommit, commitOnChange = true, compact = false, disabled = false }: { preferences: RecommendationPreferences; onChange: (next: RecommendationPreferences) => void; onCommit?: (next: RecommendationPreferences) => void; commitOnChange?: boolean; compact?: boolean; disabled?: boolean }) {
  const [draftBudget, setDraftBudget] = useState(preferences.budgetWon?.toString() ?? "");
  useEffect(() => { setDraftBudget(preferences.budgetWon?.toString() ?? ""); }, [preferences.budgetWon]);
  function preferencesWithBudget(raw: string) {
    const numericBudget = raw === "" ? undefined : Number(raw);
    const budgetWon = numericBudget === undefined || !Number.isFinite(numericBudget) ? undefined : Math.max(0, Math.floor(numericBudget));
    return budgetWon === undefined ? { ...preferences, budgetWon: undefined } : { ...preferences, budgetWon };
  }
  function commitBudget() {
    if (!commitOnChange) onCommit?.(preferencesWithBudget(draftBudget));
  }
  return <section className={compact ? "recommendation-controls compact" : "recommendation-controls"} aria-label="추천 기준 설정">
    <div className="recommendation-controls-heading"><div><strong>추천 기준</strong></div><FiActivity /></div>
    <label><span>사용 목적</span><select value={preferences.profile} disabled={disabled} onChange={(event) => { const profile = event.target.value as RecommendationProfile; const next = profile === "gaming" ? { ...preferences, profile, gamingRefreshRate: preferences.gamingRefreshRate ?? 144 } : { ...preferences, profile, gamingRefreshRate: undefined }; onChange(next); if (!commitOnChange) onCommit?.(next); }}><option value="general">{RECOMMENDATION_PROFILE_LABELS.general}</option><option value="gaming">{RECOMMENDATION_PROFILE_LABELS.gaming}</option><option value="creator">{RECOMMENDATION_PROFILE_LABELS.creator}</option><option value="development">{RECOMMENDATION_PROFILE_LABELS.development}</option><option value="office">{RECOMMENDATION_PROFILE_LABELS.office}</option></select></label>
    {preferences.profile === "gaming" && <label><span>게임 해상도 <em>게이밍 기준</em></span><select value={preferences.gamingResolution ?? "1440p"} disabled={disabled} onChange={(event) => { const next = { ...preferences, gamingResolution: event.target.value as GamingResolution }; onChange(next); if (!commitOnChange) onCommit?.(next); }}><option value="1080p">{GAMING_RESOLUTION_LABELS["1080p"]}</option><option value="1440p">{GAMING_RESOLUTION_LABELS["1440p"]}</option><option value="4k">{GAMING_RESOLUTION_LABELS["4k"]}</option></select></label>}
    {preferences.profile === "gaming" && <label><span>목표 주사율 <em>성능 가중치</em></span><select aria-label="목표 주사율" value={preferences.gamingRefreshRate ?? 144} disabled={disabled} onChange={(event) => { const next = { ...preferences, gamingRefreshRate: Number(event.target.value) as GamingRefreshRate }; onChange(next); if (!commitOnChange) onCommit?.(next); }}><option value="60">{GAMING_REFRESH_RATE_LABELS[60]}</option><option value="144">{GAMING_REFRESH_RATE_LABELS[144]}</option><option value="240">{GAMING_REFRESH_RATE_LABELS[240]}</option></select></label>}
    <label><span>우선순위</span><select data-testid="recommendation-priority" value={preferences.priority} disabled={disabled} onChange={(event) => { const next = { ...preferences, priority: event.target.value as RecommendationPreferences["priority"] }; onChange(next); if (!commitOnChange) onCommit?.(next); }}><option value="balanced">{RECOMMENDATION_PRIORITY_LABELS.balanced}</option><option value="budget">{RECOMMENDATION_PRIORITY_LABELS.budget}</option><option value="performance">{RECOMMENDATION_PRIORITY_LABELS.performance}</option><option value="reliability">{RECOMMENDATION_PRIORITY_LABELS.reliability}</option></select></label>
    <label><span>구매 조건</span><select value={preferences.listingPolicy ?? "retail_only"} disabled={disabled} onChange={(event) => { const next = { ...preferences, listingPolicy: event.target.value as ListingPolicy }; onChange(next); if (!commitOnChange) onCommit?.(next); }}><option value="retail_only">{LISTING_POLICY_LABELS.retail_only}</option><option value="include_bulk">{LISTING_POLICY_LABELS.include_bulk}</option><option value="all">{LISTING_POLICY_LABELS.all}</option></select></label>
    <label><span>목표 예산 <em>선택</em></span><input type="number" inputMode="numeric" min="0" step="10000" disabled={disabled} value={draftBudget} onChange={(event) => { const next = preferencesWithBudget(event.target.value); setDraftBudget(event.target.value); onChange(next); if (commitOnChange) onCommit?.(next); }} onBlur={commitBudget} onKeyDown={(event) => { if (event.key === "Enter") commitBudget(); }} placeholder="예: 1500000" /></label>
    <p><strong>{RECOMMENDATION_PRIORITY_LABELS[preferences.priority]}</strong> · {RECOMMENDATION_PRIORITY_DESCRIPTIONS[preferences.priority]}</p>
  </section>;
}
