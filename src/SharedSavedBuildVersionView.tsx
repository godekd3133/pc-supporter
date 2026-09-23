import { useEffect, useRef, useState } from "react";
import { FiAlertTriangle, FiArrowLeft, FiCheckCircle, FiCopy, FiDownload, FiExternalLink, FiInfo, FiLoader, FiRefreshCw, FiShare2, FiXCircle } from "react-icons/fi";
import type { SavedBuildVersionComparisonShareSnapshot, SavedBuildVersionShareCheck, SavedBuildVersionSharePayload } from "../shared/saved-build-version-share";
import type { CompatibilityResult, SavedBuild } from "../shared/types";
import { buildBenchmarkSnapshotStatusText } from "../shared/build-benchmark-snapshot";
import { buildResourceSummaryFor } from "../shared/build-resource-summary";
import { savedBuildCurrentRecheckExportFor, savedBuildCurrentRecheckTextFor } from "../shared/saved-build-current-recheck";
import type { SavedBuildVersionCurrentRecheckEntry } from "../shared/saved-build-current-recheck";
import { api } from "./api";

type Props = {
  onBack: () => void;
  onToast: (message: string) => void;
};

function statusText(status: SavedBuildVersionShareCheck["status"] | undefined) {
  return status === "compatible" ? "호환 가능" : status === "needs_review" ? "확인 필요" : status === "incompatible" ? "호환 불가" : "검사 저장본 없음";
}

function directionText(direction: SavedBuildVersionSharePayload["summary"]["direction"] | undefined) {
  return direction === "improved" ? "위험 감소" : direction === "regressed" ? "위험 증가" : direction === "changed" ? "일부 변경" : direction === "same" ? "변화 없음" : "검사 기준 없음";
}

function formatPrice(value: number | undefined, complete: boolean | undefined) {
  return complete && value !== undefined ? `${value.toLocaleString("ko-KR")}원` : "가격 확인 필요";
}

function signed(value: number | undefined) {
  if (value === undefined) return "확인 필요";
  return value === 0 ? "변화 없음" : `${value > 0 ? "+" : ""}${value}`;
}

function directionTone(direction: SavedBuildVersionSharePayload["summary"]["direction"] | undefined) {
  return direction ?? "unknown";
}

type CurrentVersionCheck = SavedBuildVersionCurrentRecheckEntry;

type CurrentVersionCheckState =
  | { status: "idle" | "loading" }
  | { status: "ready"; entries: CurrentVersionCheck[] }
  | { status: "error"; message: string };

function currentStatusText(status: CompatibilityResult["status"]) {
  return status === "compatible" ? "호환 가능" : status === "needs_review" ? "확인 필요" : "호환 불가";
}

function savedToCurrentDirection(saved: SavedBuildVersionShareCheck | undefined, current: CurrentVersionCheck["current"]) {
  if (!saved) return "저장 검사 없음";
  const rank = { incompatible: 0, needs_review: 1, compatible: 2 } as const;
  const savedRank = rank[saved.status];
  const currentRank = rank[current.status];
  return currentRank > savedRank ? "현재 기준 개선" : currentRank < savedRank ? "현재 기준 위험 증가" : saved.blockerCount !== current.blockerCount || saved.warningCount !== current.warningCount || saved.unknownCount !== current.unknownCount ? "현재 위험 수치 변경" : "결과 변화 없음";
}

function signedDelta(value: number | undefined) {
  if (value === undefined) return "확인 필요";
  return value === 0 ? "변화 없음" : `${value > 0 ? "+" : ""}${value}`;
}

function findingDeltaFor(saved: SavedBuildVersionShareCheck | undefined, current: CurrentVersionCheck["current"]) {
  if (!saved?.findings) return undefined;
  const savedByKey = new Map(saved.findings.map((finding) => [finding.key, finding]));
  const currentByKey = new Map(current.findings.map((finding) => [finding.key, finding]));
  let resolved = 0;
  let added = 0;
  let changed = 0;
  const resolvedTitles: string[] = [];
  const addedTitles: string[] = [];
  const changedTitles: string[] = [];
  for (const [key, finding] of savedByKey) {
    const currentFinding = currentByKey.get(key);
    if (!currentFinding) {
      resolved += 1;
      if (resolvedTitles.length < 3) resolvedTitles.push(finding.title);
    } else if (currentFinding.severity !== finding.severity || currentFinding.title !== finding.title) {
      changed += 1;
      if (changedTitles.length < 3) changedTitles.push(currentFinding.title);
    }
  }
  for (const [key, finding] of currentByKey) {
    if (!savedByKey.has(key)) {
      added += 1;
      if (addedTitles.length < 3) addedTitles.push(finding.title);
    }
  }
  return { resolved, added, changed, resolvedTitles, addedTitles, changedTitles };
}

