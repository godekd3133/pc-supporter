// 운영 설정의 DB→로컬 파일 동기화 계층(읽기 쪽).
//
// 다중 인스턴스에서 파일 설정(견적 옵션·타겟 필터·파일 오버라이드)이 노드마다
// 따로 노는 문제를 푼다. DB(runtime_configs)가 원본이고 각 노드의 로컬 파일은
// 기존 읽기 경로를 깨지 않게 하는 복제본이다.
//
// 쓰기 경로: 파일 기록 → pushRuntimeConfigToDatabase → config:file 이벤트(이름만).
// 수신 경로: DB에서 행을 읽어 로컬 파일에 기록 → 모듈 캐시 무효화.
// 시작 경로: 등록된 모든 키를 DB에서 내려 로컬 파일을 덮는다 — 신규 노드가
// 기존 노드의 설정을 상속한다.
import { CASE_RGB_LOAD_OVERRIDES_PATH, GPU_PHYSICAL_OVERRIDES_PATH, withSerializedFileMutation, writeJson } from "./storage";
import { listRuntimeConfigRecords, readRuntimeConfigRecord } from "./repository";
import { applyReceivedEngineGenerationOptions, invalidateEngineGenerationOptionsCache, normalizeEngineGenerationOptions } from "./engines/quotation-engine";
import { applyReceivedEngineTargetFiltersConfig, invalidateEngineTargetFiltersCache } from "./engine-target-filters";
import { engineTargetFilterConfigFromUnknown } from "../shared/engine-target-filters";
import { invalidateCatalogCache } from "./catalog";

type RuntimeConfigSink = {
  // DB 페이로드를 로컬 복제본(파일)에 기록한다 — 재발행 없이 저장만.
  persist: (payload: unknown) => Promise<void>;
  // 로컬 인메모리 캐시를 비운다 — 다음 읽기가 복제본/DB를 다시 본다.
  invalidateLocal: () => void;
};

function recordPayload(payload: unknown) {
  return typeof payload === "object" && payload !== null && !Array.isArray(payload) ? payload : {};
}

const RUNTIME_CONFIG_SINKS: Record<string, RuntimeConfigSink> = {
  "engine-generation-options": {
    persist: async (payload) => {
      await applyReceivedEngineGenerationOptions(normalizeEngineGenerationOptions(payload).options);
    },
    invalidateLocal: () => invalidateEngineGenerationOptionsCache()
  },
  "engine-target-filters": {
    persist: async (payload) => {
      await applyReceivedEngineTargetFiltersConfig(engineTargetFilterConfigFromUnknown(payload).config);
    },
    invalidateLocal: () => invalidateEngineTargetFiltersCache()
  },
  "gpu-physical-overrides": {
    persist: async (payload) => {
      await withSerializedFileMutation(GPU_PHYSICAL_OVERRIDES_PATH, () => writeJson(GPU_PHYSICAL_OVERRIDES_PATH, recordPayload(payload)));
    },
    invalidateLocal: () => invalidateCatalogCache()
  },
  "case-rgb-load-overrides": {
    persist: async (payload) => {
      await withSerializedFileMutation(CASE_RGB_LOAD_OVERRIDES_PATH, () => writeJson(CASE_RGB_LOAD_OVERRIDES_PATH, recordPayload(payload)));
    },
    invalidateLocal: () => invalidateCatalogCache()
  }
};

export function runtimeConfigSyncKeys() {
  return Object.keys(RUNTIME_CONFIG_SINKS);
}

// 다른 인스턴스의 config:file 이벤트 수신 — DB 행을 로컬 파일에 복제한다.
export async function syncRuntimeConfigFromDatabase(name: string) {
  const sink = RUNTIME_CONFIG_SINKS[name];
  if (!sink) return;
  try {
    const record = await readRuntimeConfigRecord(name);
    if (!record) {
      // 원본 행이 없으면(발행자가 DB 쓰기에 실패했거나 신규 키) 로컬 캐시만 비운다.
      sink.invalidateLocal();
      return;
    }
    await sink.persist(record.payload);
    sink.invalidateLocal();
  } catch (error) {
    console.warn(`[runtime-config] ${name} DB 동기화 실패: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// 시작 시 등록된 모든 설정을 DB에서 내려 로컬 파일에 동기화한다.
// DB가 없는 개발 환경에서는 조용히 건너뛴다.
export async function syncAllRuntimeConfigsFromDatabase() {
  if (!process.env.DATABASE_URL?.trim()) return;
  try {
    const records = await listRuntimeConfigRecords();
    const byKey = new Map(records.map((record) => [record.key, record]));
    for (const [name, sink] of Object.entries(RUNTIME_CONFIG_SINKS)) {
      const record = byKey.get(name);
      if (!record) continue;
      try {
        await sink.persist(record.payload);
      } catch (error) {
        console.warn(`[runtime-config] ${name} 시작 동기화 실패: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    console.warn(`[runtime-config] 시작 동기화를 건너뜁니다: ${error instanceof Error ? error.message : String(error)}`);
  }
}
