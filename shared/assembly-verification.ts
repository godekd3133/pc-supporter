export type AssemblyVerificationCheckId = "post" | "bios" | "memory-profile" | "storage-detection" | "gpu-output" | "fan-rgb";
export type AssemblyVerificationCheckStatus = "unchecked" | "pass" | "fail";
export type AssemblyVerificationNoiseLevel = "not_recorded" | "quiet" | "normal" | "loud";
export type AssemblyVerificationLoadTool = "not_recorded" | "occt" | "cinebench" | "3dmark" | "crystaldiskmark" | "other";
export type AssemblyVerificationLoadScenario = "not_recorded" | "idle" | "cpu" | "gpu" | "mixed" | "storage" | "custom";
export type AssemblyVerificationMeasurementSource = "manual" | "csv";
export type AssemblyVerificationMeasurementQualityStatus = "complete" | "partial" | "review";
export type AssemblyVerificationMeasurementContinuityStatus = "continuous" | "gapped" | "unknown";
export type AssemblyVerificationMeasurementContinuity = {
  status: AssemblyVerificationMeasurementContinuityStatus;
  timestampCount: number;
  unparsedTimestampCount: number;
  sampleIntervalSeconds?: number;
  observedDurationSeconds?: number;
  gapCount: number;
  largestGapSeconds?: number;
  nonMonotonicCount: number;
  estimatedMissingSamples: number;
  gapToleranceSeconds?: number;
};
export type AssemblyVerificationMeasurementQuality = {
  status: AssemblyVerificationMeasurementQualityStatus;
  rowCount: number;
  validSampleCount: number;
  skippedRowCount: number;
  invalidValueCount: number;
  recognizedCoreColumnCount: number;
  coreColumnCount: number;
  telemetryColumnCount: number;
  hasTimeAxis: boolean;
  seriesPointCount: number;
  continuity?: AssemblyVerificationMeasurementContinuity;
};
export type AssemblyVerificationTelemetryMetric = "cpuTempC" | "gpuTempC" | "ambientTempC" | "cpuFanRpm" | "gpuFanRpm" | "cpuUsagePercent" | "gpuUsagePercent" | "cpuClockMHz" | "gpuClockMHz" | "cpuPowerW" | "gpuPowerW";
export type AssemblyVerificationTelemetryPoint = {
  sampleIndex: number;
  elapsedSeconds?: number;
  cpuTempC?: number;
  gpuTempC?: number;
  ambientTempC?: number;
  cpuFanRpm?: number;
  gpuFanRpm?: number;
  cpuUsagePercent?: number;
  gpuUsagePercent?: number;
  cpuClockMHz?: number;
  gpuClockMHz?: number;
  cpuPowerW?: number;
  gpuPowerW?: number;
};

export type AssemblyVerificationTelemetryTrend = "rising" | "falling" | "unchanged" | "insufficient";
export type AssemblyVerificationTelemetryMetricAnalysis = {
  metric: AssemblyVerificationTelemetryMetric;
  sampleCount: number;
  first: number;
  last: number;
  mean: number;
  min: number;
  max: number;
  delta: number;
  trend: AssemblyVerificationTelemetryTrend;
  stepCount: number;
  positiveStepCount: number;
  peakAtSeconds?: number;
  ratePerMinute?: number;
  lastStepDelta?: number;
  finalWindowSpread?: number;
};

export type AssemblyVerificationTelemetryAnalysis = {
  pointCount: number;
  timeBased: boolean;
  elapsedSeconds?: number;
  metrics: Partial<Record<AssemblyVerificationTelemetryMetric, AssemblyVerificationTelemetryMetricAnalysis>>;
};

export type AssemblyVerificationTelemetrySeriesSegment = {
  index: number;
  points: AssemblyVerificationTelemetryPoint[];
  breakBefore?: "gap" | "non-monotonic";
  gapBeforeSeconds?: number;
};

export const ASSEMBLY_VERIFICATION_TELEMETRY_POINT_LIMIT = 240;

export type AssemblyVerificationCheckDefinition = {
  id: AssemblyVerificationCheckId;
  label: string;
  detail: string;
};

export type AssemblyVerificationEntry = {
  status: AssemblyVerificationCheckStatus;
  note?: string;
};

export type AssemblyVerificationLog = {
  type: "pc-supporter-assembly-verification";
  schemaVersion: 1;
  buildFingerprint: string;
  updatedAt: string;
  checks: Record<AssemblyVerificationCheckId, AssemblyVerificationEntry>;
  cpuMaxTempC?: number;
  gpuMaxTempC?: number;
  noiseLevel: AssemblyVerificationNoiseLevel;
  loadTool: AssemblyVerificationLoadTool;
  loadScenario: AssemblyVerificationLoadScenario;
  testDurationMinutes?: number;
  ambientTempC?: number;
  cpuFanRpm?: number;
  gpuFanRpm?: number;
  note?: string;
  measurementSource?: AssemblyVerificationMeasurementSource;
  measurementSourceLabel?: string;
  measurementSampleCount?: number;
  measurementImportedAt?: string;
  measurementSeries?: AssemblyVerificationTelemetryPoint[];
  measurementQuality?: AssemblyVerificationMeasurementQuality;
  runId?: string;
  runLabel?: string;
  createdAt?: string;
};

export type AssemblyVerificationHistory = {
  type: "pc-supporter-assembly-verification-history";
  schemaVersion: 1;
  buildFingerprint: string;
  updatedAt: string;
  activeRunId: string;
  runs: AssemblyVerificationLog[];
};

export type AssemblyVerificationSavedSnapshot = {
  type: "pc-supporter-assembly-verification-summary";
  schemaVersion: 1;
  state: AssemblyVerificationState;
  total: number;
  checked: number;
  passed: number;
  failed: number;
  checks: Record<AssemblyVerificationCheckId, AssemblyVerificationCheckStatus>;
  loadTool: AssemblyVerificationLoadTool;
  loadScenario: AssemblyVerificationLoadScenario;
  testDurationMinutes?: number;
  ambientTempC?: number;
  cpuMaxTempC?: number;
  gpuMaxTempC?: number;
  cpuFanRpm?: number;
  gpuFanRpm?: number;
  noiseLevel: AssemblyVerificationNoiseLevel;
  measurementSource?: AssemblyVerificationMeasurementSource;
  measurementSourceLabel?: string;
  measurementSampleCount?: number;
  measurementImportedAt?: string;
  measurementSeriesPointCount?: number;
  measurementQuality?: AssemblyVerificationMeasurementQuality;
  updatedAt: string;
  runId?: string;
  runLabel?: string;
  createdAt?: string;
};

export const ASSEMBLY_VERIFICATION_HISTORY_LIMIT = 12;

export type AssemblyVerificationProgress = {
  total: number;
  checked: number;
  passed: number;
  failed: number;
  remaining: number;
  percent: number;
};

export type AssemblyVerificationTrendPoint = {
  index: number;
  runId: string;
  runLabel: string;
  state: AssemblyVerificationState;
  checked: number;
  total: number;
  loadTool: AssemblyVerificationLoadTool;
  loadScenario: AssemblyVerificationLoadScenario;
  cpuMaxTempC?: number;
  gpuMaxTempC?: number;
  ambientTempC?: number;
  testDurationMinutes?: number;
  cpuFanRpm?: number;
  gpuFanRpm?: number;
  noiseLevel: AssemblyVerificationNoiseLevel;
  measurementSource?: AssemblyVerificationMeasurementSource;
  measurementSampleCount?: number;
  measurementSeriesPointCount?: number;
  measurementQualityStatus?: AssemblyVerificationMeasurementQualityStatus;
  measurementContinuityStatus?: AssemblyVerificationMeasurementContinuityStatus;
};

export type AssemblyVerificationComparisonFilter = "all" | "same-load";

export type AssemblyVerificationComparisonPoint = AssemblyVerificationTrendPoint & {
  conditionKey?: string;
  cpuAmbientAdjustedC?: number;
  gpuAmbientAdjustedC?: number;
  cpuDeltaC?: number;
  gpuDeltaC?: number;
  cpuAmbientAdjustedDeltaC?: number;
  gpuAmbientAdjustedDeltaC?: number;
  cpuFanRpmDelta?: number;
  gpuFanRpmDelta?: number;
  comparableToPrevious?: boolean;
  comparisonBlockReason?: "condition-changed" | "condition-missing" | "measurement-quality-review" | "measurement-continuity-gapped";
};

