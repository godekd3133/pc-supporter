import type { SavedBuildVersionShareCheck, SavedBuildVersionSharePayload } from "./saved-build-version-share";
import type { CompatibilityResult } from "./types";

export const SAVED_BUILD_CURRENT_RECHECK_SCHEMA_VERSION = 1 as const;
export const SAVED_BUILD_CURRENT_RECHECK_KIND = "pc-supporter.saved-build-version-current-recheck" as const;

export type SavedBuildVersionCurrentRecheckEntry = {
  label: string;
  name: string;
  savedCheck?: SavedBuildVersionShareCheck;
  current: {
    status: CompatibilityResult["status"];
    blockerCount: number;
    warningCount: number;
    unknownCount: number;
    totalPriceWon: number;
    priceComplete: boolean;
    analysisScore?: number;
    analysisScoreLabel?: CompatibilityResult["analysis"]["scoreLabel"];
    findings: Array<{ key: string; title: string; severity: string }>;
    resources: { power: string; cooling: string; state: string };
    benchmark?: { status: string; presentScoreCount: number; expectedScoreCount: number; rows: Array<{ label: string; value?: number }> };
    engineVersion: string;
    catalogSnapshotAt: string;
    checkedAt: string;
  };
};

export type SavedBuildCurrentRecheckExport = {
  schemaVersion: typeof SAVED_BUILD_CURRENT_RECHECK_SCHEMA_VERSION;
  kind: typeof SAVED_BUILD_CURRENT_RECHECK_KIND;
  generatedAt: string;
  source: {
    before: { id: string; label: string; name: string };
    after: { id: string; label: string; name: string };
  };
  entries: SavedBuildCurrentRecheckExportEntry[];
  dataBoundary: string;
};

export type SavedBuildCurrentRecheckExportEntry = Omit<SavedBuildVersionCurrentRecheckEntry, "savedCheck" | "current"> & {
  savedCheck?: SavedBuildVersionShareCheck;
  current: Omit<SavedBuildVersionCurrentRecheckEntry["current"], "analysisScore" | "analysisScoreLabel" | "benchmark">;
};

function savedCheckForPublicExport(check: SavedBuildVersionShareCheck | undefined) {
  if (!check) return undefined;
  return {
    status: check.status,
    blockerCount: check.blockerCount,
    warningCount: check.warningCount,
    unknownCount: check.unknownCount,
    totalPriceWon: check.totalPriceWon,
    priceComplete: check.priceComplete,
    ...(check.resourceBudget ? { resourceBudget: { ...check.resourceBudget } } : {}),
    ...(check.findings ? { findings: check.findings.map((finding) => ({ ...finding })) } : {}),
    engineVersion: check.engineVersion,
    catalogSnapshotAt: check.catalogSnapshotAt,
    checkedAt: check.checkedAt
  };
}

function currentCheckForPublicExport(entry: SavedBuildVersionCurrentRecheckEntry): SavedBuildCurrentRecheckExportEntry["current"] {
  const { analysisScore: _analysisScore, analysisScoreLabel: _analysisScoreLabel, benchmark: _benchmark, findings, ...current } = entry.current;
  return { ...current, findings: findings.slice(0, 32) };
}

export function savedBuildCurrentRecheckExportFor(payload: SavedBuildVersionSharePayload, entries: SavedBuildVersionCurrentRecheckEntry[], generatedAt = new Date().toISOString()): SavedBuildCurrentRecheckExport {
  return {
    schemaVersion: SAVED_BUILD_CURRENT_RECHECK_SCHEMA_VERSION,
    kind: SAVED_BUILD_CURRENT_RECHECK_KIND,
    generatedAt,
    source: {
      before: { id: payload.before.id, label: payload.before.label, name: payload.before.name },
      after: { id: payload.after.id, label: payload.after.label, name: payload.after.name }
    },
    entries: entries.map((entry) => ({
      label: entry.label,
      name: entry.name,
      ...(entry.savedCheck ? { savedCheck: savedCheckForPublicExport(entry.savedCheck) } : {}),
      current: currentCheckForPublicExport(entry)
    })),
    dataBoundary: "현재 부품 정보를 바탕으로 다시 확인한 결과입니다. 저장 견적은 바뀌지 않습니다. 가격·재고와 실제 장착 여부는 구매 전에 확인해 주세요. 게임 성능은 게임과 설정에 따라 달라집니다."
  };
}

function findingDeltaText(entry: { savedCheck?: { findings?: Array<{ key: string; title: string; severity: string }> }; current: { findings: Array<{ key: string; title: string; severity: string }> } }) {
  const saved = entry.savedCheck;
  if (!saved?.findings) return "저장본과 비교: 저장된 결과 없음";
  const savedByKey = new Map(saved.findings.map((finding) => [finding.key, finding]));
  const currentByKey = new Map(entry.current.findings.map((finding) => [finding.key, finding]));
  const resolved = [...savedByKey.keys()].filter((key) => !currentByKey.has(key));
  const added = [...currentByKey.keys()].filter((key) => !savedByKey.has(key));
  const changed = [...savedByKey.keys()].filter((key) => {
    const previous = savedByKey.get(key);
    const current = currentByKey.get(key);
    return current !== undefined && previous !== undefined && (current.severity !== previous.severity || current.title !== previous.title);
  });
  return `저장본과 비교: 해결 ${resolved.length} · 새로 생김 ${added.length} · 내용 변경 ${changed.length}`;
}

export function savedBuildCurrentRecheckTextFor(payload: SavedBuildVersionSharePayload, entries: SavedBuildVersionCurrentRecheckEntry[], generatedAt = new Date().toISOString()) {
  const exported = savedBuildCurrentRecheckExportFor(payload, entries, generatedAt);
  const lines = [
    "PC Supporter 저장 견적 비교 결과",
    "================================",
    `비교: ${exported.source.before.label} ${exported.source.before.name} → ${exported.source.after.label} ${exported.source.after.name}`,
    `생성 시각: ${generatedAt}`,
    "",
    ...exported.entries.flatMap((entry) => [
      `[${entry.label} ${entry.name}]`,
      `현재 결과: ${entry.current.status === "compatible" ? "호환 가능" : entry.current.status === "needs_review" ? "확인 필요" : "호환 불가"} · 호환 불가 ${entry.current.blockerCount} · 주의 ${entry.current.warningCount} · 확인 필요 ${entry.current.unknownCount}`,
      `가격: ${entry.current.priceComplete ? `${entry.current.totalPriceWon.toLocaleString("ko-KR")}원` : "확인 필요"}${entry.savedCheck?.priceComplete && entry.current.priceComplete ? ` · 저장본 대비 ${entry.current.totalPriceWon - entry.savedCheck.totalPriceWon > 0 ? "+" : ""}${(entry.current.totalPriceWon - entry.savedCheck.totalPriceWon).toLocaleString("ko-KR")}원` : ""}`,
      `전력·냉각: ${entry.current.resources.power} · ${entry.current.resources.cooling}`,
      findingDeltaText(entry),
      `부품 정보 기준일: ${new Date(entry.current.catalogSnapshotAt).toLocaleString("ko-KR")} · 계산 버전 ${entry.current.engineVersion} · 확인 시각 ${new Date(entry.current.checkedAt).toLocaleString("ko-KR")}`,
      ""
    ]),
    "[참고]",
    exported.dataBoundary
  ];
  return lines.join("\n");
}
