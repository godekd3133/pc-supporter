import type { GamingTargetAssessment } from "../shared/gaming-target-assessment";
import { GAMING_GRAPHICS_PRESET_LABELS, GAMING_RESOLUTION_LABELS, GAMING_UPSCALING_LABELS } from "../shared/types";
import { gameLabelFor } from "./quote-onboarding";
import { safeHttpsUrl } from "./safe-source-url";
import "./gaming-target-assessment.css";

const STATUS_LABELS: Record<GamingTargetAssessment["status"], string> = {
  verified: "같은 환경에서 목표 달성",
  projected: "다른 PC에서 측정한 값",
  target_not_met: "테스트 결과가 목표 FPS 미만",
  partial: "일부 게임만 비교 가능",
  missing: "비교할 FPS 자료가 없어요",
  stale: "오래된 테스트 결과",
  not_recorded: "게임 미선택"
};

function fpsLabel(value: number | undefined): string {
  return value !== undefined && Number.isFinite(value) ? `${Math.round(value * 10) / 10} FPS` : "자료 없음";
}

export function GamingTargetAssessmentPanel({ assessment, targetFps, gameIds, onEditConditions }: { assessment?: GamingTargetAssessment; targetFps: number; gameIds: readonly string[]; onEditConditions?: () => void }) {
  const status = assessment?.status ?? "missing";
  const requestedFps = assessment?.targetFps ?? targetFps;
  const missingGames = assessment?.missingGameIds ?? [...gameIds];
  const measurements = assessment?.measurements ?? [];
  return <section className="gaming-target-assessment" data-testid="gaming-target-assessment" data-target-status={status} aria-label="게임별 목표 FPS 비교">
    <div className="gaming-target-assessment-heading"><div><p>목표 FPS</p><h2>{requestedFps} FPS</h2></div><span className={`gaming-target-assessment-status status-${status}`}>{STATUS_LABELS[status]}</span></div>
    <p className="gaming-target-assessment-note">{assessment?.note ?? "선택한 게임과 설정으로 테스트한 FPS 자료가 없어요."}</p>
    {measurements.some((measurement) => measurement.match !== "exact") && <p className="gaming-target-source-note">이 견적을 직접 측정한 FPS가 아닙니다. 아래에서 테스트에 사용한 PC와 설정을 확인할 수 있어요.</p>}
    {measurements.map((measurement) => {
      const source = measurement.sourceConditions;
      const sourceUrl = safeHttpsUrl(source.sourceUrl);
      return <article className="gaming-target-measurement" key={measurement.referenceId}>
        <div className="gaming-target-measurement-heading"><strong>{gameLabelFor(measurement.gameId)}</strong><span>{measurement.match === "exact" ? "같은 환경의 테스트" : "다른 PC의 테스트"}</span></div>
        <div className="gaming-target-fps-values"><div><span>출처의 평균 FPS</span><strong>{fpsLabel(measurement.sourceAverageFps)}</strong></div>{measurement.sourceOnePercentLowFps !== undefined && <div><span>출처의 1% low</span><strong>{fpsLabel(measurement.sourceOnePercentLowFps)}</strong></div>}</div>
        <details className="gaming-target-source-conditions"><summary>테스트 환경과 출처 보기</summary>
        {measurement.sourceOnePercentLowFps !== undefined && <p>1% low는 프레임이 낮았던 하위 1% 구간의 평균입니다.</p>}
        <dl>
          <div><dt>CPU</dt><dd>{source.cpuModel}</dd></div>
          <div><dt>GPU</dt><dd>{source.gpuName ?? source.gpuModel} · {source.gpuVramGb}GB</dd></div>
          <div><dt>RAM</dt><dd>{source.memoryType} · {source.memorySpeedMhz}MHz{source.memoryCapacityGb !== undefined ? ` · ${source.memoryCapacityGb}GB` : ""}{source.memoryModuleCount !== undefined ? ` · ${source.memoryModuleCount}개` : ""}{source.memoryTiming ? ` · ${source.memoryTiming}` : ""}</dd></div>
          <div><dt>게임 설정</dt><dd>{GAMING_RESOLUTION_LABELS[source.resolution]} · {source.sourcePreset || GAMING_GRAPHICS_PRESET_LABELS[source.graphicsPreset]} · RT {source.rayTracing ? "켜짐" : "꺼짐"} · {source.upscaler !== "none" ? `${source.upscaler.toUpperCase()} · ` : ""}{GAMING_UPSCALING_LABELS[source.upscaling]} · 프레임 생성 {source.frameGeneration ? "켜짐" : "꺼짐"}</dd></div>
          {source.driverVersion && <div><dt>드라이버</dt><dd>{source.driverVersion}</dd></div>}
          {source.operatingSystem && <div><dt>운영체제</dt><dd>{source.operatingSystem}</dd></div>}
          {source.gameVersion && <div><dt>게임 버전</dt><dd>{source.gameVersion}</dd></div>}
          {source.scene && <div><dt>측정 장면</dt><dd>{source.scene}</dd></div>}
          <div><dt>자료 날짜</dt><dd>{source.publishedAt.slice(0, 10)}</dd></div>
        </dl>{measurement.differences.length > 0 && <div className="gaming-target-condition-differences"><strong>이 견적과 다른 부분</strong><ul>{measurement.differences.map((difference, index) => <li key={`${index}-${difference}`}>{difference}</li>)}</ul></div>}<p>{source.sourceNote}</p>{sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer">{source.sourceTitle}</a>}</details>
      </article>;
    })}
    {missingGames.length > 0 && <div className="gaming-target-missing-games"><strong>FPS 자료가 없는 게임</strong><p>{missingGames.map(gameLabelFor).join(", ") || "선택한 게임"}</p><small>테스트 자료가 없는 게임은 FPS를 예측하지 않아요.</small></div>}
    {onEditConditions && <button type="button" className="gaming-target-edit-conditions" onClick={onEditConditions}>게임 조건 다시 고르기</button>}
  </section>;
}
