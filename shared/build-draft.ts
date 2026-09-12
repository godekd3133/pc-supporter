import type { BuildSelection, RecommendationPreferences } from "./types";
import { parseBuildTransfer } from "./build-transfer";

export type BuildDraftLoadStatus = "empty" | "valid" | "recovered";

export interface BuildDraftLoadResult {
  build: BuildSelection;
  status: BuildDraftLoadStatus;
  errors: string[];
}

export type BuildDraftSyncResult =
  | { status: "same" }
  | { status: "changed"; build: BuildSelection }
  | { status: "invalid"; errors: string[] };

export type RecommendationPreferencesSyncResult =
  | { status: "same" }
  | { status: "changed"; preferences: RecommendationPreferences }
  | { status: "invalid"; errors: string[] };

function emptyBuild(): BuildSelection {
  return {
    memory: [],
    ssd: [],
    hdd: [],
    accessories: [],
    useIntegratedGraphics: true
  };
}

function buildDraftKeyFor(build: BuildSelection) {
  return JSON.stringify({
    cpu: build.cpu ?? null,
    cooler: build.cooler ?? null,
    motherboard: build.motherboard ?? null,
    memory: build.memory ?? [],
    gpu: build.gpu ?? null,
    ssd: build.ssd ?? [],
    hdd: build.hdd ?? [],
    case: build.case ?? null,
    psu: build.psu ?? null,
    accessories: build.accessories ?? [],
    m2SlotSelection: Object.entries(build.m2SlotSelection ?? {}).sort(([left], [right]) => left.localeCompare(right)),
    rgbControllerAccessoryId: build.rgbControllerAccessoryId ?? null,
    useIntegratedGraphics: build.useIntegratedGraphics !== false
  });
}

function recommendationPreferencesKeyFor(preferences: RecommendationPreferences) {
  return JSON.stringify({
    profile: preferences.profile,
    priority: preferences.priority,
    listingPolicy: preferences.listingPolicy ?? "retail_only",
    budgetWon: preferences.budgetWon ?? null,
    gamingResolution: preferences.gamingResolution ?? null,
    gamingRefreshRate: preferences.profile === "gaming" ? preferences.gamingRefreshRate ?? 144 : null
  });
}

export function parseBuildDraftStorage(raw: string | null | undefined): BuildDraftLoadResult {
  if (!raw || raw.trim().length === 0) return { build: emptyBuild(), status: "empty", errors: [] };
  const parsed = parseBuildTransfer(raw);
  if (parsed.envelope) return { build: parsed.envelope.selection, status: "valid", errors: [] };
  return { build: emptyBuild(), status: "recovered", errors: parsed.errors.slice(0, 4) };
}

export function buildDraftSyncFor(currentBuild: BuildSelection, incomingRaw: string | null | undefined): BuildDraftSyncResult {
  const incoming = parseBuildDraftStorage(incomingRaw);
  if (incoming.status !== "valid") return { status: "invalid", errors: incoming.errors };
  return buildDraftKeyFor(currentBuild) === buildDraftKeyFor(incoming.build)
    ? { status: "same" }
    : { status: "changed", build: incoming.build };
}

export function recommendationPreferencesSyncFor(currentPreferences: RecommendationPreferences, incomingRaw: string | null | undefined): RecommendationPreferencesSyncResult {
  if (!incomingRaw || incomingRaw.trim().length === 0) return { status: "invalid", errors: ["추천 기준이 비어 있습니다."] };
  let parsedRaw: unknown;
  try {
    parsedRaw = JSON.parse(incomingRaw);
  } catch {
    return { status: "invalid", errors: ["추천 기준 JSON 형식이 올바르지 않습니다."] };
  }
  const parsed = parseBuildTransfer({
    selection: { memory: [], ssd: [], hdd: [], useIntegratedGraphics: true },
    recommendationPreferences: parsedRaw
  });
  if (!parsed.envelope) return { status: "invalid", errors: parsed.errors.slice(0, 4) };
  return recommendationPreferencesKeyFor(currentPreferences) === recommendationPreferencesKeyFor(parsed.envelope.recommendationPreferences)
    ? { status: "same" }
    : { status: "changed", preferences: parsed.envelope.recommendationPreferences };
}
