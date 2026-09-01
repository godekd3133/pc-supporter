import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { FiAlertTriangle, FiCheckCircle, FiDatabase, FiDownload, FiExternalLink, FiInfo, FiLoader, FiSave, FiSearch, FiShield, FiTrash2, FiXCircle } from "react-icons/fi";
import type { CaseRgbLoadOverride, Part } from "../shared/types";
import { api } from "./api";
import { partSummary } from "./admin-panel-shared";

type CaseRgbLoadOverrideListItem = CaseRgbLoadOverride & {
  partName?: string;
  category?: Part["category"];
};

type CaseRgbLoadCoverage = {
  generatedAt: string;
  totalRgbCases: number;
  registeredCount: number;
  missingCount: number;
  coveragePercent: number;
};

type CaseRgbLoadValidationItem = {
  partId: string;
  partName?: string;
  category?: Part["category"];
  valid: boolean;
  errors: string[];
  operation?: "create" | "update" | "unchanged";
  changedFields?: string[];
};

type CaseRgbLoadValidationResponse = {
  validCount: number;
  invalidCount: number;
  createCount?: number;
  updateCount?: number;
  unchangedCount?: number;
  items: CaseRgbLoadValidationItem[];
};

const CASE_RGB_LOAD_PLACEHOLDER = '{"items":[{"partId":"danawa-case-...","rgbDevicePowerW":2.5,"manufacturerModel":"CASE-RGB-REV-A","sourceNote":"제조사 매뉴얼 LED팬 표","sourceUrl":"https://..."}]}';

function loadText(item: CaseRgbLoadOverrideListItem) {
  return [
    item.rgbDeviceCurrentA !== undefined ? `${item.rgbDeviceCurrentA}A/장치` : undefined,
    item.rgbDevicePowerW !== undefined ? `${item.rgbDevicePowerW}W/장치` : undefined,
    `제조사 ${item.manufacturerModel}`
  ].filter(Boolean).join(" · ");
}

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