export function SharedSavedBuildVersionView({ onBack, onToast }: Props) {
  const [state, setState] = useState<{ status: "loading" } | { status: "ready"; snapshot: SavedBuildVersionComparisonShareSnapshot } | { status: "error"; message: string }>({ status: "loading" });
  const [retryNonce, setRetryNonce] = useState(0);
  const mountedRef = useRef(true);
  const id = window.location.pathname.split("/").filter(Boolean).at(-1) ?? "";

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setState({ status: "loading" });
    void api<SavedBuildVersionComparisonShareSnapshot>(`/api/version-comparisons/${encodeURIComponent(id)}`, { retry: 1, signal: controller.signal }).then((snapshot) => {
      if (!cancelled) setState({ status: "ready", snapshot });
    }).catch((error: unknown) => {
      if (!cancelled) setState({ status: "error", message: error instanceof Error ? error.message : "공유 버전 비교를 불러오지 못했습니다." });
    });
    return () => { cancelled = true; controller.abort(); };
  }, [id, retryNonce]);

  function downloadJson(snapshot: SavedBuildVersionComparisonShareSnapshot) {
    const blob = new Blob([JSON.stringify(snapshot.payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pc-supporter-shared-version-comparison-${snapshot.payload.before.label}-${snapshot.payload.after.label}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
    onToast("공유 버전 비교 JSON을 저장했습니다.");
  }

  async function copyText(snapshot: SavedBuildVersionComparisonShareSnapshot) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard-unavailable");
      await navigator.clipboard.writeText(snapshot.payload.text);
      if (mountedRef.current) onToast("공유 버전 비교를 클립보드에 복사했습니다.");
    } catch {
      if (mountedRef.current) onToast("공유 버전 비교 복사에 실패했습니다. 브라우저 클립보드 권한을 확인해 주세요.");
    }
  }

  return <div className="shared-version-comparison-page">
    <div className="workspace-heading"><div><button className="back-link" type="button" onClick={onBack}><FiArrowLeft /> 홈으로</button><h1>공유된 견적 버전 비교</h1><p>두 견적의 저장 당시 구성과 검사 결과를 비교합니다.</p></div><span className="admin-badge"><FiShare2 /> 읽기 전용</span></div>
    {state.status === "loading" && <div className="shared-version-comparison-state" role="status"><FiLoader className="spin" /> 공유 버전 비교를 불러오는 중...</div>}
    {state.status === "error" && <div className="shared-version-comparison-state error" role="alert"><FiXCircle /><span>{state.message}</span><div><button className="button button-light" type="button" data-testid="shared-version-comparison-retry" onClick={() => setRetryNonce((current) => current + 1)}><FiRefreshCw /> 다시 시도</button><button className="text-button" type="button" onClick={onBack}>홈으로</button></div></div>}
    {state.status === "ready" && <><SharedVersionComparisonCard snapshot={state.snapshot} onCopy={() => void copyText(state.snapshot)} onDownload={() => downloadJson(state.snapshot)} /><SharedVersionCurrentCheck payload={state.snapshot.payload} onToast={onToast} /></>}
  </div>;
}

