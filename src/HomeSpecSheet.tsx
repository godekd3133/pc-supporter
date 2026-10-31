// Home parts sheet. Lazy so the first route stays inside its JS budget.
import type { CSSProperties } from "react";
import { FiArrowRight } from "react-icons/fi";
import { compatibilityDisplayStatusFor } from "../shared/compatibility-display-status";
import { type BuildSelection, type CompatibilityResult, type Part, type PartCategory, CATEGORY_LABELS, PART_CATEGORIES, isKnownPrice } from "../shared/types";
import { accessorySelections, selectionList } from "./build-edit";
import { CATEGORY_ICONS } from "./category-icons";

const SPEC_SHEET_ICONS = CATEGORY_ICONS;

export function HomeSpecSheet({ build, result, resultIsStale, partMap, onOpenResult }: { build: BuildSelection; result: CompatibilityResult | null; resultIsStale: boolean; partMap: ReadonlyMap<string, Part>; onOpenResult: () => void }) {
  const rows = PART_CATEGORIES.map((category) => {
    const selections = selectionList(build, category);
    const boxedCooler = category === "cooler" && selections.length === 0 && build.cpu ? partMap.get(build.cpu.partId)?.specs.coolerIncluded === true : false;
    const names = selections.map((selection) => `${partMap.get(selection.partId)?.name ?? "부품 정보 없음"}${selection.quantity > 1 ? ` ×${selection.quantity}` : ""}`).join(" / ");
    const priceWon = selections.reduce((total, selection) => {
      const price = partMap.get(selection.partId)?.priceWon;
      return isKnownPrice(price) ? total + price * selection.quantity : total;
    }, 0);
    return { category, meta: { label: CATEGORY_LABELS[category], Icon: SPEC_SHEET_ICONS[category] }, names: names || (boxedCooler ? "CPU 기본 쿨러" : ""), filled: selections.length > 0 || boxedCooler, priceWon };
  });
  const filledCount = rows.filter((row) => row.filled).length;
  const hasBuild = filledCount > 0 || accessorySelections(build).length > 0;
  const selectedPartCount = PART_CATEGORIES.reduce((total, category) => total + selectionList(build, category).reduce((count, selection) => count + selection.quantity, 0), 0);
  const accessoryCount = accessorySelections(build).reduce((total, selection) => total + selection.quantity, 0);
  const totalWon = rows.reduce((total, row) => total + row.priceWon, 0);
  const resultIsCurrent = Boolean(result && !resultIsStale);
  const displayStatus = result ? compatibilityDisplayStatusFor(result) : undefined;
  const accessoryCompatibility = result?.accessoryCompatibility;
  const warningCount = (result?.warningCount ?? 0) + (accessoryCompatibility?.warningCount ?? 0);
  const status = !hasBuild ? "부품을 고르면 채워져요" : !result ? "호환 확인 전" : resultIsStale ? "구성이 바뀌었어요" : displayStatus === "incompatible" ? result.status === "incompatible" ? "호환되지 않는 부품이 있어요" : "주변 부품의 호환을 확인해 주세요" : displayStatus === "needs_review" ? result.status === "needs_review" ? "확인할 정보가 있어요" : "주변 부품 정보가 부족해요" : warningCount > 0 ? "호환되지만 확인할 항목이 있어요" : "호환에 문제가 없어요";
  const statusTone = !hasBuild ? "idle" : !result || resultIsStale ? "review" : displayStatus ?? "review";
  const resultCounts = resultIsCurrent
    ? [
        result!.blockerCount > 0 ? `호환 불가 ${result!.blockerCount}개` : "",
        result!.warningCount > 0 ? `주의 ${result!.warningCount}개` : "",
        result!.unknownCount > 0 ? `확인할 정보 ${result!.unknownCount}개` : "",
        accessoryCompatibility?.blockerCount ? `주변 부품 호환 불가 ${accessoryCompatibility.blockerCount}개` : "",
        accessoryCompatibility?.warningCount ? `주변 부품 주의 ${accessoryCompatibility.warningCount}개` : "",
        accessoryCompatibility?.unknownCount ? `주변 부품 확인 필요 ${accessoryCompatibility.unknownCount}개` : ""
      ].filter(Boolean).join(" / ") || "부품 간 호환 문제를 찾지 못했어요."
    : resultIsStale && hasBuild ? "부품 구성이 바뀌어 이전 결과는 현재 견적에 적용되지 않아요." : "";
  return <section className={`home-spec-sheet${hasBuild ? " has-build" : ""}`} aria-label={hasBuild ? "현재 부품 구성" : "견적서 미리보기"} data-testid={hasBuild ? "home-current-build-preview" : undefined}>
    <header className="home-spec-sheet-head">
      <div><span className="home-spec-sheet-kicker">{hasBuild ? "현재 구성" : "견적서"}</span><span className="home-spec-sheet-progress"><b>{filledCount}</b>/{rows.length}</span></div>
      <div className={`home-spec-sheet-status ${statusTone}`}><span className="status-dot" /><strong>{status}</strong></div>
      {resultCounts && <p>{resultCounts}</p>}
    </header>
    <ol className="home-spec-rows">
      {rows.map(({ category, meta, names, filled, priceWon }, index) => { const RowIcon = meta.Icon; return <li className={filled ? "home-spec-row is-filled" : "home-spec-row"} key={category} style={{ "--row-index": index } as CSSProperties}>
        <span className="home-spec-icon" aria-hidden="true"><RowIcon /></span>
        <span className="home-spec-label">{meta.label}</span>
        <span className="home-spec-name">{filled ? names : <span className="home-spec-placeholder" aria-label="미선택" />}</span>
        <span className="home-spec-price">{priceWon > 0 ? priceWon.toLocaleString("ko-KR") : ""}</span>
      </li>; })}
    </ol>
    <footer className="home-spec-sheet-foot">
      <span>{hasBuild ? `부품 ${selectedPartCount}개${accessoryCount > 0 ? ` / 주변 부품 ${accessoryCount}개` : ""}` : "예상 합계"}</span>
      <strong>{totalWon > 0 ? <>{totalWon.toLocaleString("ko-KR")}<small>원</small></> : <span className="home-spec-total-empty">—</span>}</strong>
    </footer>
    {resultIsCurrent && <button className="text-button home-current-preview-link" type="button" onClick={onOpenResult}>호환 결과 보기 <FiArrowRight /></button>}
  </section>;
}

