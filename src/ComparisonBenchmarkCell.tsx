import type { BenchmarkEvidencePart } from "../shared/benchmark-evidence";

export function ComparisonBenchmarkCell({ evidence }: { evidence?: BenchmarkEvidencePart }) {
  if (!evidence) return <span className="comparison-benchmark-cell empty">성능 점수 없음</span>;
  return <span className={`comparison-benchmark-cell ${evidence.status}`} data-testid="comparison-benchmark-cell">
    <strong>{evidence.rows.map((row) => `${row.label} ${row.value === undefined ? "미등록" : `${row.value.toLocaleString("ko-KR")}${row.unit}`}`).join(" · ")}</strong>
  </span>;
}