export type AssemblyVerificationComparison = {
  filter: AssemblyVerificationComparisonFilter;
  points: AssemblyVerificationComparisonPoint[];
  referenceRunId?: string;
  conditionKey?: string;
  reason?: "reference-condition-missing" | "no-matching-condition";
};

export type AssemblyVerificationRecheckSignal = {
  id: "cpu-temperature-rise" | "gpu-temperature-rise" | "fan-rpm-rise" | "noise-rise" | "condition-incomplete" | "measurement-quality-review";
  level: "notice";
  title: string;
  summary: string;
  evidence: string;
  runIds: string[];
};

export type AssemblyVerificationState = "not_started" | "in_progress" | "passed" | "failed";

export type AssemblyVerificationSurfaceSummary = {
  state: AssemblyVerificationState;
  checked: number;
  total: number;
  passed: number;
  failed: number;
  remaining: number;
  percent: number;
  recheckSignalCount: number;
  updatedAt: string;
  runId?: string;
};

export type AssemblyVerificationParseResult = {
  log?: AssemblyVerificationLog;
  errors: string[];
};

export const ASSEMBLY_VERIFICATION_CHECKS: readonly AssemblyVerificationCheckDefinition[] = [
  { id: "post", label: "POST·첫 부팅", detail: "전원 버튼 후 POST 화면과 경고음 없이 BIOS 진입이 되는지 확인합니다." },
  { id: "bios", label: "BIOS 기본 인식", detail: "CPU·메모리·저장장치·팬이 BIOS에서 정상 인식되는지 확인합니다." },
  { id: "memory-profile", label: "메모리 프로파일", detail: "XMP·EXPO 적용 상태와 부팅 안정성을 확인합니다." },
  { id: "storage-detection", label: "저장장치 인식", detail: "M.2·SATA 저장장치가 모두 인식되고 부팅 순서가 올바른지 확인합니다." },
  { id: "gpu-output", label: "GPU 화면 출력", detail: "모니터 출력, GPU 드라이버, 보조전원 연결 상태를 확인합니다." },
  { id: "fan-rgb", label: "팬·RGB 동작", detail: "모든 팬 회전과 RGB 전압·효과·제어가 의도대로 동작하는지 확인합니다." }
] as const;

const CHECK_IDS = new Set<AssemblyVerificationCheckId>(ASSEMBLY_VERIFICATION_CHECKS.map((check) => check.id));
const NOISE_LEVELS = new Set<AssemblyVerificationNoiseLevel>(["not_recorded", "quiet", "normal", "loud"]);
const LOAD_TOOLS = new Set<AssemblyVerificationLoadTool>(["not_recorded", "occt", "cinebench", "3dmark", "crystaldiskmark", "other"]);
const LOAD_SCENARIOS = new Set<AssemblyVerificationLoadScenario>(["not_recorded", "idle", "cpu", "gpu", "mixed", "storage", "custom"]);

function nowIso() {
  return new Date().toISOString();
}

function emptyChecks(): Record<AssemblyVerificationCheckId, AssemblyVerificationEntry> {
  return Object.fromEntries(ASSEMBLY_VERIFICATION_CHECKS.map((check) => [check.id, { status: "unchecked" as const }])) as Record<AssemblyVerificationCheckId, AssemblyVerificationEntry>;
}

export function emptyAssemblyVerificationLog(buildFingerprint: string, updatedAt = nowIso()): AssemblyVerificationLog {
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { type: "pc-supporter-assembly-verification", schemaVersion: 1, buildFingerprint, updatedAt, checks: emptyChecks(), noiseLevel: "not_recorded", loadTool: "not_recorded", loadScenario: "not_recorded", runId, runLabel: "조립 검증 1회차", createdAt: updatedAt };
}

export function emptyAssemblyVerificationHistory(buildFingerprint: string, updatedAt = nowIso()): AssemblyVerificationHistory {
  const run = emptyAssemblyVerificationLog(buildFingerprint, updatedAt);
  return { type: "pc-supporter-assembly-verification-history", schemaVersion: 1, buildFingerprint, updatedAt, activeRunId: run.runId!, runs: [run] };
}

function telemetryMetricRange(metric: AssemblyVerificationTelemetryMetric) {
  if (metric === "ambientTempC") return { min: 0, max: 60 };
  if (metric.endsWith("TempC")) return { min: 0, max: 150 };
  if (metric.endsWith("Percent")) return { min: 0, max: 100 };
  if (metric.endsWith("MHz")) return { min: 0, max: 100_000 };
  if (metric.endsWith("PowerW")) return { min: 0, max: 5_000 };
  return { min: 0, max: 30_000 };
}

function telemetrySeriesFromUnknown(value: unknown, errors: string[]) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > ASSEMBLY_VERIFICATION_TELEMETRY_POINT_LIMIT) {
    errors.push(`측정 시계열은 1~${ASSEMBLY_VERIFICATION_TELEMETRY_POINT_LIMIT}개 포인트 배열이어야 합니다.`);
    return undefined;
  }
  const metrics: AssemblyVerificationTelemetryMetric[] = ["cpuTempC", "gpuTempC", "ambientTempC", "cpuFanRpm", "gpuFanRpm", "cpuUsagePercent", "gpuUsagePercent", "cpuClockMHz", "gpuClockMHz", "cpuPowerW", "gpuPowerW"];
  const series: AssemblyVerificationTelemetryPoint[] = [];
  value.forEach((rawPoint, index) => {
    if (!isRecord(rawPoint) || typeof rawPoint.sampleIndex !== "number" || !Number.isInteger(rawPoint.sampleIndex) || rawPoint.sampleIndex < 0 || rawPoint.sampleIndex > 100_000) {
      errors.push(`${index + 1}번째 측정 시계열 포인트의 샘플 번호가 올바르지 않습니다.`);
      return;
    }
    const elapsedSeconds = rawPoint.elapsedSeconds;
    if (elapsedSeconds !== undefined && (typeof elapsedSeconds !== "number" || !Number.isFinite(elapsedSeconds) || elapsedSeconds < 0 || elapsedSeconds > 172_800)) {
      errors.push(`${index + 1}번째 측정 시계열 포인트의 경과 시간이 올바르지 않습니다.`);
      return;
    }
    const point: AssemblyVerificationTelemetryPoint = { sampleIndex: rawPoint.sampleIndex, ...(typeof elapsedSeconds === "number" ? { elapsedSeconds } : {}) };
    let metricCount = 0;
    for (const metric of metrics) {
      const rawValue = rawPoint[metric];
      if (rawValue === undefined || rawValue === null) continue;
      const range = telemetryMetricRange(metric);
      if (typeof rawValue !== "number" || !Number.isFinite(rawValue) || rawValue < range.min || rawValue > range.max) {
        errors.push(`${index + 1}번째 측정 시계열 포인트의 ${metric} 값이 범위를 벗어났습니다.`);
        continue;
      }
      point[metric] = Number(rawValue.toFixed(1));
      metricCount += 1;
    }
    if (metricCount === 0) errors.push(`${index + 1}번째 측정 시계열 포인트에 유효한 센서값이 없습니다.`);
    else series.push(point);
  });
  return errors.length > 0 ? undefined : series;
}

export function assemblyVerificationTelemetrySummaryFor(series: AssemblyVerificationTelemetryPoint[] | undefined, metric: AssemblyVerificationTelemetryMetric) {
  const values = (series ?? []).map((point) => point[metric]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) return undefined;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  return { min: Number(min.toFixed(1)), mean: Number(mean.toFixed(1)), max: Number(max.toFixed(1)), count: values.length };
}

