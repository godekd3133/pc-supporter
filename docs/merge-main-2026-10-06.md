# main 병합 충돌 해결 — 2026-10-06

`feature/compatibility`(`0795d73`)에 `origin/main`(`6afefd9`, 커밋 50개)을 병합하면서 충돌을 해결한 기록입니다.

## 배경

main의 mkKim 커밋 `8fecd66`과 `5161163`이 이 브랜치와 같은 전원부(VRM) 로직을 다른 방향으로 고쳤습니다. `8fecd66`은 [호환성 문제 목록](compatibility-issues-2026-10-02.md)의 I-1·I-5·I-6을 반영한 커밋입니다.

## 충돌과 해결

| 파일 | 충돌 내용 | 해결 |
| --- | --- | --- |
| `shared/catalog-spec-coverage.ts` | `ssdBays` 라벨, main의 라디에이터·LP 필드 | main 쪽 채택 |
| `shared/types.ts` | `vrmPhaseCount`의 의미가 다름. main은 전체 합계(범위는 최솟값), 브랜치는 Vcore 앞자리 수 | `vrmPhaseCount`는 main 의미로 유지. Vcore 수는 새 필드 `vrmVcorePhaseCount`로 분리. `vrmVcoreOutputA`는 유지 |
| `shared/domain/engine.ts` `cpu-motherboard-power` | main은 용량 미확인이면 warning, 브랜치는 페이즈·Vcore로 추정하고 추정 불가면 unknown | 둘을 결합(아래 표) |
| `shared/domain/engine.ts` `gpu-psu-power` | main은 차단 → unknown 순서로 재구성(누락 필드 상세 표시), 브랜치는 CPU 부하 반영 warning 추가 | main 구조를 유지하고, 브랜치 warning을 마지막 `else if`로 덧붙임 |
| `server/danawa.test.ts` | 양쪽이 같은 위치에 VRM·M.2 파서 테스트를 추가 | 둘 다 유지. 브랜치 테스트는 합계·Vcore 분리 기준으로 수정 |

### `cpu-motherboard-power` 판정 순서 (결합 후)

| 근거 | 판정 |
| --- | --- |
| 확인된 용량 `vrmCapacityW` 있음 | 초과 시 blocker |
| `vrmVcoreOutputA` 또는 `vrmVcorePhaseCount`로 추정 가능 | 비율 1.1 미만은 info, 1.1 이상은 warning |
| 추정 근거 없음, CPU 전력은 있음 | main 정책 그대로 warning("메인보드 전원부 용량이 확인되지 않았습니다.") |
| CPU 전력 없음 | unknown |

전체 페이즈 합계(`vrmPhaseCount`)는 SoC·보조 페이즈까지 포함하므로 추정에 쓰지 않습니다.

## 충돌 표시 없이 생긴 문제와 추가 수정

- **`server/danawa.ts` 이중 대입:** 자동 병합 결과 `vrmPhaseCount` 대입이 두 줄 생겨, main의 합계 값이 브랜치 값을 덮어썼습니다.
  - 브랜치 쪽 대입을 `vrmVcorePhaseCount = parseVrmVcorePhaseCount(text)`로 바꿨습니다.
  - main의 범위·잘못된 값 처리는 `parseVrmPhaseTerms()`로 공유합니다.
  - 재파싱할 때 원문에서 사라진 `vrmVcorePhaseCount`·`vrmVcoreOutputA` 값은 제거합니다.
- **`shared/catalog-change-impact.ts`:** 변경 영향 규칙을 `vrmPhaseCount`에서 `vrmVcorePhaseCount`로 옮겼습니다.
- **라벨 추가:** `catalog-spec-coverage.ts`, `SavedCheckTimeline.tsx`에 "Vcore 페이즈" 라벨을 추가했습니다.
- **`server/engine.test.ts`:**
  - VRM 추정 픽스처를 `vrmVcorePhaseCount`로 바꿨습니다.
  - 전원부 정보가 없는 보드의 기대값을 unknown에서 warning으로 바꿨습니다.
  - 합계 페이즈만 있는 보드는 추정하지 않는다는 테스트를 추가했습니다.
- **`ENGINE_VERSION`:** `2.62.0`으로 올렸습니다. 양쪽 모두 `2.60.0`이었고 운영은 `2.61.0`이므로, 결과 캐시를 무효화하려면 운영보다 높아야 합니다.
- **`package.json`:** main에서 추가된 `compression` 의존성 때문에 `npm install`이 필요합니다.

## 검증

- `npm run typecheck` 통과.
- 단위 테스트: `server/engine.test.ts`, `server/danawa.test.ts`, `server/compatibility-parser-regression.test.ts`, `shared/catalog-change-impact.test.ts`, `shared/catalog-spec-coverage.test.ts` — 5개 파일, 290개 테스트 통과. 전체 테스트 모음은 실행하지 않았습니다.
- 무작위 부품셋 하네스(2026-10-02 스냅샷, `--reparse --targeted`, 엔진 2.62.0):
  - 300건에서 실행 오류, 결과 불변식 위반, 독립 판정 불일치 모두 0건.
  - 지정 조합 58건 모두 일치.
  - `cpu-motherboard-power`는 warning 53, info 6. 1차의 unknown 30건이 main 정책의 warning으로 바뀌었습니다.
- 로컬 테스트 주의: Windows `core.autocrlf=true`이면 `db/schema.sql`이 CRLF로 체크아웃되어 테스트 전역 설정이 스키마 체크섬 오류로 멈춥니다. 작업 파일만 LF로 바꾸면 됩니다(저장소 내용은 같음).

## 남은 일

- 운영 엔진 `2.61.0`이 `origin/main`(`2.60.0`)에 없는 코드에서 배포된 것으로 보입니다. 배포 커밋을 확인해야 합니다.
- I-6 케이스 보강값(`docs/data/case-spec-overrides-2026-10-04.json`)은 운영 DB에 아직 반영되지 않았습니다.
