# PC Supporter 개발 과정과 저장소 분류

## 문서의 범위

이 문서는 2026-09-03 현재의 `pc-supporter` 구현을 공개 저장소에 옮기면서, 기능·의존성·검증 근거를 한눈에 볼 수 있도록 정리한 현재 상태 문서입니다.

원본 폴더에는 Git 이력이 없었으므로, 최초 import 커밋들은 과거의 실제 작업 순서를 재구성한 것이 아닙니다. 커밋은 현재 snapshot을 의존성 단위로 나눈 공개 import 기록이며, 문서의 “단계”도 동일한 기준의 구현 표면 분류입니다. 과거의 날짜·작성자·미기록 결정을 만들어내지 않습니다.

## 제품 목표

PC Supporter는 다음 흐름을 하나의 설명 가능한 웹서비스로 묶습니다.

```text
다나와 목록/상세
      ↓
정규화·품질·신선도 판정
      ↓
견적 입력 → 호환성 규칙 엔진 → finding·판정 사실·관계 맵
      ↓                         ↓
대체 후보·수리 플랜             구매 준비도·실제 조립 기록
      ↓                         ↓
재검사·비교·공유·가격 추적 ←──────┘
```

핵심 원칙은 세 가지입니다.

1. 호환성 판정과 데이터 신뢰도·가격·실제 조립 검증을 한 상태로 뭉개지 않습니다.
2. 자동 추천은 후보·비교·미리보기까지만 제공하고, 차단 위험 후보의 자동 적용이나 완전 호환 확정을 대신하지 않습니다.
3. 저장·공유된 결과는 snapshot과 현재 카탈로그 재검사를 분리하고, owner token·관리자 인증이 필요한 변경 경계를 서버에서 확인합니다.

## 현재 구현 표면 분류

| 영역 | 책임 | 주요 경로 | 공개 import 정책 |
| --- | --- | --- | --- |
| 계약·도메인 | 부품/액세서리 타입, fingerprint, 품질·신선도, 규칙 결과·추천·공유 계약 | `shared/types.ts`, `shared/*` | 추적 |
| 결정적 기본 데이터 | 외부 데이터가 없어도 실행 가능한 핵심·주변 부품 starter catalog | `server/seed-catalog.ts`, `server/seed-catalog-starter.ts`, `server/seed-accessories.ts` | 추적 |
| 카탈로그 수집 | 다나와 목록·상세 수집, 정규화, merge, coverage와 변경 기록 | `server/danawa.ts`, `server/crawler.ts`, `server/accessory-crawler.ts`, `server/catalog.ts`, `server/accessories.ts` | 코드만 추적; 수집 결과 JSON 제외 |
| 호환성 엔진 | 소켓·메모리·저장장치·PCIe·장착·전력·냉각·RGB/팬·물리 근거 및 설명 가능한 finding | `server/engine.ts`, `server/*review*`, `shared/*` | 추적 |
| 카탈로그 품질 운영 | 카테고리별 스펙 완성도·누락 필드·가격 포함률·갱신 상태·카테고리 정합성을 `/api/meta`와 관리자 데이터 센터에서 집계하고, 호환 영향도 기반 보강 큐·PCIe evidence 전용 원문 확인·제조사 근거 수동 overlay·분리 원본 읽기 전용 검수 큐로 연결 | `shared/catalog-category-integrity.ts`, `shared/catalog-category-integrity-review.ts`, `shared/catalog-spec-coverage.ts`, `shared/catalog-spec-review.ts`, `shared/catalog-spec-overrides.ts`, `shared/catalog-work-priority.ts`, `shared/accessory-work-priority.ts`, `shared/pcie-slot.ts`, `server/catalog.ts`, `server/catalog-spec-overrides.ts`, `server/catalog-spec-refresh-history.ts`, `server/index.ts`, `src/AdminView.tsx`, `src/AdminCatalogSpecReviewPanel.tsx`, `src/AdminCatalogSpecOverridePanel.tsx`, `src/CatalogView.tsx` | 추적 |
| 후보·수리·예산 | 안전/확인 필요/차단 후보, 비파괴 가상 적용, 후보 부품 유사도·적용 후 전체 성능 기반 순위, 수리 플랜, 예산 ladder와 value score | `server/alternative-*.ts`, `shared/candidate-*`, `shared/repair-*`, `shared/budget-*` | 추적 |
| 저장·공유·이력 | 파일/PostgreSQL fallback, 저장 견적, 비교·관심 목록, 저장 견적 버전 효율 경계, check history, version migration, 구매 진행률·가격 확인 이력 revision/history, 카탈로그 스펙 보강 실행·근거 점검 이력 | `server/repository.ts`, `server/storage.ts`, `shared/saved-build-comparison.ts`, `server/catalog-spec-refresh-history.ts`, `server/catalog-spec-override-source-check-history.ts`, `server/*share*`, `server/*monitor*` | 코드·스키마 추적; 로컬 JSON 제외 |

서버 모니터 알림은 단순 상태 문구만 저장하지 않고 현재 snapshot의 비정보 finding 중 위험도가 높은 항목을 최대 4개까지 rule id·제목으로 함께 보존한다. 알림함은 이 제목을 표시해 사용자가 저장 견적을 연 뒤 먼저 확인할 대상을 찾을 수 있게 하며, 제목을 누르면 저장 견적 재검사 완료 후 해당 finding 카드의 `id`로 포커스를 이동한다. lazy finding 카드가 늦게 도착하는 경우에도 제한된 재탐색을 사용한다. 기존 alert에 context가 없어도 parser가 이를 optional로 처리하며, 알림 signature에는 context의 rule id도 포함해 동일한 위험 수치라도 실제 finding이 바뀌면 새 변화로 구분한다.
| 실제 조립·센서 근거 | HWiNFO/OCCT CSV, 부하 구간·안정화·추세 overlay, GPU/케이스/PSU 제조사 근거 | `shared/assembly-*`, `shared/gpu-*`, `server/physical-*` | 코드와 문서만 추적; 사용자 기록 제외 |
| API·운영 | Express endpoint, rate limit, ETag, admin auth, 크롤링/검수 endpoint, Docker compose healthcheck | `server/index.ts`, `server/auth.ts`, `server/rate-limit.ts`, `Dockerfile`, `docker-compose.yml` | 추적 |
| 브라우저 UI | 견적 편집, 결과·후보·수리·구매·관리자·공유 화면, lazy chunk 경계 | `src/*`, `index.html`, `vite.config.ts` | 추적 |
| 검증·디자인 | 단위 테스트, 디자인 QA 기록, CI 실행 계약 | `server/*.test.ts`, `shared/*.test.ts`, `src/*.test.ts`, `design-qa.md`, `.github/` | 추적; 화면 캡처·번들 제외 |

## 의존성 순서로 본 개발 단계

### 1. 기반 계약과 seed 실행점

`shared/types.ts`가 서버와 브라우저 사이의 부품, 액세서리, 견적, finding, snapshot, 검증 이력 계약을 정의합니다. `server/seed-catalog.ts`의 기존 대표 ID를 `server/seed-catalog-starter.ts`가 확장하고, `server/seed-accessories.ts`가 10개 주변 부품 범주에 총 42개 기준 후보를 채웁니다. 외부 수집이 실패하거나 데이터 디렉터리가 비어 있어도 핵심·주변 부품의 탐색·호환 화면을 재현할 수 있으며, live/incomplete 수집 데이터가 있는 환경에도 115개 핵심 starter 기준 후보를 먼저 유지한 뒤 수집 데이터를 병합합니다. starter 가격은 실판매가가 아니라 기능 시연용 기준값으로 취급합니다.

이 단계에서 보장하는 것:

- 카테고리·유통 조건·가격 미확인·데이터 품질을 명시적으로 구분
- 저장·공유 결과의 fingerprint로 오래된 검사 결과를 최신 결과처럼 열지 않음
- 테스트가 외부 HTTP나 개인 데이터에 의존하지 않는 도메인 fixture를 사용

### 2. 카탈로그와 데이터 신뢰도