export function assemblyVerificationTelemetryAnalysisFor(series: AssemblyVerificationTelemetryPoint[] | undefined): AssemblyVerificationTelemetryAnalysis {
  const points = series ?? [];
  const timeBased = points.length > 0 && points.every((point) => point.elapsedSeconds !== undefined);
  const firstElapsed = points[0]?.elapsedSeconds;
  const lastElapsed = points.at(-1)?.elapsedSeconds;
  const analysis: AssemblyVerificationTelemetryAnalysis = {
    pointCount: points.length,
    timeBased,
    ...(timeBased && firstElapsed !== undefined && lastElapsed !== undefined ? { elapsedSeconds: Number(Math.max(0, lastElapsed - firstElapsed).toFixed(1)) } : {}),
    metrics: {}
  };
  const metrics: AssemblyVerificationTelemetryMetric[] = ["cpuTempC", "gpuTempC", "ambientTempC", "cpuFanRpm", "gpuFanRpm", "cpuUsagePercent", "gpuUsagePercent", "cpuClockMHz", "gpuClockMHz", "cpuPowerW", "gpuPowerW"];
  for (const metric of metrics) {
    const valuePoints = points.map((point) => ({ point, value: point[metric] })).filter((entry): entry is { point: AssemblyVerificationTelemetryPoint; value: number } => typeof entry.value === "number" && Number.isFinite(entry.value));
    if (valuePoints.length === 0) continue;
    const values = valuePoints.map((entry) => entry.value);
    const first = values[0];
    const last = values.at(-1)!;
    const delta = Number((last - first).toFixed(1));
    let positiveStepCount = 0;
    for (let index = 1; index < values.length; index += 1) if (values[index] > values[index - 1]) positiveStepCount += 1;
    const peak = valuePoints.reduce((best, entry) => entry.value > best.value ? entry : best, valuePoints[0]);
    const lastWindow = values.slice(-3);
    const timeSpanSeconds = timeBased && valuePoints[0].point.elapsedSeconds !== undefined && valuePoints.at(-1)?.point.elapsedSeconds !== undefined
      ? valuePoints.at(-1)!.point.elapsedSeconds! - valuePoints[0].point.elapsedSeconds!
      : undefined;
    analysis.metrics[metric] = {
      metric,
      sampleCount: values.length,
      first: Number(first.toFixed(1)),
      last: Number(last.toFixed(1)),
      mean: Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(1)),
      min: Number(Math.min(...values).toFixed(1)),
      max: Number(Math.max(...values).toFixed(1)),
      delta,
      trend: values.length < 2 ? "insufficient" : delta > 0 ? "rising" : delta < 0 ? "falling" : "unchanged",
      stepCount: Math.max(0, values.length - 1),
      positiveStepCount,
      ...(timeBased && peak.point.elapsedSeconds !== undefined ? { peakAtSeconds: Number(peak.point.elapsedSeconds.toFixed(1)) } : {}),
      ...(timeSpanSeconds !== undefined && timeSpanSeconds > 0 ? { ratePerMinute: Number((delta / (timeSpanSeconds / 60)).toFixed(2)) } : {}),
      ...(values.length >= 2 ? { lastStepDelta: Number((last - values[values.length - 2]).toFixed(1)) } : {}),
      ...(lastWindow.length >= 3 ? { finalWindowSpread: Number((Math.max(...lastWindow) - Math.min(...lastWindow)).toFixed(1)) } : {})
    };
  }
  return analysis;
}

function medianPositiveInterval(points: AssemblyVerificationTelemetryPoint[]) {
  const intervals = points.map((point, index) => {
    const previous = points[index - 1];
    return index === 0 || !previous || point.elapsedSeconds === undefined || previous.elapsedSeconds === undefined ? undefined : point.elapsedSeconds - previous.elapsedSeconds;
  }).filter((value): value is number => value !== undefined && value > 0).sort((left, right) => left - right);
  if (intervals.length === 0) return undefined;
  return intervals[Math.floor(intervals.length / 2)];
}

export function assemblyVerificationTelemetrySegmentsFor(series: AssemblyVerificationTelemetryPoint[] | undefined, gapToleranceSeconds?: number): AssemblyVerificationTelemetrySeriesSegment[] {
  const points = series ?? [];
  if (points.length === 0) return [];
  const baseInterval = medianPositiveInterval(points);
  const tolerance = gapToleranceSeconds ?? (baseInterval === undefined ? undefined : Math.max(1, baseInterval * 2));
  const segments: AssemblyVerificationTelemetrySeriesSegment[] = [{ index: 1, points: [points[0]] }];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const delta = previous.elapsedSeconds !== undefined && current.elapsedSeconds !== undefined ? current.elapsedSeconds - previous.elapsedSeconds : undefined;
    const nonMonotonic = delta !== undefined && delta <= 0;
    const gap = delta !== undefined && tolerance !== undefined && delta > tolerance;
    if (nonMonotonic || gap) {
      segments.push({ index: segments.length + 1, points: [current], breakBefore: nonMonotonic ? "non-monotonic" : "gap", ...(gap ? { gapBeforeSeconds: Number(delta!.toFixed(1)) } : {}) });
    } else {
      segments.at(-1)!.points.push(current);
    }
  }
  return segments;
}

function measurementContinuityFromUnknown(value: unknown, errors: string[]) {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !["continuous", "gapped", "unknown"].includes(String(value.status))) {
    errors.push("측정 시간축 연속성 형식이 올바르지 않습니다.");
    return undefined;
  }
  const integer = (raw: unknown, label: string, min: number, max: number) => {
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < min || raw > max) {
      errors.push(`${label}이 올바르지 않습니다.`);
      return undefined;
    }
    return raw;
  };
  const timestampCount = integer(value.timestampCount, "유효 timestamp 수", 0, 50_000);
  const unparsedTimestampCount = integer(value.unparsedTimestampCount, "해석하지 못한 timestamp 수", 0, 50_000);
  const gapCount = integer(value.gapCount, "측정 공백 수", 0, 50_000);
  const nonMonotonicCount = integer(value.nonMonotonicCount, "역순 timestamp 수", 0, 50_000);
  const estimatedMissingSamples = integer(value.estimatedMissingSamples, "예상 누락 샘플 수", 0, 50_000);
  const sampleIntervalSeconds = optionalRange(value.sampleIntervalSeconds, "평균 샘플 간격", 0, 172_800, errors);
  const observedDurationSeconds = optionalRange(value.observedDurationSeconds, "관찰 기간", 0, 172_800, errors);
  const largestGapSeconds = optionalRange(value.largestGapSeconds, "최대 측정 공백", 0, 172_800, errors);
  const gapToleranceSeconds = optionalRange(value.gapToleranceSeconds, "공백 판정 기준", 0, 172_800, errors);
  if (timestampCount === undefined || unparsedTimestampCount === undefined || gapCount === undefined || nonMonotonicCount === undefined || estimatedMissingSamples === undefined) return undefined;
  if (gapCount > Math.max(0, timestampCount - 1) || nonMonotonicCount > Math.max(0, timestampCount - 1) || largestGapSeconds !== undefined && largestGapSeconds > 0 && gapCount === 0) {
    errors.push("측정 시간축 연속성의 간격·공백 수가 서로 일치하지 않습니다.");
    return undefined;
  }
  return { status: value.status as AssemblyVerificationMeasurementContinuityStatus, timestampCount, unparsedTimestampCount, ...(sampleIntervalSeconds !== undefined ? { sampleIntervalSeconds } : {}), ...(observedDurationSeconds !== undefined ? { observedDurationSeconds } : {}), gapCount, ...(largestGapSeconds !== undefined ? { largestGapSeconds } : {}), nonMonotonicCount, estimatedMissingSamples, ...(gapToleranceSeconds !== undefined ? { gapToleranceSeconds } : {}) };
}

