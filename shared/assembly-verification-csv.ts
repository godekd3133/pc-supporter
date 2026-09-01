import type { AssemblyVerificationMeasurementQuality, AssemblyVerificationTelemetryPoint } from "./assembly-verification";

export type AssemblyVerificationCsvMetric = "cpuMaxTempC" | "gpuMaxTempC" | "ambientTempC" | "cpuFanRpm" | "gpuFanRpm";
export type AssemblyVerificationCsvTelemetryMetric = "cpuUsagePercent" | "gpuUsagePercent" | "cpuClockMHz" | "gpuClockMHz" | "cpuPowerW" | "gpuPowerW";

export type AssemblyVerificationCsvValues = {
  cpuMaxTempC?: number;
  gpuMaxTempC?: number;
  ambientTempC?: number;
  cpuFanRpm?: number;
  gpuFanRpm?: number;
};

export type AssemblyVerificationCsvImport = {
  values: AssemblyVerificationCsvValues;
  headers: string[];
  detectedHeaders: Partial<Record<AssemblyVerificationCsvMetric, string>>;
  rowCount: number;
  sampleCount: number;
  skippedRowCount: number;
  invalidValueCount: number;
  missingMetrics: AssemblyVerificationCsvMetric[];
  warnings: string[];
  delimiter: "," | ";" | "\t";
  series: AssemblyVerificationTelemetryPoint[];
  timeColumn?: string;
  detectedTelemetryHeaders: Partial<Record<AssemblyVerificationCsvTelemetryMetric, string>>;
  telemetryColumnCount: number;
  quality: AssemblyVerificationMeasurementQuality;
};

export type AssemblyVerificationCsvParseResult = {
  import?: AssemblyVerificationCsvImport;
  errors: string[];
};

export const ASSEMBLY_VERIFICATION_CSV_METRIC_LABELS: Record<AssemblyVerificationCsvMetric, string> = {
  cpuMaxTempC: "CPU 최고 온도",
  gpuMaxTempC: "GPU 최고 온도",
  ambientTempC: "주변 온도",
  cpuFanRpm: "CPU 팬 RPM",
  gpuFanRpm: "GPU 팬 RPM"
};

export const ASSEMBLY_VERIFICATION_CSV_TELEMETRY_LABELS: Record<AssemblyVerificationCsvTelemetryMetric, string> = {
  cpuUsagePercent: "CPU 사용률",
  gpuUsagePercent: "GPU 사용률",
  cpuClockMHz: "CPU 클럭",
  gpuClockMHz: "GPU 클럭",
  cpuPowerW: "CPU 소비전력",
  gpuPowerW: "GPU 소비전력"
};

const MAX_CSV_BYTES = 5_000_000;
const MAX_CSV_ROWS = 50_000;
const TELEMETRY_SERIES_LIMIT = 240;

const TIME_ALIASES = ["timestamp", "date time", "datetime", "date", "time", "elapsed seconds", "elapsed time", "elapsed", "경과 시간", "측정 시간", "시간"];

type CsvRow = string[];

type MetricDefinition = {
  key: AssemblyVerificationCsvMetric;
  aliases: string[];
  aggregate: "max" | "mean";
  min: number;
  max: number;
};

type TelemetryDefinition = {
  key: AssemblyVerificationCsvTelemetryMetric;
  aliases: string[];
  min: number;
  max: number;
};

const METRIC_DEFINITIONS: MetricDefinition[] = [
  {
    key: "cpuMaxTempC",
    aliases: ["cpu package", "cpu package temperature", "cpu tctl tdie", "cpu die average", "cpu temperature", "cpu 최고 온도", "cpu 온도"],
    aggregate: "max",
    min: 0,
    max: 150
  },
  {
    key: "gpuMaxTempC",
    aliases: ["gpu temperature", "gpu core temperature", "gpu core", "gpu temp", "gpu 최고 온도", "gpu 온도"],
    aggregate: "max",
    min: 0,
    max: 150
  },
  {
    key: "ambientTempC",
    aliases: ["ambient temperature", "room temperature", "ambient", "주변 온도", "실내 온도"],
    aggregate: "mean",
    min: 0,
    max: 60
  },
  {
    key: "cpuFanRpm",
    aliases: ["cpu fan speed", "cpu fan rpm", "cpu fan", "cpu 팬 rpm", "cpu 팬"],
    aggregate: "max",
    min: 0,
    max: 30_000
  },
  {
    key: "gpuFanRpm",
    aliases: ["gpu fan speed", "gpu fan rpm", "gpu fan", "gpu 팬 rpm", "gpu 팬"],
    aggregate: "max",
    min: 0,
    max: 30_000
  }
];

