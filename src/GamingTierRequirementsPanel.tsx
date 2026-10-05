import type { BuildGenerationResult, PartCategory } from "../shared/types";
import { CATEGORY_LABELS } from "../shared/types";
import type { GamingAppropriateStatus, GamingMinimumStatus, GamingSupportRequirements } from "../shared/gaming-part-tiers";
import "./gaming-tier-requirements.css";

const CATEGORIES = ["cpu", "gpu", "motherboard", "memory", "cooler", "psu", "case"] as const;
const COOLERS = ["CPU에 포함된 기본 쿨러", "싱글 타워", "듀얼 타워", "3열 수랭"];

function boardLabel(tier: number | undefined, socket: string | undefined): string {
  if (tier === undefined || !socket) return "CPU 사양 확인 필요";
  if (socket === "AM4") return tier === 0 ? "A520M-HVS" : "TUF B550M-PLUS";
  return tier === 2 ? "X870E 토마호크" : "B850M GAMING X";
}

function requirementLabels(category: PartCategory, requirements: GamingSupportRequirements): { minimum: string; appropriate: string; detail: string } {
  if (category === "cpu") return { minimum: "보드·RAM·쿨러와 맞는 모델", appropriate: "GPU와 성능·가격 함께 비교", detail: "게임에서는 코어 수뿐 아니라 싱글코어 성능과 캐시도 중요해요. CPU를 바꾸면 소켓·RAM 규격·전원·쿨러를 다시 맞춥니다." };
  if (category === "gpu") return { minimum: "파워·케이스에 맞는 모델", appropriate: "예산 안에서 성능 우선", detail: "GPU 모델과 VRAM 용량을 함께 비교해요. 같은 GPU라도 VRAM 용량이 다르면 성능 차이가 날 수 있어요." };
  if (category === "motherboard") return { minimum: boardLabel(requirements.motherboard.minimumTier, requirements.motherboard.socket), appropriate: boardLabel(requirements.motherboard.appropriateTier, requirements.motherboard.socket), detail: `${requirements.motherboard.socket ?? "소켓 확인 필요"}${requirements.motherboard.tdpW !== undefined ? ` · CPU 기본 TDP ${requirements.motherboard.tdpW}W` : " · TDP 확인 필요"}. CPU 지원 목록과 전원부 사양을 기준으로 골라요. 구매한 보드의 BIOS 버전도 확인하세요.` };
  if (category === "memory") return { minimum: `${requirements.memory.minimumCapacityGb}GB`, appropriate: `${requirements.memory.appropriateCapacityGb}GB`, detail: `${requirements.memory.memoryType ?? "RAM 규격 확인 필요"}. 그래픽카드를 유지하고 예산이 남으면 권장 용량까지 늘려요. RAM − / +로 총용량을 바꿀 수 있습니다. DDR5-8000은 오버클럭 안정성도 확인하세요.` };
  if (category === "cooler") return { minimum: requirements.cooler.minimumTier === undefined ? "CPU 발열 확인 필요" : COOLERS[requirements.cooler.minimumTier], appropriate: requirements.cooler.appropriateTier === undefined ? "CPU 발열 확인 필요" : COOLERS[requirements.cooler.appropriateTier], detail: requirements.cooler.stockAllowed ? "CPU에 기본 쿨러가 포함돼 있어요. 다른 쿨러를 고르면 케이스 높이와 장착 공간도 확인합니다." : "CPU 발열에 맞는 쿨러가 필요해요. 공랭은 높이, 수랭은 라디에이터 위치와 RAM·보드 간섭도 확인합니다." };
  if (category === "psu") return { minimum: requirements.psu.minimumWattageW === undefined ? "CPU·GPU 전력 확인 필요" : `${Math.ceil(requirements.psu.minimumWattageW / 50) * 50}W 이상`, appropriate: "필요 용량과 커넥터 충족", detail: "GPU 제조사 권장 용량과 CPU·GPU 소비전력을 함께 확인해요. 용량뿐 아니라 전원 커넥터 수·독립 케이블·장착 길이도 맞아야 합니다." };
  const dimensions = [requirements.case.minimumGpuLengthMm === undefined ? undefined : `GPU ${requirements.case.minimumGpuLengthMm}mm`, requirements.case.minimumCoolerHeightMm === undefined ? undefined : `쿨러 ${requirements.case.minimumCoolerHeightMm}mm`, requirements.case.radiatorSizeMm === undefined ? undefined : `라디에이터 ${requirements.case.radiatorSizeMm}mm`].filter(Boolean).join(" · ");
  return { minimum: `${requirements.case.motherboardFormFactor ?? "보드 크기 확인 필요"} 장착`, appropriate: dimensions || "선택 부품이 들어가는 크기", detail: "보드와 쿨러, 그래픽카드가 들어가는 케이스가 필요해요. GPU 두께·전원 케이블 공간·라디에이터 위치도 확인하세요." };
}

