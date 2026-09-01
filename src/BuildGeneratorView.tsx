import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { IconType } from "react-icons";
import { FiActivity, FiAlertTriangle, FiArrowLeft, FiBox, FiCheck, FiCopy, FiCpu, FiDatabase, FiDownload, FiEdit3, FiHardDrive, FiInfo, FiLayers, FiLoader, FiMonitor, FiSave, FiShare2, FiTool, FiXCircle, FiZap } from "react-icons/fi";
import type { BuildAnalysis, BuildGenerationDiagnostic, BuildGenerationRecoveryOption, BuildGenerationRequest, BuildGenerationResult, GamingRefreshRate, GamingResolution, PartCategory, RecommendationPriority, RecommendationProfile, ListingPolicy } from "../shared/types";
import { budgetLadderBaseRequestFor, budgetLadderChangeFor, budgetLadderCsvFor, budgetLadderExportPayloadFor, budgetLadderJsonFor, budgetLadderTextFor } from "../shared/budget-ladder";
import type { BudgetLadderOutcome } from "../shared/budget-ladder";
import type { BudgetLadderShareSnapshot } from "../shared/budget-ladder-share";
import type { BudgetLadderLocalShareEntry } from "../shared/budget-ladder-local-history";
import { CATEGORY_LABELS, GAMING_REFRESH_RATE_LABELS, GAMING_RESOLUTION_LABELS, isKnownPrice, LISTING_POLICY_LABELS, PART_CATEGORIES, RECOMMENDATION_PRIORITY_LABELS, RECOMMENDATION_PROFILE_LABELS } from "../shared/types";
import { savedBuildComparisonDecisionFor } from "../shared/saved-build-comparison";
import type { SavedBuildComparisonDecisionKind, SavedBuildComparisonEntry } from "../shared/saved-build-comparison";
import { api } from "./api";

export type GeneratorVariantResult = {
  priority: RecommendationPriority;
  draft?: BuildGenerationResult;
  error?: string;
  diagnostics?: BuildGenerationDiagnostic[];
};

export type GeneratorBudgetResult = BudgetLadderOutcome;

export type GeneratorBudgetShareResult = {
  id: string;
  url: string;
  ownerToken: string;
  expiresAt?: string;
  catalogSnapshotAt?: string;
};

type GeneratorBudgetShareResponse = BudgetLadderShareSnapshot & {
  ownerToken: string;
};

const CATEGORY_ICONS: Record<PartCategory, IconType> = {
  cpu: FiCpu,
  cooler: FiTool,
  motherboard: FiCpu,
  memory: FiDatabase,
  gpu: FiMonitor,
  ssd: FiHardDrive,
  hdd: FiHardDrive,
  case: FiBox,
  psu: FiZap
};

function formatWon(value: number | undefined) {
  return !isKnownPrice(value) ? "가격 확인 중" : `${value.toLocaleString("ko-KR")}원`;
}

function CategoryIcon({ category }: { category: PartCategory }) {
  const Icon = CATEGORY_ICONS[category];
  return <Icon />;
}

