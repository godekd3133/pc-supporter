# 인게이지먼트 루프 명세

## 목적

첫 실행 유저가 "견적 생성 → 저장 → 다음 견적 → 비교 → 가격 추이/추적" 순환을 자연스럽게
경험하도록, 기존 기능(저장 견적·비교·가격 추적·가격 추이)을 하나의 여정으로 연결한다.
각 단계 전환은 익명 사용 이벤트로 계측하고 관리자 통계에서 루프 전환율을 확인한다.

## 여정 단계 (Journey Milestones)

`src/user-journey.ts`가 로컬 상태로부터 유저의 여정 진행을 계산한다. 핵심 루프는
**견적 만들기 → 가격 추적 등록 → 가격 추이 확인 → 다시 견적 만들기**의 3단계 순환이다.

| 단계 | id | 완료 조건 | 다음 행동 CTA |
|------|----|-----------|----------------|
| 1 | `first_build` | 호환 결과 또는 저장 견적 존재 | 새 견적 시작 → `/start`, 초안 있으면 이어서 → `/build` |
| 2 | `watching` | 가격 추적 항목 ≥ 1 | 가격 추적 시작 → `/watchlist` |
| 3 | `trend` | 가격 추이 조회 플래그 기록됨 | 가격 추이 보기 → `/result` 추이 패널 |
| — | `loop` | 세 단계 모두 완료 | 루프 재시작: 새 견적 만들기 → `/start` |

완료 조건이 실제 데이터(저장 견적 수·워치리스트 수)로 판정되는 단계는 플래그 없이
즉시 반영하고, 행위 기반 단계(`trend`)만 localStorage 플래그를 쓴다.
플래그 키: `pc-supporter-engagement-flags` (`{ comparedAt?, trendViewedAt? }`).

## UI 접점

### 홈 — `HomeJourneyPanel` (HomeView)
- 데스크톱: hero 아래, 알림 위에 가로 스테퍼 카드. 완료 단계 체크, 다음 단계 CTA 버튼.
- 모바일: `mobile-next-steps` 아래에 컴팩트 리스트 버전.
- CTA 클릭 시 `next_step_click` 이벤트 (`props.step`, `props.surface="home"`).

### 결과 — `ResultNextSteps` (ResultView)
- 호환 결과 hero 아래에 "다음에 해볼 것" 스트립.
- 상태에 따라 최대 3개 CTA: 견적 저장(미저장 시), 가격 추적 시작, 가격 추이 보기
  (패널로 스크롤), 새 견적 만들기, 저장 견적 비교.
- `props.surface="result"`로 `next_step_click` 계측.

## 신규 이벤트

`CLIENT_USAGE_EVENT_NAMES`(클라이언트·서버 동일 화이트리스트)에 추가:

| 이벤트 | 발생 지점 | props |
|--------|-----------|-------|
| `saved_build_open` | App.openSavedBuild 성공 | `from` = history |
| `build_compare` | HistoryView에서 비교 대상 ≥2 선택 | `count` |
| `watchlist_add` | App.watchCatalogEntry 신규 등록 | `kind` = part/accessory |
| `price_trend_view` | BuildPriceTrendPanel 데이터 표시 | `surface` = result |
| `next_step_click` | 여정/다음 단계 CTA | `step`, `surface` |

`build_save`·`share_link` 등 기존 이벤트는 유지. 저장 직후 자동 재열람은
`saved_build_open`에서 제외해(저장 동작 자체와 중복 계수 방지) `options.track`으로 구분한다.

## 서버 집계 확장 (`server/usage-events.ts`)

- 퍼널 단계 `saved`와 `shared` 사이에 `engaged`(재참여 활동: `saved_build_open` |
  `build_compare` | `watchlist_add` | `price_trend_view`) 단계 삽입.
- 응답에 `loop` 블록 추가:
  - `returningVisitors` / `returningRate`: 활동일 ≥ 2인 방문자
  - `multiQuoteVisitors`: recommend_success ≥ 2 방문자
  - `savedBuildOpenVisitors`, `compareVisitors`, `watchlistVisitors`, `trendVisitors`
  - `saversTotal`: build_save 방문자 수 (루프 전환 분모)
  - `nextStepClicks`: `next_step_click`을 `step`별로 집계한 표
  - `saverReactivation`: 저장자 중 재참여 활동을 한 비율

## 관리자 화면 (`AdminUsageAnalyticsPanel`)

- 요약 카드에 재방문율 추가.
- "재참여 루프" 블록: 저장자 → 다시 열기/비교/가격 추적/추이 조회 전환 막대 표.
- "다음 단계 클릭" 표: step별 클릭 수.
- 일별 추이 CSV보내기 버튼.

## 검증

- `src/user-journey.test.ts`: 단계 판정·다음 CTA 선택 단위 테스트.
- `server/usage-events.test.ts`: 신규 이벤트 수용·퍼널·loop 집계 테스트.
- 브라우저 스크린샷: 홈 여정 카드(신규/진행 상태), 결과 다음 단계 스트립, 관리자 루프 블록.
