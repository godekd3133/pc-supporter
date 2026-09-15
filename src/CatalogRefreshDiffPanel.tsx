import { FiArrowRight, FiCheckCircle, FiInfo } from "react-icons/fi";
import type { CatalogChangeValueDiff } from "../shared/types";
import { catalogRefreshValueText } from "../shared/catalog-refresh-report";

function refreshDiffTestId(kind: "part" | "accessory") {
  return kind === "accessory" ? "accessory-detail-refresh-diff" : "catalog-detail-refresh-diff";
}

/** Shows the bounded before/after values returned by a source refresh. */
export function CatalogRefreshDiffPanel({ diffs, kind }: { diffs: CatalogChangeValueDiff[]; kind: "part" | "accessory" }) {
  const testId = refreshDiffTestId(kind);
  const title = kind === "accessory" ? "주변 부품 갱신 정보" : "부품 갱신 정보";
  return <section className={`catalog-refresh-diff ${kind}`} aria-label={title} data-testid={testId}>
    <div className="catalog-refresh-diff-heading">
      <div><span className="mini-label">VALUE DIFF</span><strong>확인된 실제 값</strong><small>원문 재확인 응답에서 달라진 값만 표시합니다. 변경이 없으면 추세를 추정하지 않습니다.</small></div>
      <span>{diffs.length > 0 ? `${diffs.length}개 변화` : "변경 없음"}</span>
    </div>
    {diffs.length > 0 ? <div className="catalog-refresh-diff-list">{diffs.slice(0, 8).map((diff) => <div className="catalog-refresh-diff-row" key={diff.field}><strong>{diff.field}</strong><div><em>{catalogRefreshValueText(diff.previous)}</em><FiArrowRight aria-hidden="true" /><em>{catalogRefreshValueText(diff.next)}</em></div></div>)}{diffs.length > 8 && <small className="catalog-refresh-diff-more">그 외 값 변화 {diffs.length - 8}건은 변경 이력에서 확인할 수 있습니다.</small>}</div> : <p className="catalog-refresh-diff-empty"><FiCheckCircle /> 이번 원문 확인에서는 저장된 가격·스펙 값이 달라지지 않았습니다.</p>}
    <p className="catalog-refresh-diff-note"><FiInfo /> 값 변화는 원문 재확인 정보이며, 실제 재고·배송·호환 가능 여부를 대신 확정하지 않습니다.</p>
  </section>;
}
