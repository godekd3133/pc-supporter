// 운영 설정의 DB 기록 경로(쓰기 쪽) — config 모듈들이 저장 시 호출한다.
// 파일은 이미 로컬 복제본으로 기록됐고, 여기서는 공유 원본(DB)에 올린다.
// DB가 잠시 안 되면 로컬 파일만으로도 동작하도록 실패를 경고로 삼킨다.
import { writeRuntimeConfigRecord } from "./repository";
import { INSTANCE_ID } from "./instance-events";

export async function pushRuntimeConfigToDatabase(name: string, payload: unknown) {
  try {
    await writeRuntimeConfigRecord(name, payload, INSTANCE_ID);
  } catch (error) {
    console.warn(`[runtime-config] ${name} DB 기록 실패 — 로컬 파일만 유지됩니다: ${error instanceof Error ? error.message : String(error)}`);
  }
}
