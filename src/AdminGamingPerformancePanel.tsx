import { useEffect, useMemo, useState } from "react";
import { FiAlertTriangle, FiCheckCircle, FiCopy, FiDatabase, FiExternalLink, FiInfo, FiLoader, FiRefreshCw, FiSave, FiShield, FiUploadCloud } from "react-icons/fi";
import { gamingPerformanceEvidenceBatchValidationFor, gamingPerformanceEvidenceRequestFromJson, GAMING_PERFORMANCE_EVIDENCE_STALE_DAYS, type GamingPerformanceEvidenceBatchValidation, type GamingPerformanceEvidenceRecord, type GamingPerformanceEvidenceRequest } from "../shared/gaming-performance-evidence";
import { GAMING_GRAPHICS_PRESET_LABELS, GAMING_RESOLUTION_LABELS, GAMING_UPSCALING_LABELS } from "../shared/types";
import type { GamingGraphicsPreset, GamingRefreshRate, GamingResolution, GamingUpscaling } from "../shared/types";
import { api } from "./api";
import { AdminGamingEvidenceComposer } from "./AdminGamingEvidenceComposer";

type EvidenceResponse = {
  items: GamingPerformanceEvidenceRecord[];
  count: number;
  pathConfigured: boolean;
  updatedAt?: string;
};

const SOURCE_KIND_LABELS: Record<GamingPerformanceEvidenceRecord["sourceKind"], string> = {
  independent_review: "독립 리뷰",
  official: "공식 자료",
  lab: "랩 측정",
  user_capture: "사용자 캡처"
};

type EvidenceRecordState = "verified" | "review" | "stale";
type EvidenceRecordFilter = "all" | EvidenceRecordState;
type InitialCoverageFilters = {
  recordQuery: string;
  requestGameIds: string[];
  requestGpuPartId?: string;
  conditionResolution: GamingResolution | "";
  conditionRefreshRate: "" | "60" | "144" | "240";
  conditionGraphicsPreset: GamingGraphicsPreset | "";
  conditionUpscaling: GamingUpscaling | "";
  conditionRayTracing: "" | "true" | "false";
};

function initialCoverageFilters(): InitialCoverageFilters {
  if (typeof window === "undefined") return { recordQuery: "", requestGameIds: [], conditionResolution: "" as GamingResolution | "", conditionRefreshRate: "" as "" | "60" | "144" | "240", conditionGraphicsPreset: "" as GamingGraphicsPreset | "", conditionUpscaling: "" as GamingUpscaling | "", conditionRayTracing: "" as "" | "true" | "false" };
  const params = new URLSearchParams(window.location.search);
  const resolution = params.get("gamingResolution");
  const refresh = params.get("gamingRefresh");
  const graphics = params.get("gamingGraphics");
  const upscaling = params.get("gamingUpscaling");
  const rayTracing = params.get("gamingRt");
  const validResolution = resolution === "1080p" || resolution === "1440p" || resolution === "4k" ? resolution : "";
  const validRefresh = refresh === "60" || refresh === "144" || refresh === "240" ? refresh : "";
  const validGraphics = graphics === "competitive" || graphics === "balanced" || graphics === "high" ? graphics : "";
  const validUpscaling = upscaling === "native" || upscaling === "quality" || upscaling === "balanced" ? upscaling : "";
  const validRayTracing = rayTracing === "true" || rayTracing === "false" ? rayTracing : "";
  return {
    recordQuery: params.get("gamingGpu")?.trim().slice(0, 240) ?? "",
    requestGameIds: params.get("gamingGame")?.trim() ? [params.get("gamingGame")!.trim()] : [],
    ...(params.get("gamingGpu")?.trim() ? { requestGpuPartId: params.get("gamingGpu")!.trim() } : {}),
    conditionResolution: validResolution,
    conditionRefreshRate: validRefresh,
    conditionGraphicsPreset: validGraphics,
    conditionUpscaling: validUpscaling,
    conditionRayTracing: validRayTracing
  };
}

