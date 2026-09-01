import type { BuildGenerationDiagnostic, BuildGenerationRequest, BuildGenerationResult, BuildSelection, PartCategory } from "./types";
import { CATEGORY_LABELS, PART_CATEGORIES } from "./types";

export const BUDGET_LADDER_BANDS = [
  { id: "economy", label: "절약형", description: "입력 예산의 약 80%로 구성", multiplier: 0.8 },
  { id: "target", label: "목표 예산", description: "입력한 목표 예산 그대로", multiplier: 1 },
  { id: "headroom", label: "여유형", description: "입력 예산의 약 120%로 구성", multiplier: 1.2 }
] as const;

export type BudgetLadderBandId = (typeof BUDGET_LADDER_BANDS)[number]["id"];

export interface BudgetLadderScenario {
  id: BudgetLadderBandId;
  label: string;
  description: string;
  budgetWon: number;
  request: BuildGenerationRequest;
}

export interface BudgetLadderOutcome {
  id: BudgetLadderBandId;
  label: string;
  description: string;
  budgetWon: number;
  request?: BuildGenerationRequest;
  draft?: BuildGenerationResult;
  error?: string;
  diagnostics?: BuildGenerationDiagnostic[];
}

export interface BudgetLadderChangeLine {
  category: PartCategory;
  label: string;
  before: string;
  after: string;
}

export interface BudgetLadderChange {
  fromId: BudgetLadderBandId;
  toId: BudgetLadderBandId;
  fromLabel: string;
  toLabel: string;
  budgetDeltaWon: number;
  totalPriceDeltaWon: number;
  blockerDelta: number;
  warningDelta: number;
  unknownDelta: number;
  analysisScoreDelta?: number;
  sameConfiguration: boolean;
  changedLines: BudgetLadderChangeLine[];
}

export type BudgetLadderExportStatus = "호환 가능" | "확인 필요" | "검토 필요" | "생성 실패";

export interface BudgetLadderExportLine {
  category: PartCategory;
  text: string;
  partId?: string;
  quantity?: number;
}

export interface BudgetLadderExportItem {
  id: BudgetLadderBandId;
  label: string;
  description: string;
  budgetWon: number;
  status: BudgetLadderExportStatus;
  totalPriceWon?: number;
  budgetDeltaWon?: number;
  withinBudget?: boolean;
  priceComplete?: boolean;
  blockerCount?: number;
  warningCount?: number;
  unknownCount?: number;
  analysisScore?: number;
  lines?: BudgetLadderExportLine[];
  selection?: BuildSelection;
  error?: string;
  diagnostics?: BuildGenerationDiagnostic[];
}

export interface BudgetLadderExportPayload {
  type: "pc-supporter-budget-ladder";
  version: 1;
  exportedAt: string;
  items: BudgetLadderExportItem[];
  changes: BudgetLadderChange[];
}

type BudgetLadderResultLike = Pick<BudgetLadderOutcome, "id" | "label" | "budgetWon"> & {
  draft?: BuildGenerationResult;
};

function roundedBudgetWon(value: number) {
  if (value <= 1) return 1;
  return Math.max(1, Math.round(value / 10_000) * 10_000);
}

export function budgetLadderScenariosFor(request: BuildGenerationRequest): BudgetLadderScenario[] {
  const baseBudgetWon = Math.max(1, Math.floor(request.budgetWon));
  return BUDGET_LADDER_BANDS.map((band) => {
    const budgetWon = band.id === "target" ? baseBudgetWon : roundedBudgetWon(baseBudgetWon * band.multiplier);
    return {
      id: band.id,
      label: band.label,
      description: band.description,
      budgetWon,
      request: { ...request, budgetWon }
    };
  });
}

export function budgetLadderBaseRequestFor(outcomes: BudgetLadderOutcome[]) {
  return outcomes.find((outcome) => outcome.id === "target")?.request ?? outcomes.find((outcome) => outcome.request)?.request;
}

function generatedLineText(draft: BuildGenerationResult, category: PartCategory) {
  const line = draft.lines.find((item) => item.category === category);
  return line ? `${line.name}${line.quantity > 1 ? ` ×${line.quantity}` : ""}` : "미포함";
}

