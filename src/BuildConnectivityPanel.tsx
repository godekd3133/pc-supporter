import { FiInfo } from "react-icons/fi";
import type { Finding, Part } from "../shared/types";
import { buildConnectivitySummaryFor } from "../shared/build-connectivity";

export function BuildConnectivityPanel({ motherboard, computerCase, findings, onFocusFinding }: { motherboard?: Part["specs"]; computerCase?: Part["specs"]; findings: Finding[]; onFocusFinding?: (ruleId: string) => void }) {
  const summary = buildConnectivitySummaryFor(motherboard, computerCase);
  if (summary.status === "not_applicable") return null;
  const statusLabel = summary.status === "pass" ? "연결 확인" : summary.status === "review" ? "연결 주의" : "확인 필요";
  return <section className={`build-connectivity-panel ${summary.status}`} aria-label="팬·RGB 연결 확인" data-testid="build-connectivity-panel" tabIndex={-1}>
    <div className="build-connectivity-heading"><div><p className="eyebrow">팬·RGB 연결</p><h2>팬·RGB 연결 확인</h2><p>케이스에 기본으로 달린 팬과 RGB 장치를 메인보드에 연결할 수 있는지 살펴봅니다.</p></div><strong>{statusLabel}</strong></div>
    <div className="build-connectivity-grid">{summary.items.map((item) => { const hasFinding = findings.some((finding) => finding.ruleId === item.ruleId); return <article className={`build-connectivity-item ${item.status}`} key={item.id}><div className="build-connectivity-item-heading"><span>{item.label}</span><strong>{item.status === "pass" ? "확인됨" : item.status === "review" ? "주의" : "확인 필요"}</strong></div>{item.used !== undefined && item.capacity !== undefined && <div className="build-connectivity-meter"><span>{item.used} / {item.capacity}개</span><i><em style={{ width: `${Math.min(100, Math.max(0, item.capacity > 0 ? (item.used / item.capacity) * 100 : item.used > 0 ? 100 : 0))}%` }} /></i></div>}<p>{item.detail}</p>{hasFinding && onFocusFinding && <button className="text-button" type="button" onClick={() => onFocusFinding(item.ruleId)}>관련 결과 보기</button>}</article>; })}</div>
    <p className="build-connectivity-note"><FiInfo /> 케이스에 기본으로 달린 장치만 확인했어요. 추가 팬·RGB 장치나 허브는 주변 부품 점검에서 확인해 주세요. 5V ARGB 장치를 12V RGB에, 12V RGB 장치를 5V ARGB에 연결하면 안 됩니다.</p>
  </section>;
}
