import { FiAlertTriangle, FiCheckCircle, FiExternalLink, FiInfo } from "react-icons/fi";
import { gamingGameOptionFor } from "../shared/gaming-catalog";
import { GAMING_GRAPHICS_PRESET_LABELS, GAMING_REFRESH_RATE_LABELS, GAMING_RESOLUTION_LABELS, GAMING_UPSCALING_LABELS, type GamingPerformanceAssessment } from "../shared/types";
import { safeHttpsUrl } from "./safe-source-url";

function gameLabelFor(gameId: string) {
  return gamingGameOptionFor(gameId)?.label ?? gameId;
}

function statusLabel(status: GamingPerformanceAssessment["status"]) {
  if (status === "verified") return "평균 FPS 기준 충족";
  if (status === "target_not_met") return "목표 FPS 미달";
  if (status === "partial") return "일부 조건 확인";
  if (status === "stale") return "자료 갱신 필요";
  if (status === "missing") return "조건 일치 자료 없음";
  return "게임별 자료 미연결";
}

function statusTone(status: GamingPerformanceAssessment["status"]) {
  return status === "verified" ? "verified" : status === "not_recorded" || status === "missing" ? "pending" : "review";
}

function statusIconFor(status: GamingPerformanceAssessment["status"]) {
  return status === "verified" ? FiCheckCircle : status === "target_not_met" || status === "stale" ? FiAlertTriangle : FiInfo;
}

export function GamingPerformanceEvidencePanel({ assessment }: { assessment?: GamingPerformanceAssessment }) {
  if (!assessment) return null;
  const tone = statusTone(assessment.status);
  const StatusIcon = statusIconFor(assessment.status);
  const gameIds = assessment.gameIds;
  const matchedGameIds = new Set(assessment.matchedGameIds ?? []);
  const missingGameIds = assessment.missingGameIds ?? gameIds.filter((gameId) => !matchedGameIds.has(gameId));
  const belowTargetGameIds = assessment.belowTargetGameIds ?? [];
  const measurements = assessment.measurements ?? [];
  const conditionText = [
    GAMING_RESOLUTION_LABELS[assessment.resolution],
    GAMING_REFRESH_RATE_LABELS[assessment.refreshRate],
    assessment.graphicsPreset ? GAMING_GRAPHICS_PRESET_LABELS[assessment.graphicsPreset] : undefined,
    assessment.upscaling ? GAMING_UPSCALING_LABELS[assessment.upscaling] : undefined,
    assessment.rayTracing ? "레이 트레이싱" : undefined
  ].filter((value): value is string => Boolean(value)).join(" · ");
  const issueText = missingGameIds.length > 0
    ? `자료 없음 · ${missingGameIds.map(gameLabelFor).join(" · ")}`
    : belowTargetGameIds.length > 0
      ? `목표 FPS 미달 · ${belowTargetGameIds.map(gameLabelFor).join(" · ")}`
      : (assessment.staleRecordIds?.length ?? 0) > 0
        ? `갱신이 필요한 측정 자료 ${assessment.staleRecordIds?.length ?? 0}개`
        : assessment.status === "not_recorded"
          ? "게임별 실측 자료가 등록되면 선택 GPU와 조건을 다시 대조합니다."
          : "선택한 게임 조건에 연결된 자료를 확인했습니다.";

  return <section className={`result-gaming-evidence ${tone}`} data-testid="result-gaming-performance-evidence" aria-label="게임별 FPS 근거">
    <div className="result-gaming-evidence-heading">
      <div><p className="eyebrow">GAME PERFORMANCE EVIDENCE</p><h2>게임별 FPS 근거</h2><p>자동 추천에 사용한 게임·그래픽 조건과 선택 GPU의 측정 자료를 검사 결과에서도 이어서 확인합니다.</p></div>
      <span className="result-gaming-evidence-status"><StatusIcon /> {statusLabel(assessment.status)}</span>
    </div>
    <div className="result-gaming-evidence-conditions">
      <div><span>게임 조건</span><strong>{gameIds.length > 0 ? `${matchedGameIds.size} / ${gameIds.length}개 연결` : "특정 게임 미선택"}</strong><small>{gameIds.length > 0 ? gameIds.map(gameLabelFor).join(" · ") : "일반 게이밍 기준"}</small></div>
      <div><span>성능 조건</span><strong>{conditionText}</strong><small>자동 견적 입력 조건과 동일</small></div>
      <div><span>선택 GPU</span><strong>{assessment.gpuName ?? "확인 필요"}</strong><small>{assessment.gpuPartId ? `카탈로그 ID · ${assessment.gpuPartId}` : "GPU 자료 연결 전"}</small></div>
    </div>
    <div className="result-gaming-evidence-issue"><StatusIcon /><span>{issueText}</span></div>
    {measurements.length > 0 && <div className="result-gaming-evidence-measurements" data-testid="result-gaming-measurements">
      <div className="result-gaming-evidence-subheading"><strong>연결된 실측 결과</strong><span>평균 FPS 기준 · 측정 환경은 출처에서 확인</span></div>
      <div className="result-gaming-evidence-measurement-list">{measurements.map((measurement) => {
        const sourceUrl = safeHttpsUrl(measurement.sourceUrl);
        const meetsTarget = measurement.averageFps >= assessment.refreshRate;
        return <article className={`result-gaming-evidence-measurement ${meetsTarget ? "meets" : "below"}`} data-testid={`result-gaming-measurement-${measurement.recordId}`} key={measurement.recordId}>
          <div><strong>{gameLabelFor(measurement.gameId)}</strong><small>{measurement.gpuName}</small></div>
          <div><strong>{measurement.averageFps.toLocaleString("ko-KR")} FPS</strong><small>목표 {assessment.refreshRate} FPS{measurement.onePercentLowFps !== undefined ? ` · 1% low ${measurement.onePercentLowFps.toLocaleString("ko-KR")} FPS` : " · 1% low 미기록"}</small></div>
          <div><span>측정 {new Date(measurement.measuredAt).toLocaleDateString("ko-KR")}</span>{sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer"><FiExternalLink /> 출처</a>}</div>
        </article>;
      })}</div>
    </div>}
    <p className="result-gaming-evidence-note"><FiInfo /> {assessment.note}</p>
    <small className="result-gaming-evidence-disclaimer">평균 FPS 자료가 있어도 모니터·드라이버·온도·전력·게임 패치가 달라질 수 있어 실제 환경의 성능을 보장하지 않습니다.</small>
  </section>;
}
