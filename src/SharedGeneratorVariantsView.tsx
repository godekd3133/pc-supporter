import { useEffect, useMemo, useState } from "react";
import { FiAlertTriangle, FiArrowLeft, FiCopy, FiDownload, FiInfo, FiLoader, FiRefreshCw, FiZap } from "react-icons/fi";
import { GENERATOR_VARIANTS_DRAFT_TRANSFER_KEY, generatorVariantsConditionsSearchFor } from "../shared/generator-variants-share";
import type { GeneratorVariantsExportItem, GeneratorVariantsShareSnapshot } from "../shared/generator-variants-share";
import type { BuildGenerationVariantResult } from "../shared/types";
import { CATEGORY_LABELS, GAMING_REFRESH_RATE_LABELS, GAMING_RESOLUTION_LABELS, PART_CATEGORIES, RECOMMENDATION_PRIORITY_LABELS, RECOMMENDATION_PROFILE_LABELS } from "../shared/types";
import { api } from "./api";

function shareIdFromPath() {
  const match = window.location.pathname.match(/^\/generator-variants\/([^/]+)/);
  return match?.[1] ?? "";
}

function formatWon(value: number | undefined) {
  return value === undefined ? "확인 필요" : `${value.toLocaleString("ko-KR")}원`;
}

function lineText(item: GeneratorVariantsExportItem, category: string) {
  const line = item.draft?.lines.find((candidate) => candidate.category === category);
  return line ? `${line.name}${line.quantity > 1 ? ` ×${line.quantity}` : ""}` : "미포함";
}

function variantSignature(item: GeneratorVariantsExportItem) {
  return item.draft?.lines.map((line) => `${line.category}:${line.partId}:${line.quantity}`).join("|") ?? "";
}

function summaryFor(items: GeneratorVariantsExportItem[]) {
  const drafts = items.filter((item) => item.draft);
  const prices = drafts.map((item) => item.draft!.totalPriceWon).filter(Number.isFinite);
  const scores = drafts.map((item) => item.draft!.analysis?.overallScore).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const signatures = new Set(drafts.map(variantSignature));
  const changedCategories = PART_CATEGORIES.filter((category) => new Set(drafts.map((item) => {
    const line = item.draft!.lines.find((candidate) => candidate.category === category);
    return `${line?.partId ?? ""}:${line?.quantity ?? 0}`;
  })).size > 1);
  return {
    configurationCount: signatures.size,
    priceText: prices.length === 0 ? "확인 필요" : `${formatWon(Math.min(...prices))}${Math.min(...prices) === Math.max(...prices) ? "" : ` ~ ${formatWon(Math.max(...prices))}`}`,
    analysisText: scores.length === 0 ? "계산 불가" : `${Math.min(...scores)}점${Math.min(...scores) === Math.max(...scores) ? "" : ` ~ ${Math.max(...scores)}점`}`,
    changedCategories
  };
}

function statusLabel(status: NonNullable<BuildGenerationVariantResult["draft"]>["status"]) {
  return status === "compatible" ? "호환 가능" : status === "needs_review" ? "확인 필요" : "검토 필요";
}

function exportItemsFromVariants(variants: BuildGenerationVariantResult[]) {
  return (["balanced", "budget", "performance"] as const).map((priority): GeneratorVariantsExportItem => {
    const variant = variants.find((item) => item.priority === priority);
    const draft = variant?.draft;
    return {
      priority,
      label: RECOMMENDATION_PRIORITY_LABELS[priority],
      status: draft ? statusLabel(draft.status) : "생성 실패",
      ...(variant?.error ? { error: variant.error } : {}),
      ...(draft ? {
        draft,
        totalPriceWon: draft.totalPriceWon,
        budgetDeltaWon: draft.budgetDeltaWon,
        analysisScore: draft.analysis?.overallScore,
        blockerCount: draft.blockerCount,
        warningCount: draft.warningCount,
        unknownCount: draft.unknownCount,
        lines: PART_CATEGORIES.map((category) => {
          const line = draft.lines.find((candidate) => candidate.category === category);
          return { category, label: CATEGORY_LABELS[category], name: line?.name ?? "미포함", partId: line?.partId, quantity: line?.quantity ?? 0 };
        })
      } : {})
    };
  });
}