export function BuildGeneratorView({ initialProfile, draft, variants, budgetLadder, requestError, diagnostics = [], recoveryOptions = [], loading, onGenerate, onGenerateVariants, onGenerateBudgetLadder, onApply, onSave, onToast, onBudgetLadderShareSaved, onBudgetLadderShareRevoked, onBack }: { initialProfile: RecommendationProfile; draft: BuildGenerationResult | null; variants: GeneratorVariantResult[]; budgetLadder: GeneratorBudgetResult[]; requestError?: string | null; diagnostics?: BuildGenerationDiagnostic[]; recoveryOptions?: BuildGenerationRecoveryOption[]; loading: boolean; onGenerate: (request: BuildGenerationRequest) => Promise<void>; onGenerateVariants: (request: BuildGenerationRequest) => Promise<void>; onGenerateBudgetLadder: (request: BuildGenerationRequest) => Promise<void>; onApply: (draft: BuildGenerationResult, checkNow: boolean) => Promise<void>; onSave?: (draft: BuildGenerationResult) => void; onToast: (message: string) => void; onBudgetLadderShareSaved: (share: BudgetLadderLocalShareEntry) => void; onBudgetLadderShareRevoked: (id: string) => void; onBack: () => void }) {
  const [profile, setProfile] = useState<RecommendationProfile>(initialProfile);
  const [priority, setPriority] = useState<RecommendationPriority>("balanced");
  const [gamingResolution, setGamingResolution] = useState<GamingResolution>("1440p");
  const [gamingRefreshRate, setGamingRefreshRate] = useState<GamingRefreshRate>(144);
  const [memoryCapacityGb, setMemoryCapacityGb] = useState("32");
  const [budget, setBudget] = useState("1500000");
  const [includeGpu, setIncludeGpu] = useState(true);
  const [storageCapacityGb, setStorageCapacityGb] = useState("1000");
  const [hddCount, setHddCount] = useState("0");
  const [hddCapacityGb, setHddCapacityGb] = useState("4000");
  const [listingPolicy, setListingPolicy] = useState<ListingPolicy>("retail_only");
  const [error, setError] = useState<string | null>(null);
  const [budgetLadderShare, setBudgetLadderShare] = useState<GeneratorBudgetShareResult | null>(null);

  useEffect(() => { setProfile(initialProfile); }, [initialProfile]);
  useEffect(() => { if (budgetLadder.length === 0) setBudgetLadderShare(null); }, [budgetLadder.length]);

  function requestFromForm(): BuildGenerationRequest | undefined {
    const budgetWon = Number(budget);
    const requestedMemoryCapacityGb = Number(memoryCapacityGb);
    const requestedStorageCapacityGb = Number(storageCapacityGb);
    const requestedHddCount = Number(hddCount);
    const requestedHddCapacityGb = Number(hddCapacityGb);
    if (!Number.isInteger(budgetWon) || budgetWon <= 0) {
      setError("목표 예산은 1원 이상의 정수로 입력해 주세요.");
      return undefined;
    }
    if (![16, 32, 64, 128].includes(requestedMemoryCapacityGb)) {
      setError("RAM 목표 용량은 16GB, 32GB, 64GB, 128GB 중 하나를 선택해 주세요.");
      return undefined;
    }
    if (!Number.isInteger(requestedStorageCapacityGb) || requestedStorageCapacityGb <= 0 || !Number.isInteger(requestedHddCount) || requestedHddCount < 0 || requestedHddCount > 8 || !Number.isInteger(requestedHddCapacityGb) || requestedHddCapacityGb <= 0) {
      setError("저장장치 용량과 HDD 개수를 확인해 주세요.");
      return undefined;
    }
    setError(null);
    return { profile, priority, budgetWon, includeGpu, gamingResolution, gamingRefreshRate, memoryCapacityGb: requestedMemoryCapacityGb, storageCapacityGb: requestedStorageCapacityGb, hddCapacityGb: requestedHddCapacityGb, hddCount: requestedHddCount, listingPolicy };
  }

  async function generateFromForm() {
    const request = requestFromForm();
    if (request) await onGenerate(request);
  }

  async function generateVariantsFromForm() {
    const request = requestFromForm();
    if (request) await onGenerateVariants(request);
  }

  async function generateBudgetLadderFromForm() {
    const request = requestFromForm();
    if (request) await onGenerateBudgetLadder(request);
  }

  async function copyBudgetLadder() {
    try {
      await navigator.clipboard.writeText(budgetLadderTextFor(budgetLadder));
      onToast("예산 구간 비교표를 클립보드에 복사했습니다.");
    } catch {
      onToast("예산 구간 비교표 복사에 실패했습니다. 브라우저 클립보드 권한을 확인해 주세요.");
    }
  }

  function downloadBudgetLadder(format: "csv" | "json") {
    const content = format === "csv" ? budgetLadderCsvFor(budgetLadder) : budgetLadderJsonFor(budgetLadder);
    const blob = new Blob([content], { type: format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pc-supporter-budget-ladder-${new Date().toISOString().slice(0, 10)}.${format}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
    onToast(`예산 구간 비교표 ${format.toUpperCase()}를 저장했습니다.`);
  }

  async function shareBudgetLadder() {
    if (budgetLadder.length === 0) {
      onToast("공유할 예산 구간 비교 결과가 없습니다.");
      return;
    }
    try {
      const request = budgetLadderBaseRequestFor(budgetLadder);
      const saved = await api<GeneratorBudgetShareResponse>("/api/budget-ladders", {
        method: "POST",
        body: JSON.stringify({
          name: "PC Supporter 예산 구간 비교",
          payload: budgetLadderExportPayloadFor(budgetLadder),
          ...(request ? { request } : {}),
          expiresInDays: 30
        }),
        retry: 0
      });
      const url = `${window.location.origin}/budget-ladder/${saved.id}`;
      try {
        await navigator.clipboard.writeText(url);
        onToast("예산 구간 비교 공유 링크를 클립보드에 복사했습니다.");
      } catch {
        onToast(`예산 구간 비교 링크가 생성되었습니다: ${url}`);
      }
      setBudgetLadderShare({ id: saved.id, url, ownerToken: saved.ownerToken, ...(saved.expiresAt ? { expiresAt: saved.expiresAt } : {}), catalogSnapshotAt: saved.catalogSnapshotAt });
      onBudgetLadderShareSaved({ id: saved.id, url, name: saved.name, createdAt: saved.createdAt, ...(saved.versionNumber !== undefined ? { versionNumber: saved.versionNumber } : {}), ...(saved.expiresAt ? { expiresAt: saved.expiresAt } : {}), ownerToken: saved.ownerToken });
    } catch (error: unknown) {
      onToast(error instanceof Error ? error.message : "예산 구간 비교 공유 링크를 만들지 못했습니다.");
    }
  }

  async function revokeBudgetLadder() {
    if (!budgetLadderShare || !window.confirm("이 예산 구간 비교 공유 링크를 취소할까요? 이미 전달된 링크도 더 이상 열리지 않습니다.")) return;
    try {
      await api(`/api/budget-ladders/${encodeURIComponent(budgetLadderShare.id)}`, { method: "DELETE", headers: { "X-Share-Owner-Token": budgetLadderShare.ownerToken }, retry: 0 });
      setBudgetLadderShare(null);
      onBudgetLadderShareRevoked(budgetLadderShare.id);
      onToast("예산 구간 비교 공유 링크를 취소했습니다.");
    } catch (error: unknown) {
      onToast(error instanceof Error ? error.message : "예산 구간 비교 공유 링크를 취소하지 못했습니다.");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await generateFromForm();
  }

  async function applyRecoveryOption(option: BuildGenerationRecoveryOption) {
    const request = option.request;
    setProfile(request.profile);
    setPriority(request.priority ?? "balanced");
    setGamingResolution(request.gamingResolution ?? "1440p");
    setGamingRefreshRate(request.gamingRefreshRate ?? 144);
    setMemoryCapacityGb(String(request.memoryCapacityGb ?? 32));
    setBudget(String(request.budgetWon));
    setIncludeGpu(request.includeGpu);
    setStorageCapacityGb(String(request.storageCapacityGb ?? 1000));
    setHddCount(String(request.hddCount ?? 0));
    setHddCapacityGb(String(request.hddCapacityGb ?? 4000));
    setListingPolicy(request.listingPolicy ?? (request.includeNonRetail ? "all" : "retail_only"));
    await onGenerate(request);
  }

  const statusLabel = draft?.status === "compatible" ? "호환 가능한 초안" : draft?.status === "needs_review" ? "확인이 필요한 초안" : "검토가 필요한 초안";
  return <div className="generator-page">
    <div className="workspace-heading"><div><button className="back-link" onClick={onBack}><FiArrowLeft /> 홈으로</button><p className="eyebrow">AUTO BUILD DRAFT</p><h1>조건으로 PC 견적 만들기</h1><p>사용 목적과 예산을 입력하면 현재 카탈로그에서 호환 가능한 초안을 구성합니다.</p></div></div>
    <div className="generator-layout">
      <form className="generator-form" onSubmit={submit}>
        <div className="generator-form-heading"><span className="generator-form-icon"><FiZap /></span><div><p className="eyebrow">STARTING POINT</p><h2>원하는 구성 조건</h2></div></div>
        <label><span>사용 목적</span><select value={profile} disabled={loading} onChange={(event) => setProfile(event.target.value as RecommendationProfile)}><option value="general">{RECOMMENDATION_PROFILE_LABELS.general}</option><option value="gaming">{RECOMMENDATION_PROFILE_LABELS.gaming}</option><option value="creator">{RECOMMENDATION_PROFILE_LABELS.creator}</option><option value="development">{RECOMMENDATION_PROFILE_LABELS.development}</option><option value="office">{RECOMMENDATION_PROFILE_LABELS.office}</option></select></label>
        <label><span>구성 우선순위</span><select value={priority} disabled={loading} onChange={(event) => setPriority(event.target.value as RecommendationPriority)}><option value="balanced">{RECOMMENDATION_PRIORITY_LABELS.balanced}</option><option value="budget">{RECOMMENDATION_PRIORITY_LABELS.budget}</option><option value="performance">{RECOMMENDATION_PRIORITY_LABELS.performance}</option></select></label>
        {profile === "gaming" && <label><span>게임 해상도 <em>게이밍 추천 기준</em></span><select value={gamingResolution} disabled={loading} onChange={(event) => setGamingResolution(event.target.value as GamingResolution)}><option value="1080p">{GAMING_RESOLUTION_LABELS["1080p"]}</option><option value="1440p">{GAMING_RESOLUTION_LABELS["1440p"]}</option><option value="4k">{GAMING_RESOLUTION_LABELS["4k"]}</option></select></label>}
        {profile === "gaming" && <label><span>목표 주사율 <em>성능 우선 가중치</em></span><select value={gamingRefreshRate} disabled={loading} onChange={(event) => setGamingRefreshRate(Number(event.target.value) as GamingRefreshRate)}><option value="60">{GAMING_REFRESH_RATE_LABELS[60]}</option><option value="144">{GAMING_REFRESH_RATE_LABELS[144]}</option><option value="240">{GAMING_REFRESH_RATE_LABELS[240]}</option></select></label>}
        <label><span>RAM 목표 용량</span><select value={memoryCapacityGb} disabled={loading} onChange={(event) => setMemoryCapacityGb(event.target.value)}><option value="16">16GB 이상</option><option value="32">32GB 이상</option><option value="64">64GB 이상</option><option value="128">128GB 이상</option></select></label>
        <label><span>목표 예산</span><div className="generator-input-with-unit"><input type="number" min="1" step="10000" value={budget} disabled={loading} onChange={(event) => setBudget(event.target.value)} placeholder="예: 1500000" /><em>원</em></div></label>
        <label><span>기본 SSD 용량</span><select value={storageCapacityGb} disabled={loading} onChange={(event) => setStorageCapacityGb(event.target.value)}><option value="500">500GB 이상</option><option value="1000">1TB 이상</option><option value="2000">2TB 이상</option><option value="4000">4TB 이상</option></select></label>
        <div className="generator-storage-grid"><label><span>HDD 개수</span><select value={hddCount} disabled={loading} onChange={(event) => setHddCount(event.target.value)}><option value="0">사용하지 않음</option><option value="1">1개</option><option value="2">2개</option><option value="4">4개</option></select></label><label><span>HDD 용량</span><select value={hddCapacityGb} disabled={loading || hddCount === "0"} onChange={(event) => setHddCapacityGb(event.target.value)}><option value="2000">2TB 이상</option><option value="4000">4TB 이상</option><option value="8000">8TB 이상</option><option value="16000">16TB 이상</option></select></label></div>
        <label className="generator-checkbox"><input type="checkbox" checked={includeGpu} disabled={loading} onChange={(event) => setIncludeGpu(event.target.checked)} /><span><strong>외장 그래픽카드 포함</strong><small>끄면 CPU 내장 그래픽을 사용하는 초안을 찾습니다.</small></span></label>
        <label><span>구매 조건</span><select value={listingPolicy} disabled={loading} onChange={(event) => setListingPolicy(event.target.value as ListingPolicy)}><option value="retail_only">{LISTING_POLICY_LABELS.retail_only}</option><option value="include_bulk">{LISTING_POLICY_LABELS.include_bulk}</option><option value="all">{LISTING_POLICY_LABELS.all}</option></select></label>
        {error && <p className="generator-error"><FiAlertTriangle /> {error}</p>}
        {requestError && <div className="generator-request-error" role="alert"><div><strong><FiXCircle /> 자동 구성 요청을 완료하지 못했습니다.</strong><p>{requestError}</p><small>현재 입력은 유지됩니다. 조건을 조정하거나 잠시 후 다시 시도해 주세요.</small>{recoveryOptions.length > 0 && <div className="generator-recovery-options"><strong>가능한 조건 완화안</strong>{recoveryOptions.map((option) => <button className="generator-recovery-option" type="button" key={option.id} onClick={() => void applyRecoveryOption(option)} disabled={loading}><span><b>{option.label}</b><small>{option.summary}</small></span><em>{option.changedFields.join(" · ")} · 예상 {option.preview.totalPriceWon.toLocaleString("ko-KR")}원</em></button>)}</div>}</div></div>}
        {requestError && diagnostics.length > 0 && <div className="generator-diagnostics"><strong><FiInfo /> 실패한 조건의 실제 근거</strong>{diagnostics.map((diagnostic) => <article key={diagnostic.id}><b>{diagnostic.title}</b><p>{diagnostic.summary}</p><div>{diagnostic.facts.map((fact) => <span key={`${diagnostic.id}-${fact.label}`}><em>{fact.label}</em><strong>{fact.value}</strong></span>)}</div>{diagnostic.recommendation && <small>{diagnostic.recommendation}</small>}</article>)}</div>}
        {requestError && recoveryOptions.length > 0 && <p className="generator-recovery-preview"><FiInfo /> 후보 미리보기: {recoveryOptions.map((option) => `${option.label} · ${recoveryPreviewText(option)}`).join(" / ")}</p>}
        <button className="button button-primary full-width generator-submit" type="button" onClick={() => void generateFromForm()} disabled={loading}>{loading ? <><FiLoader className="spin" /> 호환 조합을 찾는 중...</> : <><FiZap /> 자동 견적 생성</>}</button>
        <button className="button button-secondary full-width generator-variants-submit" type="button" onClick={() => void generateVariantsFromForm()} disabled={loading}>{loading ? <><FiLoader className="spin" /> 3가지 안을 계산하는 중...</> : <><FiLayers /> 균형형·가성비·성능 3안 비교</>}</button>
        <button className="button button-light full-width generator-budget-submit" type="button" onClick={() => void generateBudgetLadderFromForm()} disabled={loading}>{loading ? <><FiLoader className="spin" /> 예산 구간을 계산하는 중...</> : <><FiActivity /> 예산 구간 3안 비교</>}</button>
        <p className="generator-note"><FiInfo /> 해상도는 권장 VRAM 기준에, 주사율은 CPU·GPU 성능 비교 가중치에 반영합니다. 실제 FPS가 아니라 현재 카탈로그의 가격·스펙·호환 규칙으로 만든 초안입니다.</p>
      </form>
      {budgetLadder.length > 0 ? <GeneratorBudgetLadderPanel scenarios={budgetLadder} loading={loading} onApply={onApply} onSave={onSave} onCopy={copyBudgetLadder} onDownload={downloadBudgetLadder} share={budgetLadderShare} onShare={() => void shareBudgetLadder()} onRevoke={() => void revokeBudgetLadder()} /> : variants.length > 0 ? <GeneratorVariantsPanel variants={variants} loading={loading} onApply={onApply} onSave={onSave} /> : draft ? <section className="generator-result"><div className="generator-result-top"><div><p className="eyebrow">GENERATED DRAFT</p><h2>{statusLabel}</h2><p>{RECOMMENDATION_PROFILE_LABELS[draft.profile]} · {RECOMMENDATION_PRIORITY_LABELS[draft.priority]}{draft.profile === "gaming" ? ` · ${GAMING_RESOLUTION_LABELS[draft.gamingResolution]} · ${GAMING_REFRESH_RATE_LABELS[draft.gamingRefreshRate ?? 144]}` : ""} · RAM {draft.memoryCapacityGb}GB 이상 · {LISTING_POLICY_LABELS[draft.listingPolicy]} · 목표 {formatWon(draft.budgetWon)}</p></div><span className={`generator-status ${draft.withinBudget ? "within" : "over"}`}>{draft.withinBudget ? "예산 내" : "예산 초과"}</span></div><div className="generator-total"><span>예상 부품 합계</span><strong>{formatWon(draft.totalPriceWon)}</strong><small>{draft.withinBudget ? `${Math.abs(draft.budgetDeltaWon).toLocaleString("ko-KR")}원 여유` : `${draft.budgetDeltaWon.toLocaleString("ko-KR")}원 초과`}</small></div>{draft.gpuTarget && <div className={`generator-gpu-target ${draft.gpuTarget.currentFit}`}><span>GPU 목표</span><strong>{draft.gpuTarget.summary}</strong></div>}{draft.analysis && <GeneratedAnalysisSummary analysis={draft.analysis} />}<div className="generator-lines">{draft.lines.map((line) => <div className="generator-line" key={line.category}><span><CategoryIcon category={line.category} /> {CATEGORY_LABELS[line.category]}</span><div><strong>{line.name}</strong><small>{line.specSummary ? `${line.specSummary} · ` : ""}{line.quantity > 1 ? `수량 ${line.quantity}개 · ` : ""}{formatWon(line.priceWon * line.quantity)}</small></div></div>)}</div><div className="generator-rationale"><strong>구성 기준</strong>{draft.rationale.map((item) => <p key={item}><FiCheck /> {item}</p>)}</div>{draft.warnings.length > 0 && <div className="generator-warnings"><strong><FiAlertTriangle /> 확인할 항목</strong>{draft.warnings.map((item) => <p key={item}>{item}</p>)}</div>}<div className="generator-actions"><button className="button button-secondary" onClick={() => void onApply(draft, false)} disabled={loading}><FiEdit3 /> 편집기로 가져가기</button><button className="button button-primary" onClick={() => void onApply(draft, true)} disabled={loading}><FiActivity /> 가져와서 바로 검사</button>{onSave && <button className="button button-light generator-save-button" onClick={() => onSave(draft)} disabled={loading}><FiSave /> 새 견적으로 저장</button>}</div></section> : <section className="generator-empty"><FiCpu /><h2>나만의 초안을 빠르게 시작하세요</h2><p>조건을 입력하면 부품을 하나씩 고르기 전에 호환 가능한 기본 구성을 찾아드립니다.</p></section>}
    </div>
  </div>;
}

function generatedVariantStatusLabel(status: BuildGenerationResult["status"]) {
  return status === "compatible" ? "호환 가능" : status === "needs_review" ? "확인 필요" : "검토 필요";
}

function generatedVariantBudgetText(draft: BuildGenerationResult) {
  if (!draft.priceComplete) return "가격 일부 확인 필요";
  return draft.withinBudget ? `${Math.abs(draft.budgetDeltaWon).toLocaleString("ko-KR")}원 여유` : `${draft.budgetDeltaWon.toLocaleString("ko-KR")}원 초과`;
}

function generatedAnalysisConfidenceLabel(confidence: BuildAnalysis["confidence"]) {
  return confidence === "high" ? "근거 충분" : confidence === "limited" ? "일부 스펙 기준" : "계산 불가";
}

function generatedAnalysisTone(analysis: BuildAnalysis) {
  if (analysis.overallScore === undefined) return "unknown";
  return analysis.overallScore >= 80 ? "high" : analysis.overallScore >= 60 ? "medium" : "low";
}

function generatedAnalysisBalanceLabel(balance: NonNullable<BuildAnalysis["balance"]>) {
  return balance.status === "balanced" ? "균형형" : balance.status === "cpu_limited" ? "CPU 보완" : "GPU 보완";
}

function generatedVariantAnalysisText(draft: BuildGenerationResult) {
  if (!draft.analysis || draft.analysis.overallScore === undefined) return "계산 불가";
  return `${draft.analysis.overallScore}점 · ${draft.analysis.scoreLabel}`;
}

function generatedVariantSpecText(draft: BuildGenerationResult) {
  return draft.lines.map((line) => `${CATEGORY_LABELS[line.category]} · ${line.specSummary || "핵심 규격 확인 필요"}`).join(" / ");
}

function recoveryPreviewText(option: BuildGenerationRecoveryOption) {
  const preview = option.preview;
  const budgetText = !preview.priceComplete
    ? "가격 확인 필요"
    : preview.withinBudget
      ? "예산 내"
      : `${Math.abs(preview.budgetDeltaWon).toLocaleString("ko-KR")}원 초과`;
  const reviewText = preview.unknownCount > 0 ? `확인 필요 ${preview.unknownCount}개` : "추가 확인 없음";
  return `${generatedVariantStatusLabel(preview.status)} · ${budgetText} · ${reviewText}`;
}

const generatedDecisionDefinitions: Array<{ kind: SavedBuildComparisonDecisionKind; label: string; description: string }> = [
  { kind: "compatibility", label: "호환 우선", description: "차단·주의·확인 필요를 합산한 위험 점수가 가장 낮은 자동 구성" },
  { kind: "price", label: "가격 우선", description: "가격이 확인된 자동 구성 중 가장 낮은 총액" },
  { kind: "analysis", label: "분석 점수 우선", description: "사용 목적 기준 상대 분석 점수가 가장 높은 자동 구성" }
];

function generatedDecisionStatusText(status: BuildGenerationResult["status"]) {
  return status === "compatible" ? "호환 가능" : status === "needs_review" ? "확인 필요" : "검토 필요";
}

function GeneratorDecisionSummary({ variants, loading }: { variants: GeneratorVariantResult[]; loading: boolean }) {
  const entries: SavedBuildComparisonEntry[] = variants.flatMap((variant) => variant.draft ? [{ id: variant.priority, name: RECOMMENDATION_PRIORITY_LABELS[variant.priority], result: variant.draft }] : []);
  const partial = entries.length < variants.length;
  const pendingText = loading ? "세 가지 자동 구성 결과를 기다리는 중입니다." : entries.length === 0 ? "생성된 자동 구성 결과가 없습니다." : "생성에 성공한 안 중 우선 후보를 계산합니다.";
  return <section className="generator-decision-summary" aria-label="자동 구성 결정 요약">
    <div className="generator-decision-heading"><div><p className="eyebrow">DECISION SUMMARY</p><h3>자동 구성 빠른 선택</h3><p>같은 조건에서 우선순위만 달리한 세 안을 안전성·가격·분석 기준으로 나눠 해석합니다.</p></div><span>{entries.length} / {variants.length}개 생성 완료</span></div>
    <div className="generator-decision-grid">
      {generatedDecisionDefinitions.map((definition) => {
        const decision = savedBuildComparisonDecisionFor(entries, definition.kind);
        const selectedVariant = decision ? variants.find((variant) => variant.priority === decision.entry.id) : undefined;
        const metricText = decision
          ? definition.kind === "compatibility"
            ? `위험 ${decision.metric}점 · ${generatedDecisionStatusText(decision.entry.result.status)} · 차단 ${decision.entry.result.blockerCount}개`
            : definition.kind === "price"
              ? `총액 ${formatWon(decision.metric)} · ${selectedVariant?.draft ? generatedVariantBudgetText(selectedVariant.draft) : "예산 확인 필요"}`
              : `상대 분석 ${decision.metric}점 · ${generatedDecisionStatusText(decision.entry.result.status)}`
          : pendingText;
        return <article className={decision ? "generator-decision-card selected" : "generator-decision-card pending"} key={definition.kind}><span>{definition.label}</span>{decision ? <><strong>{decision.entry.name}</strong><small>{metricText}</small><em>{partial ? "생성에 성공한 안 중 우선" : definition.description}</em></> : <><strong>계산 대기</strong><small>{metricText}</small><em>{definition.description}</em></>}</article>;
      })}
    </div>
    <p className="generator-decision-note"><FiInfo /> 자동 구성의 결정 요약은 현재 카탈로그의 호환성·가격·상대 분석 기준입니다. 실제 BIOS·QVL·온도·소음·게임 FPS를 확정하는 순위가 아닙니다.</p>
  </section>;
}

function GeneratedAnalysisSummary({ analysis, compact = false }: { analysis: BuildAnalysis; compact?: boolean }) {
  const insights = [...analysis.focusAreas.slice(0, compact ? 1 : 2), ...analysis.strengths.slice(0, compact ? 1 : 2)];
  const nextActions = analysis.nextActions.slice(0, compact ? 1 : 3);
  return <div className={`generator-analysis ${compact ? "compact" : ""}`}>
    <div className="generator-analysis-top"><div><p className="eyebrow">CATALOG ANALYSIS</p><strong>구성 성능·확장성 요약</strong></div><span className={`generator-analysis-score ${generatedAnalysisTone(analysis)}`}><b>{analysis.overallScore ?? "-"}</b><small>{analysis.scoreLabel}</small></span></div>
    <div className="generator-analysis-stats"><div><span>분석 근거</span><strong>{generatedAnalysisConfidenceLabel(analysis.confidence)}</strong></div>{analysis.balance && <div><span>CPU · GPU 밸런스</span><strong>{generatedAnalysisBalanceLabel(analysis.balance)}</strong></div>}<div><span>우선 확인</span><strong>{analysis.bottlenecks.length > 0 ? `${analysis.bottlenecks.length}개 신호` : "큰 신호 없음"}</strong></div></div>
    {insights.length > 0 && <div className="generator-analysis-insights">{insights.map((insight) => <div key={`${insight.category}-${insight.title}`}><span>{insight.title}</span><strong>{insight.score}점</strong>{!compact && <small>{insight.summary}</small>}</div>)}</div>}
    {!compact && <div className="generator-analysis-actions"><span>추천 확인 순서</span>{nextActions.map((action, index) => <p key={action}><b>{index + 1}</b>{action}</p>)}</div>}
    {!compact && <p className="generator-analysis-note"><FiInfo /> 실제 FPS·렌더링 벤치마크가 아닌, 현재 카탈로그의 확인된 스펙을 같은 범주 안에서 비교한 참고 지수입니다.</p>}
  </div>;
}

function generatedVariantLineText(draft: BuildGenerationResult, category: PartCategory) {
  const line = draft.lines.find((item) => item.category === category);
  return line ? `${line.name}${line.quantity > 1 ? ` ×${line.quantity}` : ""}` : "미포함";
}

function generatedVariantSignature(draft: BuildGenerationResult) {
  return draft.lines.map((line) => `${line.category}:${line.partId}:${line.quantity}`).join("|");
}

function GeneratorVariantsPanel({ variants, loading, onApply, onSave }: { variants: GeneratorVariantResult[]; loading: boolean; onApply: (draft: BuildGenerationResult, checkNow: boolean) => Promise<void>; onSave?: (draft: BuildGenerationResult) => void }) {
  const readyVariants = variants.filter((variant): variant is GeneratorVariantResult & { draft: BuildGenerationResult } => Boolean(variant.draft));
  const uniqueConfigurationCount = new Set(readyVariants.map((variant) => generatedVariantSignature(variant.draft))).size;
  const configurationCounts = new Map<string, number>();
  readyVariants.forEach((variant) => {
    const signature = generatedVariantSignature(variant.draft);
    configurationCounts.set(signature, (configurationCounts.get(signature) ?? 0) + 1);
  });
  const rows: Array<{ label: string; values: string[] }> = [
    { label: "상태", values: variants.map((variant) => variant.draft ? generatedVariantStatusLabel(variant.draft.status) : "생성 실패") },
    { label: "예상 합계", values: variants.map((variant) => variant.draft ? formatWon(variant.draft.totalPriceWon) : "-") },
    { label: "예산", values: variants.map((variant) => variant.draft ? generatedVariantBudgetText(variant.draft) : "-") },
    { label: "게이밍 목표", values: variants.map((variant) => variant.draft ? variant.draft.profile === "gaming" ? `${GAMING_RESOLUTION_LABELS[variant.draft.gamingResolution]} · ${GAMING_REFRESH_RATE_LABELS[variant.draft.gamingRefreshRate ?? 144]}` : "게이밍 기준 아님" : "-") },
    { label: "카탈로그 분석", values: variants.map((variant) => variant.draft ? generatedVariantAnalysisText(variant.draft) : "-") },
    { label: "핵심 규격", values: variants.map((variant) => variant.draft ? generatedVariantSpecText(variant.draft) : "-") },
    { label: "차단 오류", values: variants.map((variant) => variant.draft ? `${variant.draft.blockerCount}개` : "-") },
    { label: "주의", values: variants.map((variant) => variant.draft ? `${variant.draft.warningCount}개` : "-") },
    { label: "확인 필요", values: variants.map((variant) => variant.draft ? `${variant.draft.unknownCount}개` : "-") },
    ...PART_CATEGORIES.map((category) => ({ label: CATEGORY_LABELS[category], values: variants.map((variant) => variant.draft ? generatedVariantLineText(variant.draft, category) : "-") }))
  ];
  return <section className="generator-variants" aria-label="자동 구성 추천안 비교">
    <div className="generator-variants-heading"><div><p className="eyebrow">RECOMMENDATION OPTIONS</p><h2>자동 구성 3안 비교</h2><p>같은 사용 목적·예산·저장 조건으로 우선순위만 바꿔 세 가지 구성을 비교합니다.</p></div><span><FiLayers /> {readyVariants.length} / {variants.length}개 생성 · 구성 {uniqueConfigurationCount}종</span></div>
    {variants.some((variant) => variant.error) && <div className="generator-variant-errors" role="status"><FiAlertTriangle /><div><strong>일부 기준은 구성을 만들지 못했습니다.</strong>{variants.filter((variant) => variant.error).map((variant) => <p key={variant.priority}>{RECOMMENDATION_PRIORITY_LABELS[variant.priority]} · {variant.error}</p>)}</div></div>}
    {variants.some((variant) => variant.diagnostics && variant.diagnostics.length > 0) && <div className="generator-variant-diagnostics"><strong><FiInfo /> 실패한 기준의 실제 근거</strong>{variants.filter((variant) => variant.diagnostics && variant.diagnostics.length > 0).map((variant) => <article key={variant.priority}><b>{RECOMMENDATION_PRIORITY_LABELS[variant.priority]}</b>{variant.diagnostics!.slice(0, 1).map((diagnostic) => <div key={diagnostic.id}><strong>{diagnostic.title}</strong><p>{diagnostic.summary}</p>{diagnostic.facts.slice(0, 4).map((fact) => <span key={`${diagnostic.id}-${fact.label}`}>{fact.label} {fact.value}</span>)}</div>)}</article>)}</div>}
    {readyVariants.length > 0 && <>
      <GeneratorDecisionSummary variants={variants} loading={loading} />
      <div className="generator-variants-table-wrap"><table><caption>우선순위별 자동 구성 비교표</caption><thead><tr><th scope="col">비교 항목</th>{variants.map((variant) => <th scope="col" key={variant.priority}>{RECOMMENDATION_PRIORITY_LABELS[variant.priority]}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.label}><th scope="row">{row.label}</th>{row.values.map((value, index) => <td key={`${row.label}-${variants[index].priority}`}>{value}</td>)}</tr>)}</tbody></table></div>
      <div className="generator-variant-cards">{variants.map((variant) => variant.draft ? <article className={`generator-variant-card ${variant.draft.status}`} key={variant.priority}><div className="generator-variant-card-top"><span>{RECOMMENDATION_PRIORITY_LABELS[variant.priority]}{(configurationCounts.get(generatedVariantSignature(variant.draft)) ?? 0) > 1 && <small>동일 구성</small>}</span><strong>{generatedVariantStatusLabel(variant.draft.status)}</strong></div><div className="generator-variant-card-total"><span>예상 합계</span><strong>{formatWon(variant.draft.totalPriceWon)}</strong><small>{generatedVariantBudgetText(variant.draft)}</small></div>{variant.draft.analysis && <GeneratedAnalysisSummary analysis={variant.draft.analysis} compact />}<div className="generator-variant-card-lines">{["cpu", "gpu", "memory", "ssd", "case", "psu"].map((category) => <div key={category}><span>{CATEGORY_LABELS[category as PartCategory]}</span><strong>{generatedVariantLineText(variant.draft!, category as PartCategory)}</strong></div>)}</div>{variant.draft.warnings.length > 0 && <p className="generator-variant-card-warning"><FiAlertTriangle /> {variant.draft.warnings[0]}</p>}<div className="generator-variant-card-actions"><button className="button button-secondary" type="button" onClick={() => void onApply(variant.draft!, false)} disabled={loading}><FiEdit3 /> 편집기로 가져가기</button><button className="button button-primary" type="button" onClick={() => void onApply(variant.draft!, true)} disabled={loading}><FiActivity /> 바로 검사</button>{onSave && <button className="button button-light generator-variant-save-button" type="button" onClick={() => onSave(variant.draft!)} disabled={loading}><FiSave /> 새 견적으로 저장</button>}</div></article> : <article className="generator-variant-card error" key={variant.priority}><div className="generator-variant-card-top"><span>{RECOMMENDATION_PRIORITY_LABELS[variant.priority]}</span><strong>생성 실패</strong></div><p>{variant.error ?? "이 기준의 초안을 만들지 못했습니다."}</p></article>)}</div>
    </>}
    {readyVariants.length === 0 && !loading && <div className="generator-variant-empty"><FiInfo /><strong>비교할 자동 구성 결과가 없습니다.</strong><p>예산·메모리·저장장치 조건을 완화한 뒤 다시 시도해 주세요.</p></div>}
    <p className="generator-variants-note"><FiInfo /> 세 안 모두 같은 규칙 엔진으로 후보를 검증한 결과입니다. 표시된 구성은 카탈로그 기준 초안이며 실제 BIOS·QVL·온도·게임 FPS를 보장하지 않습니다.</p>
  </section>;
}

function GeneratorBudgetLadderPanel({ scenarios, loading, onApply, onSave, onCopy, onDownload, share, onShare, onRevoke }: { scenarios: GeneratorBudgetResult[]; loading: boolean; onApply: (draft: BuildGenerationResult, checkNow: boolean) => Promise<void>; onSave?: (draft: BuildGenerationResult) => void; onCopy: () => Promise<void>; onDownload: (format: "csv" | "json") => void; share: GeneratorBudgetShareResult | null; onShare: () => void; onRevoke: () => void }) {
  const readyScenarios = scenarios.filter((scenario): scenario is GeneratorBudgetResult & { draft: BuildGenerationResult } => Boolean(scenario.draft));
  const budgetDeltaText = (draft: BuildGenerationResult) => draft.withinBudget
    ? `${Math.abs(draft.budgetDeltaWon).toLocaleString("ko-KR")}원 여유`
    : `${draft.budgetDeltaWon.toLocaleString("ko-KR")}원 초과`;
  const budgetChanges = scenarios.slice(1).map((scenario, index) => budgetLadderChangeFor(scenarios[index], scenario)).filter((change): change is NonNullable<typeof change> => Boolean(change));
  const signedWon = (value: number) => value === 0 ? "변화 없음" : `${value > 0 ? "+" : ""}${value.toLocaleString("ko-KR")}원`;
  const signedCount = (value: number) => value > 0 ? `+${value}` : String(value);
  const riskDeltaText = (change: NonNullable<typeof budgetChanges[number]>) => change.blockerDelta === 0 && change.warningDelta === 0 && change.unknownDelta === 0
    ? "위험 카운트 변화 없음"
    : `차단 ${signedCount(change.blockerDelta)} · 주의 ${signedCount(change.warningDelta)} · 확인 필요 ${signedCount(change.unknownDelta)}`;
  const rows: Array<{ label: string; values: string[] }> = [
    { label: "상태", values: scenarios.map((scenario) => scenario.draft ? generatedVariantStatusLabel(scenario.draft.status) : "생성 실패") },
    { label: "목표 예산", values: scenarios.map((scenario) => `${scenario.budgetWon.toLocaleString("ko-KR")}원`) },
    { label: "예상 합계", values: scenarios.map((scenario) => scenario.draft ? formatWon(scenario.draft.totalPriceWon) : "-") },
    { label: "예산 여유", values: scenarios.map((scenario) => scenario.draft ? budgetDeltaText(scenario.draft) : "-") },
    { label: "카탈로그 분석", values: scenarios.map((scenario) => scenario.draft ? generatedVariantAnalysisText(scenario.draft) : "-") },
    { label: "CPU", values: scenarios.map((scenario) => scenario.draft ? generatedVariantLineText(scenario.draft, "cpu") : "-") },
    { label: "GPU", values: scenarios.map((scenario) => scenario.draft ? generatedVariantLineText(scenario.draft, "gpu") : "-") },
    { label: "RAM", values: scenarios.map((scenario) => scenario.draft ? generatedVariantLineText(scenario.draft, "memory") : "-") },
    { label: "파워서플라이", values: scenarios.map((scenario) => scenario.draft ? generatedVariantLineText(scenario.draft, "psu") : "-") }
  ];
  return <section className="generator-budget-ladder" aria-label="예산 구간 자동 구성 비교">
    <div className="generator-budget-ladder-heading"><div><p className="eyebrow">BUDGET LADDER</p><h2>예산 구간 3안 비교</h2><p>같은 사용 목적·성능 기준·저장 조건에서 예산만 바꿔, 추가 지출로 어떤 부품과 여유가 달라지는지 확인합니다.</p></div><div className="generator-budget-ladder-heading-actions"><span><FiActivity /> {readyScenarios.length} / {scenarios.length}개 생성 완료</span><div className="generator-budget-ladder-export-actions"><button className="text-button" type="button" onClick={() => void onCopy()}><FiCopy /> 비교 복사</button><button className="text-button" type="button" onClick={() => onDownload("csv")}><FiDownload /> CSV 저장</button><button className="text-button" type="button" onClick={() => onDownload("json")}><FiDownload /> JSON 저장</button><button className="text-button" type="button" onClick={onShare}><FiShare2 /> {share ? "링크 다시 만들기" : "공유 링크"}</button></div></div></div>
    {share && <div className="generator-budget-share-preview" role="status"><label><span>예산 비교 공유 링크{share.expiresAt ? ` · ${new Date(share.expiresAt).toLocaleString("ko-KR")} 만료` : ""}</span><input aria-label="예산 구간 비교 공유 링크" type="text" value={share.url} readOnly onFocus={(event) => event.currentTarget.select()} /></label><div><a className="text-button" href={share.url}><FiShare2 /> 열기</a><button className="text-button danger-text-button" type="button" onClick={onRevoke}><FiXCircle /> 공유 취소</button></div></div>}
    {scenarios.some((scenario) => scenario.error) && <div className="generator-budget-errors" role="status"><FiAlertTriangle /><div><strong>일부 예산 구간은 구성을 만들지 못했습니다.</strong>{scenarios.filter((scenario) => scenario.error).map((scenario) => <p key={scenario.id}>{scenario.label} · {scenario.error}</p>)}</div></div>}
    {readyScenarios.length > 0 && <>
      <div className="generator-budget-table-wrap"><table><caption>예산별 자동 구성 비교표</caption><thead><tr><th scope="col">비교 항목</th>{scenarios.map((scenario) => <th scope="col" key={scenario.id}>{scenario.label}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.label}><th scope="row">{row.label}</th>{row.values.map((value, index) => <td key={`${row.label}-${scenarios[index].id}`}>{value}</td>)}</tr>)}</tbody></table></div>
      {budgetChanges.length > 0 && <section className="generator-budget-deltas" aria-label="예산 증액 효과"><div className="generator-budget-deltas-heading"><div><strong>예산 증액으로 바뀐 것</strong><span>인접한 두 구간의 차이만 계산합니다.</span></div><small>카탈로그 기준 관찰</small></div><div className="generator-budget-delta-list">{budgetChanges.map((change) => <article className={change.sameConfiguration ? "same" : "changed"} key={`${change.fromId}-${change.toId}`}><div className="generator-budget-delta-top"><strong>{change.fromLabel} → {change.toLabel}</strong><span>예산 {signedWon(change.budgetDeltaWon)}</span></div><div className="generator-budget-delta-stats"><span>실제 합계 <b>{signedWon(change.totalPriceDeltaWon)}</b></span><span>{riskDeltaText(change)}</span>{change.analysisScoreDelta !== undefined && <span>분석 지수 <b>{signedCount(change.analysisScoreDelta)}점</b></span>}</div>{change.sameConfiguration ? <p className="generator-budget-delta-same"><FiCheck /> 두 구간의 부품·수량 구성이 같습니다. 예산이 늘어도 현재 카탈로그에서 다른 선택으로 전환되지 않았습니다.</p> : <div className="generator-budget-delta-lines"><span>변경 부품</span>{change.changedLines.map((line) => <p key={line.category}><b>{line.label}</b> {line.before} → {line.after}</p>)}</div>}</article>)}</div><p className="generator-budget-deltas-note"><FiInfo /> 분석 지수와 위험 변화는 현재 카탈로그·호환 규칙 기준입니다. 증액이 실제 FPS나 체감 성능을 보장하지 않으며, 같은 구성이라도 가격·재고는 다시 확인해야 합니다.</p></section>}
      <GeneratorBudgetScoreChart scenarios={scenarios} />
      <div className="generator-budget-cards">{scenarios.map((scenario) => scenario.draft ? <article className={`generator-budget-card ${scenario.draft.status}`} key={scenario.id}><div className="generator-budget-card-top"><div><span>{scenario.label}</span><strong>{scenario.description}</strong></div><em>{generatedVariantStatusLabel(scenario.draft.status)}</em></div><div className="generator-budget-card-total"><div><span>목표 예산</span><strong>{scenario.budgetWon.toLocaleString("ko-KR")}원</strong></div><div><span>예상 합계</span><strong>{formatWon(scenario.draft.totalPriceWon)}</strong><small>{budgetDeltaText(scenario.draft)}</small></div></div><div className="generator-budget-card-lines">{["cpu", "gpu", "memory", "psu"].map((category) => <div key={category}><span>{CATEGORY_LABELS[category as PartCategory]}</span><strong>{generatedVariantLineText(scenario.draft!, category as PartCategory)}</strong></div>)}</div>{scenario.draft.warnings.length > 0 && <p className="generator-budget-card-warning"><FiAlertTriangle /> {scenario.draft.warnings[0]}</p>}<div className="generator-budget-card-actions"><button className="button button-secondary" type="button" onClick={() => void onApply(scenario.draft!, false)} disabled={loading}><FiEdit3 /> 이 안 편집기로</button><button className="button button-primary" type="button" onClick={() => void onApply(scenario.draft!, true)} disabled={loading}><FiActivity /> 바로 검사</button>{onSave && <button className="button button-light" type="button" onClick={() => onSave(scenario.draft!)} disabled={loading}><FiSave /> 새 견적으로 저장</button>}</div></article> : <article className="generator-budget-card error" key={scenario.id}><div className="generator-budget-card-top"><div><span>{scenario.label}</span><strong>{scenario.description}</strong></div><em>생성 실패</em></div><p>{scenario.error ?? "이 예산 구간의 초안을 만들지 못했습니다."}</p><GeneratorBudgetFailureDetails scenario={scenario} /></article>)}</div>
    </>}
    {readyScenarios.length === 0 && !loading && <div className="generator-budget-empty"><FiInfo /><strong>비교할 예산 구간 결과가 없습니다.</strong><p>예산·메모리·저장장치 조건을 확인한 뒤 다시 시도해 주세요.</p></div>}
    <p className="generator-budget-note"><FiInfo /> 예산 구간 비교는 현재 카탈로그 기준의 독립적인 초안 3개를 보여줍니다. 현재 견적은 자동으로 바뀌지 않으며, 원하는 안을 눌렀을 때만 편집기·검사로 이어집니다.</p>
  </section>;
}

function GeneratorBudgetFailureDetails({ scenario }: { scenario: GeneratorBudgetResult }) {
  if (!scenario.diagnostics || scenario.diagnostics.length === 0) return null;
  return <div className="generator-budget-diagnostics"><strong><FiInfo /> 실패한 조건의 실제 근거</strong>{scenario.diagnostics.slice(0, 2).map((diagnostic) => <article key={diagnostic.id}><b>{diagnostic.title}</b><p>{diagnostic.summary}</p><div>{diagnostic.facts.slice(0, 4).map((fact) => <span key={`${diagnostic.id}-${fact.label}`}><em>{fact.label}</em><strong>{fact.value}</strong></span>)}</div>{diagnostic.recommendation && <small>{diagnostic.recommendation}</small>}</article>)}</div>;
}

function GeneratorBudgetScoreChart({ scenarios }: { scenarios: GeneratorBudgetResult[] }) {
  const scoreEntries = scenarios.flatMap((scenario, scenarioIndex) => {
    const score = scenario.draft?.analysis?.overallScore;
    return score === undefined ? [] : [{ scenario, scenarioIndex, score }];
  });
  if (scoreEntries.length === 0) return null;
  const minBudget = Math.min(...scoreEntries.map((entry) => entry.scenario.budgetWon));
  const maxBudget = Math.max(...scoreEntries.map((entry) => entry.scenario.budgetWon));
  const budgetSpan = maxBudget - minBudget;
  const xFor = (entry: (typeof scoreEntries)[number]) => budgetSpan === 0
    ? 16 + (entry.scenarioIndex / Math.max(1, scenarios.length - 1)) * 68
    : 16 + ((entry.scenario.budgetWon - minBudget) / budgetSpan) * 68;
  const yFor = (score: number) => 39 - (Math.max(0, Math.min(100, score)) / 100) * 31;
  const segments: string[] = [];
  let currentSegment: string[] = [];
  scoreEntries.forEach((entry, index) => {
    const previous = scoreEntries[index - 1];
    if (index > 0 && previous.scenarioIndex !== entry.scenarioIndex - 1) {
      if (currentSegment.length > 1) segments.push(currentSegment.join(" "));
      currentSegment = [];
    }
    currentSegment.push(`${xFor(entry)},${yFor(entry.score)}`);
  });
  if (currentSegment.length > 1) segments.push(currentSegment.join(" "));
  return <section className="generator-budget-score-chart" aria-label="예산별 카탈로그 분석 지수 추이"><div className="generator-budget-score-chart-heading"><div><strong>예산별 카탈로그 분석 지수 추이</strong><span>실제 FPS가 아닌 확인 스펙 기반 지수</span></div><small>0–100점</small></div><div className="generator-budget-score-chart-body"><svg viewBox="0 0 100 44" role="img" aria-label="예산별 카탈로그 분석 지수 선 그래프"><title>예산별 카탈로그 분석 지수</title><path d="M16 8H84 M16 23H84 M16 39H84" fill="none" stroke="currentColor" strokeDasharray="1 2" /><text x="2" y="10">100</text><text x="6" y="25">50</text><text x="9" y="41">0</text>{segments.map((segment, index) => <polyline key={`budget-score-segment-${index}`} points={segment} fill="none" vectorEffect="non-scaling-stroke" />)}{scoreEntries.map((entry) => <circle key={`${entry.scenario.id}-score-point`} cx={xFor(entry)} cy={yFor(entry.score)} r="1.7"><title>{entry.scenario.label} · {entry.score}점</title></circle>)}</svg><div className="generator-budget-score-labels">{scenarios.map((scenario) => { const score = scenario.draft?.analysis?.overallScore; return <span key={scenario.id}><b>{scenario.label}</b>{score === undefined ? "분석 불가" : `${score}점`}<small>{scenario.budgetWon.toLocaleString("ko-KR")}원</small></span>; })}</div></div>{scoreEntries.length < scenarios.length && <p className="generator-budget-score-chart-note"><FiInfo /> 분석 점수가 없는 구간은 점을 연결하거나 점수를 추정하지 않았습니다.</p>}</section>;
}