const TELEMETRY_DEFINITIONS: TelemetryDefinition[] = [
  { key: "cpuUsagePercent", aliases: ["cpu total usage", "cpu utilization", "cpu usage", "cpu load", "cpu 사용률", "cpu 사용량"], min: 0, max: 100 },
  { key: "gpuUsagePercent", aliases: ["gpu utilization", "gpu usage", "gpu core load", "gpu load", "gpu 사용률", "gpu 사용량"], min: 0, max: 100 },
  { key: "cpuClockMHz", aliases: ["cpu effective clock", "cpu clock", "cpu clock speed", "cpu 클럭", "cpu 동작 클럭"], min: 0, max: 100_000 },
  { key: "gpuClockMHz", aliases: ["gpu core clock", "gpu clock", "gpu clock speed", "gpu 클럭", "gpu 동작 클럭"], min: 0, max: 100_000 },
  { key: "cpuPowerW", aliases: ["cpu package power", "cpu ppt", "cpu power", "cpu 소비전력", "cpu 전력"], min: 0, max: 5_000 },
  { key: "gpuPowerW", aliases: ["gpu board power", "gpu power", "gpu total board power", "gpu 소비전력", "gpu 전력"], min: 0, max: 5_000 }
];

function normalizeHeader(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[^a-z0-9가-힣]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function headerMatches(value: string, alias: string) {
  const normalizedValue = normalizeHeader(value);
  const normalizedAlias = normalizeHeader(alias);
  return normalizedValue === normalizedAlias || normalizedValue.endsWith(` ${normalizedAlias}`) || normalizedValue.includes(` ${normalizedAlias} `);
}

function delimiterFor(input: string): "," | ";" | "\t" {
  const firstLine = input.split(/\r?\n/, 1)[0] ?? "";
  const counts = ([",", ";", "\t"] as const).map((delimiter) => {
    let count = 0;
    let inQuotes = false;
    for (let index = 0; index < firstLine.length; index += 1) {
      const character = firstLine[index];
      if (character === '"') {
        if (inQuotes && firstLine[index + 1] === '"') index += 1;
        else inQuotes = !inQuotes;
      } else if (!inQuotes && character === delimiter) {
        count += 1;
      }
    }
    return { delimiter, count };
  });
  return counts.sort((left, right) => right.count - left.count)[0]?.delimiter ?? ",";
}

function parseCsvRows(input: string, delimiter: "," | ";" | "\t"): { rows: CsvRow[]; errors: string[] } {
  const rows: CsvRow[] = [];
  const errors: string[] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldStarted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (inQuotes) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
    } else if (character === delimiter) {
      row.push(field);
      field = "";
      fieldStarted = false;
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(field);
      field = "";
      fieldStarted = false;
      if (row.some((value) => value.trim().length > 0)) rows.push(row);
      row = [];
    } else {
      field += character;
      fieldStarted = true;
    }
  }
  if (inQuotes) errors.push("CSV 따옴표가 닫히지 않았습니다.");
  if (field.length > 0 || fieldStarted || row.length > 0) {
    row.push(field);
    if (row.some((value) => value.trim().length > 0)) rows.push(row);
  }
  if (rows.length > MAX_CSV_ROWS + 1) errors.push(`CSV는 헤더를 제외하고 최대 ${MAX_CSV_ROWS.toLocaleString("ko-KR")}행까지 가져올 수 있습니다.`);
  return { rows: rows.slice(0, MAX_CSV_ROWS + 1), errors };
}

