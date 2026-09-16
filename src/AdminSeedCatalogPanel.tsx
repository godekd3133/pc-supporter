import { useEffect, useState } from "react";
import { FiAlertTriangle, FiCheckCircle, FiDatabase, FiInfo, FiLoader, FiRefreshCw } from "react-icons/fi";
import type { CatalogSeedPreview, CatalogSeedPreviewConflict } from "../shared/catalog-seed-preview";
import { CATEGORY_LABELS, DATA_QUALITY_LABELS, PART_CATEGORIES } from "../shared/types";
import { api } from "./api";

const SOURCE_LABELS: Record<keyof CatalogSeedPreview["active"]["sourceCounts"], string> = {
  seed: "기본 정보",
  danawa: "다나와 수집",
  manual: "직접 확인"
};

const DIFFERENCE_LABELS: Record<CatalogSeedPreviewConflict["differences"][number], string> = {
  name: "이름",
  price: "가격",
  specs: "스펙"
};

function numberText(value: number | undefined) {
  return value === undefined ? "-" : value.toLocaleString("ko-KR");
}

function priceText(value: number | undefined) {
  return value === undefined ? "가격 기준 없음" : `${value.toLocaleString("ko-KR")}원`;
}

function sourceLabel(source: keyof CatalogSeedPreview["active"]["sourceCounts"]) {
  return SOURCE_LABELS[source];
}

function conflictDifferences(conflict: CatalogSeedPreviewConflict) {
  return conflict.differences.map((difference) => DIFFERENCE_LABELS[difference]).join(" · ");
}