수집기는 목록에서 상품 식별자와 이름을 확보하고, 상세 페이지를 보강한 뒤 단위·소켓·규격을 표준화합니다. 역순 숫자 소켓 표기와 mSATA 폼팩터처럼 원문 표기 변형도 canonical 필드로 정규화하며, 케이스 카테고리에 섞인 이름 기반 라이저/브라켓 액세서리는 핵심 후보에서 제외합니다. 일반 케이스 기능 설명에 포함된 라이저 지원 문구를 액세서리로 잘못 분류하지 않는 보수적 규칙을 사용합니다. `mergeCatalog`·`mergeAccessories`는 더 불완전한 refresh가 이미 검증된 데이터를 덮어쓰지 않도록 품질 순위를 비교합니다. 메인보드 카테고리의 고신뢰 상품 식별 불일치는 `shared/catalog-category-integrity.ts`에서 별도로 판정하며, 일반적인 `센서`·`모듈`·`전원부` 단어만으로는 정상 메인보드를 제외하지 않습니다. 홈 `DATA TRUST` 카드의 스펙 부족·가격 미확인·오래된 데이터·PCIe 근거 부족·CPU/GPU 성능 근거 부족 액션은 각각 카탈로그의 `quality=incomplete`·`priceStatus=unknown`·`freshness=stale`·메인보드 `pcieSlotInfo=missing`·CPU/GPU `benchmarkStatus=incomplete` 필터로 연결해, 상태 요약과 실제 보강 대상 목록의 범위를 일치시킵니다. 벤치마크 완전 필터는 CPU의 Cinebench R23 싱글·멀티 또는 GPU의 3DMark Time Spy·Port Royal 두 점수가 모두 유효한 레코드만 남기며, 일부 점수·점수 없음은 동일한 `incomplete` 범위에서 확인합니다.

화면과 API는 제품 수만 표시하지 않고 다음 경계를 함께 보존합니다. 원본 카탈로그 수와 핵심 부품 후보 수를 별도 metadata로 계산하며, 비핵심 액세서리는 원본 수에는 남기고 핵심 후보 가격·품질 coverage에서는 제외합니다. CPU·GPU 카탈로그 카드·상세·비교표는 동일한 `benchmarkEvidenceForPart` 결과를 사용해 점수 존재 수, 개별 점수, 출처 유형, 원문 검수, 근거 freshness를 함께 표시하며, 사용자 화면이 관리자 benchmark review queue와 다른 기준으로 근거를 해석하지 않도록 합니다. 공유 비교의 현재 재확인도 같은 기준으로 공유 당시 점수와 현재 점수의 delta를 계산하되, 현재 점수 없음·부분 근거·원문 재확인 필요는 점수 변경과 분리합니다. benchmark 상태에서 파생하는 판단 영향은 benchmark 범위의 보수적 신호이며, 전체 견적 추천 순위 재계산 결과가 아닙니다.

결과 화면 대체 후보 비교와 부품 선택기 후보 비교도 같은 `benchmarkEvidenceForPart` 결과를 별도 비교 행으로 사용합니다. 근거가 없는 범주에는 점수를 보충하지 않고 `원본 성능 근거 없음`을 표시하며, 점수·출처·원문 검수·자료 freshness를 후보별로 나란히 확인할 수 있어 카드의 요약 문장과 공유 snapshot의 원본 근거가 분리되지 않습니다.

전체 견적 검사 응답은 선택된 CPU·GPU의 benchmark를 `buildBenchmarkSnapshotFor`로 묶어 `CompatibilityResult`에 기록하고, 저장 견적 검사 snapshot은 이를 그대로 보존합니다. snapshot은 점수 coverage와 부품별 원본 근거를 결정적인 fingerprint로 묶으며, 저장 당시와 현재 재검사의 값·출처·자료 시점을 `buildBenchmarkImpactFor`로 비교합니다. 값·출처·자료 시점 변화는 성능 판단 재검토로, snapshot 누락·부분 점수·원문 검수 부족은 확인 필요로 분리합니다. 이 영향은 전체 견적 추천 순위의 자동 재계산이 아니라 benchmark 근거 범위에 대한 보수적 신호입니다.

카테고리 정합성 불일치도 동일한 원칙으로 분리합니다. 원본 카탈로그와 exact-ID 상세 조회는 보존하지만, 목록 후보·일반 스펙 보강 큐·PCIe evidence coverage에서는 고신뢰 불일치 레코드를 제외합니다. PCIe coverage의 `rawTotal`·`excludedCategoryMismatchCount`와 관리자 검수 패키지의 `categoryMismatchExcludedCount`로 원본과 실제 운영 대상을 함께 추적하며, 새로 저장되는 보강 이력은 두 수치의 관계가 맞지 않으면 수용하지 않습니다. `/api/admin/catalog-category-integrity/review-package`는 이 경계를 수정하지 않고 원본 검수 항목을 fingerprint·페이지네이션과 함께 제공하며, 관리자 화면에서 원본 코드·품질·가격·원문 발췌·안전한 외부 링크를 확인합니다.

관리자 데이터센터의 크롤 상태·manifest·주변 부품 coverage 조회도 실행 API와 같은 `requireAdmin` 경계를 사용합니다. 공개 `/api/meta`에는 화면 부트스트랩에 필요한 진행 요약만 남기고 worker PID·manifest 경로·진단 메시지·오류 본문은 포함하지 않습니다. `ADMIN_PASSWORD`가 설정된 운영 환경에서는 인증 없는 상세 조회가 `ADMIN_AUTH_REQUIRED`로 거절되고, 로그인 세션이 있을 때만 상태 데이터를 반환합니다. production에서 `ADMIN_PASSWORD` 또는 기본값이 아닌 `ADMIN_SESSION_SECRET`가 빠지면 관리자 로그인과 보호 API를 `503 ADMIN_AUTH_MISCONFIGURED`로 차단하고 기본 session secret cookie를 발급하지 않습니다. 인증된 세션 응답은 환경·비밀번호·세션 secret 설정 여부와 운영 준비 상태를 별도 진단해 개발용 무인증 상태 또는 기본 secret 운영 배포를 화면에서 식별할 수 있게 합니다. 화면은 인증 세션이 준비되기 전에는 보호된 조회를 시작하지 않으며, 로그인 후에만 초기 상태·변경 이력·주변 부품 상태를 다시 읽습니다. 세션이 만료되어 보호된 관리자 요청이 401을 반환하면 공통 API 클라이언트가 `pc-supporter:admin-auth-required` 이벤트를 발행하고 화면은 실행 중인 작업을 중단한 뒤 로그인으로 전환합니다. 운영 설정이 실행 중 바뀌어 보호 API가 503을 반환하면 `pc-supporter:admin-auth-misconfigured` 이벤트를 발행해 실행 중인 작업을 중단하고 운영 보안 notice가 있는 로그인 화면으로 전환합니다. 이 경계는 `server/admin-auth-boundary.test.ts`, `server/admin-production-config.test.ts`, `src/api.test.ts`에서 운영 설정·unauthenticated 경로·로그인 후 상태 조회·client event·진단 노출 범위로, 공개 요약 제거 규칙은 `shared/public-crawl-status.test.ts`로 검증합니다.

- 인증된 관리자 화면의 `로그아웃`은 HttpOnly 세션 쿠키를 `Max-Age=0`으로 만료시키고 실행·이력 상태를 비운 뒤 인증 화면으로 전환합니다. 무상태 서명 토큰의 이전 쿠키 자체를 서버에서 즉시 폐기하는 기능과는 구분하며, 브라우저가 만료 응답을 적용한 뒤 비인증 세션으로 돌아가는 경계를 `server/admin-auth-boundary.test.ts`에서 확인합니다.
- 목록 coverage와 저장된 상세 스펙 completeness
- live/seed/manual/incomplete 품질
- 가격 확인 여부와 데이터 freshness
- 변경 로그와 해당 변경이 특정 규칙에 영향을 줄 수 있는지의 mapping
- 주변 부품 범주별 seed/live/manual/incomplete 수를 별도 metadata로 반환해 저장 snapshot 수와 starter 수의 차이를 화면에서 설명