function missingCell(value: string) {
  return /^(?:n\/a|na|null|none|--|-|미측정|측정 불가)$/i.test(value.trim());
}

function numberFromCell(value: string, delimiter: "," | ";" | "\t") {
  const trimmed = value.trim();
  if (!trimmed || missingCell(trimmed)) return undefined;
  let normalized = trimmed.replace(/\s+/g, "").replace(/(?:°C|℃|°F|RPM|MHz|W|%)/gi, "");
  if (delimiter === ";" && /^[-+]?\d+(?:,\d+)?$/.test(normalized)) normalized = normalized.replace(",", ".");
  else if (/^[-+]?\d{1,3}(?:,\d{3})+$/.test(normalized)) normalized = normalized.replaceAll(",", "");
  else if (normalized.includes(",") && !normalized.includes(".")) normalized = normalized.replace(",", ".");
  const match = normalized.match(/^[-+]?(?:\d+(?:\.\d+)?|\.\d+)/);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function clockSecondsFromCell(value: string) {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/);
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? 0);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || !Number.isFinite(seconds) || hours > 23 || minutes > 59 || seconds >= 60) return undefined;
  return hours * 3600 + minutes * 60 + seconds;
}

type TimestampState = {
  firstTimestampMs?: number;
  firstClockSeconds?: number;
  firstElapsedSeconds?: number;
  previousElapsedSeconds?: number;
  lastElapsedSeconds?: number;
  timestampDeltas: number[];
  timestampCount: number;
  unparsedTimestampCount: number;
  nonMonotonicCount: number;
};

function recordElapsedSeconds(state: TimestampState, elapsedSeconds: number) {
  state.timestampCount += 1;
  state.firstElapsedSeconds ??= elapsedSeconds;
  if (state.previousElapsedSeconds !== undefined) {
    const delta = elapsedSeconds - state.previousElapsedSeconds;
    if (delta > 0) state.timestampDeltas.push(delta);
    else state.nonMonotonicCount += 1;
  }
  state.previousElapsedSeconds = elapsedSeconds;
  state.lastElapsedSeconds = elapsedSeconds;
  return elapsedSeconds;
}

function elapsedSecondsFromCell(value: string, delimiter: "," | ";" | "\t", state: TimestampState) {
  const trimmed = value.trim();
  if (!trimmed || missingCell(trimmed)) return undefined;
  const clockSeconds = clockSecondsFromCell(trimmed);
  if (clockSeconds !== undefined) {
    state.firstClockSeconds ??= clockSeconds;
    const elapsed = clockSeconds - state.firstClockSeconds;
    return recordElapsedSeconds(state, Number((elapsed < 0 ? elapsed + 86_400 : elapsed).toFixed(1)));
  }
  if (/^[-+]?\d+(?:[.,]\d+)?$/.test(trimmed)) {
    const numeric = numberFromCell(trimmed, delimiter);
    return numeric === undefined ? undefined : recordElapsedSeconds(state, Number(Math.max(0, numeric).toFixed(1)));
  }
  const timestampMs = Date.parse(trimmed);
  if (Number.isFinite(timestampMs)) {
    state.firstTimestampMs ??= timestampMs;
    return recordElapsedSeconds(state, Number(Math.max(0, (timestampMs - state.firstTimestampMs) / 1_000).toFixed(1)));
  }
  const numeric = numberFromCell(trimmed, delimiter);
  if (numeric !== undefined) return recordElapsedSeconds(state, Number(Math.max(0, numeric).toFixed(1)));
  state.unparsedTimestampCount += 1;
  return undefined;
}

