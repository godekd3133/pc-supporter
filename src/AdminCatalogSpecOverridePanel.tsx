import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { FiAlertTriangle, FiCheckCircle, FiDatabase, FiEdit3, FiExternalLink, FiInfo, FiLoader, FiSave, FiSearch, FiTrash2, FiXCircle } from "react-icons/fi";
import type { CatalogSpecOverride, CatalogSpecOverrideValueType } from "../shared/catalog-spec-overrides";
import { catalogSpecOverrideFieldTypeFor } from "../shared/catalog-spec-overrides";
import { catalogSpecReviewFieldsFor } from "../shared/catalog-spec-review";
import { catalogMissingFieldLabelFor } from "../shared/catalog-spec-coverage";
import { physicalSourceCheckFreshness } from "../shared/physical-source-check";
import { CATEGORY_LABELS, DATA_FRESHNESS_LABELS, DATA_QUALITY_LABELS, PART_CATEGORIES, type CatalogSpecSourceCheckBatchResponse, type Part, type PartCategory, type PhysicalSourceCheck, type PhysicalSourceCheckHistoryEntry } from "../shared/types";
import { api } from "./api";
import { safeHttpsUrl } from "./safe-source-url";

type ValidationItem = {
  partId: string;
  partName?: string;
  category?: PartCategory;
  valid: boolean;
  errors: string[];
  operation?: "create" | "update" | "unchanged";
  changedFields?: string[];
};

type ValidationResponse = {
  validCount: number;
  invalidCount: number;
  items: ValidationItem[];
};

type OverrideListItem = CatalogSpecOverride & {
  partName?: string;
  remainingMissingFields?: string[];
  priceWon?: number;
};

function qualityText(part: Part) {
  return DATA_QUALITY_LABELS[part.dataQuality] ?? part.dataQuality;
}

function parseFieldValue(type: CatalogSpecOverrideValueType, raw: string): string | number | boolean | string[] | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  if (type === "number") {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : undefined;
  }
  if (type === "boolean") {
    if (value === "true" || value === "예") return true;
    if (value === "false" || value === "아니오") return false;
    return undefined;
  }
  if (type === "string_list") {
    const values = value.split(",").map((item) => item.trim()).filter(Boolean);
    return values.length > 0 ? values : undefined;
  }
  return value;
}

function fieldInputValue(type: CatalogSpecOverrideValueType) {
  return type === "number" ? "number" : "text";
}

function formatDate(value: string) {
  return Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" }) : value;
}

const SOURCE_CHECK_STATUS_LABELS: Record<PhysicalSourceCheck["status"], string> = { reachable: "URL 접근 가능", redirected: "리다이렉트 후 접근 가능", http_error: "HTTP 오류", unreachable: "접근 실패", blocked: "점검 차단", identity_mismatch: "모델 식별 불일치" };
const SOURCE_CHECK_IDENTITY_LABELS: Record<PhysicalSourceCheck["identityStatus"], string> = { matched: "모델 확인", not_found: "모델 미확인", manual_required: "문서 직접 확인", not_checked: "모델 점검 안 함" };

function sourceCheckText(check: PhysicalSourceCheck | undefined) {
  if (!check) return "페이지 확인 전";
  const freshness = physicalSourceCheckFreshness(check);
  return `${SOURCE_CHECK_STATUS_LABELS[check.status]} · ${SOURCE_CHECK_IDENTITY_LABELS[check.identityStatus]}${check.httpStatus ? ` · HTTP ${check.httpStatus}` : ""}${freshness !== "fresh" ? ` · ${DATA_FRESHNESS_LABELS[freshness]}` : ""}`;
}

