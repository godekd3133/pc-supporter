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
    analysisScoreLabel: CompatibilityResult["analysis"]["scoreLabel"];
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
  entries: SavedBuildVersionCurrentRecheckEntry[];
  dataBoundary: string;
};

export function savedBuildCurrentRecheckExportFor(payload: SavedBuildVersionSharePayload, entries: SavedBuildVersionCurrentRecheckEntry[], generatedAt = new Date().toISOString()): SavedBuildCurrentRecheckExport {
  return {
    schemaVersion: SAVED_BUILD_CURRENT_RECHECK_SCHEMA_VERSION,
    kind: SAVED_BUILD_CURRENT_RECHECK_KIND,
    generatedAt,
    source: {
      before: { id: payload.before.id, label: payload.before.label, name: payload.before.name },
      after: { id: payload.after.id, label: payload.after.label, name: payload.after.name }
    },
    entries: entries.map((entry) => ({ ...entry, current: { ...entry.current, findings: entry.current.findings.slice(0, 32), ...(entry.current.benchmark ? { benchmark: { ...entry.current.benchmark, rows: entry.current.benchmark.rows.slice(0, 4) } } : {}) } })),
    dataBoundary: "현재 catalog 기준으로 다시 검사한 참고 결과입니다. 저장 snapshot·공유 링크·원본 견적은 변경하지 않으며, 실제 가격·재고·FPS·제조사 원문·물리 장착은 별도 확인해야 합니다."
  };
}

function findingDeltaText(entry: SavedBuildVersionCurrentRecheckEntry) {
  const saved = entry.savedCheck;
  if (!saved?.findings) return "finding: snapshot 없음";
  const savedByKey = new Map(saved.findings.map((finding) => [finding.key, finding]));
  const currentByKey = new Map(entry.current.findings.map((finding) => [finding.key, finding]));
  const resolved = [...savedByKey.keys()].filter((key) => !currentByKey.has(key));
  const added = [...currentByKey.keys()].filter((key) => !savedByKey.has(key));
  const changed = [...savedByKey.keys()].filter((key) => {
    const previous = savedByKey.get(key);
    const current = currentByKey.get(key);
    return current !== undefined && previous !== undefined && (current.severity !== previous.severity || current.title !== previous.title);
  });
  return `finding: 해결 ${resolved.length} · 신규 ${added.length} · 변경 ${changed.length}`;
}

export function savedBuildCurrentRecheckTextFor(payload: SavedBuildVersionSharePayload, entries: SavedBuildVersionCurrentRecheckEntry[], generatedAt = new Date().toISOString()) {
  const exported = savedBuildCurrentRecheckExportFor(payload, entries, generatedAt);
  const lines = [
    "PC Supporter 현재 기준 버전 재검사",
    "================================",
    `비교: ${exported.source.before.label} ${exported.source.before.name} → ${exported.source.after.label} ${exported.source.after.name}`,
    `생성 시각: ${generatedAt}`,
    "",
    ...exported.entries.flatMap((entry) => [
      `[${entry.label} ${entry.name}]`,
      `현재 판정: ${entry.current.status === "compatible" ? "호환 가능" : entry.current.status === "needs_review" ? "확인 필요" : "호환 불가"} · 차단 ${entry.current.blockerCount} · 주의 ${entry.current.warningCount} · 확인 ${entry.current.unknownCount}`,
      `가격·분석: 가격 ${entry.current.priceComplete ? `${entry.current.totalPriceWon.toLocaleString("ko-KR")}원` : "확인 필요"} · 분석 ${entry.current.analysisScore !== undefined ? `${entry.current.analysisScore}점 · ${entry.current.analysisScoreLabel}` : entry.current.analysisScoreLabel}`,
      `전력·냉각: ${entry.current.resources.power} · ${entry.current.resources.cooling}`,
      `benchmark: ${entry.current.benchmark ? `${entry.current.benchmark.status} · ${entry.current.benchmark.presentScoreCount}/${entry.current.benchmark.expectedScoreCount}${entry.current.benchmark.rows.length > 0 ? ` · ${entry.current.benchmark.rows.map((row) => `${row.label} ${row.value ?? "-"}`).join(" · ")}` : ""}` : "snapshot 없음"}`,
      findingDeltaText(entry),
      `현재 catalog: ${new Date(entry.current.catalogSnapshotAt).toLocaleString("ko-KR")} · engine: ${entry.current.engineVersion} · 검사: ${new Date(entry.current.checkedAt).toLocaleString("ko-KR")}`,
      ""
    ]),
    "[데이터 경계]",
    exported.dataBoundary
  ];
  return lines.join("\n");
}
