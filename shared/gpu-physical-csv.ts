import type { GpuPhysicalOverride, PhysicalOverrideCategory } from "./types";

export const GPU_PHYSICAL_OVERRIDE_CSV_HEADERS = [
  "partId",
  "partName",
  "category",
  "manufacturerModel",
  "manufacturerRevision",
  "gpuSlotOccupancy",
  "gpuCableBendClearanceMm",
  "caseSidePanelClearanceMm",
  "psuIndependentPcieCableRuns",
  "psuPcieCableTopology",
  "sourceNote",
  "sourceUrl",
  "updatedAt"
] as const;

export type GpuPhysicalOverrideCsvItem = GpuPhysicalOverride & {
  partName?: string;
  category?: PhysicalOverrideCategory;
};

type CsvRow = string[];

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

function categoryFromCell(value: string) {
  const normalized = value.trim().toLocaleLowerCase("ko-KR");
  if (normalized === "gpu" || normalized === "그래픽카드") return "gpu" as const;
  if (normalized === "case" || normalized === "케이스") return "case" as const;
  if (normalized === "psu" || normalized === "파워" || normalized === "파워서플라이") return "psu" as const;
  return undefined;
}

function topologyFromCell(value: string) {
  const normalized = value.trim().toLocaleLowerCase("ko-KR");
  if (!normalized) return { value: undefined as GpuPhysicalOverride["psuPcieCableTopology"] };
  if (["independent", "독립", "독립 케이블", "분배 없음"].includes(normalized)) return { value: "independent" as const };
  if (["shared", "분배", "공유", "분배 구조", "분배·공유 케이블"].includes(normalized)) return { value: "shared" as const };
  return { error: "psuPcieCableTopology는 independent 또는 shared 중 하나여야 합니다." };
}

function numberFromCell(value: string, label: string, line: number) {
  const normalized = value.trim();
  if (!normalized) return { value: undefined as number | undefined };
  const parsed = Number(normalized.replaceAll(",", ""));
  if (!Number.isFinite(parsed)) return { error: `${line}행: ${label}은 숫자여야 합니다.` };
  return { value: parsed };
}

export function gpuPhysicalOverridesToCsv(items: GpuPhysicalOverrideCsvItem[]) {
  const rows = [GPU_PHYSICAL_OVERRIDE_CSV_HEADERS.join(",")];
  for (const item of items) {
    rows.push([
      item.partId,
      item.partName,
      item.category,
      item.manufacturerModel,
      item.manufacturerRevision,
      item.gpuSlotOccupancy,
      item.gpuCableBendClearanceMm,
      item.caseSidePanelClearanceMm,
      item.psuIndependentPcieCableRuns,
      item.psuPcieCableTopology,
      item.sourceNote,
      item.sourceUrl,
      item.updatedAt
    ].map(escapeCsvField).join(","));
  }
  return `\uFEFF${rows.join("\r\n")}\r\n`;
}

export function parseGpuPhysicalOverridesCsv(input: string): { items: Array<Record<string, unknown>>; errors: string[] } {
  const parsed = parseCsvRows(input.replace(/^\uFEFF/, ""));
  if (parsed.errors.length > 0) return { items: [], errors: parsed.errors };
  if (parsed.rows.length < 2) return { items: [], errors: ["CSV 헤더와 데이터 행이 모두 필요합니다."] };
  const headers = parsed.rows[0].map((value) => value.trim());
  const headerIndex = new Map(headers.map((header, index) => [header, index]));
  const requiredHeaders = ["partId", "category", "manufacturerModel", "gpuSlotOccupancy", "gpuCableBendClearanceMm", "caseSidePanelClearanceMm", "psuIndependentPcieCableRuns", "psuPcieCableTopology", "sourceNote"] as const;
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
    const categoryText = value("category");
    const category = categoryFromCell(categoryText);
    if (!category) errors.push(`${line}행: category는 gpu, case 또는 psu여야 합니다.`);
    const manufacturerModel = value("manufacturerModel");
    if (!manufacturerModel) errors.push(`${line}행: manufacturerModel(제조사 모델/SKU)이 필요합니다.`);
    const manufacturerRevision = value("manufacturerRevision");

    const slot = numberFromCell(value("gpuSlotOccupancy"), "gpuSlotOccupancy", line);
    const gpuCable = numberFromCell(value("gpuCableBendClearanceMm"), "gpuCableBendClearanceMm", line);
    const caseSide = numberFromCell(value("caseSidePanelClearanceMm"), "caseSidePanelClearanceMm", line);
    const psuRuns = numberFromCell(value("psuIndependentPcieCableRuns"), "psuIndependentPcieCableRuns", line);
    for (const result of [slot, gpuCable, caseSide, psuRuns]) if (result.error) errors.push(result.error);
    const topology = topologyFromCell(value("psuPcieCableTopology"));
    if (topology.error) errors.push(`${line}행: ${topology.error}`);
    if ([slot, gpuCable, caseSide, psuRuns].some((result) => result.error) || topology.error) return;

    items.push({
      partId,
      ...(category ? { category } : {}),
      manufacturerModel,
      ...(manufacturerRevision ? { manufacturerRevision } : {}),
      ...(slot.value !== undefined ? { gpuSlotOccupancy: slot.value } : {}),
      ...(gpuCable.value !== undefined ? { gpuCableBendClearanceMm: gpuCable.value } : {}),
      ...(caseSide.value !== undefined ? { caseSidePanelClearanceMm: caseSide.value } : {}),
      ...(psuRuns.value !== undefined ? { psuIndependentPcieCableRuns: psuRuns.value } : {}),
      ...(topology.value !== undefined ? { psuPcieCableTopology: topology.value } : {}),
      sourceNote: value("sourceNote"),
      ...(value("sourceUrl") ? { sourceUrl: value("sourceUrl") } : {})
    });
  });
  return errors.length > 0 ? { items: [], errors } : { items, errors };
}
