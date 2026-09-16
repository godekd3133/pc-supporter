import { FiCheckCircle, FiExternalLink, FiInfo } from "react-icons/fi";
import { catalogMissingFieldLabelFor } from "../shared/catalog-spec-coverage";
import { physicalSourceCheckFreshness, physicalSourceCheckNeedsReview } from "../shared/physical-source-check";
import type { Part, PhysicalSourceCheck } from "../shared/types";
import { CATEGORY_LABELS, DATA_FRESHNESS_LABELS } from "../shared/types";
import { safeHttpsUrl } from "./safe-source-url";

export function catalogSpecProvenanceFieldLabelsFor(part: Part) {
  return (part.specs.catalogSpecProvenance?.fields ?? []).map((field) => catalogMissingFieldLabelFor(field));
}

function catalogSpecProvenanceDate(value: string) {
  return Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString("ko-KR") : value;
}

function catalogSpecSourceCheckLabel(check: PhysicalSourceCheck | undefined) {
  if (!check) return "페이지 확인 전";
  return physicalSourceCheckNeedsReview(check, true) ? "정보 재확인 필요" : "페이지·모델 확인됨";
}

export function CatalogSpecProvenance({ part, compact = false }: { part: Part; compact?: boolean }) {
  const provenance = part.specs.catalogSpecProvenance;
  if (!provenance) return null;
  const sourceUrl = safeHttpsUrl(provenance.sourceUrl);
  const fields = catalogSpecProvenanceFieldLabelsFor(part);
  const sourceCheck = provenance.sourceCheck;
  const sourceCheckNeedsReview = physicalSourceCheckNeedsReview(sourceCheck, true);
  const sourceCheckFreshness = sourceCheck ? physicalSourceCheckFreshness(sourceCheck) : undefined;
  return <section className={`catalog-spec-provenance${compact ? " compact" : ""}`} aria-label={`${part.name} 제조사 정보 보강`} data-testid="catalog-spec-provenance"><div className="catalog-spec-provenance-heading"><div><strong><FiCheckCircle /> 제조사 정보로 보강된 값</strong><small>{CATEGORY_LABELS[part.category]} · 직접 확인한 정보</small></div><span>{fields.length}개 필드</span></div><div className="catalog-spec-provenance-fields">{fields.length > 0 ? fields.map((field) => <span key={field}>{field}</span>) : <span>보강 필드 확인 필요</span>}</div><p className="catalog-spec-provenance-note"><FiInfo /> 자동 추정값이 아니라 등록된 제조사 정보를 기준으로 적용한 값입니다.</p><div className="catalog-spec-provenance-check" data-testid="catalog-spec-provenance-source-check"><span className={sourceCheckNeedsReview ? "review" : sourceCheck ? "verified" : "pending"}>정보 점검 · {catalogSpecSourceCheckLabel(sourceCheck)}</span><small>{sourceCheck ? `${sourceCheck.detail ?? "상세 없음"}${sourceCheck.httpStatus ? ` · HTTP ${sourceCheck.httpStatus}` : ""}${sourceCheckFreshness && sourceCheckFreshness !== "fresh" ? ` · ${DATA_FRESHNESS_LABELS[sourceCheckFreshness]}` : ""}` : "저장된 제조사 페이지에 접근해 모델/SKU 일치를 확인하기 전입니다."}</small></div><div className="catalog-spec-provenance-meta"><span>제조사 모델/SKU <strong>{provenance.manufacturerModel}</strong></span><span>확인 갱신 <strong>{catalogSpecProvenanceDate(provenance.updatedAt)}</strong></span></div><div className="catalog-spec-provenance-source"><span>출처 메모 <strong>{provenance.sourceNote}</strong></span>{sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer"><FiExternalLink /> 제조사 페이지</a>}</div></section>;
}
