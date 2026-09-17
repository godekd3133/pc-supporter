import { GAMING_RESOLUTION_VRAM_TARGETS } from "./types";
import type { GamingGraphicsPreset, GamingResolution, GamingUpscaling } from "./types";

export type GamingGameCategory = "competitive" | "rpg" | "aaa" | "sandbox" | "sports" | "strategy" | "domestic" | "survival";

export const GAMING_GAME_CATEGORY_LABELS: Record<GamingGameCategory, string> = {
  competitive: "경쟁·FPS",
  rpg: "RPG·MMORPG",
  aaa: "AAA·오픈월드",
  sandbox: "샌드박스·생존",
  sports: "레이싱·격투·스포츠",
  strategy: "전략·시뮬레이션",
  domestic: "국내 인기",
  survival: "생존·코옵"
};

export const GAMING_GAMES = [
  { id: "valorant", label: "발로란트", demand: 0.7, category: "competitive" },
  { id: "pubg", label: "배틀그라운드", demand: 1.0, category: "competitive" },
  { id: "league", label: "리그 오브 레전드", demand: 0.7, category: "competitive" },
  { id: "overwatch2", label: "오버워치 2", demand: 0.8, category: "competitive" },
  { id: "apex", label: "에이펙스 레전드", demand: 0.9, category: "competitive" },
  { id: "cs2", label: "카운터 스트라이크 2", demand: 0.7, category: "competitive" },
  { id: "fortnite", label: "포트나이트", demand: 0.9, category: "competitive" },
  { id: "warzone", label: "콜 오브 듀티: 워존", demand: 1.2, category: "competitive" },
  { id: "rainbow6", label: "레인보우 식스 시즈", demand: 0.9, category: "competitive" },
  { id: "dota2", label: "Dota 2", demand: 0.8, category: "competitive" },
  { id: "destiny2", label: "데스티니 2", demand: 1.0, category: "competitive" },
  { id: "thefinals", label: "THE FINALS", demand: 1.0, category: "competitive" },
  { id: "lostark", label: "로스트아크", demand: 0.9, category: "rpg" },
  { id: "blackdesert", label: "검은사막", demand: 1.1, category: "rpg" },
  { id: "diablo4", label: "디아블로 IV", demand: 1.1, category: "rpg" },
  { id: "poe2", label: "패스 오브 엑자일 2", demand: 1.1, category: "rpg" },
  { id: "eldenring", label: "엘든 링", demand: 1.2, category: "rpg" },
  { id: "monsterhunter", label: "몬스터 헌터 와일즈", demand: 1.3, category: "rpg" },
  { id: "bg3", label: "발더스 게이트 3", demand: 1.1, category: "rpg" },
  { id: "ff14", label: "파이널 판타지 XIV", demand: 0.8, category: "rpg" },
  { id: "genshin", label: "원신", demand: 0.8, category: "rpg" },
  { id: "honkaistarrail", label: "붕괴: 스타레일", demand: 0.8, category: "rpg" },
  { id: "zenless", label: "젠레스 존 제로", demand: 0.9, category: "rpg" },
  { id: "dragonsdogma2", label: "드래곤즈 도그마 2", demand: 1.2, category: "rpg" },
  { id: "blackmyth", label: "검은 신화: 오공", demand: 1.3, category: "rpg" },
  { id: "cyberpunk", label: "사이버펑크 2077", demand: 1.3, category: "aaa" },
  { id: "aaa", label: "스팀 고사양 게임", demand: 1.3, category: "aaa" },
  { id: "rdr2", label: "레드 데드 리뎀션 2", demand: 1.3, category: "aaa" },
  { id: "hogwarts", label: "호그와트 레거시", demand: 1.2, category: "aaa" },
  { id: "starfield", label: "스타필드", demand: 1.3, category: "aaa" },
  { id: "alanwake2", label: "앨런 웨이크 2", demand: 1.35, category: "aaa" },
  { id: "lastofus1", label: "더 라스트 오브 어스 파트 I", demand: 1.2, category: "aaa" },
  { id: "residentevil4", label: "바이오하자드 RE:4", demand: 0.9, category: "aaa" },
  { id: "assassinscreedshadows", label: "어쌔신 크리드 섀도우스", demand: 1.25, category: "aaa" },
  { id: "indianajones", label: "인디아나 존스: 그레이트 서클", demand: 1.3, category: "aaa" },
  { id: "avatarfrontiers", label: "아바타: 프론티어 오브 판도라", demand: 1.25, category: "aaa" },
  { id: "minecraft", label: "마인크래프트", demand: 1.0, category: "sandbox" },
  { id: "gta5", label: "GTA V", demand: 1.0, category: "sandbox" },
  { id: "sims4", label: "심즈 4", demand: 0.7, category: "sandbox" },
  { id: "terraria", label: "테라리아", demand: 0.5, category: "sandbox" },
  { id: "satisfactory", label: "Satisfactory", demand: 1.0, category: "sandbox" },
  { id: "palworld", label: "팔월드", demand: 1.0, category: "survival" },
  { id: "helldivers2", label: "헬다이버즈 2", demand: 1.1, category: "survival" },
  { id: "rust", label: "러스트", demand: 1.0, category: "survival" },
  { id: "valheim", label: "발하임", demand: 0.8, category: "survival" },
  { id: "arkAscended", label: "ARK: Survival Ascended", demand: 1.3, category: "survival" },
  { id: "sevenDays", label: "7 Days to Die", demand: 0.9, category: "survival" },
  { id: "deadByDaylight", label: "데드 바이 데이라이트", demand: 0.7, category: "survival" },
  { id: "sonsforest", label: "Sons of the Forest", demand: 1.1, category: "survival" },
  { id: "conanexiles", label: "Conan Exiles", demand: 0.9, category: "survival" },
  { id: "grounded", label: "그라운디드", demand: 0.8, category: "survival" },
  { id: "dontstarve", label: "Don't Starve Together", demand: 0.6, category: "survival" },
  { id: "forza5", label: "포르자 호라이즌 5", demand: 1.0, category: "sports" },
  { id: "f124", label: "F1 24", demand: 0.9, category: "sports" },
  { id: "acc", label: "Assetto Corsa Competizione", demand: 1.1, category: "sports" },
  { id: "streetfighter6", label: "스트리트 파이터 6", demand: 0.8, category: "sports" },
  { id: "tekken8", label: "철권 8", demand: 0.9, category: "sports" },
  { id: "fcOnline", label: "FC 온라인", demand: 0.6, category: "sports" },
  { id: "nba2k", label: "NBA 2K", demand: 0.9, category: "sports" },
  { id: "eafc25", label: "EA SPORTS FC 25", demand: 0.8, category: "sports" },
  { id: "ets2", label: "유로 트럭 시뮬레이터 2", demand: 0.7, category: "sports" },
  { id: "civ7", label: "문명 VII", demand: 1.0, category: "strategy" },
  { id: "aoe4", label: "에이지 오브 엠파이어 IV", demand: 0.8, category: "strategy" },
  { id: "starcraft2", label: "스타크래프트 II", demand: 0.6, category: "strategy" },
  { id: "totalwarwh3", label: "토탈 워: 워해머 III", demand: 1.1, category: "strategy" },
  { id: "cities2", label: "시티즈: 스카이라인 II", demand: 1.0, category: "strategy" },
  { id: "footballManager", label: "풋볼 매니저", demand: 0.6, category: "strategy" },
  { id: "factorio", label: "팩토리오", demand: 0.5, category: "strategy" },
  { id: "rimworld", label: "림월드", demand: 0.5, category: "strategy" },
  { id: "maplestory", label: "메이플스토리", demand: 0.5, category: "domestic" },
  { id: "dungeonfighter", label: "던전앤파이터", demand: 0.5, category: "domestic" },
  { id: "lineage", label: "리니지", demand: 0.8, category: "domestic" },
  { id: "throneandliberty", label: "쓰론 앤 리버티", demand: 1.0, category: "domestic" }
] as const;