실제 수집 JSON과 crawl state는 공개 import에서 제외합니다. 공개 checkout은 seed로 시작하고, 로컬 운영자는 `PC_SUPPORTER_DATA_DIR`로 사설 데이터를 분리할 수 있습니다. live 수집 결과가 있으면 source product code 또는 seed ID 기준으로 starter와 병합하며, live 레코드가 존재해도 확장 starter 기준 후보를 제거하지 않습니다. 배포 환경으로 private 핵심·주변 부품 snapshot을 옮길 때는 `scripts/import-private-catalog.ts`의 dry-run 검증 후 명시적 apply를 사용하고, 핵심·주변 부품별 전체 snapshot 교체 여부를 운영자가 선택합니다. 교체 플래그는 모든 지원 범주가 포함된 snapshot만 통과하며, 부분 snapshot은 교체 없이 병합하도록 실행을 차단합니다. seed가 live 가격·재고·최신성을 의미하도록 승격하지 않습니다. 다나와 데이터의 이용·재배포 조건은 코드 테스트 통과와 별도의 검토 항목입니다.

### 3. 설명 가능한 호환성 엔진

`server/engine.ts`는 견적을 규칙별로 평가하고, 각 finding에 심각도·영향 부품·판정 사실·다음 행동을 붙입니다. 주요 규칙 표면은 다음과 같습니다.

- CPU/메인보드 socket과 CPU 전력·쿨러 용량
- RAM 세대·DIMM/SO-DIMM·용량·속도·슬롯
- M.2 form factor·NVMe/SATA·PCIe generation·lane sharing
- GPU 길이·두께·슬롯·전력·보조전원과 PSU 커넥터
- 케이스의 GPU/쿨러/PSU 물리 여유와 메인보드 form factor
- 케이스 팬/RGB와 메인보드 헤더·전압·전류 여유
- 데이터가 부족할 때의 `확인 필요`와 제조사 원문 근거 경계

수동 카탈로그 스펙 보강값은 runtime overlay로만 적용하며, 관리자에서 저장한 HTTPS 원문 점검 결과가 접근 가능·모델 일치·허용 freshness인지 다시 판정합니다. 점검 전·실패·오래된 근거는 대체 후보 추천 신뢰도를 하향하고 후보 적용·구매 판단을 확인 필요로 만들며, 원문 점검을 통과한 경우에만 신뢰도 보정이 적용됩니다. 게이밍 GPU 대체 후보는 선택 해상도·주사율·권장 VRAM과 후보 충족 상태를 별도 근거로 계산·export하고, 실제 FPS를 보장하는 것으로 해석하지 않습니다.

PCIe 세대처럼 물리 호환과 성능 경고가 분리되는 영역은 무조건 불호환으로 올리지 않습니다. 반대로 물리값이나 제조사 근거가 없으면 자동 통과로 승격하지 않습니다.

### 4. 후보·수리·구매 의사결정

후보 탐색은 빠른 범위 추천과 전체 후보 정밀 탐색을 분리합니다. 정밀 탐색은 후보를 실제 견적에 비파괴적으로 대입해 전체 finding·가격·데이터 품질을 다시 계산합니다. 대규모 후보를 bounded pool로 줄이는 경우에도 최종 성능 정렬과 동일한 `유사도 × 비교 범위` 보정값·신뢰도·비교 차원 수를 사용해 부분 스펙 후보가 평가 풀을 독점하지 않도록 합니다.
- 정밀 후보 선택기 응답은 현재 정밀 평가 후보 전체의 추천 근거 분포(high/medium/low)를 별도 집계해 표시 후보 수와 분리하며, 이 집계는 후보 점수·순위를 변경하지 않고 근거 완성도에 대한 사용자 판단만 보강함