function SharedVersionComparisonCard({ snapshot, onCopy, onDownload }: { snapshot: SavedBuildVersionComparisonShareSnapshot; onCopy: () => void; onDownload: () => void }) {
  const payload = snapshot.payload;
  const transition = payload.transition;
  const beforeCheck = payload.before.check;
  const afterCheck = payload.after.check;
  const findingCount = payload.findingChanges.length;
  return <section className={`shared-version-comparison-card ${directionTone(payload.summary.direction)}`} aria-label="공유된 저장 견적 버전 비교" data-testid="shared-version-comparison-card">
    <div className="shared-version-comparison-card-heading"><div><p className="eyebrow">견적 버전 비교</p><h2>{snapshot.name}</h2><small>{payload.before.label} {payload.before.name} → {payload.after.label} {payload.after.name} · 생성 {new Date(snapshot.createdAt).toLocaleString("ko-KR")} · {snapshot.expiresAt ? `만료 ${new Date(snapshot.expiresAt).toLocaleString("ko-KR")}` : "무기한"}</small></div><div className="shared-version-comparison-actions"><button className="button button-light" type="button" data-testid="shared-version-comparison-copy" onClick={onCopy}><FiCopy /> 비교 복사</button><button className="button button-light" type="button" data-testid="shared-version-comparison-download" onClick={onDownload}><FiDownload /> JSON 저장</button></div></div>
    <div className="shared-version-comparison-pair"><article><span>{payload.before.label}</span><strong>{payload.before.name}</strong><small>{statusText(beforeCheck?.status)} · {beforeCheck ? `차단 ${beforeCheck.blockerCount} · 주의 ${beforeCheck.warningCount} · 확인 ${beforeCheck.unknownCount}` : "저장 검사 없음"}</small>{payload.before.decisionNote && <p>선택 이유 · {payload.before.decisionNote}</p>}<a className="shared-version-comparison-current-link" data-testid={`shared-version-comparison-current-${payload.before.id}`} href={`/share/${encodeURIComponent(payload.before.id)}`}><FiExternalLink /> 현재 기준 결과 열기</a></article><b aria-hidden="true">→</b><article><span>{payload.after.label}</span><strong>{payload.after.name}</strong><small>{statusText(afterCheck?.status)} · {afterCheck ? `차단 ${afterCheck.blockerCount} · 주의 ${afterCheck.warningCount} · 확인 ${afterCheck.unknownCount}` : "저장 검사 없음"}</small>{payload.after.decisionNote && <p>선택 이유 · {payload.after.decisionNote}</p>}<a className="shared-version-comparison-current-link" data-testid={`shared-version-comparison-current-${payload.after.id}`} href={`/share/${encodeURIComponent(payload.after.id)}`}><FiExternalLink /> 현재 기준 결과 열기</a></article></div>
    <section className="shared-version-comparison-summary" aria-label="버전 비교 요약"><div><span>결과 방향</span><strong>{directionText(payload.summary.direction)}</strong></div><div><span>구성</span><strong>{payload.summary.selectionChangedCategoryCount}개 범주 변경</strong></div><div><span>위험 변화</span><strong>{transition ? `차단 ${signed(transition.blockerDelta)} · 주의 ${signed(transition.warningDelta)} · 확인 ${signed(transition.unknownDelta)}` : "비교 기준 없음"}</strong></div><div><span>총액</span><strong>{transition?.priceDeltaWon !== undefined ? `${transition.priceDeltaWon > 0 ? "+" : ""}${transition.priceDeltaWon.toLocaleString("ko-KR")}원` : beforeCheck && afterCheck ? `${formatPrice(beforeCheck.totalPriceWon, beforeCheck.priceComplete)} → ${formatPrice(afterCheck.totalPriceWon, afterCheck.priceComplete)}` : "가격 확인 필요"}</strong></div><div><span>결과 항목</span><strong>{findingCount > 0 ? `${findingCount}개 변경` : "변화 없음"}</strong></div></section>
    <div className="shared-version-comparison-columns"><section aria-label="변경된 부품"><div className="shared-version-comparison-subheading"><strong>변경된 구성</strong><span>{payload.changes.length}개</span></div>{payload.changes.length > 0 ? <div className="shared-version-comparison-change-list">{payload.changes.map((change) => <div key={change.id}><span>{change.label}</span><small><em>{change.before}</em><b>→</b><em>{change.after}</em></small></div>)}</div> : <p className="shared-version-comparison-empty"><FiCheckCircle /> 선택 구성 변화 없음</p>}</section><section aria-label="변경된 호환성 결과"><div className="shared-version-comparison-subheading"><strong>변경된 호환성 결과</strong><span>{findingCount}개</span></div>{findingCount > 0 ? <ul className="shared-version-comparison-findings">{payload.findingChanges.map((finding) => <li className={finding.change}><span>{finding.change === "resolved" ? "해결됨" : finding.change === "new" ? "신규" : finding.change === "severity_changed" ? "중요도 변경" : "내용 변경"}</span><strong>{finding.title}</strong></li>)}</ul> : <p className="shared-version-comparison-empty"><FiCheckCircle /> 항목 변화 없음</p>}</section></div>


  </section>;
}