export type GamingGameId = typeof GAMING_GAMES[number]["id"];
export type GamingGameOption = typeof GAMING_GAMES[number];

export function gamingGameOptionFor(id: string): GamingGameOption | undefined {
  return GAMING_GAMES.find((game) => game.id === id);
}

export function gamingGameDemandFor(ids: readonly string[]): number {
  return ids.length === 0 ? 1 : Math.max(...ids.map((id) => gamingGameOptionFor(id)?.demand ?? 1));
}

export interface GamingAdvisoryOptions {
  gameIds?: readonly string[];
  graphicsPreset?: GamingGraphicsPreset;
  rayTracing?: boolean;
  upscaling?: GamingUpscaling;
}

export interface GamingAdvisoryTuning {
  demandMultiplier: number;
  targetVramGb: number;
  gpuTargetWeight: number;
}

function roundUpToGb(value: number) {
  return Math.max(1, Math.ceil(value));
}

export function gamingAdvisoryTuningFor(resolution: GamingResolution, options: GamingAdvisoryOptions = {}): GamingAdvisoryTuning {
  const graphicsMultiplier = options.graphicsPreset === "competitive" ? 0.86 : options.graphicsPreset === "high" ? 1.08 : 1;
  const rayTracingMultiplier = options.rayTracing ? 1.15 : 1;
  const upscalingMultiplier = options.upscaling === "native" ? 1.05 : options.upscaling === "balanced" ? 0.96 : 1;
  const demandMultiplier = gamingGameDemandFor(options.gameIds ?? []) * graphicsMultiplier * rayTracingMultiplier * upscalingMultiplier;
  const vramMultiplier = Math.min(1.35, Math.max(0.84, 1 + (demandMultiplier - 1) * 0.55));
  const baseVram = GAMING_RESOLUTION_VRAM_TARGETS[resolution];
  return {
    demandMultiplier,
    targetVramGb: roundUpToGb(baseVram * vramMultiplier),
    gpuTargetWeight: Math.round(5 * (1 + Math.max(0, demandMultiplier - 1) * 1.5))
  };
}