- 안전·확인 필요 후보는 비교와 미리보기 후 사용자가 적용하며, 최종 변경 미리보기에서도 후보 자체 판정·근거·적용 후 전체 잔여 위험을 다시 확인한다. 가상 적용에서 실제 적용 미리보기로 전환할 때는 기존 가상 패널을 닫아 stale 상태를 남기지 않는다.
- 대체 후보를 실제 적용해 재검사하면 이번 세션의 `적용 전 → 적용 후 검사 비교`에서 판정·위험 카운트·확정 가격·성능 분석·전력·냉각 여유·변경된 finding과 변경 부품을 한 번에 보여준다. 이 비교는 저장 견적 검사 이력과 섞지 않는 읽기 전용 요약이며, benchmark 또는 가격 근거가 부족하면 별도 확인 필요로 남긴다. 비교 표의 `비교 복사`와 compact `JSON 저장`은 전체 CompatibilityResult를 그대로 노출하지 않고 비교에 필요한 snapshot·delta·변경 finding만 내보내며, 실제 판매가·재고·FPS·제조사·장착 조건의 경계를 포함한다. 일반 초안의 `선택 이유에 첨부해 저장`은 현재 비교를 다음 저장 대화상자에 미리 채우고 사용자가 저장을 확정했을 때만 새 저장 견적에 기록한다. owner token이 있는 저장 견적에서 파생한 현재 구성은 기존 견적을 수정하지 않고 `새 버전으로 저장`을 통해 부모 lineage를 유지한다. 기존 저장 견적 이력은 자동 수정하지 않으며, 취소는 현재 상태를 변경하지 않는다.
- 차단 후보는 카드에 이유를 보여주되 가상/실제 적용 모두 차단
- 하나의 finding에 여러 교체 범주가 있으면 범주별 후보 대표성을 보장
- 수리 플랜은 해결한 finding, 남은 finding, 가격 변화, 성능·유사도·근거를 함께 제시
- 수리 플랜이 여러 개면 잔여 차단·주의·확인 필요를 가중한 위험 점수, 변경 항목 수, 확인된 추가 비용으로 효율 경계를 계산함. 세 축에서 모두 불리한 플랜만 열세로 표시하고, 알려진 가격과 미확인 가격 사이에는 비용 우위를 만들지 않음
- 예산 ladder도 절약형·목표 예산·여유형의 잔여 위험·확정된 실제 합계·카탈로그 분석 지수를 비교해 효율 경계를 표시함. 가격 또는 분석 지수가 한쪽만 없으면 해당 축으로 우열을 만들지 않고, 생성 실패 구간은 비교에서 제외함
- 후보 전체 가상 비교도 호환 위험·가격 변화·적용 후 분석 지수·추천 근거를 비교해 효율 경계를 계산함. 차단 후보는 비교에서 제외하고, 선택적 가격·분석 근거가 한쪽만 없으면 해당 후보를 열세로 단정하지 않으며 결과를 공유 snapshot과 export에 보존함
- 저장 견적 버전 비교도 최신 두 버전의 호환 위험·확정된 총액·분석 점수·확장성 점수를 비교해 효율 경계를 계산함. 네 축에서 모두 불리한 버전만 열세로 표시하고, 한쪽에만 존재하는 가격·분석·확장성 근거로는 우열을 만들지 않으며 읽기 전용 결과로 유지함. 기준별 1순위가 한 견적으로 수렴하는지 또는 후보가 갈리는지를 별도 맥락으로 계산하고, 저장된 선택 이유와 구매 진행 단계는 비교 판단의 보조 정보로만 표시함. 1순위 카드에서는 해당 견적의 결과 또는 구매 목록으로 바로 이동할 수 있음
- 같은 version lineage에 3개 이상 견적이 있으면 version panel은 최신 두 버전을 기본 선택하되 사용자가 최대 두 버전을 직접 선택할 수 있게 한다. 선택 pair가 바뀌면 구성 diff·snapshot transition·finding delta·선택 이유 context·현재 카탈로그 재검사·export가 모두 같은 pair로 갱신되며, 비교 선택 상태는 새 version 추가 시 최신 두 버전으로 재기준화한다. `비교 복사`는 읽기용 텍스트를, `JSON 저장`은 `pc-supporter.saved-build-version-comparison` schemaVersion 1 snapshot을 내려받으며 owner token·인증 정보·원본 전체 견적을 포함하지 않는다. snapshot·가격·분석 근거가 없으면 비교값을 만들지 않고 확인 필요로 남긴다.
- 같은 pair의 `링크 공유`는 이후 버전 owner token을 확인한 서버가 두 저장 견적을 다시 읽어 snapshot을 생성한다. 서로 다른 lineage는 차단하며, 공개 응답에는 owner token/hash와 source credential을 포함하지 않는다. `/version-comparison/:id`는 30일(기본) 읽기 전용 route로 구성·검사·finding·선택 이유를 보여주고, `현재 카탈로그 기준 재검사`에서는 현재 위험·가격·분석·finding 해결/신규/변경을 추가로 비교한다. 원본 견적이나 공유 snapshot을 자동 변경하지 않으며, 링크 취소는 owner token으로만 가능하고, 만료·취소 링크는 공개 API에서 404로 닫힌다.
- 공개 현재 재검사의 `현재 재검사 JSON`은 `pc-supporter.saved-build-version-current-recheck` schemaVersion 1로 저장 시점과 현재 결과를 별도 보존하며, JSON을 저장해도 공개 snapshot·원본 저장 견적은 갱신하지 않는다.
- 버전 비교 공유 성공 시 브라우저에는 payload 전체가 아니라 링크·pair 이름·생성/만료 시각·owner token만 최대 20개 저장한다. 홈 `최근 견적 버전 비교 공유`는 표시 링크의 서버 상태를 재조회하고, 검색·최근/전체 이력·링크 복사·열기·브라우저 이력 제거·owner token 기반 서버 취소를 제공하며, localStorage 동기화로 다른 탭에도 같은 이력을 반영한다.
- 홈 이력은 공유 snapshot의 after 검사 `catalogSnapshotAt`과 현재 `/api/meta.catalogUpdatedAt`을 비교해 시점이 달라졌을 때 `현재 카탈로그 갱신 · 재검사 권장`을 표시한다. after 저장 견적 ID가 있는 새 이력에는 `현재 기준 결과 열기` deep-link를 제공해 기존 `/share/:id`의 현재 catalog 재검사 화면으로 이동하며, 이 경고·이동은 공개 snapshot이나 저장 견적을 자동 수정하지 않는다.
- 자동 구성 한 줄 요구사항 해석은 지원된 한국어 조건만 결정적으로 폼에 제안하고, 핵심 조건 coverage·누락 항목·안전한 보완 문구를 함께 보여주며 미리보기와 명시적 적용을 분리함. QHD·144Hz·RAM 32GB·SSD 1TB 보완 칩은 원문에만 추가해 다시 해석하고 폼에는 자동 적용하지 않으며, 선택지 밖의 용량·GPU 조건 충돌은 자동 보정하지 않고 확인 필요로 남기고, 해석 자체로는 서버 생성 요청을 시작하지 않음
- 구매 준비도는 호환성·가격·데이터 신뢰도·장착·전력·냉각·예산 gate를 분리하며, 엔진이 계산한 전력·냉각 여유가 좁거나 부분적으로만 확인되면 구매 전 확인 상태로 낮추고, 저장 snapshot·재검사 diff·모니터 알림에서도 예산 변화를 추적
- 최종 구매 판단은 구매 목록의 로컬 단계 진행도를 별도 fact로 받아 규칙·가격·데이터 gate를 덮어쓰지 않고, 예정·주문·수령·조립 수량을 즉시 보여줌. 서버 복원 뒤에도 같은 결과 화면 gate에 반영하며 실제 결제·배송 완료로 해석하지 않음. 구매 진행 상태가 있으면 현재 단계에 맞는 구매 목록 이동 액션도 제공함
- 구매·조립 실행 순서는 엔진 판정만으로 고정하지 않고 체크리스트·구매 단계·실측 summary를 선택적으로 결합함. 구매 미완료 시 사전 조립·케이블·POST 단계는 앞 단계 대기로 남기고, 실측 진행 중·실패·재확인 상태는 마지막 테스트 단계의 확인 필요로 표시하며, 미기록 실측을 통과로 승격하지 않음
- 실행 순서 상단의 `다음 단계로 재개`는 첫 번째 비완료 단계의 target만 호출함. 차단·확인 필요·선행 대기·실측 시작을 각각 구분해 기존 repair plan·checklist·data·purchase·assembly focus/URL 경계를 재사용하며, 새로운 자동 주문이나 상태 변경은 수행하지 않음
- 스펙 coverage가 high 또는 medium인 범주는 coverage 카드에서 범주 빠른 수집을 직접 시작할 수 있으며, 관리자 확인·범주 제한·페이지 1·최대 16개 샘플 계약을 유지하고 완료 후 메타와 보강 큐를 재계산함
- 주변 부품 coverage의 incomplete 상세 보강 gap도 다음 보강 작업에 별도 묶음으로 표시하며, 주변 부품 목록의 quality/category 필터와 category-scoped 상세 수집 batch만 호출함. 핵심 부품 호환 판정과 endpoint를 혼합하지 않음
- 관리자 주변 부품 coverage 패널은 API snapshot의 모든 저장 범주를 렌더링하고, live·상품 미완료·최근 수집 스펙 누락·가격 확인·목록/상세 상태를 분리 표시함. 범주별 링크와 상세 보강 액션은 해당 category와 `quality=incomplete` 경계를 유지함
- 결과 화면의 주변 부품 추천은 서버가 계산한 후보 순서를 보존한 채 범주·가격·근거 충분도 탐색과 원문 스펙 펼치기·카탈로그 deep-link를 제공하며, 견적 추가 후 기존 주변 부품 호환 판정을 다시 실행함
- 주변 부품 추천은 확인된 M.2 슬롯 초과에만 저장장치 어댑터를 연결하고, 원문에 동시 장착 수가 명시되어 초과 SSD 수를 한 번에 수용할 수 있는 후보만 추천함. PCIe 어댑터 후보에는 원문에서 확인한 요구 슬롯 폭(x1/x4/x8/x16)을 함께 표시하고, 견적에 추가하면 메인보드의 해당 폭 이상인 확장 슬롯 수에서 GPU 경로를 제외해 전기적 여유를 검사함. 카탈로그·부품 선택기의 메인보드 필터도 같은 폭 이상 집계 규칙을 사용해 x4 요구에 x4·x8·x16을 포함하며, 필요한 슬롯 폭 원문이 일부라도 없으면 결과에서 `정보 없음`으로 분리함. 메인보드 슬롯 폭·GPU 경로·물리 슬롯 점유·PCIe 레인 공유·bifurcation·부팅 조건 중 하나라도 확인되지 않으면 자동 통과시키지 않고 `확인 필요`로 남김. 6000MHz 이상 또는 다중 DIMM 고속 RAM에는 메모리 쿨러를, 300W 이상·55mm 이상 GPU에는 원문 냉각 근거가 있는 보조 GPU 쿨러를 선택적으로 제안함. 폼팩터·NVMe/SATA·메모리 세대·GPU/팬 신호가 맞지 않는 후보는 숨기며, 장착 수가 없거나 M.2 신호가 미확인인 후보는 추천하지 않음
- 주변 부품 추천 후보 비교는 동일 category만 최대 3개 선택하도록 제한하고, 가격·품질·갱신·누락·범주별 구조화 스펙·추천 근거를 읽기 전용 표로 표시함. 비교 선택은 견적 상태를 변경하지 않으며 실제 변경은 기존 추가·재검사 경계를 사용함
- 주변 부품 추천 카드의 가격 추적은 기존 `kind+itemId` 개인 watchlist identity를 재사용함. 목표가가 있으면 같은 항목의 목표가를 저장·갱신하고, 없으면 추적만 등록하며, 잘못된 목표가·중복 항목·watchlist 최대 50개 계약은 공통 저장 경계에서 검증함
- 카탈로그 품질 운영은 카테고리별 완전·부분 항목과 주요 누락 필드·가격·갱신 상태를 함께 보여주며, 대상 0개인 카테고리의 계산상 100%를 실제 근거로 해석하지 않음. 부분 누락률 50% 이상은 `우선 보강`, 10% 이상은 `보강 권장`, 그 외 부분 누락은 `소수 누락`으로 분류해 관리자 카드에 보강 순서대로 표시함
- 메인보드 PCIe 슬롯 폭은 기존 필수 `missingFields` completeness와 분리한 evidence coverage로 집계함. x16·x8·x4·x1 요구 폭별로 필요한 원문 필드가 모두 확인된 수와 정보 부족 수를 표시하고, x4 이상 조건의 정보 부족 보드는 관리자 우선 작업·카탈로그 `pcieSlotInfo=missing` 필터·`PCIe 슬롯 evidence` 원문 보강 큐로 연결함. 전용 큐의 package fields는 PCIe 슬롯 검수 지침만 포함하고, 일반 스펙 누락 수나 기본 카탈로그 완전 수치를 임의로 바꾸지 않음. 이 lane은 PCIe 슬롯 수를 추정하지 않음
- 메인보드 다나와 원문은 `[확장슬롯]`·`확장슬롯`·`PCIe버전`·구형 직접 PCIe slot label section을 모두 parser fixture로 검증함. `VGA 연결: PCIe x16`처럼 인터페이스만 있는 문자열은 slot count로 승격하지 않고, 숫자와 `개` 단위가 명시된 경우에만 정규화함
- 범용 카탈로그 스펙 보강 큐는 누락률이 높은 범주와 호환 영향도가 큰 필드를 함께 사용해 작업 우선순위를 계산하며, 검색·카테고리·우선순위·누락 필드·offset을 반영한 schemaVersion 1 JSON 작업 패키지와 `nextOffset`을 제공함. 패키지는 원문 확인용 deep-link와 필드별 검수 지침을 포함하지만 안전 후보 판정을 우회하거나 값을 자동 확정하지 않음
- 보강 큐는 `all`·`spec`·`pcie` 근거 범위를 제공해 일반 누락과 PCIe evidence 누락을 분리하며, `pcie` 범위는 PCIe 누락 필드·전용 검수 지침·전용 badge를 사용함. 선택한 다나와 핵심 후보는 `/api/admin/catalog-spec/refresh-batch`로 최대 12개까지 순차 원문 재확인할 수 있으며, 각 결과를 반영·건너뜀·실패로 분리하고 중복 ID·비핵심 항목·동시 저장·cooldown을 차단함. 성공 후에는 카탈로그 metadata와 보강 큐를 다시 읽어 남은 작업을 최신 snapshot으로 갱신함
- 일괄 보강 결과는 `catalog-spec-refresh-history.json`에 최대 100회까지 runId·필터·항목별 결과로 보존하고 `/api/admin/catalog-spec/refresh-history`에서 최근 20회만 읽음. 이력 저장 실패는 실제 원문 반영 결과와 분리해 `historyPersisted=false`로 표시하며, 견적·owner token·원문 본문은 저장하지 않음
- 제조사 근거 수동 스펙 보강은 현재 누락된 scalar/list 필드만 입력할 수 있고, 제조사 모델/SKU·근거 메모·HTTPS URL을 필수로 요구함. `/api/admin/catalog-spec-overrides/batch/validate`가 전체 항목을 먼저 검증하며 하나라도 오류가 있으면 `/batch` 저장을 차단함. overlay는 적용 전 원래 스펙·품질·누락 필드·갱신 시각을 provenance에 보존하고 `catalog.json`에 runtime 값을 영구 병합하지 않음
- 수동 override의 근거 URL은 `/source-check`에서 공개 HTTPS·HTTP 응답·모델/SKU 본문 일치를 점검하고, 결과를 별도 history의 최초·상태 유지·상태 변경 전이로 기록함. 점검 실패나 시점 만료는 값을 자동 삭제하지 않지만 provenance와 관리자 목록을 `재확인 필요`로 낮춤
- 수동 override가 많을 때는 `/api/admin/catalog-spec-overrides/source-check/batch`로 offset으로 다음 묶음을 재개하면서 한 번에 최대 50개를 동시 2개씩 점검하고, 항목별 성공·실패·저장 실패·건너뜀을 반환함. 관리자의 `최대 50개 근거 점검`은 기존 history와 runtime overlay를 갱신하고, 추천 신뢰도와 후보 적용·구매 판단은 새 결과를 즉시 소비함
- 카탈로그 스펙 보강 작업 패키지는 결정적 `queueFingerprint`를 페이지 간 전달하며, 다음 페이지 요청에서 큐가 원문 반영으로 바뀌었는지 확인함. fingerprint가 달라지면 stale offset을 계속 사용하지 않고 첫 묶음부터 다시 기준을 잡음
- 작업 패키지는 `refresh_source`·`review_source`·`inspect_catalog` 작업 유형으로 자동 원문 재확인과 수동 확인 대상을 분리하고, 선택된 작업 유형을 fingerprint와 실행 이력에 보존함
- 보강 batch는 처리 전·후 카탈로그 completeness와 incomplete 수를 `coverageBefore`·`coverageAfter`·`coverageDelta`로 기록함. 메인보드 항목은 PCIe 누락 필드 before/after와 `pcieImpact`를 추가하고 폭별 PCIe coverage delta도 검증해, 일반 스펙 완성 전환과 PCIe evidence 해소를 같은 숫자로 합치지 않음. 구버전 이력은 이 필드 없이도 읽고, 새 coverage와 delta가 서로 맞지 않으면 이력에 저장하지 않음
- 보강 batch는 실제 항목의 이전·이후 누락 필드를 비교해 `impact.newlyCompletedCount`·`impact.newlyResolvedFieldCount`·`impact.newlyCompletedByCategory`를 계산함. 처리 건수와 완성 전환을 분리하고, progress API와 관리자 품질 추이에 누적 완성 전환·해소 필드·카테고리별 결과를 제공함. 메인보드의 `pcieImpact`와 PCIe 슬롯 field progress는 일반 누락 필드 progress와 분리해 누적 PCIe 완성 전환·해소 필드·폭별 coverage를 표시함. 저장 이력의 impact가 항목 결과와 맞지 않으면 수용하지 않음
- 다나와 원문 자동 확인이 같은 항목에서 3회 연속 실패하면 review queue의 조치를 `review_source`로 전환하고 `반복 실패 · 수동 확인`을 표시함. 성공 이력이 다시 들어오면 자동 확인 조치로 복귀하며, 시도·실패·연속 실패 횟수와 마지막 결과를 queue fingerprint에 포함해 페이지 재개가 오래된 자동 큐를 재사용하지 않게 함
- 관리자 coverage의 주요 누락 필드는 `missingField` URL 필터로 카탈로그 목록과 연결하며, 필터 조건은 새로고침·복사 링크에 보존하고 해제 시 일반 목록으로 복원
- 누락 필드 결과의 다나와 부품 상세는 `원문 다시 확인`으로 단건 refresh할 수 있으며, 성공하면 현재 목록을 다시 조회하고 실패·cooldown·지원 불가 응답은 사용자에게 표시
- 호환 후보의 안전 범위는 `incomplete` 부품을 안전 후보로 승격하지 않고 제외 건수와 상위 누락 필드별 건수를 별도 표시하며, 사용자가 일반 카탈로그의 불완전 데이터 목록에서 원문을 확인한 뒤 다시 평가할 수 있게 함
- 구매 목록의 현재 가격 재확인은 자동 구매 결론으로 승격하지 않고, 확인률·인하/상승 총액·변동 혼재·재확인 필요를 별도 보수적 요약으로 표시함
- 구매 목록 진행률은 legacy `checkedIds`를 유지하면서 `planned`·`ordered`·`received`·`installed` 단계와 행별 updatedAt을 optional `itemStates`로 보존함. 주문 완료를 구매 완료로 승격하지 않고 수령·조립 단계만 기존 checked 진행률에 반영하며, 구버전 checked-only snapshot은 수령 완료로 fallback함
- 저장 견적의 조립 검증은 서버에 공유 가능한 compact snapshot/history만 남기고, 다른 브라우저·기기에서 결과를 열 때 체크 상태·대표 측정값·부하 조건·진행률을 로컬 실행 history로 복원함. 원본 measurement series와 개별 check note는 복원·공개하지 않으며, 현재 브라우저에 더 최신의 전체 로그가 있으면 행/회차별 최신 시각을 기준으로 보존함
- 구매 목록의 다음 구매 행동 센터는 스펙·원문 확인, 가격 재확인, 주문, 수령, 조립 순으로 현재 데이터·단계 counts를 정렬하고, 각 행동은 실제 주문을 실행하지 않고 해당 표시 필터로만 이동함
- 구매 목록은 가격·데이터 신선도 필터와 함께 부품명·범주·핵심/주변 구분·식별자 검색을 제공하며, 표시 범위만 줄이고 전체 금액·진행률 기준은 유지함
- 구매 목록의 M.2 주변 부품·추가 팬 행은 선택한 SSD·팬 허브를 `연결 대상`으로 표시하고, 자동 전체 대상·미지정·지정 필요 상태를 화면·복사·CSV·가격/진행률 이력 export까지 전달해 주문·조립 단계의 target context를 보존함
- 검색·가격 필터가 적용된 구매 목록은 전체 내보내기와 별도로 현재 표시 행만 복사·CSV 저장할 수 있으며, id가 없는 legacy 행도 stable row key로 구매 완료 상태를 보존함
- 가격 추적 목록은 원시 조회 상태와 목표가·가격 이력에서 파생된 결정 상태를 분리하고, 목표가 도달·구매 검토·하락 대기·재상승 관찰·목표가 관찰 중 필터와 현재 판단 분포를 제공함
- 공개 가격 추적 목록의 CSV·JSON 이동은 병합 전 미리보기와 kind+itemId 중복 처리를 거치며, 현재 가격·이력·알림·owner token은 파일에 포함하지 않음
- 전체 카탈로그 모드의 2~3개 부품 비교는 페이지 이동 후에도 선택을 유지하고, 비교 결과를 복사·CSV·JSON·읽기 전용 공유로 재사용함
- 현재 견적을 최신 기준으로 검사한 경우에만 일반 카탈로그 비교에서 전체 호환성 가상 비교로 진입하며, 검사 전에는 해당 동작을 잠금
- 전체 카탈로그 모드에서도 같은 범주의 2~3개 부품을 선택해 가격·구매 조건·데이터 상태·핵심 스펙을 나란히 비교하며, CPU·GPU인 경우 Cinebench R23·3DMark 점수와 성능 출처·원문 점검·근거 갱신 상태도 함께 표시함. 비교 복사·공유 snapshot·CSV·JSON은 동일한 원본 성능 근거를 보존하고, 공유 화면은 생성 당시 근거와 현재 카탈로그 재확인을 분리함. 이 표는 현재 견적 호환성 판정을 대신하지 않음
- 핵심 카탈로그 검색에서 분리된 액세서리 수가 있으면 `nonCoreExcludedCount`를 통해 빈 결과 원인을 설명하고 주변 부품 카탈로그로 이동시킴
- 핵심→주변 부품 이동은 원래 검색어를 `/accessories?q=...`로 전달해 사용자가 같은 검색을 반복하지 않도록 함
- 핵심·주변 부품 카탈로그의 검색어·범주·데이터 품질·갱신 상태·가격/유통 조건·정렬은 URL query와 history에 동기화하고, 검색어 연속 입력은 같은 history 항목에 coalescing함. 핵심 카탈로그 페이지 위치는 `page`로 보존해 링크 공유·새로고침·뒤로 가기·앞으로 가기 뒤에도 같은 탐색 조건을 복원함. 범위를 벗어난 페이지는 실제 결과 마지막 페이지로 보정함
- 검색·필터가 바뀌면 핵심/주변 부품 목록과 가격 추적 검색의 이전 in-flight 요청을 `AbortController`로 취소하고, API retry backoff도 `AbortSignal`에 연결함. 따라서 늦은 응답을 무시하는 UI 세대 보호와 서버 호출 자체의 취소를 분리해, 빠른 입력에서 불필요한 계산·재시도·rate limit 소비를 줄임
- 후보·변경·저장·가져오기·공유 취소 모달은 공통 접근성 훅으로 초기 포커스, Tab 순환, Esc 닫기, 닫힌 뒤 트리거 포커스 복귀를 보장함. 저장·검사 중에는 close-on-Esc와 배경 닫기를 잠가 중간 mutation을 취소하지 않음
- `Retry-After`가 있는 오류 안내는 남은 초를 표시하는 재시도 버튼으로 연결하고, 대기 중 중복 클릭을 막음. 대기 시간이 없는 네트워크 오류는 기존 즉시 재시도 동작을 유지함
- 가격 추적 화면의 개인 검색·추적 목록 필터는 `/watchlist` query와 history로 복원하되, 서버 공유 목록 `/watchlist/{id}`와 개인 관심 목록 데이터는 URL 상태와 섞지 않음
- 카탈로그·주변 부품·가격 추적 화면은 현재 탐색 URL을 버튼으로 복사할 수 있으며, 클립보드 권한이 없을 때도 URL을 toast로 남김. 가격 추적 검색어 연속 입력도 같은 history 항목으로 묶음
- 자동 구성 조건은 `/recommend` query와 history로 복원·복사하되 링크 진입만으로 생성·현재 견적 변경을 실행하지 않고, 사용자가 생성 버튼을 눌렀을 때만 서버 계산을 시작함. 예산 연속 입력은 한 history 항목으로 묶음
- 추천 우선순위는 균형형·가성비·성능·안심 우선으로 동일한 `RecommendationPriority` 계약을 사용함. 안심 우선은 후보 실제 대입 결과의 호환 검증·전체 상태와 데이터 품질·갱신·가격·원문 근거를 정렬에 반영하되, 데이터 부족을 호환 확정으로 승격하지 않음
- 견적 변경 이력은 800ms 안의 연속 수량·선택 편집을 하나의 작업으로 합치고 가장 이른 이전 snapshot을 보존해 복원 단위를 사용자 작업에 맞춤
- 브라우저에 저장된 raw 견적은 transfer parser로 부팅 전에 검증하며, 깨진 값은 별도 백업 후 안전한 빈 견적으로 복구해 새로고침 반복 오류를 막음
- 여러 탭의 draft·추천 기준 변경은 canonical key로 비교해 같은 입력은 무시하고, 다른 입력은 자동 덮어쓰기 없이 사용자가 불러오기·현재 입력 유지를 선택하게 함
- production service worker는 API를 캐시하지 않고 정적 shell만 offline fallback으로 제공해 최신 가격·호환성 판정과 오프라인 재진입을 섞지 않음
- 부품 선택기의 전체 카탈로그 모드는 성공한 목록 응답의 기본 부품 정보만 브라우저 로컬 캐시에 schemaVersion 1 envelope로 최대 600개·약 1.8MB까지 보관함. envelope의 캐시 저장 시각과 각 부품 원본 갱신 시각을 분리하고, 이전 배열형 캐시의 시각은 미확인으로 유지함. 목록 요청 실패 시 캐시를 탐색 전용 후보로만 표시하고 정밀 호환·유사도·실시간 가격은 재연결 전까지 계산·확정하지 않음
- 주변 부품 카탈로그는 App bootstrap과 성공한 목록·상세 응답을 같은 schemaVersion 1 제한 캐시에 저장 시각과 함께 보관하고, 실패 시 범주·검색·가격·갱신 조건을 적용한 탐색 전용 목록으로 전환함. 캐시 상세나 추가는 최신 원문·실시간 가격·주변 부품 호환성 확정으로 승격하지 않으며 재시도 성공 시 서버 응답을 기준으로 복귀함
- 홈의 LOCAL CATALOG CACHE 패널은 두 캐시의 개수·신선도를 읽기 전용으로 요약하고, 명시적 확인 뒤 핵심·주변·전체 탐색 캐시만 선택적으로 삭제함. 삭제 이벤트는 두 카탈로그 키와 상태 표시만 갱신하며 draft·saved build·share·watchlist 저장소에는 접근하지 않음
- 자동 구성 빠른 시작 프리셋은 사무·FHD/QHD/4K 게이밍·개발/AI의 명시적인 조건 묶음만 입력하고, 생성 전 사용자가 모든 값을 확인·수정할 수 있도록 함
- 내 자동 구성 프리셋은 schemaVersion·허용 조건·이름·시간을 검증하고 JSON 가져오기 전 미리보기·명시적 병합 확인을 거친 뒤 브라우저 로컬에 최대 10개만 저장하며, 서버 snapshot·공개 URL·현재 견적에는 목록 자체를 포함하지 않음

