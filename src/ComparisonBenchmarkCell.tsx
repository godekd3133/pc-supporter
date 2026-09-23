import type { BenchmarkEvidencePart } from "../shared/benchmark-evidence";

export function ComparisonBenchmarkCell({ evidence }: { evidence?: BenchmarkEvidencePart }) {
  if (!evidence || evidence.rows.every((row) => row.value === undefined)) return <span className="comparison-benchmark-cell empty">성능 정보 없음</span>;
  return <span className={`comparison-benchmark-cell ${evidence.status}`} data-testid="comparison-benchmark-cell">
    <strong>{evidence.rows.filter((row) => row.value !== undefined).map((row) => `${row.label} ${row.value!.toLocaleString("ko-KR")}${row.unit}`).join(" · ")}</strong>
  </span>;
}
