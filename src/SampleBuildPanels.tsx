// 견본견적 결과 화면 패널 — 완성된 견적의 금액·게임 성능과 견본 등급 ±1 이동,
// 그리고 항상 펼쳐진 "구매 전 확인할 점".
import { useEffect, useMemo, useState } from "react";
import { FiAlertTriangle, FiArrowDown, FiArrowUp, FiAward, FiChevronDown, FiLoader } from "react-icons/fi";
import "./sample-build.css";
import { api } from "./api";
import type { BuildSelection, CompatibilityResult, Part } from "../shared/types";
import { SAMPLE_GPU_CLASS_LABELS, sampleLadder, type ResolvedSampleBuild, type SampleBuildsPayload } from "../shared/sample-builds";
import { buildGamingIndex, buildTotalWon, formatPerformanceDelta, gamingIndexFor } from "./sample-part-steps";
import { formatManWonRounded } from "./sample-builds-client";

export interface ActiveSampleContext {
  sampleId: string;
  preferX3d: boolean;
  usecase: "office" | "gaming" | "work";
}

function sampleGamingIndex(sample: ResolvedSampleBuild, partsById: ReadonlyMap<string, Part>) {
  const cpuId = sample.lines.find((line) => line.category === "cpu")?.partId;
  const gpuId = sample.lines.find((line) => line.category === "gpu")?.partId;
  return gamingIndexFor({ cpu: cpuId ? partsById.get(cpuId) : undefined, gpu: gpuId ? partsById.get(gpuId) : undefined });
}

function signedManWon(won: number) {
  if (Math.abs(won) < 5_000) return "가격 비슷";
  return `${won > 0 ? "+" : "−"}${formatManWonRounded(Math.abs(won))}`;
}

export function SampleBuildTierPanel({ payload, context, build, partMap, busy, onChangeSample }: { payload: SampleBuildsPayload; context: ActiveSampleContext; build: BuildSelection; partMap: ReadonlyMap<string, Part>; busy: boolean; onChangeSample: (sampleId: string) => void }) {
  const partsById = useMemo(() => new Map(payload.parts.map((part) => [part.id, part])), [payload.parts]);
  const ladder = useMemo(() => {
    const ids = sampleLadder({ preferX3d: context.preferX3d }).map((sample) => sample.id);
    return ids.map((id) => payload.samples.find((sample) => sample.id === id)).filter((sample): sample is ResolvedSampleBuild => Boolean(sample));
  }, [payload.samples, context.preferX3d]);
  const current = payload.samples.find((sample) => sample.id === context.sampleId);
  if (!current) return null;
  const position = ladder.findIndex((sample) => sample.order === current.order);
  const lower = position > 0 ? ladder[position - 1] : undefined;
  const higher = position >= 0 && position < ladder.length - 1 ? ladder[position + 1] : undefined;
  const totalWon = buildTotalWon(build, partMap);
  const currentIndex = buildGamingIndex(build, partMap);
  const gpuId = build.gpu?.partId;
  const gpuName = build.useIntegratedGraphics || !gpuId ? "CPU 내장 그래픽" : partMap.get(gpuId)?.name ?? SAMPLE_GPU_CLASS_LABELS[current.gpuClass];
  const step = (target: ResolvedSampleBuild | undefined, direction: "down" | "up") => {
    if (!target) return <div className={`sample-tier-step ${direction} empty`}><span>{direction === "up" ? "한 등급 위" : "한 등급 아래"}</span><strong>{direction === "up" ? "가장 높은 등급이에요" : "가장 낮은 등급이에요"}</strong></div>;
    const performance = formatPerformanceDelta(currentIndex, sampleGamingIndex(target, partsById));
    return <button type="button" className={`sample-tier-step ${direction}`} data-testid={`sample-tier-${direction}`} disabled={busy} onClick={() => onChangeSample(target.id)}>
      <span>{direction === "up" ? <FiArrowUp aria-hidden="true" /> : <FiArrowDown aria-hidden="true" />} {direction === "up" ? "한 등급 위" : "한 등급 아래"} · {SAMPLE_GPU_CLASS_LABELS[target.gpuClass]}</span>
      <strong>{signedManWon(target.totalPriceWon - totalWon)}</strong>
      {performance && <em>게임 성능 {performance}</em>}
    </button>;
  };
  return <section className="sample-tier-panel" aria-label="완성된 견적" data-testid="sample-tier-panel">
    <div className="sample-tier-heading">
      <span className="sample-tier-kicker"><FiAward aria-hidden="true" /> 추천 견적 {position >= 0 ? `${position + 1}/${ladder.length} 등급` : ""}</span>
      <h2>{current.title}</h2>
      {current.evaluation.map((line) => <p key={line}>{line}</p>)}
    </div>
    <div className="sample-tier-summary">
      <div><span>견적 금액</span><strong>{totalWon.toLocaleString("ko-KR")}<small>원</small></strong></div>
      <div><span>그래픽</span><strong className="sample-tier-gpu">{gpuName}</strong></div>
    </div>
    <div className="sample-tier-steps" role="group" aria-label="견적 등급 바꾸기">
      {step(lower, "down")}
      {step(higher, "up")}
    </div>
  </section>;
}

