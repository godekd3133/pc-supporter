# Guided Quote Onboarding · Sequential Capture

현재 구현된 첫 사용자 견적 흐름을 실제 CTA 순서대로 재생해 캡처한 화면 산출물입니다.

생성 명령:

```bash
npm run capture:quote-onboarding
```

캡처 기준:

- Desktop: `1280 × 900`
- Mobile: `390 × 844`
- 대표 경로: `사이버펑크 2077 → 4K → 144 FPS → 높음 → DLSS·품질 참고 → 500만원`
- 화면 캡처와 함께 [manifest.json](../artifacts/quote-onboarding/manifest.json)에 생성 시각·viewport·route를 기록합니다.
- 전체 화면을 한 장에서 비교하려면 [flow-board.html](quote-onboarding-flow-board.html)을 엽니다.

## Desktop sequence

### 01 · 첫 사용자 홈

`START HERE` guided quote preview와 `새 견적 시작하기` CTA입니다.

![Desktop 01 · 첫 사용자 홈](../artifacts/quote-onboarding/desktop-01-home-guided.png)

### 02 · 시작 선택

새 견적·기존 PC 업그레이드·나중에 선택 화면입니다.

![Desktop 02 · 시작 선택](../artifacts/quote-onboarding/desktop-02-start-intent.png)

### 03 · 새 견적 방식

예산·작업/게임·직접 알고 있는 성능 중 하나를 선택합니다.

![Desktop 03 · 새 견적 방식](../artifacts/quote-onboarding/desktop-03-new-quote.png)

### 04 · 용도 선택

게임 또는 작업 분기로 들어갑니다.

![Desktop 04 · 용도 선택](../artifacts/quote-onboarding/desktop-04-usecase.png)

### 05 · 게임 목표 성능

게임을 고른 뒤 FHD/QHD/4K와 60/144/240 FPS 목표를 정합니다.

![Desktop 05 · 게임 목표 성능](../artifacts/quote-onboarding/desktop-05-game-performance.png)

### 06 · 그래픽 옵션 계약

그래픽 품질·업스케일링·레이 트레이싱과 평균 FPS 목표·참고 가격대를 함께 확인합니다.

![Desktop 06 · 그래픽 옵션 계약](../artifacts/quote-onboarding/desktop-06-graphics-contract.png)

### 07 · 예산·예상 사양

선택한 예산, 권장 가격 범위, 해당 금액에서 예상되는 성능·GPU·RAM·SSD를 보여줍니다.

![Desktop 07 · 예산·예상 사양](../artifacts/quote-onboarding/desktop-07-budget-range.png)

### 08 · 조건 요약

조건별 `변경` CTA를 제공하는 최종 확인 화면입니다.

![Desktop 08 · 조건 요약](../artifacts/quote-onboarding/desktop-08-summary.png)

### 09 · 자동 구성 결과

실제 부품 조합과 `GAME PERFORMANCE EVIDENCE`·exact-condition coverage를 확인합니다.

![Desktop 09 · 자동 구성 결과](../artifacts/quote-onboarding/desktop-09-generator-result.png)

## Mobile sequence

같은 흐름을 `390 × 844`에서 재생한 결과입니다. 모바일 홈에서도 먼저 guided quote를 보여주고, 하단 CTA로 `/start`에 진입합니다.

![Mobile 01 · 첫 사용자 홈](../artifacts/quote-onboarding/mobile-01-home-guided.png)

![Mobile 02 · 시작 선택](../artifacts/quote-onboarding/mobile-02-start-intent.png)

![Mobile 03 · 새 견적 방식](../artifacts/quote-onboarding/mobile-03-new-quote.png)

![Mobile 04 · 용도 선택](../artifacts/quote-onboarding/mobile-04-usecase.png)

![Mobile 05 · 게임 목표 성능](../artifacts/quote-onboarding/mobile-05-game-performance.png)

![Mobile 06 · 그래픽 옵션 계약](../artifacts/quote-onboarding/mobile-06-graphics-contract.png)

![Mobile 07 · 예산·예상 사양](../artifacts/quote-onboarding/mobile-07-budget-range.png)

