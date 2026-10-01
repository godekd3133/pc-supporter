// 견적 생성 엔진 모듈 — 자동 견적 생성(variants·budget ladder·floor 계산)의
// 운영 옵션과 인메모리 캐시를 소유한다. 도메인 계산 자체는
// shared/domain/engine.ts가 담당하고, 이 모듈은 관리자가 조정 가능한
// 생성 파라미터를 영속화해 엔진 호출에 주입한다.
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { RECOMMENDATION_PRIORITY_VALUES, RECOMMENDATION_VARIANT_PRIORITIES } from "../../shared/types";
import type { BuildGenerationRequest, Part, RecommendationPriority } from "../../shared/types";
import { minimumFeasibleBuildPriceFor, ENGINE_VERSION } from "../engine";
import { configureQuoteGenerationGate } from "../listing";
import { loadEngineTargetFiltersConfig } from "../engine-target-filters";
import { engineTargetFilterActiveFacetCount } from "../../shared/engine-target-filters";
import { recentGenerationFailures } from "../generation-failure-log";
import { DATA_DIR, fileUpdatedAt, withSerializedFileMutation, writeJson } from "../storage";
import { publishInstanceEvent } from "../instance-events";
import { pushRuntimeConfigToDatabase } from "../runtime-config-store";

// ---------- 견적 생성 옵션(관리자 조정 가능) ----------

export type EngineGenerationOptions = {
  // 자동 구성 비교(/)variants)가 순서대로 시도하는 우선순위 세트.
  variantPriorities: RecommendationPriority[];
  // 예산 사다리의 아래/위 밴드 배율 — shared/budget-ladder.ts의
  // 기본 0.8/1.2 대신 관리자 설정을 따른다.
  budgetLadderDownMultiplier: number;
  budgetLadderUpMultiplier: number;
  // CPU·GPU 견적 세대 게이트의 허용 깊이 — 1=최신 세대만(기본), 2=최신 2세대
  // 까지 허용, 0=세대 게이트 비활성. 신세대가 수집되면 경계가 자동으로 밀려나고
  // 깊이만큼 이전 세대가 허용된다.
  generationDepth: number;
};

export const ENGINE_GENERATION_OPTION_DEFAULTS: EngineGenerationOptions = {
  variantPriorities: [...RECOMMENDATION_VARIANT_PRIORITIES],
  budgetLadderDownMultiplier: 0.8,
  budgetLadderUpMultiplier: 1.2,
  generationDepth: 1
};

const VARIANT_PRIORITIES_MIN = 1;
const VARIANT_PRIORITIES_MAX = RECOMMENDATION_PRIORITY_VALUES.length;
const LADDER_MULTIPLIER_MIN = 0.5;
const LADDER_MULTIPLIER_MAX = 2;
const GENERATION_DEPTH_MIN = 0;
const GENERATION_DEPTH_MAX = 10;

// shared/listing의 견적 세대 게이트에 관리자 옵션을 반영한다 — 프로세스 전역이라
// 로드/수신 경로마다 호출해 최신 파일 상태와 맞춘다.
function applyQuoteGenerationGateOptions(options: EngineGenerationOptions) {
  configureQuoteGenerationGate({
    enabled: options.generationDepth !== 0,
    depth: Math.max(1, options.generationDepth)
  });
}

