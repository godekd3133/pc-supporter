import { FiActivity } from "react-icons/fi";
import { benchmarkEvidenceForPart } from "../shared/benchmark-evidence";
import type { BenchmarkEvidencePart } from "../shared/benchmark-evidence";
import type { BuildBenchmarkSnapshot } from "../shared/build-benchmark-snapshot";
import type { Part } from "../shared/types";

function BenchmarkScoreCard({ evidence }: { evidence: BenchmarkEvidencePart }) {
  const rows = evidence.rows.filter((row) => row.value !== undefined);
  if (rows.length === 0) return null;
  return <article className={`benchmark-evidence-card ${evidence.status}`} data-testid={`benchmark-evidence-${evidence.category}`}>
    <div className="benchmark-evidence-card-heading"><div><span>{evidence.category === "cpu" ? "CPU" : "GPU"}</span><strong>{evidence.name}</strong></div></div>
    <div className="benchmark-evidence-score-grid">{rows.map((row) => <div key={row.key}><span>{row.label}</span><strong>{row.value!.toLocaleString("ko-KR")}{row.unit}</strong></div>)}</div>
  </article>;
}

export function BenchmarkEvidencePanel({ cpu, gpu, snapshot: _snapshot }: { cpu?: Part; gpu?: Part; snapshot?: BuildBenchmarkSnapshot }) {
  const scores = [benchmarkEvidenceForPart(cpu), benchmarkEvidenceForPart(gpu)].filter((item): item is BenchmarkEvidencePart => Boolean(item && item.rows.some((row) => row.value !== undefined)));
  if (scores.length === 0) return null;
  return <section className="benchmark-evidence-panel" aria-label="CPU와 GPU 성능 점수" data-testid="benchmark-evidence-panel">
    <div className="benchmark-evidence-heading"><div><h2>CPU·GPU 성능 점수</h2><p>선택한 부품의 Cinebench R23·3DMark 점수예요.</p></div><span><FiActivity /> {scores.length}개 부품</span></div>
    <div className="benchmark-evidence-grid">{scores.map((score) => <BenchmarkScoreCard evidence={score} key={score.partId} />)}</div>
  </section>;
}