export function SharedGeneratorVariantsView({ onBack, onToast }: { onBack: () => void; onToast: (message: string) => void }) {
  const shareId = shareIdFromPath();
  const [snapshot, setSnapshot] = useState<GeneratorVariantsShareSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshState, setRefreshState] = useState<{ status: "idle" | "loading" | "ready" | "error"; items?: GeneratorVariantsExportItem[]; error?: string }>({ status: "idle" });
  const summary = useMemo(() => snapshot ? summaryFor(snapshot.payload.items) : undefined, [snapshot]);
  const currentSummary = useMemo(() => refreshState.items ? summaryFor(refreshState.items) : undefined, [refreshState.items]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void api<GeneratorVariantsShareSnapshot>(`/api/generator-variants/${encodeURIComponent(shareId)}`, { signal: controller.signal, retry: 1 })
      .then(setSnapshot)
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "공유된 자동 구성 비교를 불러오지 못했습니다."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [shareId]);

  async function copyLink() {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      onToast("자동 구성 비교 공유 링크를 복사했습니다.");
    } catch {
      onToast(`자동 구성 비교 링크: ${url}`);
    }
  }

  function downloadJson() {
    if (!snapshot) return;
    const blob = new Blob([JSON.stringify(snapshot.payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pc-supporter-generator-variants-shared-${snapshot.id}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
    onToast("공유된 자동 구성 비교 JSON을 저장했습니다.");
  }

  async function refreshCurrentCatalog() {
    if (!snapshot?.request) return;
    setRefreshState({ status: "loading" });
    try {
      const response = await api<{ variants: BuildGenerationVariantResult[] }>("/api/builds/recommend/variants", { method: "POST", body: JSON.stringify(snapshot.request), retry: 1 });
      setRefreshState({ status: "ready", items: exportItemsFromVariants(Array.isArray(response.variants) ? response.variants : []) });
    } catch (reason) {
      setRefreshState({ status: "error", error: reason instanceof Error ? reason.message : "현재 catalog 기준으로 다시 비교하지 못했습니다." });
    }
  }

  function transferCurrentDraft(item: GeneratorVariantsExportItem, mode: "edit" | "check" | "save") {
    if (!item.draft || !snapshot) return;
    try {
      const payload = refreshState.items ? { ...snapshot.payload, exportedAt: new Date().toISOString(), items: refreshState.items } : snapshot.payload;
      window.sessionStorage.setItem(GENERATOR_VARIANTS_DRAFT_TRANSFER_KEY, JSON.stringify({ source: "shared-generator-variants", payload, priority: item.priority, mode, origin: { shareId: snapshot.id, shareName: snapshot.name, catalogSnapshotAt: snapshot.catalogSnapshotAt, currentRecheckedAt: payload.exportedAt } }));
      window.location.href = "/build?entry=shared-generator";
    } catch {
      onToast("현재 결과를 편집기로 넘기지 못했습니다. JSON 저장 후 자동 구성 화면에서 다시 가져와 주세요.");
    }
  }

  return <main className="shared-generator-variants-page">
    <div className="shared-generator-variants-shell">
      <button className="back-link" type="button" onClick={onBack}><FiArrowLeft /> 홈으로</button>
      {loading && <div className="shared-build-state" role="status"><FiLoader className="spin" /> 공유된 자동 구성 비교를 불러오는 중...</div>}
      {!loading && error && <div className="shared-build-error" role="alert"><FiAlertTriangle /><div><strong>공유된 비교 결과를 열지 못했습니다.</strong><p>{error}</p><button className="button button-secondary" type="button" onClick={() => window.location.reload()}>다시 시도</button></div></div>}
      {!loading && !error && snapshot && summary && <>
        <header className="shared-generator-variants-heading"><div><p className="eyebrow">SHARED GENERATOR COMPARISON</p><h1>{snapshot.name}</h1><p>공유 당시 자동 구성 3안을 읽기 전용으로 보여줍니다.</p></div><div><button className="text-button" type="button" data-testid="shared-generator-variants-copy" onClick={() => void copyLink()}><FiCopy /> 링크 복사</button><button className="text-button" type="button" data-testid="shared-generator-variants-download" onClick={downloadJson}><FiDownload /> JSON 저장</button></div></header>
        {snapshot.catalogChangedSinceShare && <div className="shared-generator-variants-notice"><FiInfo /><div><strong>공유 후 카탈로그가 갱신되었습니다.</strong><p>아래 내용은 공유 당시 결과이며 현재 가격·재고·호환성을 다시 계산하지 않았습니다.</p></div></div>}
        {snapshot.request && <div className="shared-generator-variants-request" data-testid="shared-generator-variants-request"><strong>공유 당시 생성 조건</strong><span>{RECOMMENDATION_PROFILE_LABELS[snapshot.request.profile]} · {RECOMMENDATION_PRIORITY_LABELS[snapshot.request.priority ?? "balanced"]} · 목표 {formatWon(snapshot.request.budgetWon)} · RAM {snapshot.request.memoryCapacityGb ?? "기본"}GB · SSD {snapshot.request.storageCapacityGb ?? "기본"}GB</span>{snapshot.request.profile === "gaming" && snapshot.request.gamingResolution && snapshot.request.gamingRefreshRate && <span>{GAMING_RESOLUTION_LABELS[snapshot.request.gamingResolution]} · {GAMING_REFRESH_RATE_LABELS[snapshot.request.gamingRefreshRate]}</span>}<a className="text-button" href={`/recommend?${generatorVariantsConditionsSearchFor(snapshot.request)}`} data-testid="shared-generator-variants-conditions"><FiZap /> 같은 조건으로 새 비교 시작</a><button className="text-button" type="button" data-testid="shared-generator-variants-refresh" onClick={() => void refreshCurrentCatalog()} disabled={refreshState.status === "loading"}><FiRefreshCw /> 현재 기준으로 다시 비교</button></div>}
        <div className="shared-generator-variants-summary" data-testid="shared-generator-variants-summary"><article><span>구성</span><strong>{summary.configurationCount}종</strong><small>{snapshot.payload.items.length}개 기준 비교</small></article><article><span>예상 합계</span><strong>{summary.priceText}</strong><small>공유 당시 금액</small></article><article><span>카탈로그 분석</span><strong>{summary.analysisText}</strong><small>실제 FPS가 아닌 참고 지수</small></article><article><span>부품 변경</span><strong>{summary.changedCategories.length === 0 ? "없음" : `${summary.changedCategories.length}개 항목`}</strong><small>{summary.changedCategories.length === 0 ? "모든 안의 부품 동일" : summary.changedCategories.map((category) => CATEGORY_LABELS[category]).join(" · ")}</small></article></div>
        <div className="shared-generator-variants-table-wrap"><table><caption>공유 당시 우선순위별 자동 구성 비교</caption><thead><tr><th scope="col">비교 항목</th>{snapshot.payload.items.map((item) => <th scope="col" key={item.priority}>{item.label}</th>)}</tr></thead><tbody><tr><th scope="row">상태</th>{snapshot.payload.items.map((item) => <td key={`${item.priority}-status`}>{item.status}</td>)}</tr><tr><th scope="row">예상 합계</th>{snapshot.payload.items.map((item) => <td key={`${item.priority}-price`}>{formatWon(item.totalPriceWon)}</td>)}</tr><tr><th scope="row">카탈로그 분석</th>{snapshot.payload.items.map((item) => <td key={`${item.priority}-score`}>{item.analysisScore === undefined ? "계산 불가" : `${item.analysisScore}점`}</td>)}</tr>{PART_CATEGORIES.map((category) => <tr key={category}><th scope="row">{CATEGORY_LABELS[category]}</th>{snapshot.payload.items.map((item) => <td key={`${item.priority}-${category}`}>{lineText(item, category)}</td>)}</tr>)}</tbody></table></div>
        <div className="shared-generator-variant-cards">{snapshot.payload.items.map((item) => <article key={item.priority}><div><strong>{item.label}</strong><span>{item.status}</span></div>{item.error && <p>{item.error}</p>}{item.draft?.warnings?.length ? <p><FiInfo /> {item.draft.warnings[0]}</p> : null}<small>이 화면은 공유 snapshot을 표시하는 읽기 전용 화면입니다. 현재 견적에 부품을 자동 적용하거나 재검사하지 않습니다.</small></article>)}</div>
        {refreshState.status === "loading" && <div className="shared-generator-variants-refresh-state" role="status"><FiLoader className="spin" /> 현재 catalog 기준으로 다시 생성하는 중...</div>}
        {refreshState.status === "error" && <div className="shared-generator-variants-refresh-error" role="alert"><FiAlertTriangle /> {refreshState.error}</div>}
        {refreshState.status === "ready" && refreshState.items && currentSummary && <section className="shared-generator-variants-current" data-testid="shared-generator-variants-current"><div className="shared-generator-variants-current-heading"><div><p className="eyebrow">CURRENT CATALOG RECHECK</p><h2>현재 기준 다시 비교</h2><small>공유 snapshot은 유지하고, 저장된 생성 조건으로 현재 catalog에 다시 요청한 결과입니다.</small></div><span>{currentSummary.configurationCount}종 구성</span></div><div className="shared-generator-variants-current-summary"><article><span>현재 예상 합계</span><strong>{currentSummary.priceText}</strong><small>현재 catalog 기준</small></article><article><span>현재 분석</span><strong>{currentSummary.analysisText}</strong><small>참고 지수</small></article><article><span>현재 부품 변경</span><strong>{currentSummary.changedCategories.length === 0 ? "없음" : `${currentSummary.changedCategories.length}개 항목`}</strong><small>{currentSummary.changedCategories.length === 0 ? "현재 3안의 부품 동일" : currentSummary.changedCategories.map((category) => CATEGORY_LABELS[category]).join(" · ")}</small></article></div><div className="shared-generator-variants-current-grid">{refreshState.items.map((item) => { const original = snapshot.payload.items.find((candidate) => candidate.priority === item.priority); const priceDelta = item.totalPriceWon !== undefined && original?.totalPriceWon !== undefined ? item.totalPriceWon - original.totalPriceWon : undefined; const scoreDelta = item.analysisScore !== undefined && original?.analysisScore !== undefined ? item.analysisScore - original.analysisScore : undefined; return <article key={item.priority}><div><strong>{item.label}</strong><span>{item.status}</span></div><p>현재 합계 {formatWon(item.totalPriceWon)}</p><small>공유 당시 대비 가격 {priceDelta === undefined ? "비교 불가" : `${priceDelta > 0 ? "+" : ""}${formatWon(priceDelta)}`}</small><small>공유 당시 대비 분석 {scoreDelta === undefined ? "비교 불가" : `${scoreDelta > 0 ? "+" : ""}${scoreDelta}점`}</small></article>; })}</div><p className="shared-generator-variants-current-note"><FiInfo /> 현재 결과도 읽기 전용입니다. 원하는 구성은 자동 구성 화면에서 새로 생성한 뒤 편집기·검사로 이어가세요.</p></section>}
        <p className="shared-generator-variants-note"><FiInfo /> 공유 시점의 결과만 보존합니다. 구매 전에는 현재 카탈로그 기준으로 새 자동 구성과 호환성 검사를 다시 실행하세요.</p>
        {refreshState.status === "ready" && refreshState.items && snapshot.request && <div className="shared-generator-variants-current-actions" data-testid="shared-generator-variants-current-actions"><strong>현재 결과 이어가기</strong><small>공유 snapshot은 유지하고, 선택한 priority 조건으로 새 generator 흐름을 시작합니다.</small><div>{refreshState.items.map((item) => <a className="button button-secondary" key={item.priority} href={`/recommend?${generatorVariantsConditionsSearchFor({ ...snapshot.request!, priority: item.priority })}`} data-testid={`shared-generator-variants-current-start-${item.priority}`}><FiZap /> {item.label} 새 견적 시작</a>)}</div></div>}
        {refreshState.status === "ready" && refreshState.items && <div className="shared-generator-variants-current-draft-actions" data-testid="shared-generator-variants-current-draft-actions"><strong>현재 결과 바로 이어가기</strong><small>선택한 현재 draft를 기존 공유 snapshot과 분리해 편집기·검사·저장으로 넘깁니다.</small><div>{refreshState.items.filter((item) => item.draft).map((item) => <span key={item.priority}><button className="button button-secondary" type="button" data-testid={`shared-generator-variants-current-edit-${item.priority}`} onClick={() => transferCurrentDraft(item, "edit")}>{item.label} 편집기로 가져가기</button><button className="button button-primary" type="button" data-testid={`shared-generator-variants-current-check-${item.priority}`} onClick={() => transferCurrentDraft(item, "check")}>{item.label} 바로 검사</button><button className="button button-light" type="button" data-testid={`shared-generator-variants-current-save-${item.priority}`} onClick={() => transferCurrentDraft(item, "save")}>{item.label} 새 견적으로 저장</button></span>)}</div></div>}
      </>}
    </div>
  </main>;
}
