import { FiExternalLink } from "react-icons/fi";
import { BENCHMARK_SOURCE_KIND_LABELS } from "../shared/types";
import type { BenchmarkEvidencePart } from "../shared/benchmark-evidence";
import { benchmarkFreshnessLabelFor, benchmarkSourceCheckLabelFor } from "../shared/benchmark-evidence";
import { safeHttpsUrl } from "./safe-source-url";

function benchmarkStatusLabel(status: BenchmarkEvidencePart["status"]) {
  return status === "complete" ? "완전 자료" : status === "partial" ? "부분 자료" : "점수 없음";
}

export function ComparisonBenchmarkCell({ evidence }: { evidence?: BenchmarkEvidencePart }) {
  if (!evidence) return <span className="comparison-benchmark-cell empty">원본 성능 정보 없음</span>;
  const sourceUrl = safeHttpsUrl(evidence.provenance?.sourceUrl);
  return <span className={`comparison-benchmark-cell ${evidence.status}`} data-testid="comparison-benchmark-cell">
    <strong>{benchmarkStatusLabel(evidence.status)} · {evidence.presentCount}/{evidence.totalCount}개</strong>
    <span className="comparison-benchmark-cell-scores">{evidence.rows.map((row) => `${row.label} ${row.value === undefined ? "확인 필요" : `${row.value.toLocaleString("ko-KR")}${row.unit}`}`).join(" · ")}</span>
    <small>출처 · {evidence.provenance ? `${BENCHMARK_SOURCE_KIND_LABELS[evidence.provenance.sourceKind]} · ${evidence.provenance.sourceNote}` : "출처 미등록"}</small>
    <small>점검 · {benchmarkSourceCheckLabelFor(evidence.sourceCheck)} · 자료 {benchmarkFreshnessLabelFor(evidence.benchmarkFreshness)}</small>
    {sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer">원문 <FiExternalLink /></a>}
  </span>;
}
