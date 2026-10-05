import type { GamingGraphicsPreset, GamingMode, GamingRefreshRate, GamingResolution, GamingUpscaling, GpuVendorPreference } from "../shared/types";
import { GAMING_GRAPHICS_PRESET_LABELS, GAMING_RESOLUTION_LABELS, GAMING_UPSCALING_LABELS } from "../shared/types";
import { ONBOARDING_GAMES, CURRENT_FPS_REFERENCE_GUIDANCE, gameLabelFor } from "./quote-onboarding";
import { GpuVendorToggle } from "./GpuVendorToggle";

export interface GeneratorGamingTargetControlsProps {
  mode: GamingMode;
  onMode: (mode: GamingMode) => void;
  vendor: GpuVendorPreference;
  onVendor: (vendor: GpuVendorPreference) => void;
  gameIds: string[];
  onGames: (ids: string[]) => void;
  resolution: GamingResolution;
  onResolution: (resolution: GamingResolution) => void;
  refreshRate: GamingRefreshRate;
  onRefreshRate: (rate: GamingRefreshRate) => void;
  targetFps: string;
  onTargetFps: (fps: string) => void;
  graphicsPreset: GamingGraphicsPreset;
  onGraphicsPreset: (preset: GamingGraphicsPreset) => void;
  rayTracing: boolean;
  onRayTracing: (enabled: boolean) => void;
  upscaling: GamingUpscaling;
  onUpscaling: (mode: GamingUpscaling) => void;
  disabled: boolean;
}

export function GeneratorGamingTargetControls(props: GeneratorGamingTargetControlsProps) {
  return <section className="generator-game-target-controls" aria-label="게임 견적 조건" data-testid="generator-game-target-controls">
    <label><span>게임 견적 기준</span><select data-testid="generator-gaming-mode" value={props.mode} disabled={props.disabled} onChange={(event) => props.onMode(event.target.value as GamingMode)}><option value="budget">예산 안에서 GPU 성능 우선</option><option value="target_fps">게임과 목표 FPS에 맞추기</option></select></label>
    <GpuVendorToggle value={props.vendor} onChange={props.onVendor} disabled={props.disabled} />
    {props.mode === "target_fps" && <>
      <p className="generator-game-target-selection">{CURRENT_FPS_REFERENCE_GUIDANCE}</p>
      {(props.gameIds.length > 5 || new Set(props.gameIds).size !== props.gameIds.length) && <div className="generator-game-target-selection" role="alert">게임은 중복 없이 최대 5개까지 선택할 수 있어요. 선택을 지운 뒤 다시 골라주세요.<button className="text-button" type="button" disabled={props.disabled} onClick={() => props.onGames([])}>게임 선택 비우기</button></div>}
      {props.gameIds.some((id) => !ONBOARDING_GAMES.some((game) => game.id === id)) && <div className="generator-game-target-selection" role="alert">찾을 수 없는 게임이 있어요. 아래에서 지우고 다시 선택해 주세요.{props.gameIds.filter((id) => !ONBOARDING_GAMES.some((game) => game.id === id)).slice(0, 5).map((id) => <button type="button" className="text-button" key={id} disabled={props.disabled} onClick={() => props.onGames(props.gameIds.filter((gameId) => gameId !== id))}>{gameLabelFor(id)} 삭제</button>)}</div>}
      <fieldset><legend>주로 할 게임 · 최대 5개</legend><div className="generator-game-target-list">{ONBOARDING_GAMES.map((game) => <label key={game.id}><input type="checkbox" checked={props.gameIds.includes(game.id)} disabled={props.disabled || !props.gameIds.includes(game.id) && props.gameIds.length >= 5} onChange={() => props.onGames(props.gameIds.includes(game.id) ? props.gameIds.filter((id) => id !== game.id) : [...props.gameIds, game.id])} /><span>{game.label}</span></label>)}</div><small className="generator-game-target-selection">{props.gameIds.length}개 선택 · 선택한 모든 게임에서 목표 FPS를 비교해요.</small></fieldset>
      <div className="generator-game-target-setting-grid">
        <label><span>해상도</span><select value={props.resolution} disabled={props.disabled} onChange={(event) => props.onResolution(event.target.value as GamingResolution)}>{Object.entries(GAMING_RESOLUTION_LABELS).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label>
        <label><span>목표 FPS</span><input data-testid="generator-target-fps" type="number" inputMode="numeric" min={30} max={500} step={1} value={props.targetFps} disabled={props.disabled} onChange={(event) => props.onTargetFps(event.target.value)} /></label>
        <label><span>그래픽 품질</span><select value={props.graphicsPreset} disabled={props.disabled} onChange={(event) => props.onGraphicsPreset(event.target.value as GamingGraphicsPreset)}>{Object.entries(GAMING_GRAPHICS_PRESET_LABELS).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label>
        <label><span>업스케일링</span><select value={props.upscaling} disabled={props.disabled} onChange={(event) => props.onUpscaling(event.target.value as GamingUpscaling)}>{Object.entries(GAMING_UPSCALING_LABELS).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label>
      </div>
      <label className="generator-checkbox"><input type="checkbox" checked={props.rayTracing} disabled={props.disabled} onChange={(event) => props.onRayTracing(event.target.checked)} /><span><strong>레이 트레이싱</strong><small>지원하는 게임의 조명·반사 효과를 켜요.</small></span></label>
      <label><span>모니터 주사율</span><select value={props.refreshRate} disabled={props.disabled} onChange={(event) => props.onRefreshRate(Number(event.target.value) as GamingRefreshRate)}>{[60, 144, 240].map((rate) => <option value={rate} key={rate}>{rate}Hz</option>)}</select></label>
      <small className="generator-game-target-selection">목표 FPS는 게임에서 원하는 프레임 수예요. 모니터 주사율과 따로 설정할 수 있습니다.</small>
    </>}
  </section>;
}