### 5. 저장·공유·현재 재검사

파일 저장은 개발 환경의 기본 backend이고, `DATABASE_URL`이 설정되고 PostgreSQL이 준비되면 저장·lease·catalog persistence가 PostgreSQL로 전환됩니다. DB가 불가능하면 파일 backend로 fallback하되 `persistenceDiagnostics`에 그 상태를 노출합니다.

저장 견적·예산 ladder·비교·관심 목록에는 만료·owner token·공개 응답 경계를 둡니다. 저장 견적에는 선택 이유를 최대 500자까지 optional 메타데이터로 저장하며, 이 필드는 사용자가 공유를 의도한 설명이므로 이력·공개 결과에 표시합니다. 빈 메모는 저장하지 않고, owner token·토큰 해시·서버 모니터 상태와 분리해 공개 응답에 포함하지 않습니다. owner token이 있는 소유자는 `PATCH /api/builds/:id`로 이름·선택 이유만 수정할 수 있으며, 이 mutation은 selection·추천 기준·검사 snapshot·구매 기록·버전 번호를 변경하지 않고 메타데이터의 updatedAt만 갱신합니다. 다른 탭은 별도 metadata sync key를 받아 저장 견적 목록을 재조회합니다. 저장 당시 snapshot과 현재 catalog 재검사는 별도 행으로 비교하며, catalog 변경 로그는 선택한 부품과 검사 시각이 동시에 맞는 경우에만 원인 후보로 표시합니다. 원인 로그가 없을 때는 카탈로그 변경으로 단정하지 않습니다.
owner token이 없는 공유 견적 결과에는 `내 견적으로 복제`만 제공하고 원본 mutation 경계를 열지 않습니다. 복제는 이미 현재 카탈로그 기준으로 재검사한 selection·추천 기준을 새 브라우저 draft로 옮기되, 기존 result·saved check history·shareId·owner token·change history를 초기화하고 사용자가 별도로 다시 검사·저장하게 합니다. 원본 저장 견적은 서버에서 변경되지 않으며, 복제 동작은 공유 열람과 새 견적 생성 사이의 명시적 사용자 의도를 분리합니다.