export function normalizeEngineGenerationOptions(raw: unknown): { options: EngineGenerationOptions; errors: string[] } {
  const errors: string[] = [];
  const options: EngineGenerationOptions = { ...ENGINE_GENERATION_OPTION_DEFAULTS, variantPriorities: [...RECOMMENDATION_VARIANT_PRIORITIES] };
  if (raw === undefined || raw === null) return { options, errors };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    errors.push("견적 생성 옵션은 객체여야 합니다.");
    return { options, errors };
  }
  const value = raw as Record<string, unknown>;

  if (value.variantPriorities !== undefined) {
    if (!Array.isArray(value.variantPriorities)) {
      errors.push("variantPriorities는 우선순위 목록이어야 합니다.");
    } else {
      const seen = new Set<RecommendationPriority>();
      const priorities: RecommendationPriority[] = [];
      for (const entry of value.variantPriorities) {
        if (!RECOMMENDATION_PRIORITY_VALUES.includes(entry as RecommendationPriority)) {
          errors.push(`알 수 없는 우선순위입니다: ${String(entry)}`);
          continue;
        }
        const priority = entry as RecommendationPriority;
        if (seen.has(priority)) continue;
        seen.add(priority);
        priorities.push(priority);
      }
      if (priorities.length < VARIANT_PRIORITIES_MIN || priorities.length > VARIANT_PRIORITIES_MAX) {
        errors.push(`variantPriorities는 ${VARIANT_PRIORITIES_MIN}~${VARIANT_PRIORITIES_MAX}개여야 합니다.`);
      } else if (errors.length === 0) {
        options.variantPriorities = priorities;
      }
    }
  }

  const readMultiplier = (key: "budgetLadderDownMultiplier" | "budgetLadderUpMultiplier", fallback: number) => {
    if (value[key] === undefined) return fallback;
    const parsed = Number(value[key]);
    if (!Number.isFinite(parsed) || parsed < LADDER_MULTIPLIER_MIN || parsed > LADDER_MULTIPLIER_MAX) {
      errors.push(`${key}는 ${LADDER_MULTIPLIER_MIN}~${LADDER_MULTIPLIER_MAX} 사이의 숫자여야 합니다.`);
      return fallback;
    }
    return parsed;
  };
  options.budgetLadderDownMultiplier = readMultiplier("budgetLadderDownMultiplier", ENGINE_GENERATION_OPTION_DEFAULTS.budgetLadderDownMultiplier);
  options.budgetLadderUpMultiplier = readMultiplier("budgetLadderUpMultiplier", ENGINE_GENERATION_OPTION_DEFAULTS.budgetLadderUpMultiplier);
  if (options.budgetLadderDownMultiplier >= 1) errors.push("절약형 배율은 1보다 작아야 합니다.");
  if (options.budgetLadderUpMultiplier <= 1) errors.push("여유형 배율은 1보다 커야 합니다.");
  if (value.generationDepth !== undefined) {
    const parsed = Number(value.generationDepth);
    if (!Number.isInteger(parsed) || parsed < GENERATION_DEPTH_MIN || parsed > GENERATION_DEPTH_MAX) {
      errors.push(`generationDepth는 ${GENERATION_DEPTH_MIN}~${GENERATION_DEPTH_MAX} 사이의 정수여야 합니다.`);
    } else {
      options.generationDepth = parsed;
    }
  }
  applyQuoteGenerationGateOptions(options);
  return { options, errors };
}

// ---------- 영속화 (data/engine-generation-options.json) ----------

type EngineGenerationOptionsCache = { path: string; mtimeMs: number; options: EngineGenerationOptions } | undefined;
let optionsCache: EngineGenerationOptionsCache;

export function engineGenerationOptionsPath() {
  return process.env.ENGINE_GENERATION_OPTIONS_PATH?.trim() || resolve(DATA_DIR, "engine-generation-options.json");
}

export function loadEngineGenerationOptions(): EngineGenerationOptions {
  const path = engineGenerationOptionsPath();
  const defaults = (): EngineGenerationOptions => ({ ...ENGINE_GENERATION_OPTION_DEFAULTS, variantPriorities: [...RECOMMENDATION_VARIANT_PRIORITIES] });
  if (!existsSync(path)) {
    const options = defaults();
    applyQuoteGenerationGateOptions(options);
    return options;
  }
  try {
    const mtimeMs = statSync(path).mtimeMs;
    if (optionsCache?.path === path && optionsCache.mtimeMs === mtimeMs) return optionsCache.options;
    const { options } = normalizeEngineGenerationOptions(JSON.parse(readFileSync(path, "utf8")));
    optionsCache = { path, mtimeMs, options };
    return options;
  } catch {
    const options = defaults();
    applyQuoteGenerationGateOptions(options);
    return options;
  }
}

