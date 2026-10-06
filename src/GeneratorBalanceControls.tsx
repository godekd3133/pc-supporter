import { useEffect, useRef, useState } from "react";
import { FiLoader, FiMinus, FiPlus } from "react-icons/fi";
import type { BuildGenerationRequest, BuildGenerationResult, PartCategory } from "../shared/types";
import { CATEGORY_LABELS } from "../shared/types";
import { generatorBalanceChangesFor, generatorBudgetAdjustmentRequestFor, generatorPartAdjustmentRequestFor } from "./generator-balance";
import "./generator-balance.css";

export function GeneratorBalanceControls({ draft, loading, onGenerate, onBudgetChange }: {
  draft: BuildGenerationResult;
  loading: boolean;
  onGenerate: (request: BuildGenerationRequest) => Promise<void>;
  onBudgetChange?: (budgetWon: number) => void;
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
    setChangeSummary(changed.length > 0 ? `바뀐 부품: ${changed.map((category) => CATEGORY_LABELS[category]).join(" · ")}` : before.budgetWon !== draft.budgetWon ? "새 예산에 맞춰 견적을 바꿨어요." : "");
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

  function adjustmentButton(category: PartCategory | "budget", direction: "up" | "down", request: BuildGenerationRequest | undefined) {
    const key = `${category}:${direction}`;
    const label = category === "budget" ? `예산 10만원 ${direction === "up" ? "늘리기" : "줄이기"}` : category === "ssd" || category === "hdd" || category === "memory" ? `${CATEGORY_LABELS[category]} 용량 ${direction === "up" ? "늘리기" : "줄이기"}` : `${CATEGORY_LABELS[category]} ${direction === "up" ? "높이기" : "낮추기"}`;
    return <button className="generator-balance-button" type="button" data-testid={`balance-${key}`} aria-label={label} title={request ? label : "현재 사양에서 선택할 수 있는 부품이 없어요"} disabled={busy || !request} onClick={() => void adjust(key, request)}>{pendingKey === key ? <FiLoader className="spin" /> : direction === "up" ? <FiPlus /> : <FiMinus />}</button>;
  }

  return <section className="generator-balance" data-testid="generator-balance" aria-label="예산·부품 조정" aria-busy={busy}>
    <div className="generator-balance-budget">
      {adjustmentButton("budget", "down", generatorBudgetAdjustmentRequestFor(draft, "down"))}
      <div><span>예산</span><strong>{(draft.budgetWon / 10_000).toLocaleString("ko-KR")}만원</strong></div>
      {adjustmentButton("budget", "up", generatorBudgetAdjustmentRequestFor(draft, "up"))}
    </div>
    <div className="generator-balance-lines">
      {adjustmentLines.map((line) => <div className="generator-balance-line" key={`${line.category}-${line.partId}`}>
        {adjustmentButton(line.category, "down", generatorPartAdjustmentRequestFor(draft, line.category, "down"))}
        <div><span>{CATEGORY_LABELS[line.category]}{draft.partTierSuitability?.[line.category]?.tier.label ? ` · ${draft.partTierSuitability[line.category]!.tier.label}` : ""}</span><strong>{line.name}</strong><small>{line.specSummary ? `${line.specSummary} · ` : ""}{line.quantity > 1 ? `${line.quantity}개 · ` : ""}{(line.priceWon * line.quantity).toLocaleString("ko-KR")}원</small></div>
        {adjustmentButton(line.category, "up", generatorPartAdjustmentRequestFor(draft, line.category, "up"))}
      </div>)}
    </div>
    <p className="generator-balance-note">CPU를 바꾸면 보드·RAM·쿨러·파워를 함께 맞춰요. 그래픽카드를 바꾸면 파워와 케이스를 확인해요. 예산을 넘는 변경은 초과 금액이 표시됩니다.</p>
    <p className="generator-balance-status" role="status" aria-live="polite">{busy ? "견적을 다시 계산하고 있어요." : changeSummary}</p>
    {error && <p className="generator-balance-error" role="alert">{error}</p>}
  </section>;
}