function measurementQualityFromUnknown(value: unknown, errors: string[]) {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !["complete", "partial", "review"].includes(String(value.status))) {
    errors.push("측정 입력 품질 형식이 올바르지 않습니다.");
    return undefined;
  }
  const requiredInteger = (raw: unknown, label: string, min: number, max: number) => {
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < min || raw > max) {
      errors.push(`${label}이 올바르지 않습니다.`);
      return undefined;
    }
    return raw;
  };
  const rowCount = requiredInteger(value.rowCount, "측정 행 수", 1, 50_000);
  const validSampleCount = requiredInteger(value.validSampleCount, "유효 샘플 수", 1, 50_000);
  const skippedRowCount = requiredInteger(value.skippedRowCount, "제외 행 수", 0, 50_000);
  const invalidValueCount = requiredInteger(value.invalidValueCount, "잘못된 셀 수", 0, 100_000);
  const recognizedCoreColumnCount = requiredInteger(value.recognizedCoreColumnCount, "기본 센서 열 수", 0, 5);
  const coreColumnCount = requiredInteger(value.coreColumnCount, "기본 센서 전체 열 수", 5, 5);
  const telemetryColumnCount = requiredInteger(value.telemetryColumnCount, "추가 센서 열 수", 0, 6);
  const seriesPointCount = requiredInteger(value.seriesPointCount, "시계열 포인트 수", 1, ASSEMBLY_VERIFICATION_TELEMETRY_POINT_LIMIT);
  const continuity = measurementContinuityFromUnknown(value.continuity, errors);
  const hasTimeAxis = value.hasTimeAxis;
  if (typeof hasTimeAxis !== "boolean") errors.push("측정 시간축 여부가 올바르지 않습니다.");
  if (rowCount === undefined || validSampleCount === undefined || skippedRowCount === undefined || invalidValueCount === undefined || recognizedCoreColumnCount === undefined || coreColumnCount === undefined || telemetryColumnCount === undefined || seriesPointCount === undefined) return undefined;
  if (typeof hasTimeAxis !== "boolean") return undefined;
  if (validSampleCount + skippedRowCount !== rowCount || recognizedCoreColumnCount > coreColumnCount || seriesPointCount > validSampleCount) {
    errors.push("측정 입력 품질의 행·열·시계열 수가 서로 일치하지 않습니다.");
    return undefined;
  }
  return { status: value.status as AssemblyVerificationMeasurementQualityStatus, rowCount, validSampleCount, skippedRowCount, invalidValueCount, recognizedCoreColumnCount, coreColumnCount, telemetryColumnCount, hasTimeAxis, seriesPointCount, ...(continuity ? { continuity } : {}) };
}

export function assemblyVerificationProgressFor(log: AssemblyVerificationLog): AssemblyVerificationProgress {
  const entries = ASSEMBLY_VERIFICATION_CHECKS.map((check) => log.checks[check.id]);
  const checked = entries.filter((entry) => entry.status !== "unchecked").length;
  const passed = entries.filter((entry) => entry.status === "pass").length;
  const failed = entries.filter((entry) => entry.status === "fail").length;
  const total = entries.length;
  return { total, checked, passed, failed, remaining: total - checked, percent: total === 0 ? 0 : Math.round((checked / total) * 100) };
}

export function assemblyVerificationStateFor(log: AssemblyVerificationLog): AssemblyVerificationState {
  const progress = assemblyVerificationProgressFor(log);
  if (progress.failed > 0) return "failed";
  if (progress.checked === progress.total && progress.total > 0) return "passed";
  return progress.checked > 0 ? "in_progress" : "not_started";
}

export function assemblyVerificationSavedSnapshotFor(log: AssemblyVerificationLog): AssemblyVerificationSavedSnapshot {
  const progress = assemblyVerificationProgressFor(log);
  const state = assemblyVerificationStateFor(log);
  return {
    type: "pc-supporter-assembly-verification-summary",
    schemaVersion: 1,
    state,
    total: progress.total,
    checked: progress.checked,
    passed: progress.passed,
    failed: progress.failed,
    checks: Object.fromEntries(ASSEMBLY_VERIFICATION_CHECKS.map((check) => [check.id, log.checks[check.id].status])) as Record<AssemblyVerificationCheckId, AssemblyVerificationCheckStatus>,
    loadTool: log.loadTool,
    loadScenario: log.loadScenario,
    ...(log.testDurationMinutes !== undefined ? { testDurationMinutes: log.testDurationMinutes } : {}),
    ...(log.ambientTempC !== undefined ? { ambientTempC: log.ambientTempC } : {}),
    ...(log.cpuMaxTempC !== undefined ? { cpuMaxTempC: log.cpuMaxTempC } : {}),
    ...(log.gpuMaxTempC !== undefined ? { gpuMaxTempC: log.gpuMaxTempC } : {}),
    ...(log.cpuFanRpm !== undefined ? { cpuFanRpm: log.cpuFanRpm } : {}),
    ...(log.gpuFanRpm !== undefined ? { gpuFanRpm: log.gpuFanRpm } : {}),
    noiseLevel: log.noiseLevel,
    ...(log.measurementSource ? { measurementSource: log.measurementSource } : {}),
    ...(log.measurementSourceLabel ? { measurementSourceLabel: log.measurementSourceLabel } : {}),
    ...(log.measurementSampleCount !== undefined ? { measurementSampleCount: log.measurementSampleCount } : {}),
    ...(log.measurementImportedAt ? { measurementImportedAt: log.measurementImportedAt } : {}),
    ...(log.measurementSeries && log.measurementSeries.length > 0 ? { measurementSeriesPointCount: log.measurementSeries.length } : {}),
    ...(log.measurementQuality ? { measurementQuality: log.measurementQuality } : {}),
    updatedAt: log.updatedAt,
    ...(log.runId ? { runId: log.runId } : {}),
    ...(log.runLabel ? { runLabel: log.runLabel } : {}),
    ...(log.createdAt ? { createdAt: log.createdAt } : {})
  };
}

export function assemblyVerificationSavedHistoryFor(history: AssemblyVerificationHistory) {
  return history.runs.slice(-ASSEMBLY_VERIFICATION_HISTORY_LIMIT).map(assemblyVerificationSavedSnapshotFor);
}

export function assemblyVerificationTrendFor(history: AssemblyVerificationHistory): AssemblyVerificationTrendPoint[] {
  return history.runs.map((run, index) => {
    const progress = assemblyVerificationProgressFor(run);
    return {
      index: index + 1,
      runId: run.runId ?? `run-${index + 1}`,
      runLabel: run.runLabel ?? `조립 검증 ${index + 1}회차`,
      state: assemblyVerificationStateFor(run),
      checked: progress.checked,
      total: progress.total,
      loadTool: run.loadTool,
      loadScenario: run.loadScenario,
      ...(run.cpuMaxTempC !== undefined ? { cpuMaxTempC: run.cpuMaxTempC } : {}),
      ...(run.gpuMaxTempC !== undefined ? { gpuMaxTempC: run.gpuMaxTempC } : {}),
      ...(run.ambientTempC !== undefined ? { ambientTempC: run.ambientTempC } : {}),
      ...(run.testDurationMinutes !== undefined ? { testDurationMinutes: run.testDurationMinutes } : {}),
      ...(run.cpuFanRpm !== undefined ? { cpuFanRpm: run.cpuFanRpm } : {}),
      ...(run.gpuFanRpm !== undefined ? { gpuFanRpm: run.gpuFanRpm } : {}),
      noiseLevel: run.noiseLevel,
      ...(run.measurementSource ? { measurementSource: run.measurementSource } : {}),
      ...(run.measurementSampleCount !== undefined ? { measurementSampleCount: run.measurementSampleCount } : {}),
      ...(run.measurementQuality ? { measurementQualityStatus: run.measurementQuality.status } : {}),
      ...(run.measurementQuality?.continuity ? { measurementContinuityStatus: run.measurementQuality.continuity.status } : {})
    };
  });
}

export function assemblyVerificationConditionKeyFor(run: AssemblyVerificationLog | AssemblyVerificationTrendPoint) {
  if (run.loadTool === "not_recorded" || run.loadScenario === "not_recorded" || run.testDurationMinutes === undefined) return undefined;
  return `${run.loadTool}:${run.loadScenario}:${run.testDurationMinutes}`;
}

function ambientAdjustedTemperatureFor(temperature: number | undefined, ambient: number | undefined) {
  return temperature !== undefined && ambient !== undefined ? Number((temperature - ambient).toFixed(1)) : undefined;
}

function deltaFor(current: number | undefined, previous: number | undefined) {
  return current !== undefined && previous !== undefined ? Number((current - previous).toFixed(1)) : undefined;
}

function measurementComparisonBlockReasonFor(point: AssemblyVerificationTrendPoint, previous: AssemblyVerificationTrendPoint | undefined) {
  if (point.measurementContinuityStatus === "gapped" || previous?.measurementContinuityStatus === "gapped") return "measurement-continuity-gapped" as const;
  if (point.measurementQualityStatus === "review" || previous?.measurementQualityStatus === "review") return "measurement-quality-review" as const;
  return undefined;
}

