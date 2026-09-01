# PC Supporter 개발 과정과 저장소 분류

## 문서의 범위

이 문서는 2026-09-02 현재의 `pc-supporter` 구현을 공개 저장소에 옮기면서, 기능·의존성·검증 근거를 한눈에 볼 수 있도록 정리한 현재 상태 문서입니다.

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
| 결정적 기본 데이터 | 외부 데이터가 없어도 실행 가능한 최소 부품 집합 | `server/seed-catalog.ts` | 추적 |
| 카탈로그 수집 | 다나와 목록·상세 수집, 정규화, merge, coverage와 변경 기록 | `server/danawa.ts`, `server/crawler.ts`, `server/accessory-crawler.ts`, `server/catalog.ts`, `server/accessories.ts` | 코드만 추적; 수집 결과 JSON 제외 |
| 호환성 엔진 | 소켓·메모리·저장장치·PCIe·장착·전력·RGB/팬·물리 근거 및 설명 가능한 finding | `server/engine.ts`, `server/*review*`, `shared/*` | 추적 |
| 후보·수리·예산 | 안전/확인 필요/차단 후보, 비파괴 가상 적용, 수리 플랜, 예산 ladder와 value score | `server/alternative-*.ts`, `shared/candidate-*`, `shared/repair-*`, `shared/budget-*` | 추적 |
| 저장·공유·이력 | 파일/PostgreSQL fallback, 저장 견적, 비교·관심 목록, check history, version migration | `server/repository.ts`, `server/storage.ts`, `server/*share*`, `server/*monitor*` | 코드·스키마 추적; 로컬 JSON 제외 |
| 실제 조립·센서 근거 | HWiNFO/OCCT CSV, 부하 구간·안정화·추세 overlay, GPU/케이스/PSU 제조사 근거 | `shared/assembly-*`, `shared/gpu-*`, `server/physical-*` | 코드와 문서만 추적; 사용자 기록 제외 |
| API·운영 | Express endpoint, rate limit, ETag, admin auth, 크롤링/검수 endpoint | `server/index.ts`, `server/auth.ts`, `server/rate-limit.ts` | 추적 |
| 브라우저 UI | 견적 편집, 결과·후보·수리·구매·관리자·공유 화면, lazy chunk 경계 | `src/*`, `index.html`, `vite.config.ts` | 추적 |
| 검증·디자인 | 단위 테스트, 디자인 QA 기록, CI 실행 계약 | `server/*.test.ts`, `shared/*.test.ts`, `src/*.test.ts`, `design-qa.md`, `.github/` | 추적; 화면 캡처·번들 제외 |

## 의존성 순서로 본 개발 단계

### 1. 기반 계약과 seed 실행점

`shared/types.ts`가 서버와 브라우저 사이의 부품, 액세서리, 견적, finding, snapshot, 검증 이력 계약을 정의합니다. `server/seed-catalog.ts`는 외부 수집이 실패하거나 데이터 디렉터리가 비어 있어도 엔진과 화면을 재현할 수 있는 최소 카탈로그입니다.

이 단계에서 보장하는 것:

- 카테고리·유통 조건·가격 미확인·데이터 품질을 명시적으로 구분
- 저장·공유 결과의 fingerprint로 오래된 검사 결과를 최신 결과처럼 열지 않음
- 테스트가 외부 HTTP나 개인 데이터에 의존하지 않는 도메인 fixture를 사용

### 2. 카탈로그와 데이터 신뢰도

수집기는 목록에서 상품 식별자와 이름을 확보하고, 상세 페이지를 보강한 뒤 단위·소켓·규격을 표준화합니다. `mergeCatalog`·`mergeAccessories`는 더 불완전한 refresh가 이미 검증된 데이터를 덮어쓰지 않도록 품질 순위를 비교합니다.

화면과 API는 제품 수만 표시하지 않고 다음 경계를 함께 보존합니다.

- 목록 coverage와 저장된 상세 스펙 completeness
- live/seed/manual/incomplete 품질
- 가격 확인 여부와 데이터 freshness
- 변경 로그와 해당 변경이 특정 규칙에 영향을 줄 수 있는지의 mapping

실제 수집 JSON과 crawl state는 공개 import에서 제외합니다. 공개 checkout은 seed로 시작하고, 로컬 운영자는 `PC_SUPPORTER_DATA_DIR`로 사설 데이터를 분리할 수 있습니다. 다나와 데이터의 이용·재배포 조건은 코드 테스트 통과와 별도의 검토 항목입니다.

### 3. 설명 가능한 호환성 엔진

`server/engine.ts`는 견적을 규칙별로 평가하고, 각 finding에 심각도·영향 부품·판정 사실·다음 행동을 붙입니다. 주요 규칙 표면은 다음과 같습니다.

- CPU/메인보드 socket과 CPU 전력·쿨러 용량
- RAM 세대·DIMM/SO-DIMM·용량·속도·슬롯
- M.2 form factor·NVMe/SATA·PCIe generation·lane sharing
- GPU 길이·두께·슬롯·전력·보조전원과 PSU 커넥터
- 케이스의 GPU/쿨러/PSU 물리 여유와 메인보드 form factor
- 케이스 팬/RGB와 메인보드 헤더·전압·전류 여유
- 데이터가 부족할 때의 `확인 필요`와 제조사 원문 근거 경계

PCIe 세대처럼 물리 호환과 성능 경고가 분리되는 영역은 무조건 불호환으로 올리지 않습니다. 반대로 물리값이나 제조사 근거가 없으면 자동 통과로 승격하지 않습니다.

### 4. 후보·수리·구매 의사결정

후보 탐색은 빠른 범위 추천과 전체 후보 정밀 탐색을 분리합니다. 정밀 탐색은 후보를 실제 견적에 비파괴적으로 대입해 전체 finding·가격·데이터 품질을 다시 계산합니다.

