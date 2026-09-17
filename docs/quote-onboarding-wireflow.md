# PC Supporter Guided Quote Builder Wireflow

이 문서는 PC Supporter의 첫 사용자 견적 생성 경험을 설명하는 구현 기준 와이어플로우입니다.

공식 UX 명칭은 다음과 같이 사용합니다.

> 목적 기반 분기형 견적 생성 온보딩 와이어플로우
>
> Purpose-based Branching Onboarding Wireflow for a Guided PC Quote Builder

정적인 화면 그림만 설명하는 문서가 아니라, 현재 홈의 첫 사용자 진입 → `/start` → `/recommend` 구현·브라우저 smoke·결과 근거 표시가 같은 조건을 전달하는지 확인하기 위한 handoff 문서입니다.

## 1. 사용자 목표

처음 앱을 연 사용자가 부품 모델을 몰라도 다음 질문에 답하면서 자신의 PC 견적 조건을 만들 수 있어야 합니다.

- 새 PC를 맞추려는가?
- 기존 PC를 업그레이드하려는가?
- 지금은 나중에 할 것인가?
- 예산을 기준으로 고를 것인가?
- 게임·작업을 기준으로 고를 것인가?
- 원하는 성능·RAM·저장공간을 직접 알고 있는가?
- 게임이라면 게임·해상도·FPS·그래픽 조건은 무엇인가?
- 작업이라면 작업 종류와 강도는 무엇인가?
- 선택한 금액에서 예상되는 성능과 부품 구성은 어느 정도인가?

## 2. 전체 분기

```text
HOME · FIRST USER
└─ 부품을 고르지 않은 첫 사용자
   └─ START HERE 프리뷰(Desktop/Mobile) → 새 견적 시작하기 → `/start`
      (이미 부품을 고른 사용자는 기존 호환성 검사 홈을 유지)
START HERE
└─ 어떤 PC가 필요하세요?
   ├─ 새로운 견적을 맞추고 싶어요
   │  └─ NEW QUOTE
   │     ├─ 예산으로 맞출래요
   │     │  └─ 예산 → 조건 요약 → 자동 구성
   │     ├─ 특정 작업이나 게임을 할 거예요
   │     │  ├─ 게임 → 게임 선택 → 해상도/FPS → 그래픽 옵션 → 예산 → 요약 → 자동 구성
   │     │  └─ 작업 → 작업 선택 → 작업 강도 → 예산 → 요약 → 자동 구성
   │     └─ 생각해둔 성능이 있어요
   │        └─ 성능 등급/GPU/RAM/SSD → 예산 → 요약 → 자동 구성
   ├─ 이미 가지고 있는 컴퓨터를 업그레이드하고 싶어요
   │  └─ UPGRADE → 현재 부품 선택 → 호환성 검사 → 업그레이드 후보 비교
   └─ 나중에 할래요
      └─ 홈
```

## 3. 화면별 와이어플로우

| 순서 | 화면 | 사용자가 보는 핵심 | 다음 CTA | 저장·handoff |
| --- | --- | --- | --- | --- |
| 1 | `START HERE` | 새 견적·업그레이드·나중에 + 다음 단계 설명 | 새 견적 시작하기 / 다음 / 홈으로 돌아가기 | 세션 draft |
| 2 | `NEW QUOTE` | 예산·작업/게임·직접 성능 + 입력 결과 설명 | 다음 | 선택한 mode |
| 3 | `USE CASE` | 게임 또는 작업 | 다음 | usecase |
| 4 | `GAMING` | 검색·카테고리·최대 5개 게임 | 다음 | game IDs |
| 5 | `PERFORMANCE` | FHD/QHD/4K, 60/144/240 FPS, 평균 FPS 목표 기준 | 다음 | resolution, refresh |
| 6 | `GRAPHICS OPTIONS` | 경쟁·균형·높음, 업스케일링, RT, 참고 가격대·실측 근거 기준 | 다음 · 예산 정하기 | graphics, upscaling, ray tracing |
| 7 | `WORK` | 영상·3D·개발·방송·AI·오디오·사무 + 대표 사용 장면 | 다음 | work IDs |
| 8 | `INTENSITY` | 가볍게·균형 있게·무겁게 | 이 조건으로 맞춰보기 | intensity |
| 9 | `SPEC` | 성능 등급·외장 GPU·RAM·SSD | 다음 | tier, GPU, RAM, SSD |
| 10 | `BUDGET` | 예산, 예상 성능, 권장 가격 범위 | 이 금액으로 맞춰보기 | budget |
| 11 | `READY` | 최종 조건 요약·항목별 변경 | 이 조건으로 견적 생성하기 | `/recommend` query |
| 12 | `AUTO BUILD DRAFT` | 실제 부품 조합·총액·근거·주의 | 편집기로 가져가기 / 바로 검사 | generator draft |