function measurementContinuityFor(state: TimestampState, hasTimeAxis: boolean) {
  const positiveDeltas = state.timestampDeltas.filter((delta) => delta > 0).sort((left, right) => left - right);
  const base = positiveDeltas.length === 0 ? undefined : positiveDeltas[Math.floor(positiveDeltas.length / 2)];
  if (!hasTimeAxis || state.timestampCount < 2 || base === undefined) return { status: "unknown" as const, timestampCount: state.timestampCount, unparsedTimestampCount: state.unparsedTimestampCount, ...(state.firstElapsedSeconds !== undefined && state.lastElapsedSeconds !== undefined ? { observedDurationSeconds: Number(Math.max(0, state.lastElapsedSeconds - state.firstElapsedSeconds).toFixed(1)) } : {}), gapCount: 0, nonMonotonicCount: state.nonMonotonicCount, estimatedMissingSamples: 0 };
  const gapToleranceSeconds = Math.max(1, base * 2);
  const gaps = state.timestampDeltas.filter((delta) => delta > gapToleranceSeconds);
  const estimatedMissingSamples = gaps.reduce((total, delta) => total + Math.max(0, Math.round(delta / base) - 1), 0);
  return {
    status: gaps.length > 0 || state.nonMonotonicCount > 0 ? "gapped" as const : "continuous" as const,
    timestampCount: state.timestampCount,
    unparsedTimestampCount: state.unparsedTimestampCount,
    sampleIntervalSeconds: Number(base.toFixed(1)),
    ...(state.firstElapsedSeconds !== undefined && state.lastElapsedSeconds !== undefined ? { observedDurationSeconds: Number(Math.max(0, state.lastElapsedSeconds - state.firstElapsedSeconds).toFixed(1)) } : {}),
    gapCount: gaps.length,
    ...(gaps.length > 0 ? { largestGapSeconds: Number(Math.max(...gaps).toFixed(1)) } : {}),
    nonMonotonicCount: state.nonMonotonicCount,
    estimatedMissingSamples,
    gapToleranceSeconds: Number(gapToleranceSeconds.toFixed(1))
  };
}

function compactTelemetrySeries(points: AssemblyVerificationTelemetryPoint[]) {
  if (points.length <= TELEMETRY_SERIES_LIMIT) return points;
  return Array.from({ length: TELEMETRY_SERIES_LIMIT }, (_, index) => points[Math.round((index * (points.length - 1)) / (TELEMETRY_SERIES_LIMIT - 1))]).filter((point, index, list) => index === 0 || point.sampleIndex !== list[index - 1].sampleIndex);
}