- 안전·확인 필요 후보는 비교와 미리보기 후 사용자가 적용
- 차단 후보는 카드에 이유를 보여주되 가상/실제 적용 모두 차단
- 하나의 finding에 여러 교체 범주가 있으면 범주별 후보 대표성을 보장
- 수리 플랜은 해결한 finding, 남은 finding, 가격 변화, 성능·유사도·근거를 함께 제시
- 구매 준비도는 호환성·가격·데이터 신뢰도·장착·전력·예산 gate를 분리

### 5. 저장·공유·현재 재검사

파일 저장은 개발 환경의 기본 backend이고, `DATABASE_URL`이 설정되고 PostgreSQL이 준비되면 저장·lease·catalog persistence가 PostgreSQL로 전환됩니다. DB가 불가능하면 파일 backend로 fallback하되 `persistenceDiagnostics`에 그 상태를 노출합니다.

저장 견적·예산 ladder·비교·관심 목록에는 만료·owner token·공개 응답 경계를 둡니다. 저장 당시 snapshot과 현재 catalog 재검사는 별도 행으로 비교하며, catalog 변경 로그는 선택한 부품과 검사 시각이 동시에 맞는 경우에만 원인 후보로 표시합니다. 원인 로그가 없을 때는 카탈로그 변경으로 단정하지 않습니다.

### 6. 실제 조립·센서 증거

호환성 판정은 실제 조립 성공을 대신하지 않습니다. 조립 로그는 POST, BIOS, 메모리 프로파일, 저장장치, GPU 출력, 팬/RGB를 pass/fail/unconfirmed로 기록합니다. HWiNFO·OCCT CSV는 미리보기와 품질 카드를 통과한 뒤 최대 240개 시계열 포인트로 압축됩니다.

추세 비교는 도구·시나리오·테스트 시간과 구간 종류가 같은 회차에서만 delta를 계산합니다. timestamp 공백·역순·안정화 샘플 부족은 `확인 필요`로 남기며, 센서 값이 있다고 해서 안전이나 고장을 자동 확정하지 않습니다.

### 7. UI와 운영 패널

Vite가 브라우저 번들을 만들고 React 화면이 API 계약을 소비합니다. 초기 편집기 shell과 관리자·후보·가격 추적·공유·비교 화면은 lazy chunk로 분리되어, 운영 패널을 사용하지 않는 첫 화면의 로딩 경계를 유지합니다. 관리자 저장 작업은 auth·rate limit·source URL 검증·재조회로 보호됩니다.

## 공개 저장소에 포함하는 것과 제외하는 것

### 추적하는 것

- TypeScript 서버·도메인·React UI와 해당 단위 테스트
- `package.json`, lockfile, TypeScript/Vite 설정
- DB schema와 Docker Compose 개발 보조 설정
- `.env.example`의 빈 설정 이름과 기본값
- seed catalog, API/구조 설명, 디자인 QA 기준, CI/PR 규칙

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
| 단위 테스트 | `npm test -- --reporter=dot` | 118 files / 696 tests 통과 |
| 브라우저 번들 | `npm run build` | 로컬 통과, Vite production bundle 생성 |
| 개발 API | `npm run dev` 또는 `npm run start` 후 `/api/health` | 이 import 단계에서는 별도 장기 실행 근거로 주장하지 않음 |
| 시각·상호작용 | 브라우저/화면 QA | `design-qa.md`의 기준은 추적하지만 공개 import만으로 새 캡처 성공을 주장하지 않음 |
| PostgreSQL 경로 | `docker compose up` 후 DB 환경 설정 | 선택 backend이며 CI 기본 검증에는 포함하지 않음 |
| 외부 수집 | `npm run crawl:dry` 이후 제한된 crawl | 네트워크·이용 조건·최신 데이터 근거와 별도 |
| 배포·실서비스 | 호스팅/도메인/운영 환경 | 이 저장소 import의 완료 조건 아님 |

정적·단위·번들 통과는 소스 snapshot의 건강성을 보여주지만, 실제 가격 최신성·다나와 재배포 권리·브라우저 장기 세션·PostgreSQL 운영·실제 조립·서비스 배포를 의미하지 않습니다.

## 이후 개발 순서

1. 공개 저장소 CI가 동일한 typecheck/test/build를 재실행하는지 확인합니다.
2. seed-only checkout의 `/api/health`와 핵심 호환성 한 건을 로컬 smoke test로 고정합니다.
3. 다나와 수집 결과를 공개할지, 사설 데이터 디렉터리와 샘플 export만 제공할지 이용 조건을 확인합니다.
4. PostgreSQL backend와 파일 fallback 각각의 저장·lease·재시작 복구 테스트를 분리합니다.
5. 실제 브라우저에서 견적 입력 → finding → 후보 미리보기 → 저장/공유 → 현재 재검사 흐름을 캡처하고, 정적 테스트와 별도 증거로 기록합니다.
6. 공개 릴리스에서는 최신 catalog freshness, API rate limit, 관리자 인증 secret, 로그/개인 데이터 보존 정책을 운영 환경 기준으로 다시 검토합니다.

## 변경을 읽는 방법

작은 변경이라도 다음 순서로 리뷰합니다.

1. 변경된 데이터 계약과 producer/consumer를 확인합니다.
2. finding·가격·신뢰도·실제 조립 중 어느 증거 층을 바꾸는지 표시합니다.
3. 관련 단위 테스트와 typecheck/build를 실행합니다.
4. UI 동작이나 외부 수집을 주장할 때는 브라우저/네트워크 증거를 별도로 붙입니다.
5. `data/`와 secret 경계를 확인한 뒤에만 commit/PR 범위를 확정합니다.
