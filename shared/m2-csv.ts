import type { M2SlotProfile, M2SlotReviewTemplateItem } from "./types";

export const M2_REVIEW_CSV_HEADERS = [
  "partId",
  "partName",
  "slotId",
  "interfaces",
  "pcieGeneration",
  "connection",
  "sharedWith",
  "sourceNote",
  "sourceUrl"
] as const;

type CsvRow = string[];

function escapeCsvField(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
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

function normalizedSlotId(value: string) {
  const normalized = value.trim().toUpperCase().replace(/[ .-]/g, "_");
  const match = normalized.match(/^M_?2_?([1-8])$/);
  return match ? `M2_${match[1]}` : undefined;
}

function parseInterfaces(value: string) {
  const values = [...new Set(value.split(/[|/]/).map((item) => item.trim()).filter(Boolean))];
  if (values.length === 0) return { values: undefined as Array<"NVMe" | "SATA"> | undefined };
  if (!values.every((item) => item === "NVMe" || item === "SATA")) return { error: "interfaces는 NVMe 또는 SATA만 사용할 수 있습니다." };
  return { values: values as Array<"NVMe" | "SATA"> };
}

function parseConnection(value: string) {
  const normalized = value.trim().toLocaleLowerCase();
  if (!normalized) return { value: undefined as M2SlotProfile["connection"] };
  if (normalized === "cpu" || normalized === "cpu 직결") return { value: "cpu" as const };
  if (normalized === "chipset" || normalized === "칩셋") return { value: "chipset" as const };
  if (normalized === "unknown" || normalized === "확인 필요") return { value: "unknown" as const };
  return { error: "connection은 cpu, chipset, unknown 중 하나여야 합니다." };
}

function parseSharedWith(value: string) {
  const normalized = value.trim();
  if (!normalized) return { value: undefined as string[] | undefined };
  if (["없음", "none", "no", "-"].includes(normalized.toLocaleLowerCase())) return { value: [] };
  return { value: [...new Set(normalized.split(/[|;,]/).map((item) => item.trim()).filter(Boolean))] };
}

export function m2ReviewTemplatesToCsv(items: M2SlotReviewTemplateItem[]) {
  const rows = [M2_REVIEW_CSV_HEADERS.join(",")];
  for (const item of items) {
    for (const slot of item.slots) {
      rows.push([
        item.partId,
        item.partName ?? "",
        slot.slotId,
        slot.interfaces?.join("|") ?? "",
        slot.pcieGeneration?.toString() ?? "",
        slot.connection ?? "",
        slot.sharedWith === undefined ? "" : slot.sharedWith.length === 0 ? "없음" : slot.sharedWith.join("|"),
        item.sourceNote ?? "",
        item.sourceUrl ?? ""
      ].map(escapeCsvField).join(","));
    }
  }
  return `${rows.join("\r\n")}\r\n`;
}

export function parseM2ReviewCsv(input: string): { items: M2SlotReviewTemplateItem[]; errors: string[] } {
  const parsed = parseCsvRows(input.replace(/^\uFEFF/, ""));
  if (parsed.errors.length > 0) return { items: [], errors: parsed.errors };
  if (parsed.rows.length < 2) return { items: [], errors: ["CSV 헤더와 데이터 행이 모두 필요합니다."] };
  const headers = parsed.rows[0].map((value, index) => index === 0 ? value.trim() : value.trim());
  const headerIndex = new Map(headers.map((header, index) => [header, index]));
  const missingHeaders = M2_REVIEW_CSV_HEADERS.filter((header) => !headerIndex.has(header));
  if (missingHeaders.length > 0) return { items: [], errors: [`필수 CSV 열이 없습니다: ${missingHeaders.join(", ")}`] };

  const errors: string[] = [];
  const grouped = new Map<string, M2SlotReviewTemplateItem>();
  parsed.rows.slice(1).forEach((row, index) => {
    const line = index + 2;
    const value = (header: typeof M2_REVIEW_CSV_HEADERS[number]) => row[headerIndex.get(header) ?? -1]?.trim() ?? "";
    const partId = value("partId");
    const slotId = normalizedSlotId(value("slotId"));
    if (!partId) errors.push(`${line}행: partId가 필요합니다.`);
    if (!slotId) errors.push(`${line}행: slotId는 M2_1부터 M2_8 형식이어야 합니다.`);
    if (!partId || !slotId) return;

    const interfaces = parseInterfaces(value("interfaces"));
    const generationText = value("pcieGeneration");
    const generation = generationText ? Number(generationText) : undefined;
    const connection = parseConnection(value("connection"));
    const sharedWith = parseSharedWith(value("sharedWith"));
    if (interfaces.error) errors.push(`${line}행: ${interfaces.error}`);
    if (generationText && (!Number.isFinite(generation) || generation! < 2 || generation! > 6)) errors.push(`${line}행: PCIe 세대는 2부터 6 사이의 숫자여야 합니다.`);
    if (connection.error) errors.push(`${line}행: ${connection.error}`);
    if (interfaces.error || connection.error || (generationText && (!Number.isFinite(generation) || generation! < 2 || generation! > 6))) return;

    const current = grouped.get(partId) ?? { partId, partName: value("partName") || undefined, slots: [] };
    if (current.slots.some((slot) => slot.slotId === slotId)) {
      errors.push(`${line}행: ${partId}의 ${slotId} 슬롯이 중복되었습니다.`);
      return;
    }
    const partName = value("partName");
    const sourceNote = value("sourceNote");
    const sourceUrl = value("sourceUrl");
    if (partName && !current.partName) current.partName = partName;
    if (sourceNote && !current.sourceNote) current.sourceNote = sourceNote;
    if (sourceUrl && !current.sourceUrl) current.sourceUrl = sourceUrl;
    current.slots.push({
      slotId,
      ...(interfaces.values ? { interfaces: interfaces.values } : {}),
      ...(generation !== undefined ? { pcieGeneration: generation } : {}),
      ...(connection.value !== undefined ? { connection: connection.value } : {}),
      ...(sharedWith.value !== undefined ? { sharedWith: sharedWith.value } : {})
    });
    grouped.set(partId, current);
  });
  return { items: errors.length > 0 ? [] : [...grouped.values()], errors };
}