export function AdminSeedCatalogPanel() {
  const [preview, setPreview] = useState<CatalogSeedPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api<CatalogSeedPreview>("/api/admin/catalog/seed-preview")
      .then((next) => { if (!cancelled) setPreview(next); })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "기본 정보 기준값 비교를 계산하지 못했습니다."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  return <section className="admin-seed-preview" data-testid="admin-seed-catalog-preview" aria-label="기본 정보 기준값 비교">
    <div className="admin-seed-preview-heading">
      <div>
        <p className="eyebrow">BASELINE AUDIT</p>
        <h2>기본 정보 기준값 비교</h2>
        <p>새 checkout의 기본 정보 부품과 현재 운영 카탈로그를 ID·범주 기준으로 비교합니다. 이 화면은 병합·삭제·덮어쓰기를 실행하지 않습니다.</p>
      </div>
      <div className="admin-seed-preview-actions">
        <span className="admin-seed-preview-readonly"><FiDatabase /> 읽기 전용</span>
        <button className="button button-light button-small" type="button" data-testid="admin-seed-catalog-preview-refresh" onClick={() => setRefreshKey((current) => current + 1)} disabled={loading}><FiRefreshCw className={loading ? "spin" : undefined} /> 다시 계산</button>
      </div>
    </div>
    {loading ? <div className="admin-seed-preview-state" role="status"><FiLoader className="spin" /> 현재 카탈로그와 기본 정보 기준값을 비교하는 중...</div> : error ? <div className="admin-seed-preview-state error" role="alert"><FiAlertTriangle /><span>{error}</span></div> : preview && <>
      <div className="admin-seed-preview-summary">
        <div className="admin-seed-preview-coverage">
          <span>starter 반영 coverage</span>
          <strong>{preview.coverage.coveragePercent.toFixed(1)}%</strong>
          <small>{numberText(preview.coverage.matchedCount)}개 확인 · {numberText(preview.coverage.missingCount)}개 현재 카탈로그에 없음</small>
          <div className="admin-seed-preview-track" role="progressbar" aria-label="starter 기준값 반영 coverage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={preview.coverage.coveragePercent}><span style={{ width: `${Math.min(100, Math.max(0, preview.coverage.coveragePercent))}%` }} /></div>
        </div>
        <div><span>기본 목록 부품</span><strong>{numberText(preview.starter.total)}개</strong><small>{numberText(preview.categoryRows.length)}개 핵심 범주</small></div>
        <div><span>현재 원본 카탈로그</span><strong>{numberText(preview.active.total)}개</strong><small>{preview.active.coreEligibleCount !== undefined ? `핵심 부품 ${numberText(preview.active.coreEligibleCount)}개` : "핵심 부품 별도 계산"}</small></div>
        <div className={preview.coverage.conflictCount > 0 ? "has-warning" : ""}><span>값 충돌</span><strong>{numberText(preview.coverage.conflictCount)}개</strong><small>{preview.coverage.conflictCount > 0 ? "이름·가격·스펙 재확인" : "ID 기준 충돌 없음"}</small></div>
      </div>
      <div className="admin-seed-preview-source-strip" data-testid="admin-seed-catalog-source-summary">
        <div><strong>현재 데이터 출처</strong><small>같은 부품이라도 source와 품질은 별도로 유지합니다.</small></div>
        {Object.entries(preview.active.sourceCounts).map(([source, count]) => <span key={source}><i className={`source-dot ${source}`} />{sourceLabel(source as keyof CatalogSeedPreview["active"]["sourceCounts"])} <b>{numberText(count)}</b></span>)}
        <div className="admin-seed-preview-quality"><strong>품질</strong>{Object.entries(preview.active.qualityCounts).map(([quality, count]) => <span key={quality}>{DATA_QUALITY_LABELS[quality as keyof CatalogSeedPreview["active"]["qualityCounts"]]} <b>{numberText(count)}</b></span>)}</div>
      </div>
      <div className="admin-seed-preview-grid">
        <section className="admin-seed-preview-table-card" aria-label="범주별 starter coverage">
          <div className="admin-seed-preview-subheading"><div><span>CATEGORY COVERAGE</span><strong>범주별 반영 상태</strong></div><small>starter ID 기준</small></div>
          <div className="admin-seed-preview-table-wrap"><table><caption>starter와 현재 카탈로그의 범주별 부품 비교</caption><thead><tr><th scope="col">범주</th><th scope="col">starter</th><th scope="col">현재</th><th scope="col">확인</th><th scope="col">coverage</th></tr></thead><tbody>{preview.categoryRows.map((row) => <tr key={row.category}><th scope="row">{CATEGORY_LABELS[row.category]}</th><td>{numberText(row.starterCount)}</td><td>{numberText(row.activeCount)}</td><td>{numberText(row.matchedCount)} / {numberText(row.missingCount)} 없음</td><td><span className={row.coveragePercent < 80 ? "review" : "good"}>{row.coveragePercent.toFixed(1)}%</span></td></tr>)}</tbody></table></div>
        </section>
        <section className="admin-seed-preview-missing-card" aria-label="현재 카탈로그에 없는 starter 부품">
          <div className="admin-seed-preview-subheading"><div><span>BASELINE GAPS</span><strong>현재 카탈로그에 없는 기준 부품</strong></div><small>{numberText(preview.missingItems.length)}개</small></div>
          {preview.missingItems.length > 0 ? <div className="admin-seed-preview-missing-list">{preview.missingItems.slice(0, 10).map((item) => <div key={`${item.category}:${item.id}`}><div><span>{CATEGORY_LABELS[item.category]}</span><strong>{item.name}</strong></div><small>{item.id} · {priceText(item.priceWon)}</small></div>)}{preview.missingItems.length > 10 && <p>외 {numberText(preview.missingItems.length - 10)}개는 API 상세 응답에서 확인할 수 있습니다.</p>}</div> : <div className="admin-seed-preview-empty"><FiCheckCircle /> 모든 starter ID가 현재 카탈로그에서 확인됩니다.</div>}
        </section>
      </div>
      {preview.conflicts.length > 0 && <section className="admin-seed-preview-conflicts" aria-label="starter 값 충돌 목록"><div className="admin-seed-preview-subheading"><div><span>REVIEW BEFORE MERGE</span><strong>병합 전 다시 확인할 값</strong></div><small>{numberText(preview.conflicts.length)}개</small></div><div className="admin-seed-preview-conflict-list">{preview.conflicts.slice(0, 8).map((conflict) => <article key={`${conflict.category}:${conflict.id}`}><div><span>{CATEGORY_LABELS[conflict.category]}</span><strong>{conflict.starterName}</strong></div><small>현재 · {conflict.activeName} · {sourceLabel(conflict.activeSource)} · {DATA_QUALITY_LABELS[conflict.activeDataQuality]}</small><em>차이 · {conflictDifferences(conflict)}</em></article>)}</div>{preview.conflicts.length > 8 && <p className="admin-seed-preview-more">외 {numberText(preview.conflicts.length - 8)}개 충돌은 JSON 응답의 conflicts에서 확인할 수 있습니다.</p>}</section>}
      <p className="admin-seed-preview-note"><FiInfo /> 대조 키는 <code>category:id</code>입니다. 같은 ID가 없다는 사실은 상품이 판매되지 않는다는 뜻이 아니며, live 수집 데이터에는 별도의 source product code가 있을 수 있습니다. 실제 카탈로그 반영은 기존 수집·확인 작업과 데이터 상태 정책을 거쳐야 합니다. 마지막 계산 {new Date(preview.generatedAt).toLocaleString("ko-KR")}.</p>
    </>}
  </section>;
}
