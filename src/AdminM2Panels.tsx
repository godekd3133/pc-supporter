import { Fragment, useEffect, useRef, useState } from "react";
import type React from "react";
import { FiActivity, FiAlertTriangle, FiCheckCircle, FiChevronDown, FiDatabase, FiDownload, FiEdit3, FiExternalLink, FiHardDrive, FiInfo, FiLayers, FiLoader, FiPlus, FiSave, FiSearch, FiTrash2, FiXCircle } from "react-icons/fi";
import type { M2SlotCoverage, M2SlotOverride, M2SlotProfile, M2SlotReviewTemplate, M2SlotReviewTemplateItem, Part } from "../shared/types";
import { m2ReviewTemplatesToCsv, parseM2ReviewCsv } from "../shared/m2-csv";
import { api } from "./api";
import { partSummary } from "./admin-panel-shared";

type M2SlotBatchValidationItem = {
  partId: string;
  partName?: string;
  valid: boolean;
  complete: boolean;
  errors: string[];
};

type M2SlotBatchValidationResponse = {
  validCount: number;
  invalidCount: number;
  completeCount: number;
  incompleteCount: number;
  items: M2SlotBatchValidationItem[];
};

export function M2SlotOverridePanel({ onToast, onMetaRefresh }: { onToast: (message: string) => void; onMetaRefresh: () => void }) {
  const [overrides, setOverrides] = useState<M2SlotOverride[]>([]);
  const [overrideLoading, setOverrideLoading] = useState(true);
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [boardQuery, setBoardQuery] = useState("");
  const [boards, setBoards] = useState<Part[]>([]);
  const [boardSearching, setBoardSearching] = useState(false);
  const [selectedBoard, setSelectedBoard] = useState<Part | null>(null);
  const [slots, setSlots] = useState<M2SlotProfile[]>([]);
  const [sourceNote, setSourceNote] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [batchJson, setBatchJson] = useState("");
  const [batchValidation, setBatchValidation] = useState<M2SlotBatchValidationResponse | null>(null);
  const [batchValidatedInput, setBatchValidatedInput] = useState("");
  const [batchBusy, setBatchBusy] = useState(false);
  const [coverageRefreshKey, setCoverageRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setOverrideLoading(true);
    void api<{ items: M2SlotOverride[] }>("/api/admin/m2-overrides")
      .then((payload) => { if (!cancelled) { setOverrides(payload.items); setOverrideError(null); } })
      .catch((error: unknown) => { if (!cancelled) setOverrideError(error instanceof Error ? error.message : "M.2 슬롯 매핑을 불러오지 못했습니다."); })
      .finally(() => { if (!cancelled) setOverrideLoading(false); });
    return () => { cancelled = true; };
  }, []);

  function blankSlots(part: Part) {
    const count = Math.max(1, Math.min(8, part.specs.m2Slots ?? 2));
    return Array.from({ length: count }, (_value, index) => ({ slotId: `M2_${index + 1}`, connection: "unknown" as const, sharedWith: [] }));
  }

  function selectBoard(part: Part) {
    const existing = overrides.find((override) => override.partId === part.id);
    setSelectedBoard(part);
    setSlots(existing?.slots ?? blankSlots(part));
    setSourceNote(existing?.sourceNote ?? "");
    setSourceUrl(existing?.sourceUrl ?? "");
  }

  async function searchBoards(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBoardSearching(true);
    try {
      const query = boardQuery.trim();
      const payload = await api<{ items: Part[] }>(`/api/parts?category=motherboard&q=${encodeURIComponent(query)}&quality=all&sort=name&listingPolicy=all&limit=20`);
      setBoards(payload.items);
      if (payload.items.length === 0) onToast("검색 조건에 맞는 메인보드를 찾지 못했습니다.");
    } catch (error: unknown) {
      onToast(error instanceof Error ? error.message : "메인보드 검색에 실패했습니다.");
    } finally {
      setBoardSearching(false);
    }
  }

  async function openCoverageBoard(partId: string) {
    if (saving || batchBusy) {
      onToast("진행 중인 저장 작업이 끝난 뒤 메인보드를 열어 주세요.");
      return;
    }
    try {
      const part = await api<Part>(`/api/parts/${encodeURIComponent(partId)}`);
      setBoardQuery(part.name);
      setBoards([part]);
      selectBoard(part);
      window.setTimeout(() => document.querySelector(".m2-override-editor")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    } catch (error: unknown) {
      onToast(error instanceof Error ? error.message : "검수 큐의 메인보드를 열지 못했습니다.");
    }
  }

  function updateSlot(index: number, patch: Partial<M2SlotProfile>) {
    setSlots((current) => current.map((slot, slotIndex) => slotIndex === index ? { ...slot, ...patch } : slot));
  }

  function toggleInterface(index: number, interfaceName: "NVMe" | "SATA") {
    setSlots((current) => current.map((slot, slotIndex) => {
      if (slotIndex !== index) return slot;
      const interfaces = slot.interfaces ?? [];
      return { ...slot, interfaces: interfaces.includes(interfaceName) ? interfaces.filter((item) => item !== interfaceName) : [...interfaces, interfaceName] };
    }));
  }

  function addSlot() {
    if (selectedBoard?.specs.m2Slots !== undefined && slots.length >= selectedBoard.specs.m2Slots) {
      onToast(`이 메인보드는 M.2 슬롯 ${selectedBoard.specs.m2Slots}개까지 등록할 수 있습니다.`);
      return;
    }
    const used = new Set(slots.map((slot) => slot.slotId));
    const next = Array.from({ length: 8 }, (_value, index) => `M2_${index + 1}`).find((slotId) => !used.has(slotId));
    if (!next) {
      onToast("M.2 슬롯은 최대 8개까지 등록할 수 있습니다.");
      return;
    }
    setSlots((current) => [...current, { slotId: next, connection: "unknown", sharedWith: [] }]);
  }

  function removeSlot(index: number) {
    if (slots.length <= 1) {
      onToast("M.2 슬롯은 최소 1개가 필요합니다.");
      return;
    }
    setSlots((current) => current.filter((_slot, slotIndex) => slotIndex !== index));
  }

  async function saveOverride() {
    if (batchBusy) {
      onToast("일괄 작업이 끝난 뒤 단건 매핑을 저장해 주세요.");
      return;
    }
    if (!selectedBoard) {
      onToast("먼저 매핑할 메인보드를 검색해 선택해 주세요.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        slots: slots.map((slot) => ({
          slotId: slot.slotId,
          interfaces: slot.interfaces ?? [],
          ...(slot.pcieGeneration !== undefined ? { pcieGeneration: slot.pcieGeneration } : {}),
          connection: slot.connection ?? "unknown",
          sharedWith: slot.sharedWith ?? []
        })),
        ...(sourceNote.trim() ? { sourceNote: sourceNote.trim() } : {}),
        ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {})
      };
      const result = await api<{ override: M2SlotOverride; part: Part }>(`/api/admin/m2-overrides/${encodeURIComponent(selectedBoard.id)}`, { method: "PUT", body: JSON.stringify(payload) });
      setOverrides((current) => [result.override, ...current.filter((override) => override.partId !== result.override.partId)]);
      setSlots(result.override.slots);
      setCoverageRefreshKey((current) => current + 1);
      onMetaRefresh();
      onToast(`${selectedBoard.name}의 M.2 슬롯 매핑을 저장했습니다.`);
    } catch (error: unknown) {
      onToast(error instanceof Error ? error.message : "M.2 슬롯 매핑을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteOverride() {
    if (batchBusy) {
      onToast("일괄 작업이 끝난 뒤 단건 매핑을 삭제해 주세요.");
      return;
    }
    if (!selectedBoard || !window.confirm("이 메인보드의 수동 M.2 슬롯 매핑을 삭제할까요?")) return;
    setSaving(true);
    try {
      await api(`/api/admin/m2-overrides/${encodeURIComponent(selectedBoard.id)}`, { method: "DELETE" });
      setOverrides((current) => current.filter((override) => override.partId !== selectedBoard.id));
      setSlots(blankSlots(selectedBoard));
      setSourceNote("");
      setSourceUrl("");
      setCoverageRefreshKey((current) => current + 1);
      onMetaRefresh();
      onToast("수동 M.2 슬롯 매핑을 삭제했습니다.");
    } catch (error: unknown) {
      onToast(error instanceof Error ? error.message : "M.2 슬롯 매핑을 삭제하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  function handleBatchJsonChange(value: string) {
    setBatchJson(value);
    setBatchValidation(null);
    setBatchValidatedInput("");
  }

  async function validateBatch() {
    if (!batchJson.trim()) {
      onToast("검증할 M.2 override JSON을 입력해 주세요.");
      return;
    }
    setBatchBusy(true);
    try {
      const result = await api<M2SlotBatchValidationResponse>("/api/admin/m2-overrides/batch/validate", {
        method: "POST",
        body: batchJson
      });
      setBatchValidation(result);
      setBatchValidatedInput(batchJson);
      onToast(result.invalidCount > 0
        ? `검증 완료: ${result.validCount}개 저장 가능, ${result.invalidCount}개 형식 수정 필요`
        : `검증 완료: ${result.completeCount}개 즉시 적용 가능, ${result.incompleteCount}개는 보완 후 적용됩니다.`);
    } catch (error: unknown) {
      setBatchValidation(null);
      setBatchValidatedInput("");
      onToast(error instanceof Error ? error.message : "M.2 override 일괄 검증에 실패했습니다.");
    } finally {
      setBatchBusy(false);
    }
  }

  async function saveBatch() {
    if (saving) {
      onToast("단건 매핑 저장이 끝난 뒤 일괄 저장을 실행해 주세요.");
      return;
    }
    if (!batchValidation || batchValidatedInput !== batchJson) {
      onToast("입력 내용을 바꿨다면 먼저 JSON 검증을 다시 실행해 주세요.");
      return;
    }
    if (batchValidation.invalidCount > 0) {
      onToast("수정이 필요한 항목이 있어 일괄 저장하지 않았습니다.");
      return;
    }
    setBatchBusy(true);
    try {
      const result = await api<{ saved: boolean; count: number; items: M2SlotOverride[] }>("/api/admin/m2-overrides/batch", {
        method: "PUT",
        body: batchJson
      });
      setOverrides(result.items);
      setCoverageRefreshKey((current) => current + 1);
      onMetaRefresh();
      onToast(`${result.count}개 메인보드의 M.2 슬롯 매핑을 원자적으로 저장했습니다.`);
    } catch (error: unknown) {
      onToast(error instanceof Error ? error.message : "M.2 override 일괄 저장에 실패했습니다.");
    } finally {
      setBatchBusy(false);
    }
  }

  async function exportBatch() {
    setBatchBusy(true);
    try {
      const result = await api<{ exportedAt: string; items: M2SlotOverride[] }>("/api/admin/m2-overrides/export");
      const blob = new Blob([JSON.stringify({ items: result.items }, null, 2)], { type: "application/json" });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `m2-slot-overrides-${new Date(result.exportedAt).toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      onToast(`${result.items.length}개 M.2 슬롯 매핑을 JSON으로 내보냈습니다.`);
    } catch (error: unknown) {
      onToast(error instanceof Error ? error.message : "M.2 override 내보내기에 실패했습니다.");
    } finally {
      setBatchBusy(false);
    }
  }

  const selectedOverride = selectedBoard ? overrides.find((override) => override.partId === selectedBoard.id) : undefined;
  return <section className="admin-card m2-override-card"><div className="admin-card-heading"><div><p className="eyebrow">M.2 MANUAL TOPOLOGY</p><h3>메인보드별 M.2 슬롯 매핑</h3></div><FiHardDrive /></div><p className="admin-card-description">제조사 매뉴얼에서 확인한 슬롯별 인터페이스·PCIe 세대·연결 주체·공유 대상을 별도 override로 저장합니다. 원본 다나와 데이터는 수정하지 않습니다.</p><div className="m2-override-summary"><span>저장된 매핑 <strong>{overrides.length}개</strong></span>{overrideLoading && <span>불러오는 중...</span>}{overrideError && <span className="m2-override-error">{overrideError}</span>}</div><M2CoveragePanel refreshKey={coverageRefreshKey} onSelectBoard={(partId) => void openCoverageBoard(partId)} onToast={onToast} /><M2ReviewTablePanel refreshKey={coverageRefreshKey} onToast={onToast} onSaved={() => setCoverageRefreshKey((current) => current + 1)} /><M2BatchImportPanel json={batchJson} validation={batchValidation} validatedInput={batchValidatedInput} busy={batchBusy || saving} onChange={handleBatchJsonChange} onValidate={() => void validateBatch()} onSave={() => void saveBatch()} onExport={() => void exportBatch()} />
  <form className="m2-board-search" onSubmit={searchBoards}><label><span>메인보드 검색</span><input value={boardQuery} onChange={(event) => setBoardQuery(event.target.value)} placeholder="예: B650M PG Lightning" /></label><button className="button button-secondary" type="submit" disabled={boardSearching}>{boardSearching ? <><FiLoader className="spin" /> 검색 중...</> : <><FiSearch /> 보드 찾기</>}</button></form>{boards.length > 0 && <div className="m2-board-results">{boards.map((board) => <button className={selectedBoard?.id === board.id ? "m2-board-result selected" : "m2-board-result"} type="button" key={board.id} onClick={() => selectBoard(board)}><strong>{board.name}</strong><small>{partSummary(board)}{board.specs.m2Slots !== undefined ? ` · M.2 ${board.specs.m2Slots}개` : ""}</small></button>)}</div>}{selectedBoard && <div className="m2-override-editor"><div className="m2-selected-board"><div><span>선택한 메인보드</span><strong>{selectedBoard.name}</strong><small>{partSummary(selectedBoard)}</small></div><span className={selectedOverride ? "m2-override-status saved" : "m2-override-status"}>{selectedOverride ? "매핑 저장됨" : "새 매핑"}</span></div><div className="m2-slot-editor-list">{slots.map((slot, index) => <div className="m2-slot-editor" key={`${slot.slotId}-${index}`}><div className="m2-slot-editor-heading"><strong>슬롯 {slot.slotId}</strong><button className="text-button" type="button" onClick={() => removeSlot(index)} disabled={saving}>삭제</button></div><div className="m2-slot-editor-fields"><div className="m2-interface-checks"><span>지원 인터페이스</span><label><input type="checkbox" checked={slot.interfaces?.includes("NVMe") === true} onChange={() => toggleInterface(index, "NVMe")} disabled={saving} /> NVMe</label><label><input type="checkbox" checked={slot.interfaces?.includes("SATA") === true} onChange={() => toggleInterface(index, "SATA")} disabled={saving} /> SATA</label></div><label><span>PCIe 세대</span><input type="number" min="2" max="6" step="0.1" value={slot.pcieGeneration ?? ""} onChange={(event) => updateSlot(index, { pcieGeneration: event.target.value ? Number(event.target.value) : undefined })} placeholder="확인 필요" disabled={saving} /></label><label><span>연결 주체</span><select value={slot.connection ?? "unknown"} onChange={(event) => updateSlot(index, { connection: event.target.value as M2SlotProfile["connection"] })} disabled={saving}><option value="unknown">확인 필요</option><option value="cpu">CPU 직결</option><option value="chipset">칩셋</option></select></label><label className="m2-shared-with"><span>공유 대상</span><input value={slot.sharedWith?.join(", ") ?? ""} onChange={(event) => updateSlot(index, { sharedWith: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} placeholder="없으면 비움" disabled={saving} /></label></div></div>)}</div><button className="button button-light m2-add-slot" type="button" onClick={addSlot} disabled={saving}><FiPlus /> 슬롯 추가</button><div className="m2-override-source-fields"><label><span>매뉴얼 메모</span><textarea value={sourceNote} onChange={(event) => setSourceNote(event.target.value)} maxLength={500} placeholder="예: 제조사 매뉴얼 43페이지, Rev 1.1 기준" disabled={saving} /></label><label><span>근거 URL (HTTPS)</span><input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://..." disabled={saving} /></label></div><div className="m2-override-actions"><button className="button button-primary" type="button" onClick={() => void saveOverride()} disabled={saving}>{saving ? <><FiLoader className="spin" /> 저장 중...</> : <><FiSave /> 매핑 저장</>}</button>{selectedOverride && <button className="button button-light" type="button" onClick={() => void deleteOverride()} disabled={saving}>매핑 삭제</button>}</div><p className="m2-override-note"><FiInfo /> 모든 슬롯의 인터페이스·PCIe 세대·연결 주체·공유 대상을 확인해 저장해야 자동 슬롯 배치 판정이 확정됩니다.</p></div>}</section>;
}

function M2CoveragePanel({ refreshKey, onSelectBoard, onToast }: { refreshKey: number; onSelectBoard: (partId: string) => void; onToast: (message: string) => void }) {
  const [coverage, setCoverage] = useState<M2SlotCoverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [templateBusy, setTemplateBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api<M2SlotCoverage>("/api/admin/m2-overrides/coverage?status=needs_review&limit=8")
      .then((result) => { if (!cancelled) { setCoverage(result); setError(null); } })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "M.2 매핑 커버리지를 불러오지 못했습니다."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshKey, retryNonce]);

  async function exportReviewTemplate() {
    setTemplateBusy(true);
    try {
      const result = await api<M2SlotReviewTemplate>("/api/admin/m2-overrides/review-template?status=needs_review&limit=100");
      const blob = new Blob([JSON.stringify({ items: result.items }, null, 2)], { type: "application/json" });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `m2-slot-review-template-${new Date(result.generatedAt).toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      onToast(`${result.items.length}개 미등록·불완전 보드의 검수 템플릿을 내보냈습니다.`);
    } catch (reason: unknown) {
      onToast(reason instanceof Error ? reason.message : "M.2 검수 템플릿을 내보내지 못했습니다.");
    } finally {
      setTemplateBusy(false);
    }
  }

  const statusLabels = { mapped: "완료", stale: "재검수", incomplete: "불완전", unmapped: "미등록" } as const;
  const priorityLabels = { high: "높음", medium: "중간", low: "낮음" } as const;
  return <section className="m2-coverage-panel" aria-label="M.2 매핑 검수 현황">
    <div className="m2-coverage-heading"><div><p className="eyebrow">M.2 REVIEW QUEUE</p><h3>매핑 커버리지와 검수 큐</h3><p>판매량을 추정하지 않고, 다중 슬롯·복수 PCIe 세대처럼 구조가 복잡한 보드부터 매뉴얼 확인 순서를 제안합니다.</p></div><FiActivity /></div>
    <div className="m2-coverage-toolbar"><span>현재 큐에서 최대 100개 템플릿 생성</span><button className="button button-light" type="button" onClick={() => void exportReviewTemplate()} disabled={loading || templateBusy || !coverage || coverage.items.length === 0}>{templateBusy ? <><FiLoader className="spin" /> 생성 중...</> : <><FiExternalLink /> 검수 템플릿 내보내기</>}</button></div>
    {loading && <p className="m2-coverage-state"><FiLoader className="spin" /> 커버리지를 계산하는 중...</p>}
    {!loading && error && <div className="m2-coverage-state error"><span>{error}</span><button className="text-button" type="button" onClick={() => setRetryNonce((current) => current + 1)}>다시 불러오기</button></div>}
    {!loading && !error && coverage && <>
      <div className="m2-coverage-stats"><div><span>M.2 대상 보드</span><strong>{coverage.totals.eligibleMotherboards.toLocaleString("ko-KR")}</strong></div><div><span>다중 슬롯</span><strong>{coverage.totals.multiSlotMotherboards.toLocaleString("ko-KR")}</strong></div><div><span>매핑 완료</span><strong>{coverage.totals.mapped.toLocaleString("ko-KR")}</strong></div><div><span>커버리지</span><strong>{coverage.totals.coveragePercent.toFixed(1)}%</strong></div></div>
      <div className="m2-coverage-substats"><span>미등록 {coverage.totals.unmapped.toLocaleString("ko-KR")}개</span><span>불완전 {coverage.totals.incomplete.toLocaleString("ko-KR")}개</span><span>재검수 {coverage.totals.stale.toLocaleString("ko-KR")}개</span><span>복수 세대 미검수 {coverage.totals.unmappedMixedGenerationMotherboards.toLocaleString("ko-KR")}개</span></div>
      <div className="m2-coverage-buckets">{coverage.bySlotCount.map((bucket) => <span key={bucket.slotCount}>M.2 {bucket.slotCount}개 · {bucket.mapped}/{bucket.total} 완료{bucket.stale > 0 ? ` · 재검수 ${bucket.stale}` : ""}</span>)}</div>
      <div className="m2-coverage-list">{coverage.items.length === 0 ? <p className="m2-coverage-empty">현재 미등록·불완전·재검수 매핑이 없습니다.</p> : coverage.items.map((item) => <article className="m2-coverage-item" key={item.partId}><div className="m2-coverage-item-top"><span className={`m2-coverage-status ${item.mappingStatus}`}>{statusLabels[item.mappingStatus]}</span><span className={`m2-coverage-priority ${item.reviewPriority}`}>검수 우선 {priorityLabels[item.reviewPriority]} · {item.reviewPriorityScore}점</span></div><strong>{item.name}</strong><small>{item.m2Slots !== undefined ? `M.2 ${item.m2Slots}개` : "슬롯 수 확인 필요"}{item.m2PcieGenerations && item.m2PcieGenerations.length > 0 ? ` · PCIe ${item.m2PcieGenerations.map((generation) => generation.toFixed(1)).join(" / ")}` : " · PCIe 세대 확인 필요"}</small><p>{item.reviewReason}</p><button className="text-button" type="button" onClick={() => onSelectBoard(item.partId)}>이 보드 매핑 편집 <FiExternalLink /></button></article>)}</div>
    </>}
  </section>;
}

function M2ReviewTablePanel({ refreshKey, onToast, onSaved }: { refreshKey: number; onToast: (message: string) => void; onSaved: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [items, setItems] = useState<M2SlotReviewTemplateItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [validation, setValidation] = useState<M2SlotBatchValidationResponse | null>(null);
  const [validatedSnapshot, setValidatedSnapshot] = useState("");
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [csvPasteOpen, setCsvPasteOpen] = useState(false);
  const [csvText, setCsvText] = useState("");

  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    setLoading(true);
    void api<M2SlotReviewTemplate>("/api/admin/m2-overrides/review-template?status=needs_review&limit=20")
      .then((result) => {
        if (cancelled) return;
        setItems(result.items);
        setValidation(null);
        setValidatedSnapshot("");
        setCsvText("");
        setError(null);
      })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "M.2 검수 테이블을 불러오지 못했습니다."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [expanded, refreshKey, retryNonce]);

  function updateItem(index: number, patch: Partial<M2SlotReviewTemplateItem>) {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
    setValidation(null);
    setValidatedSnapshot("");
  }

  function updateSlot(itemIndex: number, slotIndex: number, patch: Partial<M2SlotProfile>) {
    setItems((current) => current.map((item, currentItemIndex) => currentItemIndex === itemIndex
      ? { ...item, slots: item.slots.map((slot, currentSlotIndex) => currentSlotIndex === slotIndex ? { ...slot, ...patch } : slot) }
      : item));
    setValidation(null);
    setValidatedSnapshot("");
  }

  function toggleInterface(itemIndex: number, slotIndex: number, interfaceName: "NVMe" | "SATA") {
    const item = items[itemIndex];
    const slot = item?.slots[slotIndex];
    const interfaces = slot?.interfaces ?? [];
    updateSlot(itemIndex, slotIndex, { interfaces: interfaces.includes(interfaceName) ? interfaces.filter((value) => value !== interfaceName) : [...interfaces, interfaceName] });
  }

  function serializeDraft() {
    return JSON.stringify({ items });
  }

  async function validateTable() {
    if (items.length === 0) {
      onToast("검수할 M.2 보드가 없습니다.");
      return;
    }
    const snapshot = serializeDraft();
    setWorking(true);
    try {
      const result = await api<M2SlotBatchValidationResponse>("/api/admin/m2-overrides/batch/validate", { method: "POST", body: snapshot });
      setValidation(result);
      setValidatedSnapshot(snapshot);
      onToast(result.invalidCount > 0
        ? `검증 완료: ${result.invalidCount}개 행의 형식을 수정해 주세요.`
        : result.incompleteCount > 0
          ? `검증 완료: ${result.incompleteCount}개 행은 필수 슬롯 정보를 더 채워야 합니다.`
          : `${result.completeCount}개 보드의 슬롯 정보가 완전합니다.`);
    } catch (reason: unknown) {
      setValidation(null);
      setValidatedSnapshot("");
      onToast(reason instanceof Error ? reason.message : "M.2 검수 테이블 검증에 실패했습니다.");
    } finally {
      setWorking(false);
    }
  }

  const currentSnapshot = serializeDraft();
  const completePartIds = new Set(validation?.items.filter((item) => item.valid && item.complete).map((item) => item.partId) ?? []);
  const canSave = Boolean(validation && validation.invalidCount === 0 && validation.completeCount > 0 && validatedSnapshot === currentSnapshot);
  async function saveTable() {
    if (!canSave) {
      onToast("모든 행을 완전하게 입력하고 검증한 뒤 저장해 주세요.");
      return;
    }
    setWorking(true);
    try {
      const completeItems = items.filter((item) => completePartIds.has(item.partId));
      const result = await api<{ saved: boolean; count: number; items: M2SlotOverride[] }>("/api/admin/m2-overrides/batch", { method: "PUT", body: JSON.stringify({ items: completeItems }) });
      onSaved();
      setValidation(null);
      setValidatedSnapshot("");
      onToast(`${result.count}개 M.2 매핑을 저장했습니다.`);
    } catch (reason: unknown) {
      onToast(reason instanceof Error ? reason.message : "M.2 검수 테이블 저장에 실패했습니다.");
    } finally {
      setWorking(false);
    }
  }

  function applyCsvText(input: string) {
    const parsed = parseM2ReviewCsv(input);
    if (parsed.errors.length > 0) {
      setValidation(null);
      setValidatedSnapshot("");
      onToast(`CSV를 반영하지 못했습니다: ${parsed.errors.slice(0, 3).join(" · ")}`);
      return false;
    }
    setItems(parsed.items);
    setValidation(null);
    setValidatedSnapshot("");
    onToast(`${parsed.items.length}개 보드의 CSV를 표에 반영했습니다. 서버 검증을 실행해 주세요.`);
    return true;
  }

  async function importCsv(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setWorking(true);
    try {
      applyCsvText(await file.text());
    } catch (reason: unknown) {
      onToast(reason instanceof Error ? reason.message : "CSV를 읽지 못했습니다.");
    } finally {
      setWorking(false);
    }
  }

  function importPastedCsv() {
    if (!csvText.trim()) {
      onToast("반영할 CSV 내용을 붙여 넣어 주세요.");
      return;
    }
    applyCsvText(csvText);
  }

  function exportCsv() {
    if (items.length === 0) {
      onToast("내보낼 M.2 검수 데이터가 없습니다.");
      return;
    }
    const blob = new Blob([m2ReviewTemplatesToCsv(items)], { type: "text/csv;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `m2-slot-review-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
    onToast(`${items.length}개 보드의 현재 검수 표를 CSV로 내보냈습니다.`);
  }

  return <section className={expanded ? "m2-review-table-panel expanded" : "m2-review-table-panel"} aria-label="M.2 검수 테이블">
    <button className="m2-review-table-toggle" type="button" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}><span><FiEdit3 /> M.2 검수 테이블</span><small>{expanded ? "닫기" : "상위 20개 보드 편집"}</small><FiChevronDown /></button>
    {expanded && <div className="m2-review-table-body">
      <div className="m2-review-table-tools"><div><span>SPREADSHEET</span><small>CSV는 슬롯 한 행 단위이며, 가져온 값도 서버 검증을 거쳐야 저장됩니다.</small></div><input ref={csvInputRef} className="m2-review-csv-input" type="file" accept=".csv,text/csv" aria-label="M.2 검수 CSV 가져오기" onChange={(event) => void importCsv(event)} disabled={working} /><div><button className="button button-light" type="button" onClick={() => csvInputRef.current?.click()} disabled={working}><FiDatabase /> CSV 가져오기</button><button className="button button-light" type="button" onClick={exportCsv} disabled={working || items.length === 0}><FiExternalLink /> CSV 내보내기</button></div></div>
      <div className={csvPasteOpen ? "m2-review-csv-paste expanded" : "m2-review-csv-paste"}><button className="m2-review-csv-paste-toggle" type="button" aria-expanded={csvPasteOpen} onClick={() => setCsvPasteOpen((current) => !current)}><span><FiEdit3 /> CSV 직접 붙여넣기</span><small>{csvPasteOpen ? "닫기" : "스프레드시트 복사"}</small><FiChevronDown /></button>{csvPasteOpen && <div className="m2-review-csv-paste-body"><textarea aria-label="M.2 검수 CSV 붙여넣기" value={csvText} onChange={(event) => setCsvText(event.target.value)} placeholder="partId,partName,slotId,interfaces,pcieGeneration,connection,sharedWith,sourceNote,sourceUrl\ndanawa-motherboard-...,보드 이름,M2_1,NVMe,4,chipset,없음,매뉴얼 페이지,https://..." disabled={working} /><button className="button button-secondary" type="button" onClick={importPastedCsv} disabled={working || !csvText.trim()}><FiDatabase /> CSV 표에 반영</button></div>}</div>
      {loading && <p className="m2-coverage-state"><FiLoader className="spin" /> 검수 테이블을 불러오는 중...</p>}
      {!loading && error && <div className="m2-coverage-state error"><span>{error}</span><button className="text-button" type="button" onClick={() => setRetryNonce((current) => current + 1)}>다시 불러오기</button></div>}
      {!loading && !error && items.length === 0 && <p className="m2-coverage-empty">현재 편집할 미등록·불완전 보드가 없습니다.</p>}
      {!loading && !error && items.length > 0 && <>
        <div className="m2-review-table-scroll"><table className="m2-review-table"><thead><tr><th scope="col">메인보드</th><th scope="col">슬롯</th><th scope="col">인터페이스</th><th scope="col">PCIe</th><th scope="col">연결</th><th scope="col">공유 대상</th><th scope="col">상태</th></tr></thead><tbody>{items.map((item, itemIndex) => <Fragment key={item.partId}><>{item.slots.map((slot, slotIndex) => { const validationItem = validation?.items.find((candidate) => candidate.partId === item.partId); const stateLabel = validationItem ? validationItem.valid ? validationItem.complete ? "완료" : "보완 필요" : "형식 오류" : "미검증"; return <tr key={`${item.partId}-${slot.slotId}`} className={validationItem && (!validationItem.valid || !validationItem.complete) ? "needs-attention" : ""}><td><strong>{item.partName ?? item.partId}</strong><small>{item.partId}</small></td><td><span className="m2-review-slot-id">{slot.slotId}</span></td><td><div className="m2-review-interface-checks"><label><input type="checkbox" checked={slot.interfaces?.includes("NVMe") === true} onChange={() => toggleInterface(itemIndex, slotIndex, "NVMe")} disabled={working} /> NVMe</label><label><input type="checkbox" checked={slot.interfaces?.includes("SATA") === true} onChange={() => toggleInterface(itemIndex, slotIndex, "SATA")} disabled={working} /> SATA</label></div></td><td><input className="m2-review-number" type="number" min="2" max="6" step="0.1" value={slot.pcieGeneration ?? ""} aria-label={`${item.partName ?? item.partId} ${slot.slotId} PCIe 세대`} onChange={(event) => updateSlot(itemIndex, slotIndex, { pcieGeneration: event.target.value ? Number(event.target.value) : undefined })} disabled={working} /></td><td><select value={slot.connection ?? "unknown"} aria-label={`${item.partName ?? item.partId} ${slot.slotId} 연결 주체`} onChange={(event) => updateSlot(itemIndex, slotIndex, { connection: event.target.value as M2SlotProfile["connection"] })} disabled={working}><option value="unknown">확인 필요</option><option value="cpu">CPU 직결</option><option value="chipset">칩셋</option></select></td><td><input className="m2-review-shared" value={slot.sharedWith?.join(", ") ?? ""} aria-label={`${item.partName ?? item.partId} ${slot.slotId} 공유 대상`} onChange={(event) => updateSlot(itemIndex, slotIndex, { sharedWith: event.target.value.trim() ? event.target.value.split(",").map((value) => value.trim()).filter(Boolean) : undefined })} placeholder="확인 필요" disabled={working} /><button className="text-button m2-review-shared-clear" type="button" onClick={() => updateSlot(itemIndex, slotIndex, { sharedWith: [] })} disabled={working}>{slot.sharedWith !== undefined && slot.sharedWith.length === 0 ? "공유 없음 확인됨" : "공유 없음 확인"}</button></td><td><span className={`m2-review-row-state ${validationItem && validationItem.valid && validationItem.complete ? "complete" : validationItem && !validationItem.valid ? "invalid" : "pending"}`}>{stateLabel}</span></td></tr>; })}</><tr className="m2-review-source-row"><td colSpan={7}><div className="m2-review-source-fields"><label><span>매뉴얼 메모</span><input value={item.sourceNote ?? ""} aria-label={`${item.partName ?? item.partId} 매뉴얼 메모`} onChange={(event) => updateItem(itemIndex, { sourceNote: event.target.value || undefined })} placeholder="예: 제조사 매뉴얼 43페이지" disabled={working} /></label><label><span>근거 URL (HTTPS)</span><input value={item.sourceUrl ?? ""} aria-label={`${item.partName ?? item.partId} 근거 URL`} onChange={(event) => updateItem(itemIndex, { sourceUrl: event.target.value || undefined })} placeholder="https://..." disabled={working} /></label></div></td></tr></Fragment>)}</tbody></table></div>
        <div className="m2-review-table-actions"><span>{validation ? `${validation.completeCount}개 완전 · ${validation.incompleteCount}개 보완 · ${validation.invalidCount}개 오류` : "입력 후 서버 기준으로 검증하세요."}</span><div><button className="button button-secondary" type="button" onClick={() => void validateTable()} disabled={working}><FiCheckCircle /> 검증</button><button className="button button-primary" type="button" onClick={() => void saveTable()} disabled={working || !canSave}><FiSave /> 완전 행 저장{validation && validation.completeCount > 0 ? ` (${validation.completeCount})` : ""}</button></div></div>
        {validation && <div className={validation.invalidCount === 0 && validation.incompleteCount === 0 ? "m2-batch-validation valid" : "m2-batch-validation invalid"} role="status"><strong>{validation.invalidCount === 0 && validation.incompleteCount === 0 ? <><FiCheckCircle /> 엔진 적용 가능</> : <><FiAlertTriangle /> 보완 필요</>} · 완전 {validation.completeCount}개 · 보완 {validation.incompleteCount}개 · 오류 {validation.invalidCount}개</strong>{validation.items.filter((item) => !item.valid || !item.complete).slice(0, 5).map((item) => <p key={item.partId}><b>{item.partName ?? item.partId}</b> · {item.valid ? "필수 슬롯 정보를 더 입력해야 합니다." : item.errors.join(" · ")}</p>)}</div>}
        <p className="m2-review-table-note"><FiInfo /> 제조사 매뉴얼로 완성한 행만 `완전 행 저장`에 포함되고, 보완이 필요한 행은 검수 큐에 남습니다. 저장은 기존 일괄 API와 같은 원자적 경계를 사용합니다.</p>
      </>}
    </div>}
  </section>;
}

function M2BatchImportPanel({ json, validation, validatedInput, busy, onChange, onValidate, onSave, onExport }: {
  json: string;
  validation: M2SlotBatchValidationResponse | null;
  validatedInput: string;
  busy: boolean;
  onChange: (value: string) => void;
  onValidate: () => void;
  onSave: () => void;
  onExport: () => void;
}) {
  const invalidItems = validation?.items.filter((item) => !item.valid) ?? [];
  const canSave = Boolean(validation && validation.invalidCount === 0 && validatedInput === json);
  return <div className="m2-batch-tools">
    <div className="m2-batch-heading"><div><span>일괄 관리</span><strong>검수된 매핑 JSON 가져오기</strong><small>내보낸 <code>{"{items: [...]}"}</code> 형식을 그대로 붙여 넣거나, 현재 매핑을 JSON 파일로 내보낼 수 있습니다.</small></div><FiLayers /></div>
    <textarea aria-label="M.2 override 일괄 JSON" value={json} onChange={(event) => onChange(event.target.value)} placeholder='{"items":[{"partId":"메인보드 ID","slots":[{"slotId":"M2_1","interfaces":["NVMe"],"pcieGeneration":5,"connection":"cpu","sharedWith":[]}]}]}' disabled={busy} />
    <div className="m2-batch-actions"><button className="button button-secondary" type="button" onClick={onValidate} disabled={busy || !json.trim()}><FiCheckCircle /> JSON 검증</button><button className="button button-primary" type="button" onClick={onSave} disabled={busy || !canSave}><FiSave /> 일괄 저장</button><button className="button button-light" type="button" onClick={onExport} disabled={busy}><FiExternalLink /> JSON 내보내기</button></div>
    {validation && <div className={validation.invalidCount === 0 ? "m2-batch-validation valid" : "m2-batch-validation invalid"} role="status"><strong>{validation.invalidCount === 0 ? <><FiCheckCircle /> 저장 가능</> : <><FiAlertTriangle /> 저장 차단</>} · {validation.validCount}개 저장 가능 · {validation.completeCount}개 즉시 적용 · {validation.incompleteCount}개 보완 필요 · {validation.invalidCount}개 형식 수정 필요</strong>{invalidItems.slice(0, 5).map((item) => <p key={item.partId}><b>{item.partName ?? item.partId}</b> · {item.errors.join(" · ")}</p>)}{invalidItems.length > 5 && <small>그 외 {invalidItems.length - 5}개 오류는 서버 응답에서 함께 확인할 수 있습니다.</small>}</div>}
    <p className="m2-batch-note"><FiInfo /> 일괄 저장은 모든 항목을 먼저 검증합니다. 하나라도 보드 ID·슬롯 수·슬롯 번호·인터페이스·PCIe 세대·출처 URL 오류가 있으면 전체를 저장하지 않습니다.</p>
  </div>;
}
