import { catalogWatchlistFromJson } from "./catalog-watchlist";
import type { CatalogWatchEntry } from "./catalog-watchlist";

export interface CatalogWatchlistImportResult {
  entries: CatalogWatchEntry[];
  nearLowThresholdPercent?: 5 | 10 | 20;
  errors: string[];
}

const REQUIRED_CSV_HEADERS = ["구분", "분류", "부품명", "부품 ID", "추가 시각"] as const;

function parseCsvRows(input: string) {
  const rows: string[][] = [];
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
  if (inQuotes) return { rows: [] as string[][], error: "CSV 따옴표가 닫히지 않았습니다." };
  if (field.length > 0 || fieldStarted || row.length > 0) {
    row.push(field);
    if (row.some((value) => value.length > 0)) rows.push(row);
  }
  return { rows, error: undefined };
}

function isValidTargetPrice(value: unknown): value is number {
  return value === undefined || (typeof value === "number" && Number.isFinite(value) && value > 0);
}

function isValidEntry(value: unknown): value is CatalogWatchEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<CatalogWatchEntry>;
  return typeof entry.itemId === "string" && entry.itemId.trim().length > 0
    && typeof entry.itemName === "string" && entry.itemName.trim().length > 0
    && typeof entry.category === "string" && entry.category.trim().length > 0
    && (entry.kind === "part" || entry.kind === "accessory")
    && typeof entry.addedAt === "string" && entry.addedAt.trim().length > 0
    && isValidTargetPrice(entry.targetPriceWon);
}

function thresholdFrom(value: unknown) {
  return value === 5 || value === 10 || value === 20 ? value : undefined;
}

export function catalogWatchlistEntriesFromJson(input: string): CatalogWatchlistImportResult {
  try {
    const parsed: unknown = JSON.parse(input);
    const objectValue = parsed && typeof parsed === "object" ? parsed as { items?: unknown; filters?: { nearLowThresholdPercent?: unknown } } : undefined;
    const rawItems = Array.isArray(parsed) ? parsed : objectValue && Array.isArray(objectValue.items) ? objectValue.items.map((item) => item && typeof item === "object" && "entry" in item ? (item as { entry?: unknown }).entry : item) : undefined;
    if (!rawItems) return { entries: [], errors: ["관심 목록 JSON은 배열 또는 export envelope여야 합니다."] };
    const invalidIndex = rawItems.findIndex((item) => !isValidEntry(item));
    if (invalidIndex >= 0) return { entries: [], errors: [`${invalidIndex + 1}번째 관심 항목의 필수 값이나 목표가가 올바르지 않습니다.`] };
    const thresholdValue = objectValue?.filters?.nearLowThresholdPercent;
    if (thresholdValue !== undefined && thresholdFrom(thresholdValue) === undefined) return { entries: [], errors: ["최저가 근접 기준은 5, 10, 20 중 하나여야 합니다."] };
    return { entries: catalogWatchlistFromJson(JSON.stringify(rawItems), 50), ...(thresholdFrom(thresholdValue) !== undefined ? { nearLowThresholdPercent: thresholdFrom(thresholdValue) } : {}), errors: [] };
  } catch {
    return { entries: [], errors: ["관심 목록 JSON을 읽을 수 없습니다."] };
  }
}

export function catalogWatchlistEntriesFromCsv(input: string): CatalogWatchlistImportResult {
  const parsed = parseCsvRows(input.replace(/^\uFEFF/, ""));
  if (parsed.error) return { entries: [], errors: [parsed.error] };
  if (parsed.rows.length < 2) return { entries: [], errors: ["CSV 헤더와 데이터 행이 모두 필요합니다."] };
  const headerIndex = new Map(parsed.rows[0].map((header, index) => [header.trim(), index]));
  const missingHeaders = REQUIRED_CSV_HEADERS.filter((header) => !headerIndex.has(header));
  if (missingHeaders.length > 0) return { entries: [], errors: [`필수 CSV 열이 없습니다: ${missingHeaders.join(", ")}`] };
  const indexOf = (header: string) => headerIndex.get(header) ?? -1;
  const valueOf = (row: string[], header: string) => row[indexOf(header)]?.trim() ?? "";
  const entries: CatalogWatchEntry[] = [];
  const errors: string[] = [];
  parsed.rows.slice(1).forEach((row, rowIndex) => {
    const line = rowIndex + 2;
    const kindText = valueOf(row, "구분");
    const kind = kindText === "핵심 부품" || kindText === "part" ? "part" : kindText === "주변 부품" || kindText === "accessory" ? "accessory" : undefined;
    const category = valueOf(row, "분류");
    const itemName = valueOf(row, "부품명");
    const itemId = valueOf(row, "부품 ID");
    const addedAt = valueOf(row, "추가 시각");
    const targetText = valueOf(row, "목표가(원)");
    const targetPriceWon = targetText ? Number(targetText) : undefined;
    if (!kind) errors.push(`${line}행: 구분은 핵심 부품 또는 주변 부품이어야 합니다.`);
    if (!category) errors.push(`${line}행: 분류가 필요합니다.`);
    if (!itemName) errors.push(`${line}행: 부품명이 필요합니다.`);
    if (!itemId) errors.push(`${line}행: 부품 ID가 필요합니다.`);
    if (!addedAt) errors.push(`${line}행: 추가 시각이 필요합니다.`);
    if (targetText && (!Number.isFinite(targetPriceWon) || !isValidTargetPrice(targetPriceWon))) errors.push(`${line}행: 목표가는 0보다 큰 숫자여야 합니다.`);
    if (kind && category && itemName && itemId && addedAt && (!targetText || (Number.isFinite(targetPriceWon) && isValidTargetPrice(targetPriceWon)))) entries.push({ itemId, itemName, category: category as CatalogWatchEntry["category"], kind, addedAt, ...(targetPriceWon !== undefined ? { targetPriceWon } : {}) });
  });
  if (errors.length > 0) return { entries: [], errors };
  return { entries: catalogWatchlistFromJson(JSON.stringify(entries), 50), errors: [] };
}