![Mobile 08 · 조건 요약](../artifacts/quote-onboarding/mobile-08-summary.png)

![Mobile 09 · 자동 구성 결과](../artifacts/quote-onboarding/mobile-09-generator-result.png)

## Representative branches

공통 게임 경로 외의 대표 분기도 같은 캡처 러너로 재생했습니다. 아래 파일은 Desktop/Mobile 각각 생성됩니다.

### 작업 · 영상 편집

`작업 선택 → 작업 강도 → 300만원 예산 → 조건 요약 → WORK TARGET 결과`

- [Desktop 작업 선택](../artifacts/quote-onboarding/desktop-work-01-work-select.png)
- [Desktop 작업 강도](../artifacts/quote-onboarding/desktop-work-02-intensity.png)
- [Desktop 작업 예산](../artifacts/quote-onboarding/desktop-work-03-budget.png)
- [Desktop 작업 요약](../artifacts/quote-onboarding/desktop-work-04-summary.png)
- [Desktop 작업 결과](../artifacts/quote-onboarding/desktop-work-05-result.png)
- [Mobile 작업 선택](../artifacts/quote-onboarding/mobile-work-01-work-select.png)
- [Mobile 작업 강도](../artifacts/quote-onboarding/mobile-work-02-intensity.png)
- [Mobile 작업 예산](../artifacts/quote-onboarding/mobile-work-03-budget.png)
- [Mobile 작업 요약](../artifacts/quote-onboarding/mobile-work-04-summary.png)
- [Mobile 작업 결과](../artifacts/quote-onboarding/mobile-work-05-result.png)

### 예산-only

`예산으로 맞출래요 → 400만원 → GENERAL TARGET · 예산 중심 구성`

- [Desktop 예산 화면](../artifacts/quote-onboarding/desktop-budget-01-budget.png)
- [Desktop 예산 요약](../artifacts/quote-onboarding/desktop-budget-02-summary.png)
- [Desktop 예산 결과](../artifacts/quote-onboarding/desktop-budget-03-result.png)
- [Mobile 예산 화면](../artifacts/quote-onboarding/mobile-budget-01-budget.png)
- [Mobile 예산 요약](../artifacts/quote-onboarding/mobile-budget-02-summary.png)
- [Mobile 예산 결과](../artifacts/quote-onboarding/mobile-budget-03-result.png)

### 직접 성능 입력

`생각해둔 성능이 있어요 → 최상급 → 외장 GPU · 64GB · 2TB → GENERAL TARGET 결과`

- [Desktop 직접 성능](../artifacts/quote-onboarding/desktop-spec-01-spec.png)
- [Desktop 직접 성능 요약](../artifacts/quote-onboarding/desktop-spec-02-summary.png)
- [Desktop 직접 성능 결과](../artifacts/quote-onboarding/desktop-spec-03-result.png)
- [Mobile 직접 성능](../artifacts/quote-onboarding/mobile-spec-01-spec.png)
- [Mobile 직접 성능 요약](../artifacts/quote-onboarding/mobile-spec-02-summary.png)
- [Mobile 직접 성능 결과](../artifacts/quote-onboarding/mobile-spec-03-result.png)

### 업그레이드·나중에

- [Desktop 업그레이드 진입](../artifacts/quote-onboarding/desktop-upgrade-01-entry.png)
- [Desktop 업그레이드 편집기](../artifacts/quote-onboarding/desktop-upgrade-02-editor.png)
- [Mobile 업그레이드 진입](../artifacts/quote-onboarding/mobile-upgrade-01-entry.png)
- [Mobile 업그레이드 편집기](../artifacts/quote-onboarding/mobile-upgrade-02-editor.png)
- [Desktop 나중에 선택 후 홈](../artifacts/quote-onboarding/desktop-later-01-home.png)
- [Mobile 나중에 선택 후 홈](../artifacts/quote-onboarding/mobile-later-01-home.png)

이 캡처는 정적 목업이 아니라 현재 코드의 CTA를 순서대로 조작해 얻은 구현-backed wireflow입니다. 실제 FPS 보장 상태는 별도의 provenance-backed evidence가 연결된 경우에만 결과 화면에서 `verified`로 표시됩니다.
