import { useState } from "react";
import { FiCheckCircle, FiPlus, FiRefreshCw, FiShield } from "react-icons/fi";
import { gamingPerformanceEvidenceRecordFromUnknown } from "../shared/gaming-performance-evidence";
import type { GamingPerformanceEvidenceRecord } from "../shared/gaming-performance-evidence";
import { GAMING_GRAPHICS_PRESET_LABELS, GAMING_REFRESH_RATE_LABELS, GAMING_RESOLUTION_LABELS, GAMING_UPSCALING_LABELS } from "../shared/types";
import type { GamingGraphicsPreset, GamingRefreshRate, GamingResolution, GamingUpscaling } from "../shared/types";

type ComposerState = {
  id: string;
  gameId: string;
  gpuPartId: string;
  gpuName: string;
  resolution: GamingResolution;
  refreshRate: string;
  graphicsPreset: GamingGraphicsPreset;
  rayTracing: boolean;
  upscaling: GamingUpscaling;
  averageFps: string;
  onePercentLowFps: string;
  driverVersion: string;
  measuredAt: string;
  sourceKind: GamingPerformanceEvidenceRecord["sourceKind"];
  sourceUrl: string;
  sourceNote: string;
};

const SOURCE_KIND_LABELS: Record<ComposerState["sourceKind"], string> = {
  independent_review: "독립 리뷰",
  official: "공식 자료",
  lab: "랩 측정",
  user_capture: "사용자 캡처"
};

function emptyComposer(): ComposerState {
  return {
    id: "",
    gameId: "",
    gpuPartId: "",
    gpuName: "",
    resolution: "1440p",
    refreshRate: "144",
    graphicsPreset: "balanced",
    rayTracing: false,
    upscaling: "quality",
    averageFps: "",
    onePercentLowFps: "",
    driverVersion: "",
    measuredAt: "",
    sourceKind: "independent_review",
    sourceUrl: "",
    sourceNote: ""
  };
}

