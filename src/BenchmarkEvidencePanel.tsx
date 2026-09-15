import { FiActivity, FiExternalLink, FiInfo } from "react-icons/fi";
import { BENCHMARK_SOURCE_KIND_LABELS } from "../shared/types";
import { benchmarkEvidenceForPart, benchmarkFreshnessLabelFor, benchmarkSourceCheckLabelFor } from "../shared/benchmark-evidence";
import type { BenchmarkEvidencePart } from "../shared/benchmark-evidence";
import { buildBenchmarkSnapshotFor, buildBenchmarkSnapshotStatusText } from "../shared/build-benchmark-snapshot";
import type { BuildBenchmarkSnapshot } from "../shared/build-benchmark-snapshot";
import type { Part } from "../shared/types";
import { safeHttpsUrl } from "./safe-source-url";

function statusLabel(status: BenchmarkEvidencePart["status"]) {
  return status === "complete" ? "완전 자료" : status === "partial" ? "부분 자료" : "점수 없음";
}

function BenchmarkEvidenceCard({ evidence }: { evidence: BenchmarkEvidencePart }) {
  const sourceUrl = safeHttpsUrl(evidence.provenance?.sourceUrl);
  return <article className={`benchmark-evidence-card ${evidence.status}`} data-testid={`benchmark-evidence-${evidence.category}`}>
    <div className="benchmark-evidence-card-heading"><div><span>{evidence.category === "cpu" ? "CPU" : "GPU"}</span><strong>{evidence.name}</strong></div><em>{statusLabel(evidence.status)} · {evidence.presentCount}/{evidence.totalCount} · 자료 {benchmarkFreshnessLabelFor(evidence.benchmarkFreshness)}</em></div>
    <div className="benchmark-evidence-score-grid">{evidence.rows.map((row) => <div key={row.key}><span>{row.label}</span><strong>{row.value === undefined ? "확인 필요" : `${row.value.toLocaleString("ko-KR")}${row.unit}`}</strong></div>)}</div>
    <div className="benchmark-evidence-source"><span>점수 정보</span>{evidence.provenance ? <p><strong>{BENCHMARK_SOURCE_KIND_LABELS[evidence.provenance.sourceKind]}</strong> · {evidence.provenance.sourceNote}{evidence.provenance.updatedAt ? ` · 정보 갱신 ${new Date(evidence.provenance.updatedAt).toLocaleDateString("ko-KR")}` : ""}{sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer">원문 <FiExternalLink /></a>}</p> : <p>점수는 기록되어 있지만 출처·출처 메모가 없어 원문 확인이 필요합니다.</p>}</div>
    <small className={`benchmark-evidence-source-check ${evidence.sourceCheck ? (benchmarkSourceCheckLabelFor(evidence.sourceCheck) === "원문 확인됨" ? "verified" : "review") : "not-checked"}`}>원문 점검 · {benchmarkSourceCheckLabelFor(evidence.sourceCheck)}{evidence.sourceCheck?.detail ? ` · ${evidence.sourceCheck.detail}` : ""}</small>
    <small className="benchmark-evidence-data-date">부품 데이터 갱신 {new Date(evidence.dataUpdatedAt).toLocaleDateString("ko-KR")}</small>
  </article>;
}

export function BenchmarkEvidencePanel({ cpu, gpu, snapshot }: { cpu?: Part; gpu?: Part; snapshot?: BuildBenchmarkSnapshot }) {
  const evidences = [benchmarkEvidenceForPart(cpu), benchmarkEvidenceForPart(gpu)].filter((item): item is BenchmarkEvidencePart => Boolean(item));
  if (evidences.length === 0) return null;
  const buildSnapshot = snapshot ?? buildBenchmarkSnapshotFor(cpu, gpu);
  const snapshotSummary = buildSnapshot.status === "complete"
    ? "선택된 CPU·GPU의 벤치마크 점수를 모두 기록했습니다."
    : buildSnapshot.status === "partial"
      ? "일부 점수만 있어 성능 판단 전 누락된 정보를 확인해야 합니다."
      : "선택된 부품의 벤치마크 점수가 없어 성능 판단 정보가 부족합니다.";
  return <section className="benchmark-evidence-panel" aria-label="원본 벤치마크 정보" data-testid="benchmark-evidence-panel">
    <div className="benchmark-evidence-heading"><div><p className="eyebrow">BENCHMARK EVIDENCE</p><h2>원본 벤치마크 정보</h2><p>선택한 CPU·GPU에 카탈로그로 저장된 Cinebench R23·3DMark 점수와 정보 상태를 표시합니다.</p></div><span><FiActivity /> {evidences.filter((item) => item.status === "complete").length}/{evidences.length} 완전</span></div>
    <div className={`benchmark-evidence-build-snapshot ${buildSnapshot.status}`} data-testid="build-benchmark-snapshot"><div><span>견적 성능 정보 상태</span><strong>{buildBenchmarkSnapshotStatusText(buildSnapshot.status)}</strong></div><span>{buildSnapshot.presentScoreCount}/{buildSnapshot.expectedScoreCount}개 점수 · {buildSnapshot.parts.length}개 부품</span><p>{snapshotSummary}</p></div>
    <div className="benchmark-evidence-grid">{evidences.map((evidence) => <BenchmarkEvidenceCard evidence={evidence} key={evidence.partId} />)}</div>
    <p className="benchmark-evidence-note"><FiInfo /> 점수는 측정 설정·드라이버·시스템 조건에 따라 달라지는 카탈로그 참고값이며, 실제 FPS·프레임타임·작업 시간·절대 성능 순위를 보장하지 않습니다. 출처이 없거나 점수가 일부만 있으면 그대로 확인 필요로 표시합니다.</p>
  </section>;
}