function evidenceRecordStateFor(record: GamingPerformanceEvidenceRecord, now = Date.now()): { state: EvidenceRecordState; label: string } {
  const measuredAt = Date.parse(record.measuredAt);
  if (!Number.isFinite(measuredAt) || now - measuredAt > GAMING_PERFORMANCE_EVIDENCE_STALE_DAYS * 24 * 60 * 60 * 1_000) return { state: "stale", label: "갱신 필요" };
  return record.averageFps >= record.refreshRate ? { state: "verified", label: "평균 기준 충족" } : { state: "review", label: "목표 FPS 미달" };
}

function jsonTextFor(items: GamingPerformanceEvidenceRecord[]) {
  return JSON.stringify(items, null, 2);
}

function parseEditorValue(value: string) {
  try {
    return { value: JSON.parse(value) as unknown };
  } catch {
    return { error: "JSON 문법을 먼저 확인해 주세요." };
  }
}

export function AdminGamingPerformancePanel({ onToast }: { onToast: (message: string) => void }) {
  const [initialFilters] = useState(initialCoverageFilters);
  const [items, setItems] = useState<GamingPerformanceEvidenceRecord[]>([]);
  const [json, setJson] = useState("[]");
  const [validation, setValidation] = useState<GamingPerformanceEvidenceBatchValidation | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [pathConfigured, setPathConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"validate" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recordFilter, setRecordFilter] = useState<EvidenceRecordFilter>("all");
  const [recordQuery, setRecordQuery] = useState(initialFilters.recordQuery);
  const [conditionGameIds, setConditionGameIds] = useState<string[]>(initialFilters.requestGameIds);
  const [conditionResolution, setConditionResolution] = useState<GamingResolution | "">(initialFilters.conditionResolution);
  const [conditionRefreshRate, setConditionRefreshRate] = useState<"" | "60" | "144" | "240">(initialFilters.conditionRefreshRate);
  const [conditionGraphicsPreset, setConditionGraphicsPreset] = useState<GamingGraphicsPreset | "">(initialFilters.conditionGraphicsPreset);
  const [conditionUpscaling, setConditionUpscaling] = useState<GamingUpscaling | "">(initialFilters.conditionUpscaling);
  const [conditionRayTracing, setConditionRayTracing] = useState<"" | "true" | "false">(initialFilters.conditionRayTracing);
  const [requestJson, setRequestJson] = useState("");
  const [requestError, setRequestError] = useState<string | null>(null);
  const [appliedRequest, setAppliedRequest] = useState<GamingPerformanceEvidenceRequest | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await api<EvidenceResponse>("/api/admin/gaming-performance-evidence");
      setItems(response.items);
      setJson(jsonTextFor(response.items));
      setUpdatedAt(response.updatedAt ?? null);
      setPathConfigured(response.pathConfigured);
      setValidation(null);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : "게임별 FPS 자료를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function validate() {
    const parsed = parseEditorValue(json);
    if (parsed.error) {
      setValidation(null);
      setError(parsed.error);
      return;
    }
    setBusy("validate");
    setError(null);
    try {
      const next = await api<GamingPerformanceEvidenceBatchValidation>("/api/admin/gaming-performance-evidence/validate", { method: "POST", body: JSON.stringify(parsed.value) });
      setValidation(next);
      if (next.valid) onToast(`${next.validCount.toLocaleString("ko-KR")}개 게임별 FPS 자료를 저장할 수 있습니다.`);
    } catch (validationError: unknown) {
      setError(validationError instanceof Error ? validationError.message : "FPS 자료를 확인하지 못했습니다.");
      setValidation(null);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (busy || !validation?.valid) return;
    if (!window.confirm(`${validation.validCount.toLocaleString("ko-KR")}개 게임별 FPS 자료를 서버 기준으로 저장할까요? 오류가 있는 자료는 저장되지 않습니다.`)) return;
    const parsed = parseEditorValue(json);
    if (parsed.error) {
      setError(parsed.error);
      return;
    }
    setBusy("save");
    setError(null);
    try {
      const response = await api<EvidenceResponse & { saved: boolean }>("/api/admin/gaming-performance-evidence", { method: "PUT", body: JSON.stringify(parsed.value) });
      setItems(response.items);
      setJson(jsonTextFor(response.items));
      setUpdatedAt(response.updatedAt ?? null);
      setValidation(null);
      onToast("게임별 FPS 자료를 저장했습니다. 이후 자동 견적부터 선택 GPU·조건과 대조합니다.");
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : "FPS 자료를 저장하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }

  const evidenceStateCounts = useMemo(() => items.reduce((counts, item) => {
    counts[evidenceRecordStateFor(item).state] += 1;
    return counts;
  }, { verified: 0, review: 0, stale: 0 } as Record<EvidenceRecordState, number>), [items]);
  const filteredItems = useMemo(() => {
    const normalizedQuery = recordQuery.trim().toLocaleLowerCase("ko-KR");
    return items.filter((item) => {
      const stateMatches = recordFilter === "all" || evidenceRecordStateFor(item).state === recordFilter;
      if (!stateMatches) return false;
      if (conditionGameIds.length > 0 && !conditionGameIds.includes(item.gameId)) return false;
      if (conditionResolution && item.resolution !== conditionResolution) return false;
      if (conditionRefreshRate && String(item.refreshRate) !== conditionRefreshRate) return false;
      if (conditionGraphicsPreset && item.graphicsPreset !== conditionGraphicsPreset) return false;
      if (conditionUpscaling && item.upscaling !== conditionUpscaling) return false;
      if (conditionRayTracing && String(item.rayTracing) !== conditionRayTracing) return false;
      if (!normalizedQuery) return true;
      return `${item.gameId} ${item.gpuPartId} ${item.gpuName}`.toLocaleLowerCase("ko-KR").includes(normalizedQuery);
    });
  }, [conditionGameIds, conditionGraphicsPreset, conditionRayTracing, conditionRefreshRate, conditionResolution, conditionUpscaling, items, recordFilter, recordQuery]);
  const visibleItems = useMemo(() => filteredItems.slice(0, 8), [filteredItems]);
  const conditionFilterActive = Boolean(conditionGameIds.length > 0 || conditionResolution || conditionRefreshRate || conditionGraphicsPreset || conditionUpscaling || conditionRayTracing);
  const requestGameIdsForDisplay = appliedRequest?.gameIds ?? initialFilters.requestGameIds;
  const requestGpuPartIdForDisplay = appliedRequest?.gpuPartId ?? initialFilters.requestGpuPartId;
  const clearConditionFilters = () => {
    setConditionGameIds([]);
    setConditionResolution("");
    setConditionRefreshRate("");
    setConditionGraphicsPreset("");
    setConditionUpscaling("");
    setConditionRayTracing("");
  };
  function applyRequestJson() {
    const request = gamingPerformanceEvidenceRequestFromJson(requestJson);
    if (!request) {
      setRequestError("측정 요청 JSON의 schema·조건·생성 시각을 확인해 주세요.");
      return;
    }
    setRequestError(null);
    setAppliedRequest(request);
    setConditionGameIds(request.gameIds);
    setRecordQuery(request.gpuPartId ?? "");
    setConditionResolution(request.resolution);
    setConditionRefreshRate(String(request.refreshRate) as "60" | "144" | "240");
    setConditionGraphicsPreset(request.graphicsPreset);
    setConditionUpscaling(request.upscaling);
    setConditionRayTracing(request.rayTracing ? "true" : "false");
    setRecordFilter("all");
    onToast(`${request.gameIds.length}개 게임의 측정 조건을 FPS 자료 검색에 적용했습니다.`);
  }

  function appendEvidenceRecord(record: GamingPerformanceEvidenceRecord) {
    const parsed = parseEditorValue(json);
    if (parsed.error) {
      setError(parsed.error);
      return;
    }
    const current = gamingPerformanceEvidenceBatchValidationFor(parsed.value);
    if (!current.valid) {
      setError("현재 JSON에 오류가 있어 새 레코드를 추가하지 않았습니다. 먼저 저장 전 확인으로 오류를 확인해 주세요.");
      return;
    }
    setError(null);
    setValidation(null);
    setJson(jsonTextFor([...current.records, record]));
  }

  async function copyMeasurementRequestFor(record: GamingPerformanceEvidenceRecord) {
    const request = {
      schemaVersion: 1 as const,
      kind: "gaming-performance-evidence-request" as const,
      createdAt: new Date().toISOString(),
      gameIds: [record.gameId],
      resolution: record.resolution,
      refreshRate: record.refreshRate,
      graphicsPreset: record.graphicsPreset,
      rayTracing: record.rayTracing,
      upscaling: record.upscaling,
      gpuPartId: record.gpuPartId,
      gpuName: record.gpuName
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(request, null, 2));
      onToast(`${record.gameId} · ${record.gpuName} 측정 요청 JSON을 복사했습니다.`);
    } catch {
      onToast("측정 요청 JSON을 복사하지 못했습니다. 브라우저 클립보드 권한을 확인해 주세요.");
    }
  }

  return <section className="admin-card gaming-performance-evidence-admin-card" data-testid="admin-gaming-performance-evidence">
    <div className="admin-card-heading"><div><h3>게임별 FPS 자료 관리</h3></div><FiActivityIcon /></div>
    <p className="admin-card-description">측정한 FPS 자료를 게임·해상도·그래픽 설정·그래픽카드와 연결합니다. 저장 전 GPU ID, FPS, 측정 날짜와 원본 링크를 확인합니다. 자료가 없으면 사용자 결과에 확인이 필요하다고 표시됩니다.</p>
    <div className="gaming-performance-evidence-admin-summary"><span>저장 자료 <strong>{items.length.toLocaleString("ko-KR")}개</strong></span><span>평균 기준 충족 <strong className="good">{evidenceStateCounts.verified.toLocaleString("ko-KR")}개</strong></span><span>목표 미달 <strong className={evidenceStateCounts.review > 0 ? "review" : "good"}>{evidenceStateCounts.review.toLocaleString("ko-KR")}개</strong></span><span>갱신 필요 <strong className={evidenceStateCounts.stale > 0 ? "review" : "good"}>{evidenceStateCounts.stale.toLocaleString("ko-KR")}개</strong></span><span>{loading ? "불러오는 중..." : updatedAt ? `마지막 저장 ${new Date(updatedAt).toLocaleString("ko-KR")}` : "저장 이력 없음"}</span>{pathConfigured && <span className="configured">외부 경로 사용</span>}</div>
    {(requestGameIdsForDisplay.length > 0 || requestGpuPartIdForDisplay) && <div className="gaming-performance-evidence-admin-request-context" data-testid="gaming-performance-evidence-request-context"><strong>측정 요청</strong><span>{appliedRequest ? "붙여넣은 조건으로 FPS 자료를 찾고 있어요." : "사용자 결과에서 전달된 측정 조건이에요."}</span><small>{requestGameIdsForDisplay.length > 0 ? `게임 · ${requestGameIdsForDisplay.join(" · ")}` : "게임 조건 확인 필요"}{requestGpuPartIdForDisplay ? ` · GPU · ${requestGpuPartIdForDisplay}` : " · GPU 조건 확인 필요"}</small></div>}
    {error && <div className="gaming-performance-evidence-admin-error" role="alert"><FiAlertTriangle /><span>{error}</span></div>}
    <AdminGamingEvidenceComposer onAdd={appendEvidenceRecord} onToast={onToast} />
    <div className="gaming-performance-evidence-admin-tools"><label><span>FPS 자료 JSON</span><textarea value={json} onChange={(event) => { setJson(event.target.value); setValidation(null); }} spellCheck={false} aria-label="게임별 FPS 자료 JSON" placeholder="확인한 FPS 자료 배열을 붙여 넣으세요." /></label><div className="gaming-performance-evidence-admin-actions"><button className="button button-light" type="button" onClick={() => void load()} disabled={loading || busy !== null}><FiRefreshCw className={loading ? "spin" : undefined} /> 현재 자료 다시 읽기</button><button className="button button-secondary" type="button" onClick={() => void validate()} disabled={busy !== null}><FiShield /> {busy === "validate" ? "확인 중..." : "저장 전 확인"}</button><button className="button button-primary" type="button" onClick={() => void save()} disabled={busy !== null || !validation?.valid}><FiSave /> {busy === "save" ? "저장 중..." : "자료 저장"}</button></div></div>
    {validation && <div className={`gaming-performance-evidence-admin-validation ${validation.valid ? "valid" : "invalid"}`} role="status"><strong>{validation.valid ? <><FiCheckCircle /> 저장 가능한 자료</> : <><FiAlertTriangle /> 저장 중단</>}</strong><span>유효 {validation.validCount.toLocaleString("ko-KR")}개 · 오류 {validation.invalidCount.toLocaleString("ko-KR")}개</span>{validation.errors.length > 0 && <ul>{validation.errors.slice(0, 5).map((item) => <li key={`${item.index}-${item.id ?? "row"}-${item.message}`}>{item.index >= 0 ? `${item.index + 1}행 · ` : ""}{item.message}</li>)}</ul>}</div>}
    <section className="gaming-performance-evidence-admin-request-import" data-testid="gaming-performance-evidence-request-import" aria-label="측정 요청 JSON 적용"><div><strong>측정 요청 JSON 적용</strong><span>요청한 조건으로 자료를 검색합니다. FPS 측정 기록은 변경하거나 저장하지 않습니다.</span></div><textarea value={requestJson} onChange={(event) => { setRequestJson(event.target.value); setRequestError(null); }} spellCheck={false} aria-label="측정 요청 JSON" placeholder="gaming-performance-evidence-request JSON을 붙여 넣으세요." /><div><button className="button button-light" type="button" onClick={applyRequestJson} disabled={!requestJson.trim()}>요청 조건 적용</button>{requestError && <p role="alert">{requestError}</p>}</div></section>
    <section className="gaming-performance-evidence-admin-coverage" data-testid="gaming-performance-evidence-filter" aria-label="게임별 FPS 자료 필터"><div className="gaming-performance-evidence-admin-coverage-heading"><div><strong>자료 연결 확인</strong><span>{conditionGameIds.length > 0 ? `게임 조건 · ${conditionGameIds.join(" · ")} · ` : ""}선택한 조건에 맞는 자료를 보여줍니다.</span></div><em>{filteredItems.length.toLocaleString("ko-KR")} / {items.length.toLocaleString("ko-KR")}개</em></div><label><span>게임·GPU 검색</span><input type="search" value={recordQuery} onChange={(event) => setRecordQuery(event.target.value)} placeholder="cyberpunk · gpu-rtx-5090" aria-label="게임 또는 GPU 자료 검색" /></label><div className="gaming-performance-evidence-admin-condition-grid"><label><span>해상도</span><select aria-label="FPS 자료 해상도 조건" value={conditionResolution} onChange={(event) => setConditionResolution(event.target.value as GamingResolution | "")}><option value="">전체 해상도</option>{Object.entries(GAMING_RESOLUTION_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>목표 FPS</span><select aria-label="FPS 자료 목표 FPS 조건" value={conditionRefreshRate} onChange={(event) => setConditionRefreshRate(event.target.value as "" | "60" | "144" | "240")}><option value="">전체 FPS</option>{([60, 144, 240] as const).map((value) => <option value={value} key={value}>{value} FPS</option>)}</select></label><label><span>그래픽</span><select aria-label="FPS 자료 그래픽 조건" value={conditionGraphicsPreset} onChange={(event) => setConditionGraphicsPreset(event.target.value as GamingGraphicsPreset | "")}><option value="">전체 그래픽</option>{Object.entries(GAMING_GRAPHICS_PRESET_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>업스케일링</span><select aria-label="FPS 자료 업스케일링 조건" value={conditionUpscaling} onChange={(event) => setConditionUpscaling(event.target.value as GamingUpscaling | "")}><option value="">전체 업스케일링</option>{Object.entries(GAMING_UPSCALING_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>레이 트레이싱</span><select aria-label="FPS 자료 레이 트레이싱 조건" value={conditionRayTracing} onChange={(event) => setConditionRayTracing(event.target.value as "" | "true" | "false")}><option value="">전체 RT</option><option value="true">포함</option><option value="false">미포함</option></select></label>{conditionFilterActive && <button className="text-button gaming-performance-evidence-admin-clear" type="button" onClick={clearConditionFilters}>조건 초기화</button>}</div><div className="gaming-performance-evidence-admin-filters" role="group" aria-label="FPS 자료 상태 필터"><button type="button" className={recordFilter === "all" ? "selected" : ""} aria-pressed={recordFilter === "all"} onClick={() => setRecordFilter("all")}>전체 {items.length}</button><button type="button" className={recordFilter === "verified" ? "selected" : ""} aria-pressed={recordFilter === "verified"} onClick={() => setRecordFilter("verified")}>평균 기준 충족 {evidenceStateCounts.verified}</button><button type="button" className={recordFilter === "review" ? "selected" : ""} aria-pressed={recordFilter === "review"} onClick={() => setRecordFilter("review")}>목표 미달 {evidenceStateCounts.review}</button><button type="button" className={recordFilter === "stale" ? "selected" : ""} aria-pressed={recordFilter === "stale"} onClick={() => setRecordFilter("stale")}>갱신 필요 {evidenceStateCounts.stale}</button></div></section>
    {visibleItems.length > 0 ? <div className="gaming-performance-evidence-admin-list" aria-label="저장된 게임별 FPS 자료">{visibleItems.map((item) => { const recordState = evidenceRecordStateFor(item); return <article key={item.id}><div><strong>{item.gameId}</strong><span>{item.gpuName}</span><small>GPU ID · {item.gpuPartId}</small></div><div><b className={`evidence-record-state ${recordState.state}`}>{recordState.label}</b><small>{item.averageFps.toLocaleString("ko-KR")} FPS · 목표 {item.refreshRate} FPS</small><small>측정 {new Date(item.measuredAt).toLocaleDateString("ko-KR")} · {item.resolution} · {GAMING_GRAPHICS_PRESET_LABELS[item.graphicsPreset]} · {GAMING_UPSCALING_LABELS[item.upscaling]}</small><small>{SOURCE_KIND_LABELS[item.sourceKind]}</small></div><div className="gaming-performance-evidence-admin-row-actions"><button type="button" className="text-button" data-testid={`gaming-performance-request-${item.id}`} onClick={() => void copyMeasurementRequestFor(item)}><FiCopy /> 측정 요청</button><a href={item.sourceUrl} target="_blank" rel="noreferrer" aria-label={`${item.id} 원본 출처`}><FiExternalLink /></a></div></article>; })}</div> : <div className="gaming-performance-evidence-admin-empty"><FiDatabase /><strong>{items.length > 0 ? "조건에 맞는 FPS 자료가 없습니다." : "연결된 FPS 자료가 없습니다."}</strong><p>{items.length > 0 ? "검색어 또는 상태 필터를 바꿔 다른 자료를 확인해 주세요." : "실측 자료를 임의로 만들지 않고, 확인한 JSON을 준비했을 때만 저장합니다."}</p></div>}
    {filteredItems.length > visibleItems.length && <p className="gaming-performance-evidence-admin-more">현재 필터 결과 중 {visibleItems.length.toLocaleString("ko-KR")}개를 표시하고 있습니다. 외 {(filteredItems.length - visibleItems.length).toLocaleString("ko-KR")}개 자료는 검색어를 더 좁혀 확인하세요.</p>}
    <p className="gaming-performance-evidence-admin-note"><FiInfo /> 목표 FPS에 도달한 자료라도 실제 성능은 게임 업데이트와 PC 환경에 따라 달라질 수 있어요. 저장한 측정 자료는 부품 추천에 사용돼요.</p>
  </section>;
}

function FiActivityIcon() {
  return <FiUploadCloud aria-hidden="true" />;
}
