# PC Supporter 모바일 UI 화면 기준

## 공통 기준

- 기준 viewport: 390 x 844
- 시각 언어: warm ivory canvas, ink navy typography, cobalt primary action, green success, restrained terracotta warning
- 공통 셸: compact sticky app bar, safe-area spacing, `검사 / 카탈로그 / 저장 / 더보기` bottom navigation
- 원칙: 한 화면에 하나의 다음 행동만 우선 표시하고, 근거·설정·export는 접힌 영역이나 다음 단계로 이동
- 기능 계약: 기존 API, localStorage/sessionStorage, URL route, 호환성 판정, 저장·공유 owner boundary를 변경하지 않음

## 화면 기준과 구현 매핑

| 화면 | 주요 사용자 행동 | 시안 기준 | 구현 surface |
| --- | --- | --- | --- |
| 홈 / 검사 | 새 견적 시작·현재 구성 재개 | `/Users/kimminkyu/.codex/generated_images/01a089d3-763d-7330-938e-5dcf5f11911b/exec-39cf2e95-5a6d-4085-b766-9c0f7ff308f6.png` | `MobileHomeView`, `AppHeader` |
| 견적 구성 | 부품 행을 탭해 선택·검사 | `/Users/kimminkyu/.codex/generated_images/01a089d3-763d-7330-938e-5dcf5f11911b/exec-50bc7466-35be-4a88-92c5-009ae573c662.png` | `MobileEditorSurface`, `PartPicker` |
| 호환성 결과 | 위험 요약·우선 조치·finding 확인 | `/Users/kimminkyu/.codex/generated_images/01a089d3-763d-7330-938e-5dcf5f11911b/exec-43e86db5-5e56-4553-827c-1533100cb84c.png` | `ResultView`, `mobile-result-metric-strip` |
| 부품 카탈로그 | 검색·범주 선택·후보 추가 | `/Users/kimminkyu/.codex/generated_images/01a089d3-763d-7330-938e-5dcf5f11911b/exec-f185e65a-26a9-45fa-8f77-aadc4d6b1654.png` | `CatalogView`, `mobile-catalog-category-chips` |
| 자동 구성 | 자연어 조건·프리셋·예산으로 생성 | `/Users/kimminkyu/.codex/generated_images/01a089d3-763d-7330-938e-5dcf5f11911b/exec-464f56ed-7c76-44a3-b55e-ce0e6a5eaf43.png` | `BuildGeneratorView`, mobile generator overrides |
| 가격 추적 | 현재가·목표가·구매 판단 | `/Users/kimminkyu/.codex/generated_images/01a089d3-763d-7330-938e-5dcf5f11911b/exec-224c6774-9afb-4dc2-b25b-4bb9c442d938.png` | `PriceWatchlistView`, `mobile-price-watch-summary` |
| 저장 견적 | 저장 목록 재개·비교 | `/Users/kimminkyu/.codex/generated_images/01a089d3-763d-7330-938e-5dcf5f11911b/exec-8cab6fd7-ae69-40a8-89ac-182cbd6736ff.png` | `HistoryView`, mobile history ordering |
| 주변 부품 | 현재 구성에 주변 부품 추가 | `/Users/kimminkyu/.codex/generated_images/01a089d3-763d-7330-938e-5dcf5f11911b/exec-c3055459-8cec-499f-a337-6d1c690f6497.png` | `AccessoryView`, accessory mobile styles |
| 데이터 센터 | 수집·스펙·성능 근거 우선 확인 | `/Users/kimminkyu/.codex/generated_images/01a089d3-763d-7330-938e-5dcf5f11911b/exec-1cf1ad7d-9fe4-458a-8f06-8ded7c0dfa68.png` | `AdminView`, admin mobile styles |
| 공유 후보 비교 | 읽기 전용 후보 비교·내 구성으로 가져오기 | `/Users/kimminkyu/.codex/generated_images/01a089d3-763d-7330-938e-5dcf5f11911b/exec-92d37439-7c40-41aa-ac56-82e5813f6806.png` | `SharedAlternativeComparisonView` |
| 공유 가격 추적 | 공유 가격 snapshot 확인·내 목록에 추가 | `/Users/kimminkyu/.codex/generated_images/01a089d3-763d-7330-938e-5dcf5f11911b/exec-2ab82dd9-fc15-4240-ad56-6cfaefddb0b3.png` | `SharedWatchlistView` |
| 공유 예산 비교 | 구간별 비용·위험·확장성 비교 | `/Users/kimminkyu/.codex/generated_images/01a089d3-763d-7330-938e-5dcf5f11911b/exec-e7fab5d5-030b-4328-8f6e-09edbd466999.png` | `SharedBudgetLadderView` |
| 공유 버전 비교 | v1→v2 변경·위험 변화 확인 | `/Users/kimminkyu/.codex/generated_images/01a089d3-763d-7330-938e-5dcf5f11911b/exec-c3403bb3-5919-445c-9f76-f29f6cd2261f.png` | `SharedSavedBuildVersionView` |

