import type { BuildGenerationDiagnostic, BuildGenerationRequest } from "../shared/types";

// 자동 구성 실패를 구조화 로그 + 최근 기록 링 버퍼에 남긴다.
// 목적: 사용자가 "실패했다"고만 보고해도 서버 로그/관리자 조회로
// 요청 조건과 진단을 바로 볼 수 있어야 재현이 가능하다.

export type GenerationFailureRequestSummary = {
  profile?: BuildGenerationRequest["profile"];
  priority?: BuildGenerationRequest["priority"];
  performanceTier?: BuildGenerationRequest["performanceTier"];
  budgetWon?: number;
  includeGpu?: boolean;
  gamingResolution?: BuildGenerationRequest["gamingResolution"];
  gamingRefreshRate?: number;
  gamingGameIds?: string[];
  gamingGraphicsPreset?: BuildGenerationRequest["gamingGraphicsPreset"];
  gamingRayTracing?: boolean;
  gamingUpscaling?: BuildGenerationRequest["gamingUpscaling"];
  memoryCapacityGb?: number;
  storageCapacityGb?: number;
  hddCount?: number;
  hddCapacityGb?: number;
  listingPolicy?: BuildGenerationRequest["listingPolicy"];
  includeNonRetail?: boolean;
};

export type GenerationFailureRecord = {
  event: "builds.generation.failed";
  at: string;
  requestId?: string;
  route: string;
  statusCode: number;
  error: string;
  request: GenerationFailureRequestSummary;
  diagnostics: { id: string; title: string; facts: { label: string; value: string }[] }[];
  recoveryOptionIds: string[];
  /** variants/budget-ladder 같이 한 요청 안의 부분 실패를 구분하는 라벨. */
  context?: string;
};

const MAX_RECENT_FAILURES = 200;
const recentFailures: GenerationFailureRecord[] = [];

export type GenerationFailureLogSink = (record: GenerationFailureRecord) => void;

function defaultLogSink(record: GenerationFailureRecord) {
  console.log(JSON.stringify(record));
}

export function generationRequestSummaryFor(request: BuildGenerationRequest): GenerationFailureRequestSummary {
  return {
    profile: request.profile,
    priority: request.priority,
    performanceTier: request.performanceTier,
    budgetWon: request.budgetWon,
    includeGpu: request.includeGpu,
    gamingResolution: request.gamingResolution,
    gamingRefreshRate: request.gamingRefreshRate,
    gamingGameIds: request.gamingGameIds?.slice(0, 8),
    gamingGraphicsPreset: request.gamingGraphicsPreset,
    gamingRayTracing: request.gamingRayTracing,
    gamingUpscaling: request.gamingUpscaling,
    memoryCapacityGb: request.memoryCapacityGb,
    storageCapacityGb: request.storageCapacityGb,
    hddCount: request.hddCount,
    hddCapacityGb: request.hddCapacityGb,
    listingPolicy: request.listingPolicy,
    includeNonRetail: request.includeNonRetail
  };
}

function diagnosticSummaryFor(diagnostics: BuildGenerationDiagnostic[] | undefined) {
  return (diagnostics ?? []).slice(0, 8).map((diagnostic) => ({
    id: diagnostic.id,
    title: diagnostic.title,
    facts: (diagnostic.facts ?? []).slice(0, 8).map((fact) => ({ label: fact.label, value: fact.value }))
  }));
}

export function recordGenerationFailure(
  input: {
    route: string;
    statusCode: number;
    error: unknown;
    request: BuildGenerationRequest;
    diagnostics?: BuildGenerationDiagnostic[];
    recoveryOptionIds?: string[];
    requestId?: string;
    context?: string;
  },
  sink: GenerationFailureLogSink = defaultLogSink
) {
  const record: GenerationFailureRecord = {
    event: "builds.generation.failed",
    at: new Date().toISOString(),
    requestId: input.requestId,
    route: input.route,
    statusCode: input.statusCode,
    error: input.error instanceof Error ? input.error.message : String(input.error),
    request: generationRequestSummaryFor(input.request),
    diagnostics: diagnosticSummaryFor(input.diagnostics),
    recoveryOptionIds: input.recoveryOptionIds ?? [],
    ...(input.context ? { context: input.context } : {})
  };
  recentFailures.push(record);
  if (recentFailures.length > MAX_RECENT_FAILURES) recentFailures.splice(0, recentFailures.length - MAX_RECENT_FAILURES);
  try {
    sink(record);
  } catch {
    // Logging must never change the result of an application request.
  }
  return record;
}

export function recentGenerationFailures(limit = 50): GenerationFailureRecord[] {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, MAX_RECENT_FAILURES) : 50;
  return recentFailures.slice(-safeLimit).reverse();
}

export function resetGenerationFailuresForTest() {
  recentFailures.length = 0;
}
