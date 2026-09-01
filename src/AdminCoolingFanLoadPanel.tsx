import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { FiAlertTriangle, FiCheckCircle, FiDatabase, FiDownload, FiExternalLink, FiInfo, FiLoader, FiSave, FiSearch, FiShield, FiTrash2, FiXCircle } from "react-icons/fi";
import type { AccessoryItem, CoolingFanLoadOverride } from "../shared/types";
import { api } from "./api";

type CoolingFanLoadOverrideListItem = CoolingFanLoadOverride & {
  accessoryName?: string;
  category?: AccessoryItem["category"];
};

type CoolingFanLoadCoverage = {
  generatedAt: string;
  totalCoolingFans: number;
  registeredCount: number;
  knownCount: number;
  missingCount: number;
  coveragePercent: number;
};

type CoolingFanLoadValidationItem = {
  accessoryId: string;
  accessoryName?: string;
  category?: AccessoryItem["category"];
  valid: boolean;
  errors: string[];
  operation?: "create" | "update" | "unchanged";
  changedFields?: string[];
};

type CoolingFanLoadValidationResponse = {
  validCount: number;
  invalidCount: number;
  createCount?: number;
  updateCount?: number;
  unchangedCount?: number;
  items: CoolingFanLoadValidationItem[];
};

const COOLING_FAN_LOAD_PLACEHOLDER = '{"items":[{"accessoryId":"danawa-accessory-...","fanCurrentA":0.2,"manufacturerModel":"FAN-MODEL-REV-A","sourceNote":"제조사 매뉴얼 정격전류 표","sourceUrl":"https://..."}]}';

function fanSummary(item: AccessoryItem) {
  return [
    item.brand,
    item.model,
    item.specs.fanCount !== undefined ? `상품 팬 ${item.specs.fanCount}개` : undefined,
    item.specs.lengthMm !== undefined ? `${item.specs.lengthMm}mm` : undefined,
    item.specs.fanCurrentA !== undefined ? `${item.specs.fanCurrentA}A/팬` : undefined
  ].filter(Boolean).join(" · ") || "상세 스펙을 확인할 수 있습니다.";
}

