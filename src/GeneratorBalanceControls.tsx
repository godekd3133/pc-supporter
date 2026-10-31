import { useEffect, useRef, useState } from "react";
import { FiLoader, FiMinus, FiPlus } from "react-icons/fi";
import type { BuildGenerationRequest, BuildGenerationResult, CpuGpuBalanceAssessment, GamingBalanceLevel, PartCategory } from "../shared/types";
import { CATEGORY_LABELS } from "../shared/types";
import { generatorBalanceChangesFor, generatorPartAdjustmentRequestFor } from "./generator-balance";
import "./generator-balance.css";

export function GeneratorBalanceControls({ draft, loading, onGenerate, onBudgetChange, onPickPart }: {
  draft: BuildGenerationResult;
  loading: boolean;
  onGenerate: (request: BuildGenerationRequest) => Promise<void>;
  onBudgetChange?: (budgetWon: number) => void;
  onPickPart?: (category: PartCategory) => void;
}) {
  const pendingRef = useRef(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changeSummary, setChangeSummary] = useState("");
  const previousDraftRef = useRef(draft);
  const busy = loading || pendingKey !== null;
  const adjustmentLines = [...draft.lines];
  if (draft.selection.useIntegratedGraphics && !draft.selection.gpu && !draft.lines.some((line) => line.category === "gpu")) {
    adjustmentLines.push({ category: "gpu", partId: "integrated", name: "CPU 내장 그래픽", quantity: 1, priceWon: 0 });
  }
  if (!draft.selection.cooler && !draft.lines.some((line) => line.category === "cooler")) {
    const coolerIncluded = draft.gamingSupportRequirements?.cooler.stockAllowed === true;
    adjustmentLines.push({ category: "cooler", partId: "included", name: coolerIncluded ? "CPU에 포함된 기본 쿨러" : "쿨러 미선택", quantity: 1, priceWon: 0 });
  }

  useEffect(() => {
    const before = previousDraftRef.current;
    previousDraftRef.current = draft;
    if (before === draft) return;
    onBudgetChange?.(draft.budgetWon);
    const changed = generatorBalanceChangesFor(before, draft);
    setChangeSummary(changed.length > 0 ? `바뀐 부품: ${changed.map((category) => CATEGORY_LABELS[category]).join(" / ")}` : before.budgetWon !== draft.budgetWon ? "새 예산에 맞춰 견적을 바꿨어요." : "");
  }, [draft, onBudgetChange]);

  async function adjust(key: string, request: BuildGenerationRequest | undefined) {
    if (!request || loading || pendingRef.current) return;
    pendingRef.current = true;
    setPendingKey(key);
    setError(null);
    try {
      await onGenerate(request);
    } catch {
      setError("견적을 바꾸지 못했어요. 다시 시도해 주세요.");
    } finally {
      pendingRef.current = false;
      setPendingKey(null);
    }
  }

  function adjustmentButton(category: PartCategory, direction: "up" | "down", request: BuildGenerationRequest | undefined) {
    const key = `${category}:${direction}`;
    const label = category === "ssd" || category === "hdd" || category === "memory" ? `${CATEGORY_LABELS[category]} 용량 ${direction === "up" ? "늘리기" : "줄이기"}` : `${CATEGORY_LABELS[category]} ${direction === "up" ? "높이기" : "낮추기"}`;
    const unavailableReason = direction === "up" ? draft.partTiers?.[category]?.upUnavailableReason : draft.partTiers?.[category]?.downUnavailableReason;
    const description = request ? undefined : unavailableReason ?? "현재 사양에서 선택할 수 있는 부품이 없어요";
    return <button className="generator-balance-button" type="button" data-testid={`balance-${key}`} aria-label={label} aria-description={description} title={description ?? label} disabled={busy || !request} onClick={() => void adjust(key, request)}>{pendingKey === key ? <FiLoader className="spin" /> : direction === "up" ? <FiPlus /> : <FiMinus />}</button>;
  }

  return <section className="generator-balance" data-testid="generator-balance" aria-label="예산/부품 조정" aria-busy={busy}>
    <div className="generator-balance-total" aria-live="polite"><div><span>합계</span><strong>{draft.totalPriceWon.toLocaleString("ko-KR")}원</strong></div><small>{draft.withinBudget ? `${Math.abs(draft.budgetDeltaWon).toLocaleString("ko-KR")}원 여유` : `${draft.budgetDeltaWon.toLocaleString("ko-KR")}원 초과`}</small></div>
    <CpuGpuBalanceRow assessment={draft.cpuGpuBalance} hasGpu={Boolean(draft.selection.gpu)} />
    <div className="generator-balance-lines">
      {adjustmentLines.map((line) => <div className="generator-balance-line" key={`${line.category}-${line.partId}`}>
        {adjustmentButton(line.category, "down", generatorPartAdjustmentRequestFor(draft, line.category, "down"))}
        <button type="button" className="generator-balance-part" aria-label={`${CATEGORY_LABELS[line.category]} 직접 선택`} disabled={busy || !onPickPart} onClick={() => onPickPart?.(line.category)}><span>{CATEGORY_LABELS[line.category]}</span><strong>{line.name}</strong><small>{line.specSummary ? `${line.specSummary} / ` : ""}{line.quantity > 1 ? `${line.quantity}개 / ` : ""}{(line.priceWon * line.quantity).toLocaleString("ko-KR")}원</small></button>
        {adjustmentButton(line.category, "up", generatorPartAdjustmentRequestFor(draft, line.category, "up"))}
      </div>)}
    </div>
    <p className="generator-balance-note">CPU를 바꾸면 보드/RAM/쿨러/파워를 함께 맞춰요. 그래픽카드를 바꾸면 파워와 케이스를 확인해요. 예산을 넘는 변경은 초과 금액이 표시됩니다.</p>
    <p className="generator-balance-status" role="status" aria-live="polite">{busy ? "견적을 다시 계산하고 있어요." : changeSummary}</p>
    {error && <p className="generator-balance-error" role="alert">{error}</p>}
  </section>;
}

const BALANCE_LABELS: Record<GamingBalanceLevel, string> = { too_weak: "너무 약함", slightly_weak: "살짝 약함", good: "좋음", slightly_strong: "살짝 강함", too_strong: "너무 강함" };
export function CpuGpuBalanceRow({ assessment, hasGpu = true }: { assessment?: CpuGpuBalanceAssessment; hasGpu?: boolean }) {
  if (!hasGpu) return null;
  const known = assessment && assessment.evidence !== "unknown";
  return <div className="generator-cpu-gpu-balance" data-testid="cpu-gpu-balance" aria-label="CPU와 GPU 밸런스"><strong>밸런스</strong><div>{(["cpu", "gpu"] as const).map((category) => <span key={category}><b>{category.toUpperCase()}</b><em className={known ? `balance-grade balance-${assessment[category].level}` : "balance-grade balance-unknown"}>{known ? BALANCE_LABELS[assessment[category].level] : "정보 확인 필요"}</em></span>)}</div></div>;
}
