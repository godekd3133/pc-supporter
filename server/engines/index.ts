// 서버 엔진 레지스트리 — 대규모 서비스 기준으로 수집·견적·검사 계산을 각각
// 독립 엔진으로 다룬다. 운영 표면(/api/admin/engines)은 여기서 세 엔진의
// 상태를 한 번에 묶어 돌려준다.
export * as crawlerEngine from "./crawler-engine";
export * as quotationEngine from "./quotation-engine";
export * as compatibilityEngine from "./compatibility-engine";

import { crawlerEngineStatus } from "./crawler-engine";
import { quotationEngineStatus } from "./quotation-engine";
import { compatibilityEngineStatus } from "./compatibility-engine";

export const ENGINE_MODULE_IDS = ["crawler", "quotation", "compatibility"] as const;
export type EngineModuleId = (typeof ENGINE_MODULE_IDS)[number];

export async function engineModulesStatus() {
  const [crawler, quotation] = await Promise.all([crawlerEngineStatus(), quotationEngineStatus()]);
  return { crawler, quotation, compatibility: compatibilityEngineStatus() };
}