export function CaseRgbLoadOverridePanel({ onToast, onMetaRefresh }: { onToast: (message: string) => void; onMetaRefresh: () => void }) {
  const [overrides, setOverrides] = useState<CaseRgbLoadOverrideListItem[]>([]);
  const [coverage, setCoverage] = useState<CaseRgbLoadCoverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [parts, setParts] = useState<Part[]>([]);
  const [partsLoading, setPartsLoading] = useState(false);
  const [selectedPart, setSelectedPart] = useState<Part | null>(null);
  const [currentA, setCurrentA] = useState("");
  const [powerW, setPowerW] = useState("");
  const [manufacturerModel, setManufacturerModel] = useState("");
  const [sourceNote, setSourceNote] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [listQuery, setListQuery] = useState("");
  const [json, setJson] = useState("");
  const [validation, setValidation] = useState<CaseRgbLoadValidationResponse | null>(null);
  const [validatedInput, setValidatedInput] = useState("");

  async function loadData() {
    setLoading(true);
    try {
      const [overridePayload, coveragePayload] = await Promise.all([
        api<{ items: CaseRgbLoadOverrideListItem[] }>("/api/admin/case-rgb-load-overrides"),
        api<CaseRgbLoadCoverage>("/api/admin/case-rgb-load-overrides/coverage")
      ]);
      setOverrides(overridePayload.items);
      setCoverage(coveragePayload);
      setError(null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "케이스 RGB 부하 보강 데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadData(); }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setPartsLoading(true);
      void api<{ items: Part[] }>(`/api/parts?category=case&q=${encodeURIComponent(query.trim())}&quality=all&sort=name&listingPolicy=all&limit=12`)
        .then((payload) => { if (!cancelled) setParts(payload.items); })
        .catch(() => { if (!cancelled) setParts([]); })
        .finally(() => { if (!cancelled) setPartsLoading(false); });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query]);

  function selectPart(part: Part) {
    const existing = overrides.find((item) => item.partId === part.id);
    setSelectedPart(part);
    setCurrentA(existing?.rgbDeviceCurrentA?.toString() ?? part.specs.rgbDeviceCurrentA?.toString() ?? "");
    setPowerW(existing?.rgbDevicePowerW?.toString() ?? part.specs.rgbDevicePowerW?.toString() ?? "");
    setManufacturerModel(existing?.manufacturerModel ?? part.model ?? part.name);
    setSourceNote(existing?.sourceNote ?? "");
    setSourceUrl(existing?.sourceUrl ?? "");
  }

  function clearEditor() {
    setSelectedPart(null);
    setCurrentA("");
    setPowerW("");
    setManufacturerModel("");
    setSourceNote("");
    setSourceUrl("");
  }

  async function saveSelected(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPart) {
      onToast("먼저 RGB 부하를 보강할 케이스를 검색해 선택해 주세요.");
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        ...(currentA.trim() ? { rgbDeviceCurrentA: currentA.trim() } : {}),
        ...(powerW.trim() ? { rgbDevicePowerW: powerW.trim() } : {}),
        manufacturerModel,
        sourceNote,
        ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {})
      };
      await api(`/api/admin/case-rgb-load-overrides/${encodeURIComponent(selectedPart.id)}`, { method: "PUT", body: JSON.stringify(payload) });
      await loadData();
      onMetaRefresh();
      onToast(`${selectedPart.name}의 RGB 부하 근거를 저장했습니다. 다음 호환성 검사부터 레일 부하를 계산합니다.`);
    } catch (reason: unknown) {
      onToast(reason instanceof Error ? reason.message : "케이스 RGB 부하 근거를 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function removeOverride(partId: string) {
    if (!window.confirm("이 케이스의 RGB 부하 보강을 삭제할까요? 원문에서 파싱된 값이 있으면 원문 값을 다시 사용합니다.")) return;
    setBusy(true);
    try {
      await api(`/api/admin/case-rgb-load-overrides/${encodeURIComponent(partId)}`, { method: "DELETE" });
      await loadData();
      onMetaRefresh();
      if (selectedPart?.id === partId) clearEditor();
      onToast("케이스 RGB 부하 보강을 삭제했습니다.");
    } catch (reason: unknown) {
      onToast(reason instanceof Error ? reason.message : "케이스 RGB 부하 보강을 삭제하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function validateBatch() {
    if (!json.trim()) {
      onToast("검증할 케이스 RGB 부하 JSON을 입력해 주세요.");
      return;
    }
    try {
      JSON.parse(json);
    } catch {
      onToast("JSON 형식이 올바르지 않습니다.");
      return;
    }
    setBusy(true);
    try {
      const result = await api<CaseRgbLoadValidationResponse>("/api/admin/case-rgb-load-overrides/batch/validate", { method: "POST", body: json });
      setValidation(result);
      setValidatedInput(json);
      onToast(result.invalidCount > 0 ? `검증 완료: ${result.validCount}개 저장 가능, ${result.invalidCount}개 수정 필요` : `${result.validCount}개 케이스 RGB 부하 보강 데이터를 저장할 수 있습니다.`);
    } catch (reason: unknown) {
      setValidation(null);
      setValidatedInput("");
      onToast(reason instanceof Error ? reason.message : "케이스 RGB 부하 JSON 검증에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function saveBatch() {
    if (!validation || validatedInput !== json) {
      onToast("입력 내용을 바꿨다면 먼저 JSON 검증을 다시 실행해 주세요.");
      return;
    }
    if (validation.invalidCount > 0) {
      onToast("수정이 필요한 항목이 있어 저장하지 않았습니다.");
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ saved: boolean; count: number; items: CaseRgbLoadOverrideListItem[] }>("/api/admin/case-rgb-load-overrides/batch", { method: "PUT", body: json });
      setOverrides(result.items);
      const nextCoverage = await api<CaseRgbLoadCoverage>("/api/admin/case-rgb-load-overrides/coverage");
      setCoverage(nextCoverage);
      onMetaRefresh();
      onToast(`${result.count}개 케이스의 RGB 부하 보강을 저장했습니다.`);
    } catch (reason: unknown) {
      onToast(reason instanceof Error ? reason.message : "케이스 RGB 부하 보강을 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function exportOverrides() {
    setBusy(true);
    try {
      const result = await api<{ exportedAt: string; items: CaseRgbLoadOverrideListItem[] }>("/api/admin/case-rgb-load-overrides/export");
      downloadJson(`case-rgb-load-overrides-${new Date(result.exportedAt).toISOString().slice(0, 10)}.json`, { items: result.items });
      onToast(`${result.items.length}개 케이스 RGB 부하 보강을 JSON으로 내보냈습니다.`);
    } catch (reason: unknown) {
      onToast(reason instanceof Error ? reason.message : "케이스 RGB 부하 보강을 내보내지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const visibleOverrides = useMemo(() => {
    const normalized = listQuery.trim().toLocaleLowerCase("ko-KR");
    return overrides.filter((item) => !normalized || [item.partId, item.partName, item.manufacturerModel, item.sourceNote].filter((value): value is string => Boolean(value)).some((value) => value.toLocaleLowerCase("ko-KR").includes(normalized)));
  }, [listQuery, overrides]);

  return <section className="admin-card case-rgb-load-card" data-testid="admin-case-rgb-load">
    <div className="admin-card-heading"><div><p className="eyebrow">RGB POWER EVIDENCE</p><h3>케이스 RGB 부하 검수</h3><p className="admin-card-description">케이스 원문에 없는 RGB 장치당 소비전력·소비전류를 제조사 근거로 보강합니다. 저장값은 원본 카탈로그를 덮어쓰지 않고 호환성 검사에만 런타임 적용됩니다.</p></div><FiShield /></div>
    {error && <div className="case-rgb-load-error" role="alert"><FiXCircle /> {error}</div>}
    <div className="case-rgb-load-coverage"><div><strong>{coverage?.totalRgbCases.toLocaleString("ko-KR") ?? "-"}</strong><span>RGB 케이스</span></div><div><strong>{coverage?.registeredCount.toLocaleString("ko-KR") ?? "-"}</strong><span>부하 보강 등록</span></div><div><strong>{coverage?.missingCount.toLocaleString("ko-KR") ?? "-"}</strong><span>근거 미등록</span></div><div><strong>{coverage ? `${coverage.coveragePercent}%` : "-"}</strong><span>coverage</span></div></div>
    <div className="case-rgb-load-grid">
      <div className="case-rgb-load-editor">
        <div className="case-rgb-load-subheading"><strong>케이스 검색·단건 보강</strong><span>명시적 제조사 근거 필수</span></div>
        <label className="case-rgb-load-search"><span>케이스 검색</span><div><FiSearch /><input aria-label="RGB 부하 케이스 검색" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="케이스명·브랜드·모델" disabled={busy} /></div></label>
        {partsLoading ? <p className="case-rgb-load-state"><FiLoader className="spin" /> 케이스 검색 중...</p> : parts.length > 0 ? <div className="case-rgb-load-parts">{parts.map((part) => <button type="button" className={part.id === selectedPart?.id ? "selected" : ""} onClick={() => selectPart(part)} key={part.id} disabled={busy}><strong>{part.name}</strong><small>{part.id} · {partSummary(part)}</small></button>)}</div> : <p className="case-rgb-load-state">검색 결과가 없습니다.</p>}
        {selectedPart && <form className="case-rgb-load-form" onSubmit={(event) => void saveSelected(event)}>
          <div className="case-rgb-load-selected"><span>선택한 케이스</span><strong>{selectedPart.name}</strong><small>{selectedPart.id}</small></div>
          <div className="case-rgb-load-fields"><label><span>RGB 장치당 소비전류 (A)</span><input aria-label="RGB 장치당 소비전류" type="number" min="0.001" max="20" step="0.001" value={currentA} onChange={(event) => setCurrentA(event.target.value)} placeholder="예: 0.4" disabled={busy} /></label><label><span>RGB 장치당 소비전력 (W)</span><input aria-label="RGB 장치당 소비전력" type="number" min="0.001" max="250" step="0.001" value={powerW} onChange={(event) => setPowerW(event.target.value)} placeholder="예: 2.5" disabled={busy} /></label></div>
          <div className="case-rgb-load-source-fields"><label><span>제조사 모델/SKU</span><input aria-label="RGB 부하 제조사 모델" value={manufacturerModel} onChange={(event) => setManufacturerModel(event.target.value)} maxLength={160} placeholder="예: CASE-RGB-REV-A" disabled={busy} required /></label><label><span>검수 근거 메모</span><input aria-label="RGB 부하 검수 근거 메모" value={sourceNote} onChange={(event) => setSourceNote(event.target.value)} maxLength={500} placeholder="예: 제조사 매뉴얼 LED팬 표" disabled={busy} required /></label><label><span>근거 URL (HTTPS)</span><input aria-label="RGB 부하 근거 URL" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://..." disabled={busy} /></label></div>
          <div className="case-rgb-load-form-actions"><button className="button button-primary" type="submit" disabled={busy || (!currentA.trim() && !powerW.trim())}><FiSave /> 저장</button><button className="button button-light" type="button" onClick={clearEditor} disabled={busy}>선택 해제</button></div>
          <p className="case-rgb-load-help"><FiInfo /> 전류 또는 전력 중 하나 이상만 입력해도 됩니다. 전압·장치 수·컨트롤러 레일이 맞을 때 검사 엔진이 총 부하를 계산합니다.</p>
        </form>}
      </div>
      <div className="case-rgb-load-batch">
        <div className="case-rgb-load-subheading"><strong>JSON 일괄 보강</strong><span>최대 500개 · 오류 발생 시 전체 저장 중단</span></div>
        <textarea aria-label="케이스 RGB 부하 보강 JSON" value={json} onChange={(event) => { setJson(event.target.value); setValidation(null); setValidatedInput(""); }} placeholder={CASE_RGB_LOAD_PLACEHOLDER} disabled={busy} />
        <div className="case-rgb-load-batch-actions"><button className="button button-secondary" type="button" onClick={() => void validateBatch()} disabled={busy || !json.trim()}><FiCheckCircle /> JSON 검증</button><button className="button button-primary" type="button" onClick={() => void saveBatch()} disabled={busy || !validation || validation.invalidCount > 0 || validatedInput !== json}><FiSave /> 검증 결과 저장</button><button className="button button-light" type="button" onClick={() => void exportOverrides()} disabled={busy}><FiDownload /> JSON 내보내기</button></div>
        {validation && <div className={`case-rgb-load-validation ${validation.invalidCount === 0 ? "valid" : "invalid"}`} role="status"><strong>{validation.invalidCount === 0 ? <><FiCheckCircle /> 저장 가능</> : <><FiAlertTriangle /> 저장 차단</>} · {validation.validCount}개 유효 · {validation.invalidCount}개 수정 필요</strong>{validation.items.filter((item) => !item.valid).slice(0, 5).map((item) => <p key={item.partId}><b>{item.partName ?? item.partId}</b> · {item.errors.join(" · ")}</p>)}</div>}
        <p className="case-rgb-load-help"><FiInfo /> 등록값에는 제조사 모델/SKU와 근거 메모를 남겨야 합니다. URL은 HTTPS만 허용합니다.</p>
      </div>
    </div>
    <div className="case-rgb-load-list-heading"><strong>저장된 RGB 부하 근거</strong><span>{visibleOverrides.length} / {overrides.length}개</span><input aria-label="저장된 RGB 부하 근거 검색" value={listQuery} onChange={(event) => setListQuery(event.target.value)} placeholder="등록 목록 검색" disabled={busy} /></div>
    {loading ? <p className="case-rgb-load-state"><FiLoader className="spin" /> 저장 목록을 불러오는 중...</p> : visibleOverrides.length === 0 ? <p className="case-rgb-load-state"><FiDatabase /> 저장된 RGB 부하 근거가 없습니다.</p> : <div className="case-rgb-load-list">{visibleOverrides.map((item) => <article key={item.partId}><div><strong>{item.partName ?? item.partId}</strong><small>{loadText(item)} · {new Date(item.updatedAt).toLocaleDateString("ko-KR")}</small><small>{item.sourceNote}</small></div><div>{item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer" aria-label={`${item.partName ?? item.partId} RGB 부하 근거 원문`}><FiExternalLink /></a>}<button className="text-button danger-text-button" type="button" onClick={() => void removeOverride(item.partId)} disabled={busy}><FiTrash2 /> 삭제</button></div></article>)}</div>}
    <p className="case-rgb-load-note"><FiInfo /> 보강값은 원본 카탈로그와 분리됩니다. 삭제하면 원문에서 자동 파싱된 값만 다시 사용하며, 원문에도 값이 없으면 연결 계획은 확인 필요로 돌아갑니다.</p>
  </section>;
}