## 4. 게이밍 경로 기준 화면

대표 확인 경로는 다음입니다.

```text
사이버펑크 2077
→ 4K
→ 144 FPS
→ 높음
→ DLSS·품질 참고
→ 500만원
```

그래픽 옵션 단계에서는 `PERFORMANCE CONTRACT` 카드로 목표의 해석을 고정합니다.

```text
평균 FPS 144 이상 목표
4K · 144 FPS · 높음 · DLSS·품질 참고
이 조건의 참고 가격대 · 450만원 ~ 530만원
동일한 게임·GPU·해상도·그래픽 조건의 최신 실측 자료가 있을 때만 검증 완료
```

실측 자료가 없으면 이 단계의 목표는 카탈로그 기준 참고 조건으로 전달되며, 실제 FPS 보장으로 표현하지 않습니다.

예산 화면은 단순 금액만 보여주지 않습니다. 현재 선택 금액이 권장 범위 밖이면 `권장 최저 예산으로 맞추기` 또는 `권장 상한으로 맞추기` CTA가 나타나 범위의 경계값으로 바로 조정할 수 있습니다. 목표가 예산에 맞지 않을 때는 `목표 성능 다시 고르기`로 게임의 해상도·FPS 또는 작업 강도를 다시 선택할 수도 있습니다.

```text
현재 목표 · 4K · 144 FPS · 높음 · DLSS·품질 참고
선택 예산 · 500만원
이 조건의 예상 가격대 · 450만원 ~ 530만원
이 금액에서 예상되는 수준 · 4K · 144 FPS · 최상급 GPU · 64GB · 2TB SSD
```

이 가격 범위는 현재 카탈로그·스펙 기반 참고값입니다. 게임별 FPS 실측 자료가 없으면 절대적인 성능 보장으로 표현하지 않습니다.

요약 화면은 읽기 전용 확인 단계가 아닙니다. 게임·목표 성능·그래픽 옵션·작업·작업 강도·성능 등급·예산처럼 수정 가능한 항목에는 해당 단계로 바로 돌아가는 `변경` CTA를 둡니다. 수정 후에도 이미 선택한 나머지 조건은 유지되어, 사용자가 긴 위저드를 처음부터 다시 반복하지 않아도 됩니다.

## 5. 작업 경로 기준 화면

대표 확인 경로는 다음입니다.

```text
영상 편집
→ 무겁게 · 4K·6K 편집·고급 효과 · 상급 GPU · 64GB · 2TB SSD
→ 300만원
```

화면과 generator handoff는 다음 기준을 보존합니다.

```text
4K·6K 편집·고급 효과
상급 GPU
64GB
2TB SSD
work=video
intensity=heavy
```

작업의 예상 수준은 generic `작업용 PC`가 아니라 선택한 작업 종류와 강도에 따라 구체적으로 달라집니다.

## 6. 예산-only·직접 성능 경로

### 예산-only

```text
400만원
→ 상급 일반 구성
→ 상급 GPU
→ 64GB
→ 2TB SSD
→ /recommend?profile=general&ram=64&budget=4000000&ssd=2000
```

화면에 표시한 budget tier와 generator 요청의 RAM·SSD가 달라지지 않도록 producer·consumer 양쪽에서 같은 계약을 사용합니다.

### 직접 성능 입력