## 완료 기준

- 모든 user-facing route가 390px에서 body/document horizontal overflow 없이 표시된다.
- 핵심 CTA·탭·필터·선택 행·바텀시트·공유 읽기 전용 경계가 실제 기존 handler를 호출한다.
- loading, empty, error, success, warning 상태가 같은 토큰과 레이아웃 규칙으로 표현된다.
- 시안과 같은 순서로 첫 화면의 primary action이 노출되며, 부가 기능은 상세/더보기 영역으로 밀린다.
- `npm run typecheck`, `npm test`, `npm run build`, `git diff --check`, 390px browser/CUA 검증 결과를 `design-qa.md`에 기록한다.

## 최신 검증 메모 (2026-09-10)

- 기본 user-facing route와 공유 읽기 전용 오류 경계를 390 x 844 연결 브라우저에서 재확인했다.
- 결과 화면 구매 목록은 모바일에서 메타데이터·근거 배지·상세·가격 추적 액션이 줄바꿈되도록 보정했으며, 390px/320px에서 의도하지 않은 viewport overflow가 없다.
- 공유 성공 snapshot은 임의 ID를 만들지 않고 검증하지 않았다. 공유 route의 read-only 오류/로딩 경계와 모바일 shell만 확인하며, 실제 snapshot 검증은 기존 persistence/browser lane의 fixture가 담당한다.

## 최신 개선 메모 (2026-09-11)

- 헤더 lazy chunk가 준비되는 동안에도 모바일 앱바·하단 네비게이션 실루엣을 유지하는 `AppHeaderLoadingFallback`을 추가했다. fallback은 aria-hidden 상태의 시각적 loading surface이며, 실제 상호작용은 기존 `AppHeader`가 로드된 뒤 담당한다.
- 헤더 chunk를 의도적으로 차단한 focused CDP probe에서도 전체 recovery boundary로 확장되지 않고 fallback header·모바일 네비게이션·홈 본문을 유지했다. 즉, lazy chunk 대기와 로드 실패가 모두 화면 전체를 잃게 만들지 않는다.
- cross-tab draft notice의 동적 요약 문장을 조사 가능한 형태로 정리해 `9개 범주을` 같은 조사 결합 오류를 제거했다.
- 390 x 844 fresh CUA에서 홈의 오류 시연 견적 → 편집기 → 호환성 결과를 재확인했다. 결과에는 10개 finding이 표시되고, body/document 폭은 390px이며, 44px 미만의 보이는 버튼·링크·선택 컨트롤은 확인되지 않았다.
- 저장 견적 화면의 전체 조작 요소도 별도 측정해 알림·우선순위·구매 상태 필터와 카드 액션의 폭·높이를 44px 이상으로 맞췄다. 네이티브 체크박스 자체는 작지만 라벨 전체가 조작 영역을 감싼다.
- 최신 `npm run test:browser`는 전체 flow와 route-history manifest 6개를 통과했다. mobile assertion은 `innerWidth=390`, body/document `375`(스크롤바 포함)로 기록됐고, `/home`, `/build`, `/catalog`, `/recommend`, `/admin`의 의도하지 않은 가로 overflow가 없었다. focused CUA의 demo hydration과 함께 시각·기능 smoke를 모두 현재 코드 기준으로 재확인했다.
