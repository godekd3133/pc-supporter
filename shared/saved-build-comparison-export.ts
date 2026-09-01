export type SavedBuildComparisonExportRow = {
  label: string;
  values: string[];
};

export type SavedBuildComparisonExportInput = {
  buildNames: string[];
  snapshotRows: SavedBuildComparisonExportRow[];
  currentRows: SavedBuildComparisonExportRow[];
};

function csvCell(value: string | number | undefined) {
  const raw = value === undefined ? "" : String(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function rowsForExport(input: SavedBuildComparisonExportInput) {
  return [
    ["구분", "비교 항목", ...input.buildNames],
    ...input.snapshotRows.map((row) => ["저장 시점 스냅샷", row.label, ...row.values]),
    ...input.currentRows.map((row) => ["현재 카탈로그 재검사", row.label, ...row.values])
  ];
}

export function savedBuildComparisonTextFor(input: SavedBuildComparisonExportInput) {
  const lines = ["PC Supporter 저장 견적 비교", `비교 견적: ${input.buildNames.join(" · ")}`, "", "[저장 시점 스냅샷]"];
  input.snapshotRows.forEach((row) => lines.push(`${row.label}: ${row.values.join(" | ")}`));
  lines.push("", "[현재 카탈로그 재검사]");
  input.currentRows.forEach((row) => lines.push(`${row.label}: ${row.values.join(" | ")}`));
  return lines.join("\n");
}

export function savedBuildComparisonCsvFor(input: SavedBuildComparisonExportInput) {
  return `\uFEFF${rowsForExport(input).map((row) => row.map((value) => csvCell(value)).join(",")).join("\r\n")}`;
}

export function savedBuildComparisonJsonFor(input: SavedBuildComparisonExportInput) {
  return JSON.stringify({
    type: "pc-supporter-saved-build-comparison",
    version: 1,
    exportedAt: new Date().toISOString(),
    ...input
  }, null, 2);
}