// 견적 화면 하단의 "구매 전 확인할 점" — 생성된 견적이면 그 경고를, 직접 담은
// 견적(견본견적 포함)이면 현재 구성을 서버에서 검사한 주의 항목을 보여 준다.
// 생성기 경고와 같은 기준: 주의/확인 필요/호환 불가 제목. RAM 속도 확인은 보이지 않고,
// 데이터가 비어 생기는 사소한 "확인 필요"(팬/RGB 헤더, XMP 지원 등)도 생성기처럼 뺀다.
const HIDDEN_PURCHASE_CHECK_RULES = new Set(["memory-speed"]);
const COSMETIC_UNKNOWN_RULES = new Set(["case-fan-headers", "case-rgb-headers", "case-rgb-voltage", "memory-profile", "m2-pcie-lane-sharing"]);

export function purchaseCheckItemsFromResult(result: Pick<CompatibilityResult, "findings">): string[] {
  const titles = result.findings
    .filter((finding) => (finding.severity === "warning" || finding.severity === "unknown" || finding.severity === "blocker") && !HIDDEN_PURCHASE_CHECK_RULES.has(finding.ruleId) && !(finding.severity === "unknown" && COSMETIC_UNKNOWN_RULES.has(finding.ruleId)))
    .map((finding) => finding.title);
  return [...new Set(titles)];
}

function buildCheckKey(build: BuildSelection) {
  return JSON.stringify([build.cpu, build.cooler, build.motherboard, build.memory, build.gpu, build.ssd, build.hdd, build.case, build.psu, build.useIntegratedGraphics]);
}

export function usePurchaseCheckItems(build: BuildSelection, enabled: boolean): { items: string[]; loading: boolean } {
  const [state, setState] = useState<{ key: string; items: string[]; loading: boolean }>({ key: "", items: [], loading: false });
  const key = buildCheckKey(build);
  const ready = enabled && Boolean(build.cpu && build.motherboard && build.memory.length > 0);
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    setState((current) => ({ ...current, loading: true }));
    const timer = window.setTimeout(() => {
      void api<CompatibilityResult>("/api/compatibility/check", { method: "POST", body: JSON.stringify(build), signal: controller.signal, retry: 1, retryOnRateLimit: true })
        .then((result) => setState({ key, items: purchaseCheckItemsFromResult(result), loading: false }))
        .catch(() => { if (!controller.signal.aborted) setState({ key, items: [], loading: false }); });
    }, 600);
    return () => { window.clearTimeout(timer); controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);
  return { items: ready && state.key === key ? state.items : [], loading: ready && (state.loading || state.key !== key) };
}

export function PurchaseCheckPanel({ items, loading = false }: { items: readonly string[]; loading?: boolean }) {
  if (!loading && items.length === 0) return null;
  return <details className="purchase-check-panel" open data-testid="purchase-check-panel">
    <summary><span><FiAlertTriangle className="purchase-check-icon" aria-hidden="true" /> 구매 전 확인할 점 {items.length > 0 ? items.length : ""}</span><FiChevronDown className="purchase-check-chevron" aria-hidden="true" /></summary>
    {loading && items.length === 0
      ? <p className="purchase-check-loading" role="status"><FiLoader className="spin" /> 확인하는 중...</p>
      : <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>}
  </details>;
}