export function assemblyVerificationComparisonFor(history: AssemblyVerificationHistory, filter: AssemblyVerificationComparisonFilter, referenceRunId = history.activeRunId): AssemblyVerificationComparison {
  const trend = assemblyVerificationTrendFor(history);
  const reference = trend.find((point) => point.runId === referenceRunId) ?? trend.at(-1);
  const referenceConditionKey = reference ? assemblyVerificationConditionKeyFor(reference) : undefined;
  if (filter === "same-load" && referenceConditionKey === undefined) return { filter, points: [], ...(reference ? { referenceRunId: reference.runId } : {}), reason: "reference-condition-missing" };
  const filtered = filter === "same-load" ? trend.filter((point) => assemblyVerificationConditionKeyFor(point) === referenceConditionKey) : trend;
  if (filter === "same-load" && filtered.length === 0) return { filter, points: [], ...(reference ? { referenceRunId: reference.runId } : {}), ...(referenceConditionKey ? { conditionKey: referenceConditionKey } : {}), reason: "no-matching-condition" };
  const points = filtered.map((point, index) => {
    const previous = filtered[index - 1];
    const conditionKey = assemblyVerificationConditionKeyFor(point);
    const previousConditionKey = previous ? assemblyVerificationConditionKeyFor(previous) : undefined;
    const conditionBlockReason = previous ? !conditionKey || !previousConditionKey ? "condition-missing" as const : conditionKey !== previousConditionKey ? "condition-changed" as const : undefined : undefined;
    const measurementBlockReason = previous ? measurementComparisonBlockReasonFor(point, previous) : undefined;
    const comparisonBlockReason = conditionBlockReason ?? measurementBlockReason;
    const comparableToPrevious = Boolean(previous && !comparisonBlockReason);
    const cpuAmbientAdjustedC = ambientAdjustedTemperatureFor(point.cpuMaxTempC, point.ambientTempC);
    const gpuAmbientAdjustedC = ambientAdjustedTemperatureFor(point.gpuMaxTempC, point.ambientTempC);
    const previousCpuAmbientAdjustedC = previous ? ambientAdjustedTemperatureFor(previous.cpuMaxTempC, previous.ambientTempC) : undefined;
    const previousGpuAmbientAdjustedC = previous ? ambientAdjustedTemperatureFor(previous.gpuMaxTempC, previous.ambientTempC) : undefined;
    return {
      ...point,
      ...(conditionKey ? { conditionKey } : {}),
      ...(cpuAmbientAdjustedC !== undefined ? { cpuAmbientAdjustedC } : {}),
      ...(gpuAmbientAdjustedC !== undefined ? { gpuAmbientAdjustedC } : {}),
      ...(previous ? {
        comparableToPrevious,
        ...(comparisonBlockReason ? { comparisonBlockReason } : {}),
        ...(comparableToPrevious ? {
        ...(deltaFor(point.cpuMaxTempC, previous.cpuMaxTempC) !== undefined ? { cpuDeltaC: deltaFor(point.cpuMaxTempC, previous.cpuMaxTempC) } : {}),
        ...(deltaFor(point.gpuMaxTempC, previous.gpuMaxTempC) !== undefined ? { gpuDeltaC: deltaFor(point.gpuMaxTempC, previous.gpuMaxTempC) } : {}),
        ...(deltaFor(cpuAmbientAdjustedC, previousCpuAmbientAdjustedC) !== undefined ? { cpuAmbientAdjustedDeltaC: deltaFor(cpuAmbientAdjustedC, previousCpuAmbientAdjustedC) } : {}),
        ...(deltaFor(gpuAmbientAdjustedC, previousGpuAmbientAdjustedC) !== undefined ? { gpuAmbientAdjustedDeltaC: deltaFor(gpuAmbientAdjustedC, previousGpuAmbientAdjustedC) } : {}),
        ...(deltaFor(point.cpuFanRpm, previous.cpuFanRpm) !== undefined ? { cpuFanRpmDelta: deltaFor(point.cpuFanRpm, previous.cpuFanRpm) } : {}),
        ...(deltaFor(point.gpuFanRpm, previous.gpuFanRpm) !== undefined ? { gpuFanRpmDelta: deltaFor(point.gpuFanRpm, previous.gpuFanRpm) } : {})
        } : {})
      } : {})
    };
  });
  return { filter, points, ...(reference ? { referenceRunId: reference.runId } : {}), ...(referenceConditionKey ? { conditionKey: referenceConditionKey } : {}) };
}

function consecutiveRiseSignal(points: AssemblyVerificationComparisonPoint[], deltaForPoint: (point: AssemblyVerificationComparisonPoint) => number | undefined) {
  let streak = 0;
  const runIds: string[] = [];
  for (const point of points) {
    const delta = deltaForPoint(point);
    if (point.comparableToPrevious && delta !== undefined && delta > 0) {
      streak += 1;
      runIds.push(point.runId);
      if (streak >= 2) return runIds.slice(-2);
    } else {
      streak = 0;
      runIds.length = 0;
    }
  }
  return undefined;
}

function noiseRank(value: AssemblyVerificationNoiseLevel) {
  return value === "quiet" ? 1 : value === "normal" ? 2 : value === "loud" ? 3 : 0;
}

export function assemblyVerificationRecheckSignalsFor(comparison: AssemblyVerificationComparison): AssemblyVerificationRecheckSignal[] {
  const signals: AssemblyVerificationRecheckSignal[] = [];
  const points = comparison.points;
  const cpuTemperatureRunIds = consecutiveRiseSignal(points, (point) => point.cpuAmbientAdjustedDeltaC ?? point.cpuDeltaC);
  if (cpuTemperatureRunIds) signals.push({ id: "cpu-temperature-rise", level: "notice", title: "CPU 온도 상승 추세", summary: "동일 조건에서 CPU 온도가 2회 연속 상승했습니다.", evidence: "주변 온도 보정값을 우선 사용하고, 보정값이 없으면 원시 최고 온도를 비교했습니다.", runIds: cpuTemperatureRunIds });
  const gpuTemperatureRunIds = consecutiveRiseSignal(points, (point) => point.gpuAmbientAdjustedDeltaC ?? point.gpuDeltaC);
  if (gpuTemperatureRunIds) signals.push({ id: "gpu-temperature-rise", level: "notice", title: "GPU 온도 상승 추세", summary: "동일 조건에서 GPU 온도가 2회 연속 상승했습니다.", evidence: "주변 온도 보정값을 우선 사용하고, 보정값이 없으면 원시 최고 온도를 비교했습니다.", runIds: gpuTemperatureRunIds });
  const cpuFanRunIds = consecutiveRiseSignal(points, (point) => point.cpuFanRpmDelta);
  const gpuFanRunIds = consecutiveRiseSignal(points, (point) => point.gpuFanRpmDelta);
  if (cpuFanRunIds || gpuFanRunIds) signals.push({ id: "fan-rpm-rise", level: "notice", title: "팬 RPM 상승 추세", summary: "동일 조건에서 CPU 또는 GPU 팬 RPM이 2회 연속 상승했습니다.", evidence: [cpuFanRunIds ? "CPU RPM" : undefined, gpuFanRunIds ? "GPU RPM" : undefined].filter(Boolean).join(" · "), runIds: [...new Set([...(cpuFanRunIds ?? []), ...(gpuFanRunIds ?? [])])] });
  let noiseStreak = 0;
  const noiseRunIds: string[] = [];
  points.forEach((point, index) => {
    const previous = points[index - 1];
    if (previous && point.comparableToPrevious && noiseRank(point.noiseLevel) > noiseRank(previous.noiseLevel) && noiseRank(point.noiseLevel) > 0) {
      noiseStreak += 1;
      noiseRunIds.push(point.runId);
    } else {
      noiseStreak = 0;
      noiseRunIds.length = 0;
    }
  });
  if (noiseStreak >= 2) signals.push({ id: "noise-rise", level: "notice", title: "소음 상승 추세", summary: "동일 조건에서 기록된 체감 소음이 2회 연속 커졌습니다.", evidence: "정량 소음계가 아닌 사용자가 기록한 소음 단계의 순서를 비교했습니다.", runIds: noiseRunIds.slice(-2) });
  if (comparison.filter === "all" && points.length > 1 && points.some((point) => assemblyVerificationConditionKeyFor(point) === undefined)) signals.push({ id: "condition-incomplete", level: "notice", title: "비교 조건 미완성", summary: "일부 회차에 도구·시나리오·테스트 시간이 없어 변화량 비교에서 제외될 수 있습니다.", evidence: "조건이 기록된 동일 회차만 변화량을 계산합니다.", runIds: points.filter((point) => assemblyVerificationConditionKeyFor(point) === undefined).map((point) => point.runId).slice(-3) });
  const qualityRunIds = points.filter((point) => point.comparisonBlockReason === "measurement-quality-review" || point.comparisonBlockReason === "measurement-continuity-gapped").map((point) => point.runId);
  if (qualityRunIds.length > 0) signals.push({ id: "measurement-quality-review", level: "notice", title: "측정 품질 재확인", summary: "측정 품질 또는 시간축 공백 때문에 일부 회차의 델타·신호 비교를 제외했습니다.", evidence: "공백·역순 timestamp나 오류 셀이 있는 회차는 정상 연속 측정으로 간주하지 않습니다.", runIds: qualityRunIds.slice(-3) });
  return signals;
}