export function invalidateEngineGenerationOptionsCache() {
  optionsCache = undefined;
}

async function persistEngineGenerationOptions(options: EngineGenerationOptions) {
  const path = engineGenerationOptionsPath();
  await withSerializedFileMutation(path, async () => {
    await writeJson(path, options);
    invalidateEngineGenerationOptionsCache();
  });
}

export async function saveEngineGenerationOptions(options: EngineGenerationOptions) {
  const path = engineGenerationOptionsPath();
  await persistEngineGenerationOptions(options);
  // 공유 원본(runtime_configs)에 올리고 다른 인스턴스에 무효화만 알린다 —
  // 수신자는 DB에서 읽어 로컬 파일 복제본을 갱신한다.
  await pushRuntimeConfigToDatabase("engine-generation-options", options);
  void publishInstanceEvent("config:file", { name: "engine-generation-options" });
  return { options: loadEngineGenerationOptions(), updatedAt: await fileUpdatedAt(path) };
}

// 다른 인스턴스가 버스로 복제해온 설정 — 로컬 파일에만 기록하고 재발행하지
// 않는다(재발행하면 모든 노드에서 순환한다).
export async function applyReceivedEngineGenerationOptions(options: EngineGenerationOptions) {
  applyQuoteGenerationGateOptions(options);
  await persistEngineGenerationOptions(options);
}

export function engineGenerationVariantPrioritiesFor(): RecommendationPriority[] {
  const options = loadEngineGenerationOptions();
  return options.variantPriorities.length > 0 ? options.variantPriorities : [...RECOMMENDATION_VARIANT_PRIORITIES];
}

export function engineGenerationLadderMultipliersFor() {
  const options = loadEngineGenerationOptions();
  return { down: options.budgetLadderDownMultiplier, up: options.budgetLadderUpMultiplier };
}

// ---------- floor 계산 캐시 ----------

// floor 계산은 풀 전수 탐색이라 작은 서버에서 수 초가 걸린다. 같은 요청이
// 반복되면(온보딩 버튼, 복구 제안 확인) 캐시로 응답한다 — 키는 카탈로그 배열
// 참조라 재로드 시 자동 무효화된다. 엔진 타겟 필터도 풀을 바꾸므로 키에 포함한다.
const generationFloorCache = new WeakMap<Part[], Map<string, number | null>>();

export function quotationEngineFloorFor(catalog: Part[], request: BuildGenerationRequest) {
  const targetFilters = loadEngineTargetFiltersConfig();
  const key = JSON.stringify(request) + "|" + JSON.stringify(targetFilters);
  let byRequest = generationFloorCache.get(catalog);
  if (!byRequest) {
    byRequest = new Map();
    generationFloorCache.set(catalog, byRequest);
  }
  if (byRequest.has(key)) return byRequest.get(key) ?? null;
  const value = minimumFeasibleBuildPriceFor(catalog, request, { targetFilters }) ?? null;
  if (byRequest.size >= 300) byRequest.clear();
  byRequest.set(key, value);
  return value;
}

// ---------- 운영 상태 ----------

export async function quotationEngineStatus() {
  const options = loadEngineGenerationOptions();
  const filters = loadEngineTargetFiltersConfig();
  const activeFacets = Object.values(filters.categories).reduce((sum, rule) => sum + engineTargetFilterActiveFacetCount(rule), 0);
  const failures = recentGenerationFailures(50);
  return {
    id: "quotation" as const,
    label: "견적 생성 엔진",
    engineVersion: ENGINE_VERSION,
    options,
    targetFilters: {
      enabled: filters.enabled,
      activeFacets
    },
    floorCache: {
      maxEntriesPerCatalog: 300
    },
    recentFailures: failures.length,
    lastFailureAt: failures[0]?.at ?? null
  };
}