설명 변경 이력의 before/after 원문은 `metadata_history`에 최대 12회 보관하지만 `publicSavedBuild`에서 제거하고, 소유자 인증이 필요한 `/api/builds/:id/metadata-history`에서만 읽습니다. 따라서 사용자가 현재 메모를 비우거나 수정할 때 과거의 선택 이유가 공유 링크에 남지 않으며, 이력 조회 실패는 현재 저장 견적 표시를 막지 않습니다.

공유 후보 비교 화면은 일시적인 API 연결 오류에서 현재 `/compare/:id` route를 유지한 채 재시도할 수 있습니다. 재시도 성공은 같은 읽기 전용 snapshot을 복원하고, 만료·취소 링크는 재시도 후에도 서버 404 경계를 따릅니다. 전체 가상 비교 snapshot에는 후보 적용 후 성능 점수·등급·신뢰도와 현재 구성 대비 점수 변화량을 optional로 보존하고, 공유 표·텍스트·CSV/JSON export에서 같은 성능 판단을 재현합니다. CPU·GPU 후보의 로컬 가상 비교 카드도 같은 `benchmarkEvidenceForPart` 기준으로 현재 원본 점수와 후보 원본 점수의 항목별 delta, 후보 원문 검수, 자료 freshness를 표시하며, 한쪽 점수가 없으면 `비교 불가`로 남겨 성능을 추정하지 않습니다.