export function assemblyVerificationHistoryJsonFor(history: AssemblyVerificationHistory) {
  return JSON.stringify(history, null, 2);
}

export function withAssemblyVerificationCheck(log: AssemblyVerificationLog, id: AssemblyVerificationCheckId, status: AssemblyVerificationCheckStatus, note = "") {
  const normalizedNote = note.trim();
  return {
    ...log,
    updatedAt: nowIso(),
    checks: {
      ...log.checks,
      [id]: { status, ...(normalizedNote ? { note: normalizedNote } : {}) }
    }
  } satisfies AssemblyVerificationLog;
}

function optionalTemperature(value: unknown, label: string, errors: string[]) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 150) {
    errors.push(`${label}은 0~150°C 사이의 숫자여야 합니다.`);
    return undefined;
  }
  return parsed;
}

function optionalRange(value: unknown, label: string, min: number, max: number, errors: string[], integer = false) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || integer && !Number.isInteger(parsed)) {
    errors.push(`${label}은 ${min}~${max}${integer ? " 사이의 정수" : " 사이의 숫자"}여야 합니다.`);
    return undefined;
  }
  return parsed;
}

export function withAssemblyVerificationMeasurements(log: AssemblyVerificationLog, values: { cpuMaxTempC?: unknown; gpuMaxTempC?: unknown; noiseLevel?: unknown; loadTool?: unknown; loadScenario?: unknown; testDurationMinutes?: unknown; ambientTempC?: unknown; cpuFanRpm?: unknown; gpuFanRpm?: unknown; note?: unknown; measurementSource?: unknown; measurementSourceLabel?: unknown; measurementSampleCount?: unknown; measurementImportedAt?: unknown; measurementSeries?: unknown; measurementQuality?: unknown }): AssemblyVerificationParseResult {
  const errors: string[] = [];
  const cpuMaxTempC = optionalTemperature(values.cpuMaxTempC, "CPU 최고 온도", errors);
  const gpuMaxTempC = optionalTemperature(values.gpuMaxTempC, "GPU 최고 온도", errors);
  const noiseLevel = values.noiseLevel === undefined || values.noiseLevel === "" ? log.noiseLevel : values.noiseLevel;
  if (!NOISE_LEVELS.has(noiseLevel as AssemblyVerificationNoiseLevel)) errors.push("소음 수준 값이 올바르지 않습니다.");
  const loadTool = values.loadTool === undefined || values.loadTool === "" ? log.loadTool : values.loadTool;
  const loadScenario = values.loadScenario === undefined || values.loadScenario === "" ? log.loadScenario : values.loadScenario;
  if (!LOAD_TOOLS.has(loadTool as AssemblyVerificationLoadTool)) errors.push("부하 도구 값이 올바르지 않습니다.");
  if (!LOAD_SCENARIOS.has(loadScenario as AssemblyVerificationLoadScenario)) errors.push("부하 시나리오 값이 올바르지 않습니다.");
  const testDurationMinutes = optionalRange(values.testDurationMinutes, "테스트 시간", 1, 1_440, errors, true);
  const ambientTempC = optionalRange(values.ambientTempC, "주변 온도", 0, 60, errors);
  const cpuFanRpm = optionalRange(values.cpuFanRpm, "CPU 팬 RPM", 0, 30_000, errors, true);
  const gpuFanRpm = optionalRange(values.gpuFanRpm, "GPU 팬 RPM", 0, 30_000, errors, true);
  const note = values.note === undefined ? log.note : typeof values.note === "string" ? values.note.trim() : "";
  if (note && note.length > 1_000) errors.push("조립 검증 메모는 1,000자 이하로 입력해야 합니다.");
  const measurementSource = values.measurementSource === undefined ? log.measurementSource : values.measurementSource;
  if (measurementSource !== undefined && !["manual", "csv"].includes(String(measurementSource))) errors.push("측정값 출처가 올바르지 않습니다.");
  const measurementSourceLabel = values.measurementSourceLabel === undefined ? log.measurementSourceLabel : typeof values.measurementSourceLabel === "string" ? values.measurementSourceLabel.trim() : "";
  if (measurementSourceLabel !== undefined && (measurementSourceLabel.trim().length === 0 || measurementSourceLabel.length > 160)) errors.push("측정값 출처 이름은 공백이 아닌 160자 이하이어야 합니다.");
  const measurementSampleCount = optionalRange(values.measurementSampleCount, "측정 샘플 수", 1, 50_000, errors, true);
  const measurementImportedAt = values.measurementImportedAt === undefined ? log.measurementImportedAt : typeof values.measurementImportedAt === "string" ? values.measurementImportedAt.trim() : "";
  if (measurementImportedAt !== undefined && measurementImportedAt.length > 120) errors.push("측정값 가져오기 시각이 올바르지 않습니다.");
  const measurementSeries = values.measurementSeries === undefined ? log.measurementSeries : telemetrySeriesFromUnknown(values.measurementSeries, errors);
  const measurementQuality = values.measurementQuality === undefined ? log.measurementQuality : measurementQualityFromUnknown(values.measurementQuality, errors);
  if (errors.length > 0) return { errors };
  const nextLog: AssemblyVerificationLog = {
    ...log,
    updatedAt: nowIso(),
    ...(cpuMaxTempC !== undefined ? { cpuMaxTempC } : { cpuMaxTempC: undefined }),
    ...(gpuMaxTempC !== undefined ? { gpuMaxTempC } : { gpuMaxTempC: undefined }),
    noiseLevel: noiseLevel as AssemblyVerificationNoiseLevel,
    loadTool: loadTool as AssemblyVerificationLoadTool,
    loadScenario: loadScenario as AssemblyVerificationLoadScenario,
    ...(testDurationMinutes !== undefined ? { testDurationMinutes } : { testDurationMinutes: undefined }),
    ...(ambientTempC !== undefined ? { ambientTempC } : { ambientTempC: undefined }),
    ...(cpuFanRpm !== undefined ? { cpuFanRpm } : { cpuFanRpm: undefined }),
    ...(gpuFanRpm !== undefined ? { gpuFanRpm } : { gpuFanRpm: undefined }),
    ...(measurementSource !== undefined ? { measurementSource: measurementSource as AssemblyVerificationMeasurementSource } : { measurementSource: undefined }),
    ...(measurementSource === "csv" && measurementSourceLabel ? { measurementSourceLabel } : { measurementSourceLabel: undefined }),
    ...(measurementSource === "csv" && measurementSampleCount !== undefined ? { measurementSampleCount } : { measurementSampleCount: undefined }),
    ...(measurementSource === "csv" && measurementImportedAt ? { measurementImportedAt } : { measurementImportedAt: undefined }),
    ...(measurementSource === "csv" && measurementSeries ? { measurementSeries } : { measurementSeries: undefined }),
    ...(measurementSource === "csv" && measurementQuality ? { measurementQuality } : { measurementQuality: undefined })
  };
  if (note) nextLog.note = note;
  else delete nextLog.note;
  return {
    log: nextLog,
    errors
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function assemblyVerificationSavedSnapshotFromUnknown(value: unknown): AssemblyVerificationSavedSnapshot | undefined {
  if (!isRecord(value) || value.type !== "pc-supporter-assembly-verification-summary" || value.schemaVersion !== 1) return undefined;
  const states = new Set<AssemblyVerificationState>(["not_started", "in_progress", "passed", "failed"]);
  if (!states.has(value.state as AssemblyVerificationState) || !NOISE_LEVELS.has(value.noiseLevel as AssemblyVerificationNoiseLevel) || !LOAD_TOOLS.has(value.loadTool as AssemblyVerificationLoadTool) || !LOAD_SCENARIOS.has(value.loadScenario as AssemblyVerificationLoadScenario)) return undefined;
  if (!isRecord(value.checks) || typeof value.updatedAt !== "string" || value.updatedAt.length === 0 || value.updatedAt.length > 120) return undefined;
  const checks = {} as Record<AssemblyVerificationCheckId, AssemblyVerificationCheckStatus>;
  for (const definition of ASSEMBLY_VERIFICATION_CHECKS) {
    const status = value.checks[definition.id];
    if (!["unchecked", "pass", "fail"].includes(String(status))) return undefined;
    checks[definition.id] = status as AssemblyVerificationCheckStatus;
  }
  const total = value.total;
  const checked = value.checked;
  const passed = value.passed;
  const failed = value.failed;
  if (typeof total !== "number" || !Number.isInteger(total) || total < 0 || typeof checked !== "number" || !Number.isInteger(checked) || checked < 0 || typeof passed !== "number" || !Number.isInteger(passed) || passed < 0 || typeof failed !== "number" || !Number.isInteger(failed) || failed < 0) return undefined;
  if (total !== ASSEMBLY_VERIFICATION_CHECKS.length || checked !== passed + failed || checked > total || passed !== Object.values(checks).filter((status) => status === "pass").length || failed !== Object.values(checks).filter((status) => status === "fail").length) return undefined;
  const errors: string[] = [];
  const cpuMaxTempC = optionalTemperature(value.cpuMaxTempC, "CPU 최고 온도", errors);
  const gpuMaxTempC = optionalTemperature(value.gpuMaxTempC, "GPU 최고 온도", errors);
  const testDurationMinutes = optionalRange(value.testDurationMinutes, "테스트 시간", 1, 1_440, errors, true);
  const ambientTempC = optionalRange(value.ambientTempC, "주변 온도", 0, 60, errors);
  const cpuFanRpm = optionalRange(value.cpuFanRpm, "CPU 팬 RPM", 0, 30_000, errors, true);
  const gpuFanRpm = optionalRange(value.gpuFanRpm, "GPU 팬 RPM", 0, 30_000, errors, true);
  const measurementSource = value.measurementSource;
  if (measurementSource !== undefined && !["manual", "csv"].includes(String(measurementSource))) return undefined;
  const measurementSourceLabel = value.measurementSourceLabel;
  if (measurementSourceLabel !== undefined && (typeof measurementSourceLabel !== "string" || measurementSourceLabel.trim().length === 0 || measurementSourceLabel.length > 160)) return undefined;
  const measurementSampleCount = optionalRange(value.measurementSampleCount, "측정 샘플 수", 1, 50_000, errors, true);
  const measurementSeriesPointCount = optionalRange(value.measurementSeriesPointCount, "측정 시계열 포인트 수", 1, ASSEMBLY_VERIFICATION_TELEMETRY_POINT_LIMIT, errors, true);
  const measurementQuality = measurementQualityFromUnknown(value.measurementQuality, errors);
  const measurementImportedAt = value.measurementImportedAt;
  if (measurementImportedAt !== undefined && (typeof measurementImportedAt !== "string" || measurementImportedAt.length === 0 || measurementImportedAt.length > 120)) return undefined;
  if (errors.length > 0) return undefined;
  return {
    type: "pc-supporter-assembly-verification-summary",
    schemaVersion: 1,
    state: value.state as AssemblyVerificationState,
    total,
    checked,
    passed,
    failed,
    checks,
    loadTool: value.loadTool as AssemblyVerificationLoadTool,
    loadScenario: value.loadScenario as AssemblyVerificationLoadScenario,
    ...(testDurationMinutes !== undefined ? { testDurationMinutes } : {}),
    ...(ambientTempC !== undefined ? { ambientTempC } : {}),
    ...(cpuMaxTempC !== undefined ? { cpuMaxTempC } : {}),
    ...(gpuMaxTempC !== undefined ? { gpuMaxTempC } : {}),
    ...(cpuFanRpm !== undefined ? { cpuFanRpm } : {}),
    ...(gpuFanRpm !== undefined ? { gpuFanRpm } : {}),
    noiseLevel: value.noiseLevel as AssemblyVerificationNoiseLevel,
    ...(measurementSource !== undefined ? { measurementSource: measurementSource as AssemblyVerificationMeasurementSource } : {}),
    ...(typeof measurementSourceLabel === "string" ? { measurementSourceLabel } : {}),
    ...(measurementSampleCount !== undefined ? { measurementSampleCount } : {}),
    ...(measurementSeriesPointCount !== undefined ? { measurementSeriesPointCount } : {}),
    ...(measurementQuality ? { measurementQuality } : {}),
    ...(typeof measurementImportedAt === "string" ? { measurementImportedAt } : {}),
    updatedAt: value.updatedAt,
    ...(typeof value.runId === "string" && value.runId.length > 0 && value.runId.length <= 120 ? { runId: value.runId } : {}),
    ...(typeof value.runLabel === "string" && value.runLabel.length > 0 && value.runLabel.length <= 160 ? { runLabel: value.runLabel } : {}),
    ...(typeof value.createdAt === "string" && value.createdAt.length > 0 && value.createdAt.length <= 120 ? { createdAt: value.createdAt } : {})
  };
}

export function assemblyVerificationSavedHistoryFromUnknown(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const parsed = value.slice(-ASSEMBLY_VERIFICATION_HISTORY_LIMIT).map(assemblyVerificationSavedSnapshotFromUnknown);
  return parsed.every((item): item is AssemblyVerificationSavedSnapshot => Boolean(item)) ? parsed : undefined;
}

export function parseAssemblyVerificationJson(input: string, expectedBuildFingerprint: string): AssemblyVerificationParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return { errors: ["조립 검증 로그 JSON 형식이 올바르지 않습니다."] };
  }
  if (!isRecord(parsed)) return { errors: ["조립 검증 로그 JSON은 객체여야 합니다."] };
  if (parsed.type !== "pc-supporter-assembly-verification" || parsed.schemaVersion !== 1) return { errors: ["지원하지 않는 조립 검증 로그 버전입니다."] };
  if (typeof parsed.buildFingerprint !== "string" || parsed.buildFingerprint.length === 0 || parsed.buildFingerprint.length > 5_000) return { errors: ["조립 검증 로그의 견적 fingerprint가 올바르지 않습니다."] };
  if (parsed.buildFingerprint !== expectedBuildFingerprint) return { errors: ["현재 견적과 다른 조립 검증 로그입니다. 같은 견적에서 내보낸 JSON만 가져올 수 있습니다."] };
  if (typeof parsed.updatedAt !== "string" || parsed.updatedAt.length === 0 || parsed.updatedAt.length > 120) return { errors: ["조립 검증 로그의 갱신 시각이 올바르지 않습니다."] };
  if (!isRecord(parsed.checks)) return { errors: ["조립 검증 로그의 checks 형식이 올바르지 않습니다."] };

  const errors: string[] = [];
  const checks = emptyChecks();
  for (const [rawId, rawEntry] of Object.entries(parsed.checks)) {
    if (!CHECK_IDS.has(rawId as AssemblyVerificationCheckId)) continue;
    if (!isRecord(rawEntry) || !["unchecked", "pass", "fail"].includes(String(rawEntry.status))) {
      errors.push(`${rawId} 상태가 올바르지 않습니다.`);
      continue;
    }
    const note = rawEntry.note;
    if (note !== undefined && (typeof note !== "string" || note.length > 500)) {
      errors.push(`${rawId} 메모는 문자열 500자 이하이어야 합니다.`);
      continue;
    }
    checks[rawId as AssemblyVerificationCheckId] = { status: rawEntry.status as AssemblyVerificationCheckStatus, ...(typeof note === "string" && note.trim() ? { note: note.trim() } : {}) };
  }
  const cpuMaxTempC = optionalTemperature(parsed.cpuMaxTempC, "CPU 최고 온도", errors);
  const gpuMaxTempC = optionalTemperature(parsed.gpuMaxTempC, "GPU 최고 온도", errors);
  const noiseLevel = parsed.noiseLevel ?? "not_recorded";
  if (!NOISE_LEVELS.has(noiseLevel as AssemblyVerificationNoiseLevel)) errors.push("소음 수준 값이 올바르지 않습니다.");
  const loadTool = parsed.loadTool ?? "not_recorded";
  const loadScenario = parsed.loadScenario ?? "not_recorded";
  if (!LOAD_TOOLS.has(loadTool as AssemblyVerificationLoadTool)) errors.push("부하 도구 값이 올바르지 않습니다.");
  if (!LOAD_SCENARIOS.has(loadScenario as AssemblyVerificationLoadScenario)) errors.push("부하 시나리오 값이 올바르지 않습니다.");
  const testDurationMinutes = optionalRange(parsed.testDurationMinutes, "테스트 시간", 1, 1_440, errors, true);
  const ambientTempC = optionalRange(parsed.ambientTempC, "주변 온도", 0, 60, errors);
  const cpuFanRpm = optionalRange(parsed.cpuFanRpm, "CPU 팬 RPM", 0, 30_000, errors, true);
  const gpuFanRpm = optionalRange(parsed.gpuFanRpm, "GPU 팬 RPM", 0, 30_000, errors, true);
  const measurementSource = parsed.measurementSource;
  if (measurementSource !== undefined && !["manual", "csv"].includes(String(measurementSource))) errors.push("측정값 출처가 올바르지 않습니다.");
  const measurementSourceLabel = parsed.measurementSourceLabel;
  if (measurementSourceLabel !== undefined && (typeof measurementSourceLabel !== "string" || measurementSourceLabel.trim().length === 0 || measurementSourceLabel.length > 160)) errors.push("측정값 출처 이름은 공백이 아닌 160자 이하의 문자열이어야 합니다.");
  const measurementSampleCount = optionalRange(parsed.measurementSampleCount, "측정 샘플 수", 1, 50_000, errors, true);
  const measurementImportedAt = parsed.measurementImportedAt;
  if (measurementImportedAt !== undefined && (typeof measurementImportedAt !== "string" || measurementImportedAt.length === 0 || measurementImportedAt.length > 120)) errors.push("측정값 가져오기 시각이 올바르지 않습니다.");
  const measurementSeries = telemetrySeriesFromUnknown(parsed.measurementSeries, errors);
  const measurementQuality = measurementQualityFromUnknown(parsed.measurementQuality, errors);
  const note = parsed.note;
  if (note !== undefined && (typeof note !== "string" || note.length > 1_000)) errors.push("조립 검증 메모는 문자열 1,000자 이하이어야 합니다.");
  if (errors.length > 0) return { errors };
  const runId = typeof parsed.runId === "string" && parsed.runId.length > 0 && parsed.runId.length <= 120 ? parsed.runId : `legacy-${parsed.updatedAt}`;
  const runLabel = typeof parsed.runLabel === "string" && parsed.runLabel.length > 0 && parsed.runLabel.length <= 160 ? parsed.runLabel : "기존 조립 검증";
  const createdAt = typeof parsed.createdAt === "string" && parsed.createdAt.length > 0 && parsed.createdAt.length <= 120 ? parsed.createdAt : parsed.updatedAt;
  return {
    log: {
      type: "pc-supporter-assembly-verification",
      schemaVersion: 1,
      buildFingerprint: expectedBuildFingerprint,
      updatedAt: parsed.updatedAt,
      checks,
      ...(cpuMaxTempC !== undefined ? { cpuMaxTempC } : {}),
      ...(gpuMaxTempC !== undefined ? { gpuMaxTempC } : {}),
      noiseLevel: noiseLevel as AssemblyVerificationNoiseLevel,
      loadTool: loadTool as AssemblyVerificationLoadTool,
      loadScenario: loadScenario as AssemblyVerificationLoadScenario,
      ...(testDurationMinutes !== undefined ? { testDurationMinutes } : {}),
      ...(ambientTempC !== undefined ? { ambientTempC } : {}),
      ...(cpuFanRpm !== undefined ? { cpuFanRpm } : {}),
      ...(gpuFanRpm !== undefined ? { gpuFanRpm } : {}),
      ...(measurementSource !== undefined ? { measurementSource: measurementSource as AssemblyVerificationMeasurementSource } : {}),
      ...(typeof measurementSourceLabel === "string" ? { measurementSourceLabel: measurementSourceLabel.trim() } : {}),
      ...(measurementSampleCount !== undefined ? { measurementSampleCount } : {}),
      ...(typeof measurementImportedAt === "string" ? { measurementImportedAt: measurementImportedAt.trim() } : {}),
      ...(measurementSeries ? { measurementSeries } : {}),
      ...(measurementQuality ? { measurementQuality } : {}),
      ...(typeof note === "string" && note.trim() ? { note: note.trim() } : {}),
      runId,
      runLabel,
      createdAt
    },
    errors
  };
}

