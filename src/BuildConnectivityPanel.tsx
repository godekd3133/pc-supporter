import { FiInfo } from "react-icons/fi";
import type { Finding, Part } from "../shared/types";
import { buildConnectivitySummaryFor } from "../shared/build-connectivity";

export function BuildConnectivityPanel({ motherboard, computerCase, findings, onFocusFinding }: { motherboard?: Part["specs"]; computerCase?: Part["specs"]; findings: Finding[]; onFocusFinding?: (ruleId: string) => void }) {
  const summary = buildConnectivitySummaryFor(motherboard, computerCase);
  if (summary.status === "not_applicable") return null;
  const statusLabel = summary.status === "pass" ? "연결 기준 확인" : summary.status === "review" ? "연결 주의" : "확인 필요";
  return <section className={`build-connectivity-panel ${summary.status}`} aria-label="팬·RGB 연결 자원" data-testid="build-connectivity-panel">
    <div className="build-connectivity-heading"><div><p className="eyebrow">CONNECTIVITY BUDGET</p><h2>팬·RGB 연결 자원</h2><p>케이스 기본 팬·RGB 장치와 메인보드 헤더·전압 정보를 같은 기준으로 대조합니다.</p></div><strong>{statusLabel}</strong></div>
    <div className="build-connectivity-grid">{summary.items.map((item) => { const hasFinding = findings.some((finding) => finding.ruleId === item.ruleId); return <article className={`build-connectivity-item ${item.status}`} key={item.id}><div className="build-connectivity-item-heading"><span>{item.label}</span><strong>{item.status === "pass" ? "확인됨" : item.status === "review" ? "주의" : "확인 필요"}</strong></div>{item.used !== undefined && item.capacity !== undefined && <div className="build-connectivity-meter"><span>{item.used} / {item.capacity}개</span><i><em style={{ width: `${Math.min(100, Math.max(0, item.capacity > 0 ? (item.used / item.capacity) * 100 : item.used > 0 ? 100 : 0))}%` }} /></i></div>}<p>{item.detail}</p>{hasFinding && onFocusFinding && <button className="text-button" type="button" onClick={() => onFocusFinding(item.ruleId)}>관련 판정 보기</button>}</article>; })}</div>
    <p className="build-connectivity-note"><FiInfo /> 케이스 기본 장치 기준이며, 추가한 쿨링팬·RGB 장치·허브의 상세 연결은 주변 부품 호환 점검에서 별도로 확인하세요. 헤더 수가 맞아도 5V ARGB와 12V RGB 전압을 혼용할 수 없습니다.</p>
  </section>;
}