```text
최상급 성능
→ 외장 GPU 포함
→ 64GB
→ 2TB SSD
→ 300만원
→ /recommend?profile=general&priority=performance&tier=top&ram=64&budget=3000000&ssd=2000
```

외장 GPU를 해제한 경우에는 `gpu=0`을 명시해 내장 그래픽 조건을 보존합니다.

두 경로 모두 generator 결과 상단에 `GENERAL TARGET` 카드를 유지합니다.

```text
예산-only
→ 예산 중심 구성
→ 상급 일반 구성 · 상급 GPU · 64GB · 2TB SSD
→ 아래 실제 부품과 구분해 표시

직접 성능 입력
→ 최상급 성능 · 직접 입력
→ 외장 GPU 포함 · 64GB · 2TB SSD
→ 아래 실제 부품과 구분해 표시
```

## 7. Handoff query 계약

게이밍 handoff는 기본값과 같더라도 사용자가 고른 조건을 URL에 명시합니다.

```text
profile=gaming
priority=performance
resolution=4k
refresh=144
games=cyberpunk
graphics=high
upscaling=quality
ram=64
budget=5000000
ssd=2000
autorun=1
```

`/recommend`가 마운트된 뒤 generator URL 동기화가 `refresh=144`, `graphics=high`, `upscaling=quality`를 임의로 삭제하지 않습니다. 이 값들은 공유·새로고침·뒤로가기에서도 요구사항을 복원하기 위한 계약입니다.

## 8. 성능 근거 경계

게이밍 결과는 네 개의 상태를 분리합니다.

```text
선택 조건 보존     → 온보딩 조건이 generator까지 전달됐는가
카탈로그 GPU 기준  → VRAM·스펙 기준을 만족하는가
exact-condition    → 같은 게임·GPU·해상도·FPS·옵션 자료가 있는가
실제 환경 확인     → 모니터·드라이버·온도·패치까지 구매 전 확인했는가
```

`verified`가 되려면 다음이 모두 맞아야 합니다.

- 게임 ID 일치
- GPU Part ID 일치
- 해상도 일치
- 목표 FPS 일치
- 그래픽 프리셋 일치
- 레이 트레이싱 일치
- 업스케일링 일치
- 측정일이 freshness window 안에 있음
- HTTPS 원본 출처 존재
- 평균 FPS가 목표 FPS 이상

오래된 자료는 `stale`로 남고, 다른 GPU의 자료를 현재 선택 GPU에 상속하지 않습니다.

## 9. 측정 요청 운영 흐름

사용자 결과의 `측정 요청 JSON 복사`는 FPS 값을 만들지 않습니다.

```text
조건-only request JSON
→ 관리자 요청 JSON 적용
→ coverage 필터 확인
→ 실측 레코드 입력
→ 저장 전 batch 검증
→ 검증된 자료 저장
→ 동일 조건 coverage 재검사
```

실측 레코드 입력 폼은 자료 ID·게임·GPU·조건·평균 FPS·1% low·측정일·출처 URL을 요구합니다. `datetime-local` 측정일은 저장 전 ISO timestamp로 정규화합니다.

## 10. 검증 근거

현재 구현·시각 검증 기준은 [design-qa.md](../design-qa.md)에 기록되어 있습니다.

실제 CTA를 순서대로 재생한 데스크톱·모바일 PNG 캡처는 [quote-onboarding-capture.md](quote-onboarding-capture.md)에 있습니다.

주요 검증 범위:

- 전체 Vitest `252개 파일 / 1,348개 테스트`
- 타입체크
- production build 및 client bundle verifier
- desktop quote onboarding smoke
- 390px mobile quote onboarding smoke
- 게임·작업·예산-only·직접 성능·나중에·업그레이드 분기
- exact-condition coverage 사용자 결과
- 관리자 deep-link·요청 JSON 적용
- 실측 레코드 fail-closed 입력
- 관리자 coverage filter·측정 요청 액션

이 문서의 캡처는 구현과 연결된 와이어플로우 검증 자료이며, 실제 FPS 보장 주장은 provenance-backed evidence가 연결된 범위 안에서만 허용합니다.