export function assemblyVerificationJsonFor(log: AssemblyVerificationLog) {
  return JSON.stringify(log, null, 2);
}

export type AssemblyVerificationHistoryParseResult = {
  history?: AssemblyVerificationHistory;
  errors: string[];
};

export function parseAssemblyVerificationHistoryJson(input: string, expectedBuildFingerprint: string): AssemblyVerificationHistoryParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return { errors: ["조립 검증 이력 JSON 형식이 올바르지 않습니다."] };
  }
  if (!isRecord(parsed)) return { errors: ["조립 검증 이력 JSON은 객체여야 합니다."] };
  if (parsed.type === "pc-supporter-assembly-verification") {
    const legacy = parseAssemblyVerificationJson(input, expectedBuildFingerprint);
    if (legacy.errors.length > 0 || !legacy.log) return { errors: legacy.errors };
    return { history: { type: "pc-supporter-assembly-verification-history", schemaVersion: 1, buildFingerprint: expectedBuildFingerprint, updatedAt: legacy.log.updatedAt, activeRunId: legacy.log.runId!, runs: [legacy.log] }, errors: [] };
  }
  if (parsed.type !== "pc-supporter-assembly-verification-history" || parsed.schemaVersion !== 1) return { errors: ["지원하지 않는 조립 검증 이력 버전입니다."] };
  if (typeof parsed.buildFingerprint !== "string" || parsed.buildFingerprint.length === 0 || parsed.buildFingerprint.length > 5_000) return { errors: ["조립 검증 이력의 견적 fingerprint가 올바르지 않습니다."] };
  if (parsed.buildFingerprint !== expectedBuildFingerprint) return { errors: ["현재 견적과 다른 조립 검증 이력입니다. 같은 견적에서 내보낸 JSON만 가져올 수 있습니다."] };
  if (typeof parsed.updatedAt !== "string" || parsed.updatedAt.length === 0 || parsed.updatedAt.length > 120) return { errors: ["조립 검증 이력의 갱신 시각이 올바르지 않습니다."] };
  if (typeof parsed.activeRunId !== "string" || parsed.activeRunId.length === 0 || !Array.isArray(parsed.runs) || parsed.runs.length < 1 || parsed.runs.length > ASSEMBLY_VERIFICATION_HISTORY_LIMIT) return { errors: [`조립 검증 이력은 1~${ASSEMBLY_VERIFICATION_HISTORY_LIMIT}회차 배열이어야 합니다.`] };
  const runs: AssemblyVerificationLog[] = [];
  const errors: string[] = [];
  const seenRunIds = new Set<string>();
  parsed.runs.forEach((run, index) => {
    const parsedRun = parseAssemblyVerificationJson(JSON.stringify(run), expectedBuildFingerprint);
    if (parsedRun.errors.length > 0 || !parsedRun.log) {
      errors.push(`${index + 1}회차: ${parsedRun.errors.join(" ") || "로그를 읽을 수 없습니다."}`);
      return;
    }
    if (seenRunIds.has(parsedRun.log.runId!)) {
      errors.push(`${index + 1}회차: runId가 중복되었습니다.`);
      return;
    }
    seenRunIds.add(parsedRun.log.runId!);
    runs.push(parsedRun.log);
  });
  if (errors.length > 0) return { errors };
  if (!seenRunIds.has(parsed.activeRunId)) return { errors: ["activeRunId가 이력에 존재하지 않습니다."] };
  return { history: { type: "pc-supporter-assembly-verification-history", schemaVersion: 1, buildFingerprint: expectedBuildFingerprint, updatedAt: parsed.updatedAt, activeRunId: parsed.activeRunId, runs }, errors: [] };
}

export function assemblyVerificationStatusLabel(status: AssemblyVerificationCheckStatus) {
  return status === "pass" ? "통과" : status === "fail" ? "실패 확인" : "미확인";
}

export function assemblyVerificationStateLabel(state: AssemblyVerificationState) {
  return state === "passed" ? "실측 확인 완료" : state === "failed" ? "실패 항목 있음" : state === "in_progress" ? "확인 진행 중" : "아직 기록 없음";
}