const MINIMUM_LABELS: Record<GamingMinimumStatus, string> = { met: "필요 사양 충족", unmet: "사양 부족", unknown: "사양 확인 필요" };
const APPROPRIATE_LABELS: Record<GamingAppropriateStatus, string> = { met: "권장 사양", below: "권장보다 낮음", excessive: "여유 있는 사양", unknown: "사양 확인 필요" };

export function GamingTierRequirementsPanel({ draft }: { draft: BuildGenerationResult }) {
  const requirements = draft.gamingSupportRequirements;
  const assessments = draft.partTierSuitability;
  if (!requirements || !assessments) return null;
  return <details className="gaming-tier-panel" data-testid="gaming-tier-requirements">
    <summary><span>부품 선택 기준</span><small>필요 사양과 권장 사양</small></summary>
    <div className="gaming-tier-content">
      <p className="gaming-tier-intro">이 CPU와 그래픽카드에 맞는 보드·RAM·파워·쿨러·케이스 사양입니다.</p>
      <div className="gaming-tier-column-head" aria-hidden="true"><span>부품</span><span>필요 사양</span><span>권장 사양</span></div>
      <div className="gaming-tier-rows">
        {CATEGORIES.map((category) => {
          const assessment = assessments[category];
          const includedCooler = category === "cooler" && !draft.selection.cooler && requirements.cooler.stockAllowed;
          if (!assessment && !includedCooler) return null;
          const labels = requirementLabels(category, requirements);
          const hasIssue = assessment?.minimum === "unmet" || assessment?.minimum === "unknown";
          const label = includedCooler ? "CPU에 포함된 기본 쿨러" : assessment!.tier.label;
          const status = includedCooler ? "기본 쿨러 포함" : hasIssue ? MINIMUM_LABELS[assessment!.minimum] : APPROPRIATE_LABELS[assessment!.appropriate];
          const statusKind = includedCooler ? "met" : hasIssue ? assessment!.minimum : assessment!.appropriate;
          const checks = assessment?.checks.filter((check) => check.status !== "met") ?? [];
          return <div className="gaming-tier-row" key={category} data-testid={`gaming-tier-${category}`}>
            <div className="gaming-tier-part"><strong>{CATEGORY_LABELS[category]}</strong><span>{label}</span><small className={`gaming-tier-status gaming-tier-status-${statusKind}`}>{status}</small></div>
            <div className="gaming-tier-minimum"><span className="gaming-tier-mobile-label">필요 사양</span><strong>{labels.minimum}</strong></div>
            <div className="gaming-tier-appropriate"><span className="gaming-tier-mobile-label">권장 사양</span><strong>{labels.appropriate}</strong></div>
            <p className="gaming-tier-detail">{labels.detail}</p>
            {checks.length > 0 && <ul className="gaming-tier-checks">{checks.map((check) => <li key={check.code}>{check.detail}</li>)}</ul>}
          </div>;
        })}
      </div>
      <p className="gaming-tier-footnote">소켓·전원·장착 여부는 호환성 검사 결과도 확인하세요.</p>
    </div>
  </details>;
}