export function budgetLadderChangeFor(before: BudgetLadderResultLike, after: BudgetLadderResultLike): BudgetLadderChange | undefined {
  if (!before.draft || !after.draft) return undefined;
  const changedLines = PART_CATEGORIES.flatMap((category) => {
    const beforeLine = before.draft!.lines.find((line) => line.category === category);
    const afterLine = after.draft!.lines.find((line) => line.category === category);
    if (beforeLine?.partId === afterLine?.partId && beforeLine?.quantity === afterLine?.quantity) return [];
    return [{ category, label: CATEGORY_LABELS[category], before: generatedLineText(before.draft!, category), after: generatedLineText(after.draft!, category) }];
  });
  const analysisScoreDelta = before.draft.analysis?.overallScore !== undefined && after.draft.analysis?.overallScore !== undefined
    ? after.draft.analysis.overallScore - before.draft.analysis.overallScore
    : undefined;
  return {
    fromId: before.id,
    toId: after.id,
    fromLabel: before.label,
    toLabel: after.label,
    budgetDeltaWon: after.budgetWon - before.budgetWon,
    totalPriceDeltaWon: after.draft.totalPriceWon - before.draft.totalPriceWon,
    blockerDelta: after.draft.blockerCount - before.draft.blockerCount,
    warningDelta: after.draft.warningCount - before.draft.warningCount,
    unknownDelta: after.draft.unknownCount - before.draft.unknownCount,
    ...(analysisScoreDelta !== undefined ? { analysisScoreDelta } : {}),
    sameConfiguration: changedLines.length === 0,
    changedLines
  };
}

function statusText(outcome: BudgetLadderOutcome) {
  if (!outcome.draft) return "생성 실패";
  return outcome.draft.status === "compatible" ? "호환 가능" : outcome.draft.status === "needs_review" ? "확인 필요" : "검토 필요";
}

function budgetResultText(draft: BuildGenerationResult) {
  if (!draft.priceComplete) return "가격 일부 확인 필요";
  return draft.withinBudget ? `${Math.abs(draft.budgetDeltaWon).toLocaleString("ko-KR")}원 여유` : `${draft.budgetDeltaWon.toLocaleString("ko-KR")}원 초과`;
}

function compactLineText(draft: BuildGenerationResult, category: PartCategory) {
  const line = draft.lines.find((item) => item.category === category);
  return line ? `${line.name}${line.quantity > 1 ? ` ×${line.quantity}` : ""}` : "미포함";
}

function compactDiagnosticsText(outcome: BudgetLadderOutcome) {
  return (outcome.diagnostics ?? []).slice(0, 2).flatMap((diagnostic) => [
    `${diagnostic.title}: ${diagnostic.summary}`,
    ...diagnostic.facts.slice(0, 4).map((fact) => `${fact.label} ${fact.value}`),
    ...(diagnostic.recommendation ? [`권장 ${diagnostic.recommendation}`] : [])
  ]).join(" · ");
}