### 6. 실제 조립·센서 증거

호환성 판정은 실제 조립 성공을 대신하지 않습니다. 조립 로그는 POST, BIOS, 메모리 프로파일, 저장장치, GPU 출력, 팬/RGB를 pass/fail/unconfirmed로 기록합니다. HWiNFO·OCCT CSV는 미리보기와 품질 카드를 통과한 뒤 최대 240개 시계열 포인트로 압축됩니다.

추세 비교는 도구·시나리오·테스트 시간과 구간 종류가 같은 회차에서만 delta를 계산합니다. timestamp 공백·역순·안정화 샘플 부족은 `확인 필요`로 남기며, 센서 값이 있다고 해서 안전이나 고장을 자동 확정하지 않습니다.

### 7. UI와 운영 패널

Vite가 브라우저 번들을 만들고 React 화면이 API 계약을 소비합니다. 초기 편집기 shell과 관리자·후보·가격 추적·공유·비교 화면은 lazy chunk로 분리되어, 운영 패널을 사용하지 않는 첫 화면의 로딩 경계를 유지합니다. 결과·이력 전용 순수 계산은 `catalog-change-domain`·`saved-build-domain`·`purchase-domain`으로 별도 manual chunk에 두어 앱 entry의 parse/cache 단위를 줄이고, 해당 분리는 판정 순서·API·데이터 계약을 변경하지 않습니다. `scripts/verify-client-bundle.mjs`는 build 후 entry 540,000바이트 예산과 세 도메인 chunk 생성을 검사해 이 경계를 회귀 방지 gate로 유지합니다. 결과 화면 상단의 lazy `ResultQuickNav`는 최종 구매 판단·우선 조치·상세 판정·구매 전 체크·구매 목록으로 이동하는 탐색만 담당하며, 대상 패널이 늦게 로드되어도 bounded retry로 포커스를 복원합니다. 결과 요약 카드도 심각도 필터와 상세 목록 이동을 결합해 숫자 요약이 다음 행동으로 이어지도록 합니다. 관리자 저장 작업은 auth·rate limit·source URL 검증·재조회로 보호됩니다.

공유 가격 추적 snapshot은 일반 가격 추적 화면과 분리된 lazy route에서 저장 기준·현재 가격·가격 이력·결정 상태를 표시하며, 일시적인 API 오류에서는 같은 route 재시도를 제공합니다. 공유받은 사용자의 확인은 읽기 전용으로 유지됩니다.

브라우저 offline/online 상태는 API 정상 여부와 별도 fact로 표시합니다. 오프라인에서는 입력·로컬 프리셋·마지막 성공 결과를 보존하고 읽기 데이터만 재동기화 대상으로 남기며, online 이벤트 자동 retry는 bootstrap 실패가 있었을 때만 실행합니다. 저장·공유 같은 쓰기 요청은 중복 실행을 막기 위해 자동 재시도하지 않습니다.

동일한 `/api/parts`, `/api/accessories`, `/api/meta` GET이 네트워크 실패할 때만 24시간·512KB 이내의 session fallback을 사용할 수 있습니다. fallback을 사용해도 API status는 `offline`로 남기며, 부품 상세·가격·저장 견적·POST 요청에는 오래된 응답을 사용하지 않습니다.

## 공개 저장소에 포함하는 것과 제외하는 것

### 추적하는 것

- TypeScript 서버·도메인·React UI와 해당 단위 테스트
- `package.json`, lockfile, TypeScript/Vite 설정
- DB schema와 Docker Compose 개발 보조 설정
- `.env.example`의 빈 설정 이름과 기본값
- seed catalog와 `server/fixtures/`의 synthetic fixture, API/구조 설명, 디자인 QA 기준, CI/PR 규칙

### 추적하지 않는 것

- `.env`, 관리자 비밀번호·session secret·DB credential
- `node_modules/`, `dist/`, `.playwright-mcp/`, `artifacts/`
- `data/*.json`의 live catalog·accessory snapshot·저장 견적·watchlist·변경 이력
- crawl lock/lease/temp 파일과 로컬 실행 로그

이 경계는 “테스트가 통과한다”는 근거와 “외부 수집 데이터 재배포가 허용된다”는 판단을 분리하기 위한 것입니다.

## 검증 매트릭스