function SharedVersionCurrentCheck({ payload, onToast }: { payload: SavedBuildVersionSharePayload; onToast: (message: string) => void }) {
  const [state, setState] = useState<CurrentVersionCheckState>({ status: "idle" });
  const [retryNonce, setRetryNonce] = useState(0);
  const mountedRef = useRef(true);
  const buildIds = `${payload.before.id},${payload.after.id}`;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  function downloadCurrentRecheck() {
    if (state.status !== "ready") return;
    const exportPayload = savedBuildCurrentRecheckExportFor(payload, state.entries);
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pc-supporter-current-version-recheck-${payload.before.label}-${payload.after.label}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
    onToast("현재 기준 버전 재검사 JSON을 저장했습니다.");
  }

  async function copyCurrentRecheck() {
    if (state.status !== "ready") return;
    const text = savedBuildCurrentRecheckTextFor(payload, state.entries);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard-unavailable");
      await navigator.clipboard.writeText(text);
      if (mountedRef.current) onToast("현재 기준 버전 재검사를 클립보드에 복사했습니다.");
    } catch {
      if (mountedRef.current) onToast("현재 기준 버전 재검사 복사에 실패했습니다. 브라우저 클립보드 권한을 확인해 주세요.");
    }
  }

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setState({ status: "loading" });
    const run = async () => {
      try {
        const response = await api<{ items: SavedBuild[] }>(`/api/builds?ids=${encodeURIComponent(buildIds)}&limit=2`, { retry: 1, signal: controller.signal });
        const builds = new Map(response.items.map((build) => [build.id, build]));
        const entries = await Promise.all([
          { id: payload.before.id, label: payload.before.label, name: payload.before.name, savedCheck: payload.before.check },
          { id: payload.after.id, label: payload.after.label, name: payload.after.name, savedCheck: payload.after.check }
        ].map(async (version): Promise<CurrentVersionCheck> => {
          const saved = builds.get(version.id);
          if (!saved) throw new Error(`${version.label} 저장 견적을 현재 공개 목록에서 찾지 못했습니다.`);
          const result = await api<CompatibilityResult>("/api/compatibility/check", {
            method: "POST",
            body: JSON.stringify({ ...saved.selection, recommendationPreferences: saved.recommendationPreferences }),
            retry: 1,
            retryOnRateLimit: true,
            signal: controller.signal
          });
          return {
            label: version.label,
            name: version.name,
            savedCheck: version.savedCheck,
            current: {
              status: result.status,
              blockerCount: result.blockerCount,
              warningCount: result.warningCount,
              unknownCount: result.unknownCount,
              totalPriceWon: result.totalPriceWon,
              priceComplete: result.priceComplete,
              ...(result.analysis.overallScore !== undefined ? { analysisScore: result.analysis.overallScore } : {}),
              analysisScoreLabel: result.analysis.scoreLabel,
              findings: result.findings.slice(0, 32).map((finding) => ({ key: finding.ruleId || finding.id, title: finding.title, severity: finding.severity })),
              resources: (() => { const summary = buildResourceSummaryFor(result.metrics); return { power: summary.cards[0].headline, cooling: summary.cards[1].headline, state: summary.stateLabel }; })(),
              ...(result.benchmarkSnapshot ? { benchmark: { status: buildBenchmarkSnapshotStatusText(result.benchmarkSnapshot.status), presentScoreCount: result.benchmarkSnapshot.presentScoreCount, expectedScoreCount: result.benchmarkSnapshot.expectedScoreCount, rows: result.benchmarkSnapshot.parts.flatMap((part) => part.rows.map((row) => ({ label: row.label, ...(row.value !== undefined ? { value: row.value } : {}) }))).slice(0, 4) } } : {}),
              engineVersion: result.engineVersion,
              catalogSnapshotAt: result.catalogSnapshotAt,
              checkedAt: result.checkedAt
            }
          };
        }));
        if (!cancelled) setState({ status: "ready", entries });
      } catch (error: unknown) {
        if (!cancelled) setState({ status: "error", message: error instanceof Error ? error.message : "현재 견적 비교에 실패했습니다." });
      }
    };
    void run();
    return () => { cancelled = true; controller.abort(); };
  }, [buildIds, payload.after.id, payload.before.id, retryNonce]);

  return <section className="shared-version-current-check" aria-label="현재 견적 비교" data-testid="shared-version-comparison-current-check"><div className="shared-version-current-check-heading"><div><h3>현재 견적 비교</h3><small>저장 당시 견적과 현재 가격·호환성 결과를 비교해요.</small></div><div className="shared-version-current-check-actions"><button className="button button-light" type="button" data-testid="shared-version-comparison-current-retry" onClick={() => setRetryNonce((current) => current + 1)} disabled={state.status === "loading"}><FiRefreshCw className={state.status === "loading" ? "spin" : undefined} /> {state.status === "loading" ? "재검사 중..." : "현재 결과 불러오기"}</button>{state.status === "ready" && <><button className="button button-light" type="button" data-testid="shared-version-comparison-current-copy" onClick={() => void copyCurrentRecheck()}><FiCopy /> 현재 재검사 복사</button><button className="button button-light" type="button" data-testid="shared-version-comparison-current-download" onClick={downloadCurrentRecheck}><FiDownload /> 현재 재검사 JSON</button></>}</div></div>{state.status === "loading" && <div className="shared-version-current-check-state" role="status"><FiLoader className="spin" /> 현재 부품 정보로 견적을 계산하는 중...</div>}{state.status === "error" && <div className="shared-version-current-check-state error" role="alert"><FiAlertTriangle /><span>{state.message}</span><button className="text-button" type="button" onClick={() => setRetryNonce((current) => current + 1)}>다시 시도</button></div>}{state.status === "ready" && <div className="shared-version-current-check-grid" data-testid="shared-version-current-check-grid">{state.entries.map((entry) => { const saved = entry.savedCheck; const priceDelta = saved?.priceComplete && entry.current.priceComplete ? entry.current.totalPriceWon - saved.totalPriceWon : undefined; const analysisDelta = saved?.analysisScore !== undefined && entry.current.analysisScore !== undefined ? entry.current.analysisScore - saved.analysisScore : undefined; const findingDelta = findingDeltaFor(saved, entry.current); const catalogChanged = Boolean(saved?.catalogSnapshotAt && saved.catalogSnapshotAt !== entry.current.catalogSnapshotAt); return <article key={entry.label} className={entry.current.status}><div className="shared-version-current-check-item-heading"><div><span>{entry.label}</span><strong>{entry.name}</strong></div><em>{currentStatusText(entry.current.status)}</em></div><small>현재 위험 · 차단 {entry.current.blockerCount} · 주의 {entry.current.warningCount} · 확인 {entry.current.unknownCount}</small><div className="shared-version-current-check-evidence"><span>전력 {entry.current.resources.power}</span><span>냉각 {entry.current.resources.cooling}</span>{entry.current.benchmark && <>{entry.current.benchmark.rows.length > 0 && <span>점수 {entry.current.benchmark.rows.map((row) => `${row.label} ${row.value ?? "-"}`).join(" · ")}</span>}</>}</div><div className="shared-version-current-check-deltas"><span>저장본 대비 <b>{savedToCurrentDirection(saved, entry.current)}</b></span><span>가격 <b>{signedDelta(priceDelta)}{priceDelta !== undefined ? "원" : ""}</b></span><span>항목 <b>{findingDelta ? `해결 ${findingDelta.resolved} · 신규 ${findingDelta.added} · 변경 ${findingDelta.changed}` : "저장본 없음"}</b></span></div>{findingDelta && (findingDelta.resolvedTitles.length + findingDelta.addedTitles.length + findingDelta.changedTitles.length > 0) && <div className="shared-version-current-check-finding-preview" data-testid={`shared-version-current-finding-preview-${entry.label}`}><strong>변경 항목</strong>{findingDelta.resolvedTitles.length > 0 && <span><em>해결</em> {findingDelta.resolvedTitles.join(" · ")}</span>}{findingDelta.addedTitles.length > 0 && <span><em>신규</em> {findingDelta.addedTitles.join(" · ")}</span>}{findingDelta.changedTitles.length > 0 && <span><em>변경</em> {findingDelta.changedTitles.join(" · ")}</span>}</div>}<small>계산 시각 {new Date(entry.current.checkedAt).toLocaleString("ko-KR")}</small>{catalogChanged && <p className="shared-version-current-check-warning"><FiAlertTriangle /> 저장 당시와 현재 호환성 결과가 달라요.</p>}</article>; })}</div>}<p className="shared-version-current-check-note"><FiInfo /> 현재 결과를 다시 확인해도 공유된 두 견적은 바뀌지 않습니다.</p></section>;
}