function AdminCatalogSpecOverrideList({ items, loading, error, onRefresh, onDelete, onCheckSource, onCheckSourcesBatch, sourceBatchNextOffset, sourceBatchResult, sourceCheckingPartId, sourceHistoryPartId, sourceHistory, sourceHistoryLoading, sourceHistoryError, onToggleHistory }: { items: OverrideListItem[]; loading: boolean; error: string | null; onRefresh: () => void; onDelete: (partId: string) => void; onCheckSource: (partId: string) => void; onCheckSourcesBatch: () => void; sourceBatchNextOffset: number | null; sourceBatchResult: CatalogSpecSourceCheckBatchResponse | null; sourceCheckingPartId: string | null; sourceHistoryPartId: string | null; sourceHistory: PhysicalSourceCheckHistoryEntry[]; sourceHistoryLoading: boolean; sourceHistoryError: string | null; onToggleHistory: (partId: string) => void }) {
  return <section className="catalog-spec-override-list" data-testid="admin-catalog-spec-override-list" aria-label="저장된 수동 사양 보완"><div className="catalog-spec-override-list-heading"><div><strong>저장된 수동 사양 보완</strong><small>기본 카탈로그 정보는 그대로 두고, 확인한 값을 따로 저장합니다.</small></div><div><button className="text-button" type="button" onClick={onRefresh} disabled={loading || sourceCheckingPartId !== null}><FiSearch className={loading ? "spin" : undefined} /> 다시 확인</button><button className="text-button" type="button" onClick={onCheckSourcesBatch} disabled={loading || sourceCheckingPartId !== null || items.every((item) => !item.sourceUrl)}><FiCheckCircle /> {sourceBatchNextOffset !== null ? "다음 50개 정보 점검" : "최대 50개 정보 점검"}</button></div></div>{sourceBatchResult && <p className="catalog-spec-override-batch-progress" data-testid="catalog-spec-source-check-batch-progress">{sourceBatchResult.checkedCount > 0 ? `이번 점검 ${sourceBatchResult.offset + 1}–${sourceBatchResult.offset + sourceBatchResult.checkedCount} / ${sourceBatchResult.totalCandidates}개` : "이번 묶음에서 점검할 항목 없음"} · {sourceBatchResult.nextOffset !== undefined ? `다음 ${sourceBatchResult.nextOffset + 1}번부터 계속` : "현재 조건 점검 완료"}</p>}{loading && items.length === 0 ? <p className="catalog-spec-override-state"><FiLoader className="spin" /> 저장된 보완값을 불러오는 중...</p> : error && items.length === 0 ? <p className="catalog-spec-override-state error"><FiAlertTriangle /> {error}</p> : items.length === 0 ? <p className="catalog-spec-override-state"><FiInfo /> 아직 저장된 수동 사양 보완이 없습니다.</p> : <div className="catalog-spec-override-list-items">{items.map((item) => { const sourceUrl = safeHttpsUrl(item.sourceUrl); const sourceChecking = sourceCheckingPartId === item.partId; const historyOpen = sourceHistoryPartId === item.partId; return <article key={item.partId}><div><strong>{item.partName ?? item.partId}</strong><small>{CATEGORY_LABELS[item.category]} · {item.partId} · {formatDate(item.updatedAt)}</small><small>제조사 {item.manufacturerModel} · {Object.keys(item.fields).join(" · ")}</small><small>{item.sourceNote}</small><small className={`catalog-spec-override-source-check ${item.sourceCheck ? item.sourceCheck.status : "pending"}`}>정보 점검 · {sourceCheckText(item.sourceCheck)}</small>{item.remainingMissingFields && item.remainingMissingFields.length > 0 && <small className="catalog-spec-override-remaining">남은 누락 {item.remainingMissingFields.join(" · ")}</small>}</div><div>{sourceUrl && <a className="text-button" href={sourceUrl} target="_blank" rel="noreferrer"><FiExternalLink /> 정보</a>}<button className="text-button" type="button" onClick={() => onCheckSource(item.partId)} disabled={sourceCheckingPartId !== null}>{sourceChecking ? <><FiLoader className="spin" /> 점검 중...</> : "정보 점검"}</button><button className="text-button" type="button" onClick={() => onToggleHistory(item.partId)} disabled={sourceCheckingPartId !== null}>{historyOpen ? "이력 닫기" : "이력 보기"}</button><button className="text-button danger-text-button" type="button" onClick={() => onDelete(item.partId)} disabled={sourceCheckingPartId !== null}><FiTrash2 /> 제거</button></div>{historyOpen && <div className="catalog-spec-override-source-history">{sourceHistoryLoading ? <span><FiLoader className="spin" /> 점검 이력 불러오는 중...</span> : sourceHistoryError ? <span className="error"><FiAlertTriangle /> {sourceHistoryError}</span> : sourceHistory.length === 0 ? <span><FiInfo /> 저장된 점검 이력이 없습니다.</span> : sourceHistory.slice(0, 6).map((entry) => <div key={entry.id}><span>{entry.transition === "initial" ? "최초" : entry.transition === "changed" ? "상태 변경" : "상태 유지"} · {formatDate(entry.recordedAt)}</span><strong>{sourceCheckText(entry.sourceCheck)}</strong><small>{entry.sourceCheck.detail ?? "상세 없음"}</small></div>)}</div>}</article>; })}</div>}</section>;
}

