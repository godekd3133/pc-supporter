import type { BenchmarkOverride, BenchmarkScoreKey, PartCategory } from "./types";

export const BENCHMARK_OVERRIDE_CSV_HEADERS = [
  "partId",
  "partName",
  "category",
  "cinebenchR23Single",
  "cinebenchR23Multi",
  "gpu3dmarkTimeSpyScore",
  "gpu3dmarkPortRoyalScore",
  "sourceNote",
  "sourceKind",
  "sourceUrl",
  "updatedAt"
] as const;

type CsvRow = string[];

export type BenchmarkOverrideCsvItem = BenchmarkOverride & {
  partName?: string;
  category?: PartCategory;
};

export type BenchmarkReviewCsvItem = {
  partId: string;
  partName: string;
  category: "cpu" | "gpu";
  scores: Partial<Record<BenchmarkScoreKey, number>>;
  updatedAt: string;
  benchmarkSourceKind?: BenchmarkOverride["sourceKind"];
};

function escapeCsvField(value: string | number | undefined) {
  const raw = value === undefined ? "" : String(value);
  return /[",\r\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

function parseCsvRows(input: string): { rows: CsvRow[]; errors: string[] } {
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
    } else if (character === ",") {
      row.push(field);
      field = "";
      fieldStarted = false;
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(field);
      field = "";
      fieldStarted = false;
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
    } else {
      field += character;
      fieldStarted = true;
    }
  }
  if (inQuotes) errors.push("CSV 따옴표가 닫히지 않았습니다.");
  if (field.length > 0 || fieldStarted || row.length > 0) {
    row.push(field);
    if (row.some((value) => value.length > 0)) rows.push(row);
  }
  return { rows, errors };
}

function scoreFromCell(value: string, header: BenchmarkScoreKey, line: number, errors: string[]) {
  if (!value.trim()) return undefined;
  const score = Number(value.replaceAll(",", "").trim());
  if (!Number.isInteger(score) || score <= 0 || score > 1_000_000) {
    errors.push(`${line}행: ${header}는 1부터 1,000,000 사이의 정수여야 합니다.`);
    return undefined;
  }
  return score;
}

export function benchmarkOverridesToCsv(overrides: BenchmarkOverrideCsvItem[]) {
  const rows = [BENCHMARK_OVERRIDE_CSV_HEADERS.join(",")];
  for (const override of overrides) {
    rows.push([
      override.partId,
      override.partName,
      override.category,
      override.scores.cinebenchR23Single,
      override.scores.cinebenchR23Multi,
      override.scores.gpu3dmarkTimeSpyScore,
      override.scores.gpu3dmarkPortRoyalScore,
      override.sourceNote,
      override.sourceKind,
      override.sourceUrl,
      override.updatedAt
    ].map(escapeCsvField).join(","));
  }
  return `\uFEFF${rows.join("\r\n")}\r\n`;
}

export function benchmarkReviewItemsToCsv(items: BenchmarkReviewCsvItem[]) {
  return benchmarkOverridesToCsv(items.map((item) => ({
    partId: item.partId,
    partName: item.partName,
    category: item.category,
    scores: item.scores,
    sourceNote: "",
    ...(item.benchmarkSourceKind ? { sourceKind: item.benchmarkSourceKind } : {}),
    updatedAt: item.updatedAt
  })));
}

export function parseBenchmarkOverridesCsv(input: string): { items: Array<Record<string, unknown>>; errors: string[] } {
  const parsed = parseCsvRows(input.replace(/^\uFEFF/, ""));
  if (parsed.errors.length > 0) return { items: [], errors: parsed.errors };
  if (parsed.rows.length < 2) return { items: [], errors: ["CSV 헤더와 데이터 행이 모두 필요합니다."] };
  const headers = parsed.rows[0].map((value) => value.trim());
  const headerIndex = new Map(headers.map((header, index) => [header, index]));
  const requiredHeaders = ["partId", "cinebenchR23Single", "cinebenchR23Multi", "gpu3dmarkTimeSpyScore", "gpu3dmarkPortRoyalScore", "sourceNote"] as const;
  const missingHeaders = requiredHeaders.filter((header) => !headerIndex.has(header));
  if (missingHeaders.length > 0) return { items: [], errors: [`필수 CSV 열이 없습니다: ${missingHeaders.join(", ")}`] };

  const errors: string[] = [];
  const items: Array<Record<string, unknown>> = [];
  parsed.rows.slice(1).forEach((row, index) => {
    const line = index + 2;
    const value = (header: string) => row[headerIndex.get(header) ?? -1]?.trim() ?? "";
    const partId = value("partId");
    if (!partId) {
      errors.push(`${line}행: partId가 필요합니다.`);
      return;
    }
    const item: Record<string, unknown> = { partId };
    for (const header of ["cinebenchR23Single", "cinebenchR23Multi", "gpu3dmarkTimeSpyScore", "gpu3dmarkPortRoyalScore"] as const) {
      const score = scoreFromCell(value(header), header, line, errors);
      if (score !== undefined) item[header] = score;
    }
    item.sourceNote = value("sourceNote");
    const sourceKind = value("sourceKind");
    if (sourceKind) item.sourceKind = sourceKind;
    const sourceUrl = value("sourceUrl");
    if (sourceUrl) item.sourceUrl = sourceUrl;
    items.push(item);
  });
  return { items: errors.length > 0 ? [] : items, errors };
}