export function AdminGamingEvidenceComposer({ onAdd, onToast }: { onAdd: (record: GamingPerformanceEvidenceRecord) => void; onToast: (message: string) => void }) {
  const [form, setForm] = useState<ComposerState>(emptyComposer);
  const [error, setError] = useState<string | null>(null);
  const update = (patch: Partial<ComposerState>) => setForm((current) => ({ ...current, ...patch }));

  function appendRecord() {
    const parsedMeasuredAt = form.measuredAt ? new Date(form.measuredAt) : undefined;
    if (parsedMeasuredAt && Number.isNaN(parsedMeasuredAt.getTime())) {
      setError("측정일을 확인해 주세요.");
      return;
    }
    const record = gamingPerformanceEvidenceRecordFromUnknown({
      id: form.id,
      gameId: form.gameId,
      gpuPartId: form.gpuPartId,
      gpuName: form.gpuName,
      resolution: form.resolution,
      refreshRate: Number(form.refreshRate) as GamingRefreshRate,
      graphicsPreset: form.graphicsPreset,
      rayTracing: form.rayTracing,
      upscaling: form.upscaling,
      averageFps: Number(form.averageFps),
      ...(form.onePercentLowFps.trim() ? { onePercentLowFps: Number(form.onePercentLowFps) } : {}),
      ...(form.driverVersion.trim() ? { driverVersion: form.driverVersion } : {}),
      measuredAt: parsedMeasuredAt ? parsedMeasuredAt.toISOString() : form.measuredAt,
      sourceKind: form.sourceKind,
      sourceUrl: form.sourceUrl,
      ...(form.sourceNote.trim() ? { sourceNote: form.sourceNote } : {})
    });
    if (!record) {
      setError("ID·게임·GPU·평균 FPS·측정일·HTTPS 출처와 조건을 모두 확인해 주세요. 1% low는 평균 FPS보다 높을 수 없습니다.");
      return;
    }
    setError(null);
    onAdd(record);
    setForm(emptyComposer());
    onToast("실측 레코드를 JSON 편집기에 추가했습니다. 저장 전 확인을 실행해 주세요.");
  }

  return <details className="gaming-performance-evidence-composer" data-testid="gaming-performance-evidence-composer">
    <summary><span><FiPlus /> 실측 레코드 1건 입력</span><small>실제 측정값과 원본 출처가 있을 때만 작성</small></summary>
    <div className="gaming-performance-evidence-composer-body">
      <p className="gaming-performance-evidence-composer-note"><FiShield /> 이 폼은 측정값을 만들어 주지 않습니다. 실제 측정 자료와 HTTPS 원본을 확인한 뒤 입력하고, 추가 후에도 서버 확인과 저장 단계를 통과해야 합니다.</p>
      <div className="gaming-performance-evidence-composer-grid">
        <label><span>자료 ID</span><input value={form.id} onChange={(event) => update({ id: event.target.value })} placeholder="예: cyberpunk-gpu-2026-01" /></label>
        <label><span>게임 ID</span><input value={form.gameId} onChange={(event) => update({ gameId: event.target.value })} placeholder="예: cyberpunk" /></label>
        <label><span>GPU Part ID</span><input value={form.gpuPartId} onChange={(event) => update({ gpuPartId: event.target.value })} placeholder="예: gpu-rtx-5090" /></label>
        <label><span>GPU 이름</span><input value={form.gpuName} onChange={(event) => update({ gpuName: event.target.value })} placeholder="측정에 사용한 GPU 모델명" /></label>
        <label><span>해상도</span><select value={form.resolution} onChange={(event) => update({ resolution: event.target.value as GamingResolution })}>{Object.entries(GAMING_RESOLUTION_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label><span>목표 FPS</span><select value={form.refreshRate} onChange={(event) => update({ refreshRate: event.target.value })}>{([60, 144, 240] as const).map((value) => <option value={value} key={value}>{GAMING_REFRESH_RATE_LABELS[value]}</option>)}</select></label>
        <label><span>그래픽 프리셋</span><select value={form.graphicsPreset} onChange={(event) => update({ graphicsPreset: event.target.value as GamingGraphicsPreset })}>{Object.entries(GAMING_GRAPHICS_PRESET_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label><span>업스케일링</span><select value={form.upscaling} onChange={(event) => update({ upscaling: event.target.value as GamingUpscaling })}>{Object.entries(GAMING_UPSCALING_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label><span>평균 FPS</span><input type="number" min="0.1" max="1000" step="0.1" value={form.averageFps} onChange={(event) => update({ averageFps: event.target.value })} placeholder="실제 측정 평균" /></label>
        <label><span>1% low FPS <em>선택</em></span><input type="number" min="0.1" max="1000" step="0.1" value={form.onePercentLowFps} onChange={(event) => update({ onePercentLowFps: event.target.value })} placeholder="기록한 경우만" /></label>
        <label><span>드라이버 <em>선택</em></span><input value={form.driverVersion} onChange={(event) => update({ driverVersion: event.target.value })} placeholder="예: 576.02" /></label>
        <label><span>측정일</span><input type="datetime-local" value={form.measuredAt} onChange={(event) => update({ measuredAt: event.target.value })} /></label>
        <label><span>출처 종류</span><select value={form.sourceKind} onChange={(event) => update({ sourceKind: event.target.value as ComposerState["sourceKind"] })}>{Object.entries(SOURCE_KIND_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label className="wide"><span>HTTPS 원본 URL</span><input type="url" value={form.sourceUrl} onChange={(event) => update({ sourceUrl: event.target.value })} placeholder="https://..." /></label>
        <label className="wide"><span>측정 메모 <em>선택</em></span><textarea value={form.sourceNote} onChange={(event) => update({ sourceNote: event.target.value })} placeholder="드라이버·게임 패치·측정 장면·온도 등 원문에 남은 조건" /></label>
        <label className="composer-checkbox wide"><input type="checkbox" checked={form.rayTracing} onChange={(event) => update({ rayTracing: event.target.checked })} /><span>레이 트레이싱 조건 포함</span></label>
      </div>
      {error && <p className="gaming-performance-evidence-composer-error" role="alert">{error}</p>}
      <div className="gaming-performance-evidence-composer-actions"><button className="button button-light" type="button" onClick={() => { setForm(emptyComposer()); setError(null); }}><FiRefreshCw /> 입력 초기화</button><button className="button button-secondary" type="button" onClick={appendRecord}><FiCheckCircle /> JSON에 추가</button></div>
    </div>
  </details>;
}
