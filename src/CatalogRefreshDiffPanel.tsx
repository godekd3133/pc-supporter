import { FiArrowRight, FiCheckCircle } from "react-icons/fi";
import type { CatalogChangeValueDiff } from "../shared/types";
import { catalogRefreshValueText } from "../shared/catalog-refresh-report";
import { catalogChangeFieldLabelFor } from "../shared/catalog-spec-coverage";

function refreshDiffTestId(kind: "part" | "accessory") {
  return kind === "accessory" ? "accessory-detail-refresh-diff" : "catalog-detail-refresh-diff";
}

/** Shows the bounded before/after values returned by a source refresh. */
export function CatalogRefreshDiffPanel({ diffs, kind }: { diffs: CatalogChangeValueDiff[]; kind: "part" | "accessory" }) {
  const testId = refreshDiffTestId(kind);
  const title = kind === "accessory" ? "주변 부품 가격·사양 변경" : "부품 가격·사양 변경";
  return <section className={`catalog-refresh-diff ${kind}`} aria-label={title} data-testid={testId}>
    <div className="catalog-refresh-diff-heading">
      <div><strong>변경된 가격·사양</strong><small>이전 정보와 달라진 항목만 표시합니다.</small></div>
      <span>{diffs.length > 0 ? `${diffs.length}개 변경` : "변경 없음"}</span>
    </div>
    {diffs.length > 0 ? <div className="catalog-refresh-diff-list">{diffs.slice(0, 8).map((diff) => <div className="catalog-refresh-diff-row" key={diff.field}><strong>{catalogChangeFieldLabelFor(diff.field)}</strong><div><em>{catalogRefreshValueText(diff.previous)}</em><FiArrowRight aria-hidden="true" /><em>{catalogRefreshValueText(diff.next)}</em></div></div>)}{diffs.length > 8 && <small className="catalog-refresh-diff-more">그 외 {diffs.length - 8}개 항목이 바뀌었어요.</small>}</div> : <p className="catalog-refresh-diff-empty"><FiCheckCircle /> 가격과 사양이 바뀌지 않았어요.</p>}
  </section>;
}