function escapeCsvField(value: string | number) {
  const raw = String(value);
  return /[",\r\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

export function assemblyVerificationCsvTemplateFor() {
  const header = ["timestamp", "CPU Package [°C]", "GPU Temperature [°C]", "Ambient Temperature [°C]", "CPU Fan [RPM]", "GPU Fan [RPM]"];
  const row = ["2026-09-01 20:00:00", 78, 72, 24, 1200, 1450];
  return `\uFEFF${[header, row].map((values) => values.map(escapeCsvField).join(",")).join("\r\n")}\r\n`;
}

export function parseAssemblyVerificationCsv(input: string): AssemblyVerificationCsvParseResult {
  if (typeof input !== "string" || input.length === 0) return { errors: ["측정 CSV가 비어 있습니다."] };
  if (input.length > MAX_CSV_BYTES) return { errors: [`측정 CSV는 ${Math.floor(MAX_CSV_BYTES / 1_000_000)}MB 이하만 가져올 수 있습니다.`] };
  const delimiter = delimiterFor(input.replace(/^\uFEFF/, ""));
  const parsed = parseCsvRows(input.replace(/^\uFEFF/, ""), delimiter);
  if (parsed.errors.length > 0) return { errors: parsed.errors };
  if (parsed.rows.length < 2) return { errors: ["측정 CSV는 헤더와 데이터 행이 모두 필요합니다."] };

  const headers = parsed.rows[0].map((value) => value.trim());
  const dataRows = parsed.rows.slice(1);
  let timeMatch: { header: string; index: number } | undefined;
  for (const alias of TIME_ALIASES) {
    const index = headers.findIndex((header) => headerMatches(header, alias));
    if (index >= 0) {
      timeMatch = { header: headers[index], index };
      break;
    }
  }
  const detectedHeaders: Partial<Record<AssemblyVerificationCsvMetric, string>> = {};
  const columnIndexes: Partial<Record<AssemblyVerificationCsvMetric, number>> = {};
  const detectedTelemetryHeaders: Partial<Record<AssemblyVerificationCsvTelemetryMetric, string>> = {};
  const telemetryColumnIndexes: Partial<Record<AssemblyVerificationCsvTelemetryMetric, number>> = {};
  const missingMetrics: AssemblyVerificationCsvMetric[] = [];
  for (const definition of METRIC_DEFINITIONS) {
    let match: { header: string; index: number } | undefined;
    for (const alias of definition.aliases) {
      const index = headers.findIndex((header) => headerMatches(header, alias));
      if (index >= 0) {
        match = { header: headers[index], index };
        break;
      }
    }
    if (!match) {
      missingMetrics.push(definition.key);
      continue;
    }
    detectedHeaders[definition.key] = match.header;
    columnIndexes[definition.key] = match.index;
  }
  for (const definition of TELEMETRY_DEFINITIONS) {
    let match: { header: string; index: number } | undefined;
    for (const alias of definition.aliases) {
      const index = headers.findIndex((header) => headerMatches(header, alias));
      if (index >= 0) {
        match = { header: headers[index], index };
        break;
      }
    }
    if (!match) continue;
    detectedTelemetryHeaders[definition.key] = match.header;
    telemetryColumnIndexes[definition.key] = match.index;
  }
  if (Object.keys(columnIndexes).length === 0 && Object.keys(telemetryColumnIndexes).length === 0) return { errors: ["CPU/GPU 온도·주변 온도·팬 RPM·사용률·클럭·소비전력 열을 찾지 못했습니다. 제공된 CSV 양식이나 HWiNFO·OCCT 센서 열 이름을 확인해 주세요."] };

  const valuesByMetric = new Map<AssemblyVerificationCsvMetric, number[]>();
  const seriesPoints: AssemblyVerificationTelemetryPoint[] = [];
  const timestampState: TimestampState = { timestampDeltas: [], timestampCount: 0, unparsedTimestampCount: 0, nonMonotonicCount: 0 };
  let sampleCount = 0;
  let invalidValueCount = 0;
  for (const row of dataRows) {
    let rowHasValue = false;
    const point: AssemblyVerificationTelemetryPoint = { sampleIndex: sampleCount };
    if (timeMatch) {
      const elapsedSeconds = elapsedSecondsFromCell(row[timeMatch.index] ?? "", delimiter, timestampState);
      if (elapsedSeconds !== undefined) point.elapsedSeconds = elapsedSeconds;
    }
    for (const definition of METRIC_DEFINITIONS) {
      const columnIndex = columnIndexes[definition.key];
      if (columnIndex === undefined) continue;
      const rawValue = row[columnIndex] ?? "";
      const numericValue = numberFromCell(rawValue, delimiter);
      if (numericValue === undefined) {
        if (rawValue.trim() && !missingCell(rawValue)) invalidValueCount += 1;
        continue;
      }
      if (numericValue < definition.min || numericValue > definition.max) {
        invalidValueCount += 1;
        continue;
      }
      rowHasValue = true;
      const seriesMetric = definition.key === "cpuMaxTempC" ? "cpuTempC" : definition.key === "gpuMaxTempC" ? "gpuTempC" : definition.key;
      point[seriesMetric] = Number(numericValue.toFixed(1));
      const current = valuesByMetric.get(definition.key) ?? [];
      current.push(numericValue);
      valuesByMetric.set(definition.key, current);
    }
    for (const definition of TELEMETRY_DEFINITIONS) {
      const columnIndex = telemetryColumnIndexes[definition.key];
      if (columnIndex === undefined) continue;
      const rawValue = row[columnIndex] ?? "";
      const numericValue = numberFromCell(rawValue, delimiter);
      if (numericValue === undefined) {
        if (rawValue.trim() && !missingCell(rawValue)) invalidValueCount += 1;
        continue;
      }
      if (numericValue < definition.min || numericValue > definition.max) {
        invalidValueCount += 1;
        continue;
      }
      rowHasValue = true;
      point[definition.key] = Number(numericValue.toFixed(1));
    }
    if (rowHasValue) {
      seriesPoints.push(point);
      sampleCount += 1;
    }
  }

  if (sampleCount === 0) return { errors: ["유효한 온도·주변 온도·팬 RPM·사용률·클럭·소비전력 측정값이 있는 행을 찾지 못했습니다."] };
  const values: AssemblyVerificationCsvValues = {};
  for (const definition of METRIC_DEFINITIONS) {
    const measurements = valuesByMetric.get(definition.key) ?? [];
    if (measurements.length === 0) continue;
    const aggregated = definition.aggregate === "max"
      ? Math.max(...measurements)
      : measurements.reduce((total, value) => total + value, 0) / measurements.length;
    values[definition.key] = Number(aggregated.toFixed(1));
  }
  const skippedRowCount = dataRows.length - sampleCount;
  const compactSeries = compactTelemetrySeries(seriesPoints);
  const qualityStatus: AssemblyVerificationMeasurementQuality["status"] = invalidValueCount > 0 ? "review" : Object.keys(columnIndexes).length === METRIC_DEFINITIONS.length && skippedRowCount === 0 && Boolean(timeMatch) ? "complete" : "partial";
  const continuity = measurementContinuityFor(timestampState, Boolean(timeMatch));
  const qualityWithContinuityStatus: AssemblyVerificationMeasurementQuality["status"] = continuity.status === "gapped" || continuity.unparsedTimestampCount > 0 ? "review" : qualityStatus;
  const quality: AssemblyVerificationMeasurementQuality = {
    status: qualityWithContinuityStatus,
    rowCount: dataRows.length,
    validSampleCount: sampleCount,
    skippedRowCount,
    invalidValueCount,
    recognizedCoreColumnCount: Object.keys(columnIndexes).length,
    coreColumnCount: METRIC_DEFINITIONS.length,
    telemetryColumnCount: Object.keys(detectedTelemetryHeaders).length,
    hasTimeAxis: Boolean(timeMatch),
    seriesPointCount: compactSeries.length,
    continuity
  };
  const warnings: string[] = [];
  if (missingMetrics.length > 0) warnings.push(`CSV에서 찾지 못한 측정 열: ${missingMetrics.map((metric) => ASSEMBLY_VERIFICATION_CSV_METRIC_LABELS[metric]).join(" · ")}`);
  if (skippedRowCount > 0) warnings.push(`유효한 측정값이 없어 제외한 행 ${skippedRowCount.toLocaleString("ko-KR")}개`);
  if (invalidValueCount > 0) warnings.push(`범위를 벗어나거나 숫자로 읽지 못한 셀 ${invalidValueCount.toLocaleString("ko-KR")}개`);
  if (!timeMatch) warnings.push("시간 열을 찾지 못해 시계열을 샘플 순서로 표시합니다.");
  if (continuity.status === "gapped") warnings.push(`시간축 공백 ${continuity.gapCount}개 · 최대 공백 ${continuity.largestGapSeconds ?? "-"}초 · 예상 누락 샘플 ${continuity.estimatedMissingSamples}개`);
  if (continuity.unparsedTimestampCount > 0) warnings.push(`해석하지 못한 timestamp ${continuity.unparsedTimestampCount}개`);
  else if (continuity.status === "unknown" && timeMatch) warnings.push("유효 timestamp가 2개 미만이어서 시간축 연속성을 확인하지 못했습니다.");
  return {
    import: {
      values,
      headers,
      detectedHeaders,
      rowCount: dataRows.length,
      sampleCount,
      skippedRowCount,
      invalidValueCount,
      missingMetrics,
      warnings,
      delimiter,
      series: compactSeries,
      ...(timeMatch ? { timeColumn: timeMatch.header } : {}),
      detectedTelemetryHeaders,
      telemetryColumnCount: Object.keys(detectedTelemetryHeaders).length,
      quality
    },
    errors: []
  };
}