function csvCell(value: string | number | boolean | undefined) {
  const raw = value === undefined ? "" : String(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

export function budgetLadderExportItemFor(outcome: BudgetLadderOutcome): BudgetLadderExportItem {
  const draft = outcome.draft;
  return {
    id: outcome.id,
    label: outcome.label,
    description: outcome.description,
    budgetWon: outcome.budgetWon,
    status: statusText(outcome),
    ...(draft ? {
      totalPriceWon: draft.totalPriceWon,
      budgetDeltaWon: draft.budgetDeltaWon,
      withinBudget: draft.withinBudget,
      priceComplete: draft.priceComplete,
      blockerCount: draft.blockerCount,
      warningCount: draft.warningCount,
      unknownCount: draft.unknownCount,
      ...(draft.analysis?.overallScore !== undefined ? { analysisScore: draft.analysis.overallScore } : {}),
      lines: PART_CATEGORIES.map((category) => {
        const line = draft.lines.find((item) => item.category === category);
        return { category, text: compactLineText(draft, category), ...(line ? { partId: line.partId, quantity: line.quantity } : {}) };
      }),
      selection: draft.selection
    } : {}),
    ...(outcome.error ? { error: outcome.error } : {}),
    ...(outcome.diagnostics && outcome.diagnostics.length > 0 ? { diagnostics: outcome.diagnostics.slice(0, 2) } : {})
  } satisfies BudgetLadderExportItem;
}

export function budgetLadderExportPayloadFor(outcomes: BudgetLadderOutcome[], exportedAt = new Date().toISOString()): BudgetLadderExportPayload {
  const changes = outcomes.slice(1).map((outcome, index) => budgetLadderChangeFor(outcomes[index], outcome)).filter((change): change is BudgetLadderChange => Boolean(change));
  return {
    type: "pc-supporter-budget-ladder",
    version: 1,
    exportedAt,
    items: outcomes.map(budgetLadderExportItemFor),
    changes
  };
}

export function budgetLadderTextFor(outcomes: BudgetLadderOutcome[]) {
  const lines = ["PC Supporter 예산 구간 비교", ""];
  outcomes.forEach((outcome) => {
    lines.push(`[${outcome.label}] ${outcome.description}`);
    lines.push(`- 목표 예산: ${outcome.budgetWon.toLocaleString("ko-KR")}원`);
    lines.push(`- 상태: ${statusText(outcome)}`);
    if (outcome.draft) {
      lines.push(`- 예상 합계: ${outcome.draft.totalPriceWon.toLocaleString("ko-KR")}원 · ${budgetResultText(outcome.draft)}`);
      lines.push(`- 위험: 차단 ${outcome.draft.blockerCount}개 · 주의 ${outcome.draft.warningCount}개 · 확인 필요 ${outcome.draft.unknownCount}개`);
      lines.push(`- 카탈로그 분석: ${outcome.draft.analysis?.overallScore === undefined ? "계산 불가" : `${outcome.draft.analysis.overallScore}점`}`);
      for (const category of PART_CATEGORIES) lines.push(`- ${CATEGORY_LABELS[category]}: ${compactLineText(outcome.draft, category)}`);
    } else {
      lines.push(`- 오류: ${outcome.error ?? "자동 구성을 만들지 못했습니다."}`);
      const diagnostics = compactDiagnosticsText(outcome);
      if (diagnostics) lines.push(`- 실패 근거: ${diagnostics}`);
    }
    lines.push("");
  });
  const changes = outcomes.slice(1).map((outcome, index) => budgetLadderChangeFor(outcomes[index], outcome)).filter((change): change is BudgetLadderChange => Boolean(change));
  if (changes.length > 0) {
    lines.push("[예산 증액 효과]");
    changes.forEach((change) => {
      lines.push(`- ${change.fromLabel} → ${change.toLabel}: 예산 ${change.budgetDeltaWon >= 0 ? "+" : ""}${change.budgetDeltaWon.toLocaleString("ko-KR")}원 · 실제 합계 ${change.totalPriceDeltaWon >= 0 ? "+" : ""}${change.totalPriceDeltaWon.toLocaleString("ko-KR")}원`);
      lines.push(`  위험 변화: 차단 ${change.blockerDelta >= 0 ? "+" : ""}${change.blockerDelta} · 주의 ${change.warningDelta >= 0 ? "+" : ""}${change.warningDelta} · 확인 필요 ${change.unknownDelta >= 0 ? "+" : ""}${change.unknownDelta}`);
      if (change.sameConfiguration) lines.push("  구성: 부품·수량 동일");
      else change.changedLines.forEach((line) => lines.push(`  변경: ${line.label} · ${line.before} → ${line.after}`));
    });
  }
  return lines.join("\n");
}

export function budgetLadderCsvFor(outcomes: BudgetLadderOutcome[]) {
  const header = ["구간 ID", "구간", "설명", "목표 예산", "상태", "예상 합계", "예산 결과", "차단", "주의", "확인 필요", "카탈로그 분석", ...PART_CATEGORIES.map((category) => CATEGORY_LABELS[category]), "오류"];
  const rows = outcomes.map((outcome) => {
    const draft = outcome.draft;
    return [
      outcome.id,
      outcome.label,
      outcome.description,
      outcome.budgetWon,
      statusText(outcome),
      draft?.totalPriceWon,
      draft ? budgetResultText(draft) : undefined,
      draft?.blockerCount,
      draft?.warningCount,
      draft?.unknownCount,
      draft?.analysis?.overallScore,
      ...PART_CATEGORIES.map((category) => draft ? compactLineText(draft, category) : undefined),
      outcome.error ?? (compactDiagnosticsText(outcome) || undefined)
    ];
  });
  return `\uFEFF${[header, ...rows].map((row) => row.map((value) => csvCell(value)).join(",")).join("\r\n")}`;
}

export function budgetLadderTextForPayload(payload: BudgetLadderExportPayload) {
  const lines = ["PC Supporter 예산 구간 비교", ""];
  payload.items.forEach((item) => {
    lines.push(`[${item.label}] ${item.description}`);
    lines.push(`- 목표 예산: ${item.budgetWon.toLocaleString("ko-KR")}원`);
    lines.push(`- 상태: ${item.status}`);
    if (item.totalPriceWon !== undefined) {
      const budgetResult = item.priceComplete === false
        ? "가격 일부 확인 필요"
        : item.withinBudget
          ? `${Math.abs(item.budgetDeltaWon ?? 0).toLocaleString("ko-KR")}원 여유`
          : `${(item.budgetDeltaWon ?? 0).toLocaleString("ko-KR")}원 초과`;
      lines.push(`- 예상 합계: ${item.totalPriceWon.toLocaleString("ko-KR")}원 · ${budgetResult}`);
      lines.push(`- 위험: 차단 ${item.blockerCount ?? 0}개 · 주의 ${item.warningCount ?? 0}개 · 확인 필요 ${item.unknownCount ?? 0}개`);
      lines.push(`- 카탈로그 분석: ${item.analysisScore === undefined ? "계산 불가" : `${item.analysisScore}점`}`);
      for (const line of item.lines ?? []) lines.push(`- ${CATEGORY_LABELS[line.category]}: ${line.text}`);
    } else {
      lines.push(`- 오류: ${item.error ?? "자동 구성을 만들지 못했습니다."}`);
      const diagnostics = (item.diagnostics ?? []).slice(0, 2).flatMap((diagnostic) => [
        `${diagnostic.title}: ${diagnostic.summary}`,
        ...diagnostic.facts.slice(0, 4).map((fact) => `${fact.label} ${fact.value}`),
        ...(diagnostic.recommendation ? [`권장 ${diagnostic.recommendation}`] : [])
      ]).join(" · ");
      if (diagnostics) lines.push(`- 실패 근거: ${diagnostics}`);
    }
    lines.push("");
  });
  if (payload.changes.length > 0) {
    lines.push("[예산 증액 효과]");
    payload.changes.forEach((change) => {
      lines.push(`- ${change.fromLabel} → ${change.toLabel}: 예산 ${change.budgetDeltaWon >= 0 ? "+" : ""}${change.budgetDeltaWon.toLocaleString("ko-KR")}원 · 실제 합계 ${change.totalPriceDeltaWon >= 0 ? "+" : ""}${change.totalPriceDeltaWon.toLocaleString("ko-KR")}원`);
      lines.push(`  위험 변화: 차단 ${change.blockerDelta >= 0 ? "+" : ""}${change.blockerDelta} · 주의 ${change.warningDelta >= 0 ? "+" : ""}${change.warningDelta} · 확인 필요 ${change.unknownDelta >= 0 ? "+" : ""}${change.unknownDelta}`);
      if (change.sameConfiguration) lines.push("  구성: 부품·수량 동일");
      else change.changedLines.forEach((line) => lines.push(`  변경: ${line.label} · ${line.before} → ${line.after}`));
    });
  }
  return lines.join("\n");
}

export function budgetLadderCsvForPayload(payload: BudgetLadderExportPayload) {
  const header = ["구간 ID", "구간", "설명", "목표 예산", "상태", "예상 합계", "예산 결과", "차단", "주의", "확인 필요", "카탈로그 분석", ...PART_CATEGORIES.map((category) => CATEGORY_LABELS[category]), "오류"];
  const rows = payload.items.map((item) => {
    const budgetResult = item.totalPriceWon === undefined ? undefined : item.priceComplete === false
      ? "가격 일부 확인 필요"
      : item.withinBudget
        ? `${Math.abs(item.budgetDeltaWon ?? 0).toLocaleString("ko-KR")}원 여유`
        : `${(item.budgetDeltaWon ?? 0).toLocaleString("ko-KR")}원 초과`;
    const lineByCategory = new Map((item.lines ?? []).map((line) => [line.category, line.text]));
    return [
      item.id,
      item.label,
      item.description,
      item.budgetWon,
      item.status,
      item.totalPriceWon,
      budgetResult,
      item.blockerCount,
      item.warningCount,
      item.unknownCount,
      item.analysisScore,
      ...PART_CATEGORIES.map((category) => lineByCategory.get(category)),
      item.error ?? ((item.diagnostics ?? []).length > 0 ? (item.diagnostics ?? []).slice(0, 2).map((diagnostic) => `${diagnostic.title}: ${diagnostic.summary}`).join(" · ") : undefined)
    ];
  });
  return `\uFEFF${[header, ...rows].map((row) => row.map((value) => csvCell(value)).join(",")).join("\r\n")}`;
}

export function budgetLadderJsonForPayload(payload: BudgetLadderExportPayload) {
  return JSON.stringify(payload, null, 2);
}

export function budgetLadderJsonFor(outcomes: BudgetLadderOutcome[]) {
  return budgetLadderJsonForPayload(budgetLadderExportPayloadFor(outcomes));
}