function loadText(item: CoolingFanLoadOverrideListItem) {
  return [`${item.fanCurrentA}A/팬`, `제조사 ${item.manufacturerModel}`, item.sourceNote].filter(Boolean).join(" · ");
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

export function CoolingFanLoadOverridePanel({ onToast, onMetaRefresh }: { onToast: (message: string) => void; onMetaRefresh: () => void }) {
  const [overrides, setOverrides] = useState<CoolingFanLoadOverrideListItem[]>([]);
  const [coverage, setCoverage] = useState<CoolingFanLoadCoverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [fans, setFans] = useState<AccessoryItem[]>([]);
  const [fansLoading, setFansLoading] = useState(false);
  const [selectedFan, setSelectedFan] = useState<AccessoryItem | null>(null);
  const [currentA, setCurrentA] = useState("");
  const [manufacturerModel, setManufacturerModel] = useState("");
  const [sourceNote, setSourceNote] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [listQuery, setListQuery] = useState("");
  const [json, setJson] = useState("");
  const [validation, setValidation] = useState<CoolingFanLoadValidationResponse | null>(null);
  const [validatedInput, setValidatedInput] = useState("");

  async function loadData() {
    setLoading(true);
    try {
      const [overridePayload, coveragePayload] = await Promise.all([
        api<{ items: CoolingFanLoadOverrideListItem[] }>("/api/admin/cooling-fan-load-overrides"),
        api<CoolingFanLoadCoverage>("/api/admin/cooling-fan-load-overrides/coverage")
      ]);
      setOverrides(overridePayload.items);
      setCoverage(coveragePayload);
      setError(null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "쿨링팬 소비전류 보강 데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadData(); }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setFansLoading(true);
      void api<{ items: AccessoryItem[] }>(`/api/accessories?category=cooling_fan&q=${encodeURIComponent(query.trim())}&quality=all&sort=name&limit=12`)
        .then((payload) => { if (!cancelled) setFans(payload.items); })
        .catch(() => { if (!cancelled) setFans([]); })
        .finally(() => { if (!cancelled) setFansLoading(false); });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query]);

  function selectFan(fan: AccessoryItem) {
    const existing = overrides.find((item) => item.accessoryId === fan.id);
    setSelectedFan(fan);
    setCurrentA(existing?.fanCurrentA?.toString() ?? fan.specs.fanCurrentA?.toString() ?? "");
    setManufacturerModel(existing?.manufacturerModel ?? fan.model ?? fan.name);
    setSourceNote(existing?.sourceNote ?? "");
    setSourceUrl(existing?.sourceUrl ?? "");
  }

  function clearEditor() {
    setSelectedFan(null);
    setCurrentA("");
    setManufacturerModel("");
    setSourceNote("");
    setSourceUrl("");
  }

  async function saveSelected(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFan) {
      onToast("먼저 소비전류를 보강할 쿨링팬을 검색해 선택해 주세요.");
      return;
    }
    setBusy(true);
    try {
      await api(`/api/admin/cooling-fan-load-overrides/${encodeURIComponent(selectedFan.id)}`, {
        method: "PUT",
        body: JSON.stringify({ fanCurrentA: currentA.trim(), manufacturerModel, sourceNote, ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}) })
      });
      await loadData();
      onMetaRefresh();
      onToast(`${selectedFan.name}의 팬 소비전류 근거를 저장했습니다. 다음 호환성 검사부터 허브 전류를 계산합니다.`);
    } catch (reason: unknown) {
      onToast(reason instanceof Error ? reason.message : "쿨링팬 소비전류 근거를 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function removeOverride(accessoryId: string) {
    if (!window.confirm("이 쿨링팬의 소비전류 보강을 삭제할까요? 원문에서 파싱된 값이 있으면 원문 값을 다시 사용합니다.")) return;
    setBusy(true);
    try {
      await api(`/api/admin/cooling-fan-load-overrides/${encodeURIComponent(accessoryId)}`, { method: "DELETE" });
      await loadData();
      onMetaRefresh();
      if (selectedFan?.id === accessoryId) clearEditor();
      onToast("쿨링팬 소비전류 보강을 삭제했습니다.");
    } catch (reason: unknown) {
      onToast(reason instanceof Error ? reason.message : "쿨링팬 소비전류 보강을 삭제하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function validateBatch() {
    if (!json.trim()) {
      onToast("검증할 쿨링팬 소비전류 JSON을 입력해 주세요.");
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
      const result = await api<CoolingFanLoadValidationResponse>("/api/admin/cooling-fan-load-overrides/batch/validate", { method: "POST", body: json });
      setValidation(result);
      setValidatedInput(json);
      onToast(result.invalidCount > 0 ? `검증 완료: ${result.validCount}개 저장 가능, ${result.invalidCount}개 수정 필요` : `${result.validCount}개 쿨링팬 소비전류 보강을 저장할 수 있습니다.`);
    } catch (reason: unknown) {
      setValidation(null);
      setValidatedInput("");
      onToast(reason instanceof Error ? reason.message : "쿨링팬 소비전류 JSON 검증에 실패했습니다.");
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
      const result = await api<{ saved: boolean; count: number; items: CoolingFanLoadOverrideListItem[] }>("/api/admin/cooling-fan-load-overrides/batch", { method: "PUT", body: json });
      setOverrides(result.items);
      setCoverage(await api<CoolingFanLoadCoverage>("/api/admin/cooling-fan-load-overrides/coverage"));
      onMetaRefresh();
      onToast(`${result.count}개 쿨링팬의 소비전류 보강을 저장했습니다.`);
    } catch (reason: unknown) {
      onToast(reason instanceof Error ? reason.message : "쿨링팬 소비전류 보강을 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function exportOverrides() {
    setBusy(true);
    try {
      const result = await api<{ exportedAt: string; items: CoolingFanLoadOverrideListItem[] }>("/api/admin/cooling-fan-load-overrides/export");
      downloadJson(`cooling-fan-load-overrides-${new Date(result.exportedAt).toISOString().slice(0, 10)}.json`, { items: result.items });
      onToast(`${result.items.length}개 쿨링팬 소비전류 보강을 JSON으로 내보냈습니다.`);
    } catch (reason: unknown) {
      onToast(reason instanceof Error ? reason.message : "쿨링팬 소비전류 보강을 내보내지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const visibleOverrides = useMemo(() => {
    const normalized = listQuery.trim().toLocaleLowerCase("ko-KR");
    return overrides.filter((item) => !normalized || [item.accessoryId, item.accessoryName, item.manufacturerModel, item.sourceNote].filter((value): value is string => Boolean(value)).some((value) => value.toLocaleLowerCase("ko-KR").includes(normalized)));
  }, [listQuery, overrides]);

  return <section className="admin-card cooling-fan-load-card" data-testid="admin-cooling-fan-load">
    <div className="admin-card-heading"><div><p className="eyebrow">FAN MOTOR EVIDENCE</p><h3>쿨링팬 소비전류 검수</h3><p className="admin-card-description">쿨링팬 모터의 장치당 소비전류를 원문 또는 제조사 근거로 보강합니다. RGB LED 전류와 분리해 저장하며, 허브 포트·커넥터·전류가 모두 확인된 경우에만 추천 후보로 승격합니다.</p></div><FiShield /></div>
    {error && <div className="cooling-fan-load-error" role="alert"><FiXCircle /> {error}</div>}
    <div className="cooling-fan-load-coverage"><div><strong>{coverage?.totalCoolingFans.toLocaleString("ko-KR") ?? "-"}</strong><span>쿨링팬</span></div><div><strong>{coverage?.knownCount.toLocaleString("ko-KR") ?? "-"}</strong><span>전류 확인</span></div><div><strong>{coverage?.registeredCount.toLocaleString("ko-KR") ?? "-"}</strong><span>제조사 보강</span></div><div><strong>{coverage ? `${coverage.coveragePercent}%` : "-"}</strong><span>coverage</span></div></div>
    <div className="cooling-fan-load-grid">
      <div className="cooling-fan-load-editor">
        <div className="cooling-fan-load-subheading"><strong>팬 검색·단건 보강</strong><span>제조사 근거 필수</span></div>
        <label className="cooling-fan-load-search"><span>쿨링팬 검색</span><div><FiSearch /><input aria-label="팬 소비전류 팬 검색" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="팬명·브랜드·모델" disabled={busy} /></div></label>
        {fansLoading ? <p className="cooling-fan-load-state"><FiLoader className="spin" /> 쿨링팬 검색 중...</p> : fans.length > 0 ? <div className="cooling-fan-load-fans">{fans.map((fan) => <button type="button" className={fan.id === selectedFan?.id ? "selected" : ""} onClick={() => selectFan(fan)} key={fan.id} disabled={busy}><strong>{fan.name}</strong><small>{fan.id} · {fanSummary(fan)}</small></button>)}</div> : <p className="cooling-fan-load-state">검색 결과가 없습니다.</p>}
        {selectedFan && <form className="cooling-fan-load-form" onSubmit={(event) => void saveSelected(event)}>
          <div className="cooling-fan-load-selected"><span>선택한 쿨링팬</span><strong>{selectedFan.name}</strong><small>{selectedFan.id}</small></div>
          <div className="cooling-fan-load-fields"><label><span>팬 모터 소비전류 (A/팬)</span><input aria-label="팬 모터 소비전류" type="number" min="0.001" max="20" step="0.001" value={currentA} onChange={(event) => setCurrentA(event.target.value)} placeholder="예: 0.2" disabled={busy} required /></label><label><span>제조사 모델/SKU</span><input aria-label="팬 소비전류 제조사 모델" value={manufacturerModel} onChange={(event) => setManufacturerModel(event.target.value)} maxLength={160} placeholder="예: FAN-MODEL-REV-A" disabled={busy} required /></label></div>
          <div className="cooling-fan-load-source-fields"><label><span>검수 근거 메모</span><input aria-label="팬 소비전류 검수 근거 메모" value={sourceNote} onChange={(event) => setSourceNote(event.target.value)} maxLength={500} placeholder="예: 제조사 매뉴얼 정격전류 표" disabled={busy} required /></label><label><span>근거 URL (HTTPS)</span><input aria-label="팬 소비전류 근거 URL" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://..." disabled={busy} /></label></div>
          <div className="cooling-fan-load-form-actions"><button className="button button-primary" type="submit" disabled={busy || !currentA.trim()}><FiSave /> 저장</button><button className="button button-light" type="button" onClick={clearEditor} disabled={busy}>선택 해제</button></div>
          <p className="cooling-fan-load-help"><FiInfo /> 값은 상품 1개가 아니라 팬 1개 기준입니다. 상품 팬 개수와 수량을 엔진이 곱해 허브 총 부하를 계산합니다.</p>
        </form>}
      </div>
      <div className="cooling-fan-load-batch">
        <div className="cooling-fan-load-subheading"><strong>JSON 일괄 보강</strong><span>최대 500개 · 오류 발생 시 전체 저장 중단</span></div>
        <textarea aria-label="쿨링팬 소비전류 보강 JSON" value={json} onChange={(event) => { setJson(event.target.value); setValidation(null); setValidatedInput(""); }} placeholder={COOLING_FAN_LOAD_PLACEHOLDER} disabled={busy} />
        <div className="cooling-fan-load-batch-actions"><button className="button button-secondary" type="button" onClick={() => void validateBatch()} disabled={busy || !json.trim()}><FiCheckCircle /> JSON 검증</button><button className="button button-primary" type="button" onClick={() => void saveBatch()} disabled={busy || !validation || validation.invalidCount > 0 || validatedInput !== json}><FiSave /> 검증 결과 저장</button><button className="button button-light" type="button" onClick={() => void exportOverrides()} disabled={busy}><FiDownload /> JSON 내보내기</button></div>
        {validation && <div className={`cooling-fan-load-validation ${validation.invalidCount === 0 ? "valid" : "invalid"}`} role="status"><strong>{validation.invalidCount === 0 ? <><FiCheckCircle /> 저장 가능</> : <><FiAlertTriangle /> 저장 차단</>} · {validation.validCount}개 유효 · {validation.invalidCount}개 수정 필요</strong>{validation.items.filter((item) => !item.valid).slice(0, 5).map((item) => <p key={item.accessoryId}><b>{item.accessoryName ?? item.accessoryId}</b> · {item.errors.join(" · ")}</p>)}</div>}
        <p className="cooling-fan-load-help"><FiInfo /> 등록값에는 제조사 모델/SKU와 근거 메모를 남겨야 합니다. URL은 HTTPS만 허용합니다.</p>
      </div>
    </div>
    <div className="cooling-fan-load-list-heading"><strong>저장된 팬 소비전류 근거</strong><span>{visibleOverrides.length} / {overrides.length}개</span><input aria-label="저장된 팬 소비전류 근거 검색" value={listQuery} onChange={(event) => setListQuery(event.target.value)} placeholder="등록 목록 검색" disabled={busy} /></div>
    {loading ? <p className="cooling-fan-load-state"><FiLoader className="spin" /> 저장 목록을 불러오는 중...</p> : visibleOverrides.length === 0 ? <p className="cooling-fan-load-state"><FiDatabase /> 저장된 팬 소비전류 근거가 없습니다.</p> : <div className="cooling-fan-load-list">{visibleOverrides.map((item) => <article key={item.accessoryId}><div><strong>{item.accessoryName ?? item.accessoryId}</strong><small>{loadText(item)} · {new Date(item.updatedAt).toLocaleDateString("ko-KR")}</small></div><div>{item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer" aria-label={`${item.accessoryName ?? item.accessoryId} 팬 소비전류 근거 원문`}><FiExternalLink /></a>}<button className="text-button danger-text-button" type="button" onClick={() => void removeOverride(item.accessoryId)} disabled={busy}><FiTrash2 /> 삭제</button></div></article>)}</div>}
    <p className="cooling-fan-load-note"><FiInfo /> 보강값은 원본 accessories.json과 분리됩니다. 삭제하면 원문에서 자동 파싱된 값만 다시 사용하며, 원문에도 값이 없으면 허브 전류는 확인 필요로 돌아갑니다.</p>
  </section>;
}
