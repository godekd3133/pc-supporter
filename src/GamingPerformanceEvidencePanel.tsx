import { FiAlertTriangle, FiCheckCircle, FiInfo } from "react-icons/fi";
import { gamingGameOptionFor } from "../shared/gaming-catalog";
import { GAMING_GRAPHICS_PRESET_LABELS, GAMING_REFRESH_RATE_LABELS, GAMING_RESOLUTION_LABELS, GAMING_UPSCALING_LABELS, type GamingPerformanceAssessment } from "../shared/types";

function gameLabelFor(gameId: string) {
  return gamingGameOptionFor(gameId)?.label ?? gameId;
}

function statusLabel(status: GamingPerformanceAssessment["status"]) {
  if (status === "verified") return "목표 FPS 달성";
  if (status === "target_not_met") return "목표 FPS 미달";
  if (status === "partial") return "일부 게임 측정값 없음";
  if (status === "stale") return "측정값 업데이트 필요";
  if (status === "missing") return "일치하는 측정값 없음";
  return "FPS 측정값 없음";
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
  const measurements = assessment.measurements ?? [];
  const conditionText = [
    GAMING_RESOLUTION_LABELS[assessment.resolution],
    GAMING_REFRESH_RATE_LABELS[assessment.refreshRate],
    assessment.graphicsPreset ? GAMING_GRAPHICS_PRESET_LABELS[assessment.graphicsPreset] : undefined,
    assessment.upscaling ? GAMING_UPSCALING_LABELS[assessment.upscaling] : undefined,
    assessment.rayTracing ? "레이 트레이싱" : undefined
  ].filter((value): value is string => Boolean(value)).join(" · ");
  const issueText = assessment.status === "target_not_met"
    ? `목표 FPS보다 낮은 게임: ${(assessment.belowTargetGameIds ?? []).map(gameLabelFor).join(" · ")}`
    : assessment.status === "partial" || assessment.status === "missing"
      ? `측정값 없음: ${(assessment.missingGameIds ?? gameIds).map(gameLabelFor).join(" · ")}`
      : statusLabel(assessment.status);

  return <section className={`result-gaming-evidence ${tone}`} data-testid="result-gaming-performance-evidence" aria-label="게임별 예상 FPS">
    <div className="result-gaming-evidence-heading">
      <div><p className="eyebrow">GAME PERFORMANCE</p><h2>게임별 예상 FPS</h2><p>선택한 게임과 화질 설정에 해당하는 FPS 측정값이에요.</p></div>
      <span className="result-gaming-evidence-status"><StatusIcon /> {statusLabel(assessment.status)}</span>
    </div>
    <div className="result-gaming-evidence-conditions">
      <div><span>게임</span><strong>{gameIds.length > 0 ? `${gameIds.length}개` : "일반 게이밍"}</strong><small>{gameIds.length > 0 ? gameIds.map(gameLabelFor).join(" · ") : "특정 게임 미선택"}</small></div>
      <div><span>해상도·화질</span><strong>{conditionText}</strong></div>
      <div><span>그래픽카드</span><strong>{assessment.gpuName ?? "미선택"}</strong></div>
    </div>
    <div className="result-gaming-evidence-issue"><StatusIcon /><span>{issueText}</span></div>
    {measurements.length > 0 && <div className="result-gaming-evidence-measurements" data-testid="result-gaming-measurements">
      <div className="result-gaming-evidence-subheading"><strong>FPS 측정값</strong></div>
      <div className="result-gaming-evidence-measurement-list">{measurements.map((measurement) => {
        const meetsTarget = measurement.averageFps >= assessment.refreshRate;
        return <article className={`result-gaming-evidence-measurement ${meetsTarget ? "meets" : "below"}`} data-testid={`result-gaming-measurement-${measurement.recordId}`} key={measurement.recordId}>
          <div><strong>{gameLabelFor(measurement.gameId)}</strong><small>{measurement.gpuName}</small></div>
          <div><strong>{measurement.averageFps.toLocaleString("ko-KR")} FPS</strong><small>목표 {assessment.refreshRate} FPS{measurement.onePercentLowFps !== undefined ? ` · 1% low ${measurement.onePercentLowFps.toLocaleString("ko-KR")} FPS` : ""}</small></div>
          <div><span>측정 {new Date(measurement.measuredAt).toLocaleDateString("ko-KR")}</span></div>
        </article>;
      })}</div>
    </div>}
  </section>;
}