| 검증 층 | 명령/방법 | 현재 import 기준 |
| --- | --- | --- |
| 타입·정적 계약 | `npm run typecheck` | 로컬 통과 |
| 단위 테스트 | `npm test -- --reporter=dot` | 고정 개수는 기록하지 않고 현재 worktree에서 명령 실행 결과를 authoritative evidence로 사용 |
| 브라우저 번들 | `npm run build` | 로컬 통과, Vite production bundle 생성 |
| 브라우저 기능 smoke | `npm run test:browser`·`npm run test:browser:persistence` (Chrome 필요) | 로컬 Chrome CDP 및 CI `browser-smoke` job에서 개발 서버와 production preview(`/api` proxy 포함)의 정상 후보 흐름·결과 바로가기 5개와 lazy 대상 포커스·모달 초기 포커스·Tab 순환·Esc 닫기·API 실패 복구·390px overflow·임시 저장/공유/선택 이유 저장·owner metadata 수정·공유 견적 owner 없는 복제·후보 scenario 공유 링크 두 번째 탭 복원·공개 owner credential 경계·후보 scenario 버전 lineage·다중 탭 이력 sync·구매 단계 selector/itemStates·다음 구매 행동 센터·단계별 revision diff·구매 진행률/가격 이력 동시 저장 충돌·복원·검색/필터 통과 |
| production container | GitHub Actions `container-smoke` job | runner Docker에서 compose build·PostgreSQL healthcheck·production health/meta 응답 확인; 로컬 daemon 미실행으로 이 import에서는 image runtime을 직접 주장하지 않음 |
| 개발 API | `npm run dev` 또는 `npm run start` 후 `/api/health` | 이 import 단계에서는 별도 장기 실행 근거로 주장하지 않음 |
| seed-only API·호환성 | `npm run test:seed` (빈 임시 `PC_SUPPORTER_DATA_DIR`에서 서버를 띄움) | 외부 수집·기존 `data/` 없이 starter 핵심/주변 부품 materialize, 메타·목록·호환성 차단·안전 대체 후보·자동 구성 API와 fallback 파일 생성 검증 |
| 시각·상호작용 | 브라우저/화면 QA | `design-qa.md`의 기준은 추적하지만 공개 import만으로 새 캡처 성공을 주장하지 않음 |
| PostgreSQL 경로 | GitHub Actions `container-smoke`의 `test:postgres:comparison` | production compose의 `storageMode=postgres`를 확인한 뒤 후보 비교 저장·재조회·공개 credential 경계·owner 삭제 round-trip을 검증 |
| 외부 수집 | `npm run crawl:dry` 이후 제한된 crawl | 네트워크·이용 조건·최신 데이터 근거와 별도 |
| 배포·실서비스 | 호스팅/도메인/운영 환경 | 이 저장소 import의 완료 조건 아님 |

결과 화면의 심각도 필터는 `?finding=...` query와 `#findings`·`#purchase-list` 등 section hash로 직렬화한다. 서버 모니터 알림에서 전달된 `findingRule`은 별도 일회성 deep-link 상태로 파싱하며, 허용된 rule id만 저장 견적 공유 route의 재검사 후 해당 finding 카드 포커스에 사용한다. 브라우저 smoke는 카드 선택 후 URL 생성, 새로고침 복원, 주의 필터 전환, navigation history 뒤로 가기 후 차단 필터 복원과 alert/deep-link finding 포커스를 함께 확인한다.

결과 텍스트·JSON export는 현재 허용된 결과 viewState를 optional metadata로 함께 기록하며, `결과 링크 복사`는 owner credential 없이 재현 가능한 상대 경로만 복사한다. 후보가 있는 텍스트 report에는 후보 위험·가상 적용 후 잔여 위험·확인 근거·물리 근거 상태를 포함하고, 선택 CPU·GPU의 benchmark 원점수·완성도·출처가 확인되면 이를 함께 기록하고, 게이밍 GPU 대체 후보가 있으면 선택 해상도·주사율·권장 VRAM·현재/후보 충족 상태도 후보 아래 근거로 기록한다. 자동 해결 플랜이 있는 경우 플랜별 변경 부품·해결 범위·잔여 finding과 rule id·가격/예산 근거를 포함해 화면의 결정 근거를 축약하지 않는다. legacy report envelope는 viewState가 없어도 기존 구조로 소비할 수 있다.

저장 견적 공유도 현재 URL의 허용된 필터·섹션 suffix를 `/share/:id`에 붙여, 공유받은 사용자가 저장 견적을 현재 카탈로그 기준으로 재검사한 뒤 같은 결과 범위로 진입하게 한다. 이 suffix는 서버 저장 snapshot과 별도로 관리한다.

공유 결과에는 저장 당시 snapshot과 현재 재검사의 차이를 설명하는 lazy 비교 패널을 표시한다. 이 패널은 상위 판정·위험·가격·성능 분석·카탈로그/엔진 기준을 비교하고, 변화가 있을 때만 재확인 경고를 내며 상세 판정과 검사 타임라인으로 이동시킨다. 분석 점수·label·신뢰도 변화는 benchmark 또는 분석 기준 변화 신호로 분리한다. 원문 재확인 report가 snapshot에 있으면 성공 대상별 가격·품질·누락 수와 제한된 `valueDiffs`를 보여주고, 대상 부품 ID와 현재 finding 영향 부품 ID가 겹치는 경우에만 `현재 finding` 연결을 제공한다. 이 연결은 관측된 영향 가능성이지 원문 변경의 인과관계 확정이 아니다. benchmark snapshot이 있는 후보는 현재 카탈로그와 점수별 값을 대조해 동일·변경·현재 점수 없음·부분 근거·재확인 필요를 구분하며, 출처·benchmark 자료 갱신 시각 차이도 별도 신호로 보존한다. 서버 snapshot 자체에는 화면 위치나 viewState를 저장하지 않는다. 가격 변경에는 구매 목록, 스펙·품질·누락 변경에는 현재 판정으로 이동하는 바로가기를 제공하고 URL hash와 focus를 함께 갱신한다.

저장 견적 결과 export에도 최신 저장 snapshot이 있을 때 같은 diff·transition과 규칙별 finding 변화를 optional 구조로 붙인다. 성능 분석 점수·label·신뢰도 변화도 diff와 transition에 포함해 benchmark 보강을 별도 변화로 추적한다. 텍스트는 변경 finding을 제한된 수로 요약하고 JSON은 snapshot·diff·transition을 보존하며, snapshot이 없는 legacy 결과는 기존 export 형식을 유지한다.

변경된 finding이 있으면 현재 재검사 결과의 후보를 기존 엔진 순서가 아닌 잔여 위험·후보 안전성·추천 근거·유사도·가성비의 동일한 순수 모델로 다시 정렬해 우선 검토 후보를 표시한다. 안전 경계가 `적용 보류`인 후보에는 가상 적용 버튼을 노출하지 않고, 검토 후보는 기존 상세 finding 카드의 근거와 최종 재검사 흐름으로 이동시킨다.

각 변경 finding에는 현재 결과의 수리 전략별 연결 상태도 표시한다. `remainingFindingRuleIds`를 최신 근거로 사용하고, legacy 플랜에는 해결·잔여 finding 제목을 fallback으로 적용한다. 연결 정보가 없는 경우에는 `근거 확인 필요`로 남겨 전략이 해당 finding을 해결한다고 과장하지 않으며, 연결된 변경 부품·잔여 차단 수·가격 변화와 함께 상세 수리 플랜으로 이동할 수 있게 한다.

정적·단위·번들 통과는 소스 snapshot의 건강성을 보여주지만, 실제 가격 최신성·다나와 재배포 권리·브라우저 장기 세션·PostgreSQL 운영·실제 조립·서비스 배포를 의미하지 않습니다.

## 이후 개발 순서

1. 공개 저장소 CI가 동일한 typecheck/test/build와 `npm run test:seed`를 재실행하는지 확인합니다.
2. 다나와 수집 결과를 공개할지, 사설 데이터 디렉터리와 샘플 export만 제공할지 이용 조건을 확인합니다.
3. PostgreSQL backend와 파일 fallback 각각의 저장·lease·재시작 복구 테스트를 분리합니다. production Compose에서는 `npm run test:postgres:comparison`으로 후보 비교를, `npm run test:postgres:saved-build`로 선택 이유·구매 진행률·가격 확인 이력의 revision/history round-trip을 검증합니다.
4. 실제 브라우저에서 견적 입력 → finding → 후보 미리보기 → 저장/공유 → 현재 재검사 흐름을 캡처하고, 정적 테스트와 별도 증거로 기록합니다.
5. 공개 릴리스에서는 최신 catalog freshness, API rate limit, 관리자 인증 secret, 로그/개인 데이터 보존 정책을 운영 환경 기준으로 다시 검토합니다.

## 변경을 읽는 방법

작은 변경이라도 다음 순서로 리뷰합니다.

1. 변경된 데이터 계약과 producer/consumer를 확인합니다.
2. finding·가격·신뢰도·실제 조립 중 어느 증거 층을 바꾸는지 표시합니다.
3. 관련 단위 테스트와 typecheck/build를 실행합니다.
4. UI 동작이나 외부 수집을 주장할 때는 브라우저/네트워크 증거를 별도로 붙입니다.
5. `data/`와 secret 경계를 확인한 뒤에만 commit/PR 범위를 확정합니다.