export function AdminCatalogSpecOverridePanel({ onToast }: { onToast: (message: string) => void }) {
  const [partQuery, setPartQuery] = useState("");
  const [partCategory, setPartCategory] = useState<PartCategory>("gpu");
  const [partResults, setPartResults] = useState<Part[]>([]);
  const [partSearching, setPartSearching] = useState(false);
  const [selectedPart, setSelectedPart] = useState<Part | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [manufacturerModel, setManufacturerModel] = useState("");
  const [sourceNote, setSourceNote] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [validation, setValidation] = useState<ValidationResponse | null>(null);
  const [validatedInput, setValidatedInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkJson, setBulkJson] = useState("");
  const [bulkValidation, setBulkValidation] = useState<ValidationResponse | null>(null);
  const [bulkValidatedInput, setBulkValidatedInput] = useState("");
  const [overrides, setOverrides] = useState<OverrideListItem[]>([]);
  const [overridesLoading, setOverridesLoading] = useState(true);
  const [overridesError, setOverridesError] = useState<string | null>(null);
  const [overrideRefreshNonce, setOverrideRefreshNonce] = useState(0);
  const [sourceCheckingPartId, setSourceCheckingPartId] = useState<string | null>(null);
  const [sourceHistoryPartId, setSourceHistoryPartId] = useState<string | null>(null);
  const [sourceHistory, setSourceHistory] = useState<PhysicalSourceCheckHistoryEntry[]>([]);
  const [sourceHistoryLoading, setSourceHistoryLoading] = useState(false);
  const [sourceHistoryError, setSourceHistoryError] = useState<string | null>(null);
  const [sourceBatchNextOffset, setSourceBatchNextOffset] = useState<number | null>(null);
  const [sourceBatchResult, setSourceBatchResult] = useState<CatalogSpecSourceCheckBatchResponse | null>(null);
  const partSearchRequestVersionRef = useRef(0);
  const sourceHistoryRequestVersionRef = useRef(0);
  const mountedRef = useRef(false);
  const mutationRequestVersionRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      partSearchRequestVersionRef.current += 1;
      sourceHistoryRequestVersionRef.current += 1;
      mutationRequestVersionRef.current += 1;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setOverridesLoading(true);
    setOverridesError(null);
    void api<{ items: OverrideListItem[] }>("/api/admin/catalog-spec-overrides")
      .then((payload) => { if (!cancelled) setOverrides(payload.items); })
      .catch((reason: unknown) => { if (!cancelled) setOverridesError(reason instanceof Error ? reason.message : "저장된 수동 사양 보완값을 불러오지 못했습니다."); })
      .finally(() => { if (!cancelled) setOverridesLoading(false); });
    return () => { cancelled = true; };
  }, [overrideRefreshNonce]);

  const editableFields = useMemo(() => selectedPart ? catalogSpecReviewFieldsFor(selectedPart.category).filter((field) => selectedPart.missingFields.includes(field.field) && catalogSpecOverrideFieldTypeFor(selectedPart.category, field.field) !== undefined) : [], [selectedPart]);

  function resetSourceBatchProgress() {
    setSourceBatchNextOffset(null);
    setSourceBatchResult(null);
  }

  function refreshOverrides() {
    resetSourceBatchProgress();
    setOverrideRefreshNonce((current) => current + 1);
  }

  function clearPartSearchEditor() {
    partSearchRequestVersionRef.current += 1;
    setPartResults([]);
    setSelectedPart(null);
    setFieldValues({});
    setManufacturerModel("");
    setSourceNote("");
    setSourceUrl("");
    setValidation(null);
    setValidatedInput("");
  }

  async function searchParts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearPartSearchEditor();
    const requestVersion = partSearchRequestVersionRef.current;
    setPartSearching(true);
    try {
      const payload = await api<{ items: Part[] }>(`/api/parts?category=${encodeURIComponent(partCategory)}&q=${encodeURIComponent(partQuery.trim())}&quality=all&listingPolicy=all&sort=name&limit=12`);
      if (partSearchRequestVersionRef.current !== requestVersion) return;
      setPartResults(payload.items);
      if (payload.items.length === 0) onToast("조건에 맞는 핵심 부품을 찾지 못했습니다.");
    } catch (reason: unknown) {
      if (partSearchRequestVersionRef.current === requestVersion) onToast(reason instanceof Error ? reason.message : "부품 검색에 실패했습니다.");
    } finally {
      if (partSearchRequestVersionRef.current === requestVersion) setPartSearching(false);
    }
  }

  function selectPart(part: Part) {
    setSelectedPart(part);
    setFieldValues(Object.fromEntries(catalogSpecReviewFieldsFor(part.category).map((field) => [field.field, ""])));
    setManufacturerModel(part.model ?? part.name);
    setSourceUrl(part.danawaUrl ?? "");
    setSourceNote("");
    setValidation(null);
    setValidatedInput("");
  }

  useEffect(() => {
    clearPartSearchEditor();
  }, [partCategory]);

  function singleInput() {
    if (!selectedPart) return undefined;
    const fields: Record<string, unknown> = {};
    for (const field of editableFields) {
      const type = catalogSpecOverrideFieldTypeFor(selectedPart.category, field.field);
      const value = type ? parseFieldValue(type, fieldValues[field.field] ?? "") : undefined;
      if (value !== undefined) fields[field.field] = value;
    }
    return { items: [{ partId: selectedPart.id, category: selectedPart.category, fields, manufacturerModel, sourceNote, sourceUrl }] };
  }

  function jsonForInput(input: unknown) {
    return JSON.stringify(input);
  }

  async function validateSingle() {
    const input = singleInput();
    if (!input) {
      onToast("수동으로 보완할 부품을 먼저 선택해 주세요.");
      return;
    }
    const serialized = jsonForInput(input);
    const requestVersion = ++mutationRequestVersionRef.current;
    const isCurrent = () => mountedRef.current && mutationRequestVersionRef.current === requestVersion;
    setValidatedInput("");
    try {
      const result = await api<ValidationResponse>("/api/admin/catalog-spec-overrides/batch/validate", { method: "POST", body: serialized });
      if (!isCurrent()) return;
      setValidation(result);
      if (result.invalidCount === 0) setValidatedInput(serialized);
      onToast(result.invalidCount === 0 ? "수동 사양 보완값을 저장할 수 있습니다." : "저장할 수 없는 항목이 있습니다.");
    } catch (reason: unknown) {
      if (isCurrent()) onToast(reason instanceof Error ? reason.message : "수동 사양 보완값 확인에 실패했습니다.");
    }
  }

  async function saveSingle() {
    const input = singleInput();
    if (!input) return;
    const serialized = jsonForInput(input);
    if (validatedInput !== serialized || !validation || validation.invalidCount > 0) {
      onToast("저장 전 최신 JSON 확인을 먼저 통과해 주세요.");
      return;
    }
    const requestVersion = ++mutationRequestVersionRef.current;
    const isCurrent = () => mountedRef.current && mutationRequestVersionRef.current === requestVersion;
    setSaving(true);
    try {
      const result = await api<{ saved: boolean; items: OverrideListItem[] }>("/api/admin/catalog-spec-overrides/batch", { method: "PUT", body: serialized });
      if (!isCurrent()) return;
      setOverrides(result.items);
      setValidation(null);
      setValidatedInput("");
      setFieldValues({});
      setSelectedPart(null);
      resetSourceBatchProgress();
      window.dispatchEvent(new Event("pc-supporter:catalog-meta-refresh"));
      onToast("수동 사양 보완값을 저장하고 호환 정보를 다시 계산했습니다.");
    } catch (reason: unknown) {
      if (isCurrent()) onToast(reason instanceof Error ? reason.message : "수동 사양 보완값을 저장하지 못했습니다.");
    } finally {
      if (isCurrent()) setSaving(false);
    }
  }

  async function validateBulk() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(bulkJson);
    } catch {
      onToast("일괄 입력 JSON 형식을 확인해 주세요.");
      return;
    }
    const serialized = jsonForInput(parsed);
    const requestVersion = ++mutationRequestVersionRef.current;
    const isCurrent = () => mountedRef.current && mutationRequestVersionRef.current === requestVersion;
    setBulkValidatedInput("");
    try {
      const result = await api<ValidationResponse>("/api/admin/catalog-spec-overrides/batch/validate", { method: "POST", body: serialized });
      if (!isCurrent()) return;
      setBulkValidation(result);
      if (result.invalidCount === 0) setBulkValidatedInput(serialized);
      onToast(result.invalidCount === 0 ? "일괄 입력값을 저장할 수 있습니다." : "일괄 입력값에 수정할 항목이 있습니다.");
    } catch (reason: unknown) {
      if (isCurrent()) onToast(reason instanceof Error ? reason.message : "일괄 입력값 확인에 실패했습니다.");
    }
  }

  async function saveBulk() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(bulkJson);
    } catch {
      return;
    }
    const serialized = jsonForInput(parsed);
    if (bulkValidatedInput !== serialized || !bulkValidation || bulkValidation.invalidCount > 0) {
      onToast("일괄 저장 전 최신 JSON 확인을 먼저 통과해 주세요.");
      return;
    }
    const requestVersion = ++mutationRequestVersionRef.current;
    const isCurrent = () => mountedRef.current && mutationRequestVersionRef.current === requestVersion;
    setSaving(true);
    try {
      const result = await api<{ saved: boolean; items: OverrideListItem[] }>("/api/admin/catalog-spec-overrides/batch", { method: "PUT", body: serialized });
      if (!isCurrent()) return;
      setOverrides(result.items);
      setBulkValidation(null);
      setBulkValidatedInput("");
      resetSourceBatchProgress();
      window.dispatchEvent(new Event("pc-supporter:catalog-meta-refresh"));
      onToast("수동 사양 보완값을 일괄 저장했습니다.");
    } catch (reason: unknown) {
      if (isCurrent()) onToast(reason instanceof Error ? reason.message : "수동 사양 보완값을 일괄 저장하지 못했습니다.");
    } finally {
      if (isCurrent()) setSaving(false);
    }
  }

  async function removeOverride(partId: string) {
    if (!window.confirm("이 수동 보완값을 삭제하고 처음 수집한 사양으로 되돌릴까요?")) return;
    const requestVersion = ++mutationRequestVersionRef.current;
    const isCurrent = () => mountedRef.current && mutationRequestVersionRef.current === requestVersion;
    setSaving(true);
    try {
      await api(`/api/admin/catalog-spec-overrides/${encodeURIComponent(partId)}`, { method: "DELETE" });
      if (!isCurrent()) return;
      refreshOverrides();
      if (sourceHistoryPartId === partId) {
        setSourceHistoryPartId(null);
        setSourceHistory([]);
        setSourceHistoryError(null);
      }
      window.dispatchEvent(new Event("pc-supporter:catalog-meta-refresh"));
      onToast("수동 보완값을 삭제하고 처음 수집한 사양으로 되돌렸습니다.");
    } catch (reason: unknown) {
      if (isCurrent()) onToast(reason instanceof Error ? reason.message : "수동 보완값을 삭제하지 못했습니다.");
    } finally {
      if (isCurrent()) setSaving(false);
    }
  }

  async function checkSource(partId: string) {
    if (saving || sourceCheckingPartId) return;
    const requestVersion = ++mutationRequestVersionRef.current;
    const isCurrent = () => mountedRef.current && mutationRequestVersionRef.current === requestVersion;
    setSourceCheckingPartId(partId);
    setSaving(true);
    try {
      const result = await api<{ sourceCheck: PhysicalSourceCheck; override: CatalogSpecOverride }>(`/api/admin/catalog-spec-overrides/${encodeURIComponent(partId)}/source-check`, { method: "POST" });
      if (!isCurrent()) return;
      setOverrides((current) => current.map((item) => item.partId === partId ? { ...item, ...result.override } : item));
      refreshOverrides();
      resetSourceBatchProgress();
      window.dispatchEvent(new Event("pc-supporter:catalog-meta-refresh"));
      onToast(`수동 스펙 정보 점검 완료 · ${sourceCheckText(result.sourceCheck)}`);
      if (sourceHistoryPartId === partId) await loadSourceHistory(partId);
    } catch (reason: unknown) {
      if (isCurrent()) onToast(reason instanceof Error ? reason.message : "수동 스펙 정보 점검에 실패했습니다.");
    } finally {
      if (isCurrent()) {
        setSourceCheckingPartId(null);
        setSaving(false);
      }
    }
  }

  async function checkSourcesBatch() {
    if (saving || sourceCheckingPartId) return;
    const targets = overrides.filter((item) => Boolean(item.sourceUrl));
    if (targets.length === 0) {
      onToast("점검할 카탈로그 스펙 HTTPS 페이지 URL이 없습니다.");
      return;
    }
    const offset = sourceBatchNextOffset ?? 0;
    const requestVersion = ++mutationRequestVersionRef.current;
    const isCurrent = () => mountedRef.current && mutationRequestVersionRef.current === requestVersion;
    setSourceCheckingPartId("__batch__");
    setSaving(true);
    try {
      const result = await api<CatalogSpecSourceCheckBatchResponse>("/api/admin/catalog-spec-overrides/source-check/batch", { method: "POST", body: JSON.stringify({ partIds: targets.map((item) => item.partId), limit: 50, offset }) });
      if (!isCurrent()) return;
      const checkedById = new Map(result.items.map((item) => [item.partId, item]));
      setOverrides((current) => current.map((item) => {
        const checked = checkedById.get(item.partId);
        return checked ? { ...item, sourceCheck: checked.sourceCheck } : item;
      }));
      setSourceBatchResult(result);
      setSourceBatchNextOffset(result.nextOffset ?? null);
      setOverrideRefreshNonce((current) => current + 1);
      window.dispatchEvent(new Event("pc-supporter:catalog-meta-refresh"));
      const range = result.checkedCount > 0 ? `${result.offset + 1}–${result.offset + result.checkedCount}/${result.totalCandidates}` : `${result.offset}/${result.totalCandidates}`;
      onToast(`카탈로그 스펙 정보 ${range} 일괄 점검 완료 · 확인됨 ${result.passedCount}개 · 재확인 ${result.reviewCount}개${result.persistFailureCount > 0 ? ` · 저장 실패 ${result.persistFailureCount}개` : ""}${result.nextOffset !== undefined ? ` · 다음 ${result.nextOffset}번부터 계속` : ""}`);
    } catch (reason: unknown) {
      if (isCurrent()) onToast(reason instanceof Error ? reason.message : "카탈로그 스펙 정보 일괄 점검에 실패했습니다.");
    } finally {
      if (isCurrent()) {
        setSourceCheckingPartId(null);
        setSaving(false);
      }
    }
  }

  async function loadSourceHistory(partId: string) {
    const requestVersion = ++sourceHistoryRequestVersionRef.current;
    const isCurrent = () => mountedRef.current && sourceHistoryRequestVersionRef.current === requestVersion;
    setSourceHistory([]);
    setSourceHistoryLoading(true);
    setSourceHistoryError(null);
    try {
      const result = await api<{ partId: string; entries: PhysicalSourceCheckHistoryEntry[] }>(`/api/admin/catalog-spec-overrides/${encodeURIComponent(partId)}/source-check/history?limit=20`);
      if (!isCurrent()) return;
      setSourceHistory(result.entries);
    } catch (reason: unknown) {
      if (!isCurrent()) return;
      setSourceHistoryError(reason instanceof Error ? reason.message : "수동 스펙 정보 점검 이력을 불러오지 못했습니다.");
    } finally {
      if (isCurrent()) setSourceHistoryLoading(false);
    }
  }

  async function toggleSourceHistory(partId: string) {
    if (sourceHistoryPartId === partId) {
      sourceHistoryRequestVersionRef.current += 1;
      setSourceHistoryPartId(null);
      setSourceHistory([]);
      setSourceHistoryError(null);
      setSourceHistoryLoading(false);
      return;
    }
    setSourceHistoryPartId(partId);
    await loadSourceHistory(partId);
  }

  const singleReady = Boolean(selectedPart && validation && validation.invalidCount === 0 && validatedInput === jsonForInput(singleInput()));

  return <section className="admin-card catalog-spec-override-card" data-testid="admin-catalog-spec-override" aria-label="수동 카탈로그 스펙 보강">
    <div className="admin-card-heading catalog-spec-override-heading"><div><h3>제조사 사양 직접 보완</h3><p>상품 페이지에 없는 호환 정보를 제조사 자료에서 확인해 입력합니다. 비어 있는 항목만 채우며 기존 사양은 바꾸지 않습니다.</p></div><span className="catalog-spec-override-icon"><FiEdit3 /></span></div>
    <form className="catalog-spec-override-search" onSubmit={searchParts}><label><span>범주</span><select aria-label="수동 스펙 보강 부품 범주" value={partCategory} onChange={(event) => { clearPartSearchEditor(); setPartSearching(false); setPartCategory(event.target.value as PartCategory); }} disabled={saving}><option value="gpu">그래픽카드</option><option value="case">케이스</option><option value="ssd">SSD</option><option value="motherboard">메인보드</option><option value="cpu">CPU</option><option value="memory">RAM</option><option value="psu">파워서플라이</option><option value="cooler">CPU 쿨러</option><option value="hdd">HDD</option></select></label><label className="catalog-spec-override-search-query"><span>부품 검색</span><input aria-label="수동 스펙 보강 부품 검색" value={partQuery} onChange={(event) => setPartQuery(event.target.value)} placeholder="모델명·브랜드·상품코드" disabled={saving} /></label><button className="button button-secondary button-small" type="submit" disabled={partSearching || saving}>{partSearching ? <><FiLoader className="spin" /> 검색 중...</> : <><FiSearch /> 검색</>}</button></form>
    {partResults.length > 0 && <div className="catalog-spec-override-search-results">{partResults.map((part) => <button type="button" className={selectedPart?.id === part.id ? "selected" : ""} onClick={() => selectPart(part)} key={part.id}><strong>{part.name}</strong><small>{part.id} · {qualityText(part)} · 누락 {part.missingFields.length > 0 ? part.missingFields.map((field) => catalogMissingFieldLabelFor(field)).join(" · ") : "없음"}</small></button>)}</div>}
    {selectedPart && <div className="catalog-spec-override-editor"><div className="catalog-spec-override-selected"><div><strong>{selectedPart.name}</strong><small>{CATEGORY_LABELS[selectedPart.category]} · {selectedPart.id} · 현재 누락 {selectedPart.missingFields.length > 0 ? selectedPart.missingFields.map((field) => catalogMissingFieldLabelFor(field)).join(" · ") : "없음"}</small></div><button className="text-button" type="button" onClick={() => setSelectedPart(null)} disabled={saving}>선택 해제</button></div>{editableFields.length === 0 ? <p className="catalog-spec-override-state"><FiInfo /> 입력할 수 있는 누락 항목이 없습니다. 사양을 다시 확인하거나 이미 저장한 보완값을 확인해 주세요.</p> : <div className="catalog-spec-override-fields">{editableFields.map((field) => { const type = catalogSpecOverrideFieldTypeFor(selectedPart.category, field.field)!; return <label key={field.field}><span>{field.label}<small>{field.instruction}</small></span><input type={fieldInputValue(type)} value={fieldValues[field.field] ?? ""} onChange={(event) => { setFieldValues((current) => ({ ...current, [field.field]: event.target.value })); setValidation(null); setValidatedInput(""); }} placeholder={type === "string_list" ? "쉼표로 구분" : type === "number" ? "숫자 입력" : "페이지 값 입력"} disabled={saving} /></label>; })}</div>}<div className="catalog-spec-override-provenance"><label><span>제조사 모델/SKU</span><input aria-label="수동 스펙 보강 제조사 모델" value={manufacturerModel} onChange={(event) => { setManufacturerModel(event.target.value); setValidation(null); setValidatedInput(""); }} maxLength={160} disabled={saving} /></label><label><span>확인 정보 메모</span><textarea aria-label="수동 스펙 보강 출처 메모" value={sourceNote} onChange={(event) => { setSourceNote(event.target.value); setValidation(null); setValidatedInput(""); }} maxLength={500} placeholder="예: 제조사 공식 사양서 4쪽, 모델명 표기 확인" disabled={saving} /></label><label><span>HTTPS 페이지 URL</span><input aria-label="수동 스펙 보강 페이지 URL" type="url" value={sourceUrl} onChange={(event) => { setSourceUrl(event.target.value); setValidation(null); setValidatedInput(""); }} maxLength={1000} placeholder="https://..." disabled={saving} /></label></div><div className="catalog-spec-override-actions"><button className="button button-secondary button-small" type="button" onClick={() => void validateSingle()} disabled={saving || editableFields.length === 0}><FiCheckCircle /> JSON 확인</button><button className="button button-primary button-small" type="button" onClick={() => void saveSingle()} disabled={saving || !singleReady}>{saving ? <><FiLoader className="spin" /> 저장 중...</> : <><FiSave /> 확인값 저장</>}</button></div>{validation && <div className={validation.invalidCount === 0 ? "catalog-spec-override-validation valid" : "catalog-spec-override-validation invalid"} role="status"><strong>{validation.invalidCount === 0 ? <><FiCheckCircle /> 저장 가능</> : <><FiXCircle /> 저장 차단</>} · {validation.validCount}개 통과 · {validation.invalidCount}개 수정 필요</strong>{validation.items.flatMap((item) => item.errors).slice(0, 6).map((error) => <small key={error}>{error}</small>)}</div>}</div>}
    <div className="catalog-spec-override-bulk"><button className="button button-light button-small" type="button" onClick={() => setBulkOpen((current) => !current)} aria-expanded={bulkOpen}><FiDatabase /> {bulkOpen ? "JSON 일괄 보강 닫기" : "JSON 일괄 보강"}</button>{bulkOpen && <div className="catalog-spec-override-bulk-body"><textarea aria-label="수동 사양 보완 JSON" value={bulkJson} onChange={(event) => { setBulkJson(event.target.value); setBulkValidation(null); setBulkValidatedInput(""); }} placeholder='{"items":[{"partId":"danawa-gpu-...","category":"gpu","fields":{"powerW":320},"manufacturerModel":"MODEL-SKU","sourceNote":"제조사 사양서 4쪽","sourceUrl":"https://..."}]}' disabled={saving} /><div className="catalog-spec-override-actions"><button className="button button-secondary button-small" type="button" onClick={() => void validateBulk()} disabled={saving || !bulkJson.trim()}><FiCheckCircle /> JSON 확인</button><button className="button button-primary button-small" type="button" onClick={() => void saveBulk()} disabled={saving || !bulkValidation || bulkValidation.invalidCount > 0 || bulkValidatedInput !== jsonForInput((() => { try { return JSON.parse(bulkJson); } catch { return undefined; } })())}><FiSave /> 일괄 저장</button></div>{bulkValidation && <div className={bulkValidation.invalidCount === 0 ? "catalog-spec-override-validation valid" : "catalog-spec-override-validation invalid"} role="status"><strong>{bulkValidation.invalidCount === 0 ? "일괄 저장 가능" : "일괄 저장 차단"} · {bulkValidation.validCount}개 통과 · {bulkValidation.invalidCount}개 수정 필요</strong>{bulkValidation.items.flatMap((item) => item.errors).slice(0, 8).map((error) => <small key={error}>{error}</small>)}</div>}</div>}</div>
    <AdminCatalogSpecOverrideList items={overrides} loading={overridesLoading} error={overridesError} onRefresh={refreshOverrides} onDelete={(partId) => void removeOverride(partId)} onCheckSource={(partId) => void checkSource(partId)} onCheckSourcesBatch={() => void checkSourcesBatch()} sourceBatchNextOffset={sourceBatchNextOffset} sourceBatchResult={sourceBatchResult} sourceCheckingPartId={sourceCheckingPartId} sourceHistoryPartId={sourceHistoryPartId} sourceHistory={sourceHistory} sourceHistoryLoading={sourceHistoryLoading} sourceHistoryError={sourceHistoryError} onToggleHistory={(partId) => void toggleSourceHistory(partId)} />
    <p className="catalog-spec-override-note"><FiInfo /> 수동 보완값은 기본 카탈로그 정보와 따로 저장됩니다. 여기서 입력한 항목만 호환성 검사에 반영됩니다. 제조사 안내에서 확인한 값만 입력해 주세요.</p>
  </section>;
}
