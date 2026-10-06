# 후속 범위 포함 견적 검증 - 2026-10-05

## 완료 범위

- 단일 선택 즉시 진행, 80만원 5500GT 진입 견적, 국내 신품/정확한 상품 가격, GPU 우선 예산 구성.
- 게임/목표 FPS(30-500)/해상도/옵션 별도 모드, NVIDIA/AMD 고정 선택 및 요청 도움말.
- 네 가지 성능 지표/설명, 부품 최소·적정 조건, 예산/부품 ± 및 CPU·GPU 연계 재구성.
- URL/재편집/프리셋/저장/가져오기/새로고침 정합과 서버의 현재 FPS·티어 재계산.

## 소스와 환경

공개 다나와 상품 페이지를 읽은 47개 상품 스냅샷(기존33 + AMD4 + 5060Ti16GB2 + 지원부품8)만 별도 PostgreSQL 데이터베이스에 입력했다. 기존 private catalog 전체는 입력하지 않았다. 실시간 호환 확인이 다시 조회한 가격은 체크 응답의 가격 스냅샷과 최종 화면/내보내기에 동일하게 적용한다. 더 최근 가격·검수한 물리 사양은 스냅샷보다 우선한다.

절대 FPS는 TechSpot 원저자의 6게임·80조건·11개 원본 그래프를 사용했다. CPU는 9800X3D, RAM은 DDR5-6000이며 용량은 출처 미기록이다. 현재 견적의 FPS로 단정하지 않는다. GPU 제품/VRAM/CPU/RAM/옵션/RT/업스케일링/프레임 생성과 날짜를 구분한다. GPU 상대%와 CPU 상대%를 곱해 절대FPS를 생성하지 않는다.

## API 예산표

각제조사별12예산, 총24견적이 예산안이며 호환불가0건이다. 확인되지 않은 소비전력·물리사양은 확인필요로 남긴다. NVIDIA 고정100만원은 국내허용외장GPU 구성의최소가격이맞지않아5500GT을 사용한다. AMD100만원은RX580 경로를 사용한다. 가격은 조회 시점의 값이며 변경될 수 있다.

| 제조사 | 예산 | 합계 | CPU | GPU | RAM | 파워 |
|---|---:|---:|---|---|---:|---|
|nvidia|800,000|755,630|AMD 라이젠5-4세대 5500GT (세잔) (멀티팩 정품)|CPU 내장 그래픽|16GB|마이크로닉스 COOLMAX ELITE II 500W|
|nvidia|1,000,000|755,630|AMD 라이젠5-4세대 5500GT (세잔) (멀티팩 정품)|CPU 내장 그래픽|16GB|마이크로닉스 COOLMAX ELITE II 500W|
|nvidia|1,200,000|1,095,400|AMD 라이젠5-4세대 5600 (버미어) (멀티팩 정품)|갤럭시 GALAZ 지포스 RTX 5050 BLACK OC D6 8GB DUAL HDMI|16GB|마이크로닉스 COOLMAX ELITE II 600W|
|nvidia|1,400,000|1,258,600|AMD 라이젠5-4세대 5600 (버미어) (멀티팩 정품)|갤럭시 GALAZ 지포스 RTX 5060 Ti BLACK OC Classic D7 8GB|16GB|마이크로닉스 COOLMAX ELITE II 600W|
|nvidia|1,600,000|1,467,050|AMD 라이젠5-4세대 5600 (버미어) (멀티팩 정품)|GIGABYTE 지포스 RTX 5060 Ti WINDFORCE MAX OC D7 16GB 피씨디렉트|16GB|마이크로닉스 COOLMAX FOCUS II 700W ETA브론즈 ATX3.1|
|nvidia|1,800,000|1,761,570|AMD 라이젠5-5세대 7400F (라파엘) (멀티팩 정품)|GIGABYTE 지포스 RTX 5060 Ti WINDFORCE MAX OC D7 16GB 피씨디렉트|16GB|마이크로닉스 COOLMAX FOCUS II 700W ETA브론즈 ATX3.1|
|nvidia|2,200,000|2,137,690|AMD 라이젠5-5세대 7400F (라파엘) (멀티팩 정품)|GAINWARD 지포스 RTX 5070 피닉스 D7 12GB|16GB|마이크로닉스 COOLMAX FOCUS II 700W ETA브론즈 ATX3.1|
|nvidia|3,000,000|2,911,330|AMD 라이젠7-5세대 7800X3D (라파엘) (멀티팩 정품)|갤럭시 GALAZ 지포스 RTX 5070 Ti BLACK 2X OC D7 16GB|16GB|마이크로닉스 WIZMAX 750W 80PLUS실버 ATX3.1|
|nvidia|4,000,000|3,903,700|AMD 라이젠7-6세대 9800X3D (그래니트 릿지) (멀티팩 정품)|GAINWARD 지포스 RTX 5080 피닉스 D7 16GB|16GB|마이크로닉스 WIZMAX 850W 80PLUS실버 ATX3.1|
|nvidia|6,000,000|4,238,050|AMD 라이젠7-6세대 9800X3D (그래니트 릿지) (멀티팩 정품)|GAINWARD 지포스 RTX 5080 피닉스 D7 16GB|32GB|마이크로닉스 WIZMAX 850W 80PLUS실버 ATX3.1|
|nvidia|8,000,000|7,848,000|AMD 라이젠7-5세대 7800X3D (라파엘) (멀티팩 정품)|MANLI 지포스 RTX 5090 Gallardo OC D7 32GB 인텍앤컴퍼니|16GB|마이크로닉스 WIZMAX G-1000W 80PLUS골드 ATX3.1|
|nvidia|10,000,000|8,390,250|AMD 라이젠7-6세대 9800X3D (그래니트 릿지) (멀티팩 정품)|MANLI 지포스 RTX 5090 Gallardo OC D7 32GB 인텍앤컴퍼니|32GB|마이크로닉스 WIZMAX G-1000W 80PLUS골드 ATX3.1|
|amd|800,000|755,630|AMD 라이젠5-4세대 5500GT (세잔) (멀티팩 정품)|CPU 내장 그래픽|16GB|마이크로닉스 COOLMAX ELITE II 500W|
|amd|1,000,000|902,590|AMD 라이젠5-4세대 5600 (버미어) (멀티팩 정품)|AFOX 라데온 RX 580 2048SP D5 8GB 디앤디컴|16GB|마이크로닉스 COOLMAX ELITE II 500W|
|amd|1,200,000|1,087,300|AMD 라이젠5-4세대 5600 (버미어) (멀티팩 정품)|ASUS DUAL 라데온 RX 9060 D6 8GB 대원씨티에스|16GB|마이크로닉스 COOLMAX ELITE II 600W|
|amd|1,400,000|1,381,820|AMD 라이젠5-5세대 7400F (라파엘) (멀티팩 정품)|ASUS DUAL 라데온 RX 9060 D6 8GB 대원씨티에스|16GB|마이크로닉스 COOLMAX ELITE II 600W|
|amd|1,600,000|1,537,600|AMD 라이젠5-4세대 5600 (버미어) (멀티팩 정품)|SAPPHIRE 라데온 RX 9060 XT PULSE OC D6 16GB|16GB|마이크로닉스 COOLMAX ELITE II 500W|
|amd|1,800,000|1,537,600|AMD 라이젠5-4세대 5600 (버미어) (멀티팩 정품)|SAPPHIRE 라데온 RX 9060 XT PULSE OC D6 16GB|16GB|마이크로닉스 COOLMAX ELITE II 500W|
|amd|2,200,000|2,184,300|AMD 라이젠5-5세대 7400F (라파엘) (멀티팩 정품)|SAPPHIRE 라데온 RX 9070 PURE OC D6 16GB|16GB|마이크로닉스 COOLMAX FOCUS II 700W ETA브론즈 ATX3.1|
|amd|3,000,000|2,848,400|AMD 라이젠7-5세대 7800X3D (라파엘) (멀티팩 정품)|SAPPHIRE 라데온 RX 9070 XT PULSE D6 16GB|16GB|마이크로닉스 WIZMAX 750W 80PLUS실버 ATX3.1|
|amd|4,000,000|3,390,650|AMD 라이젠7-6세대 9800X3D (그래니트 릿지) (멀티팩 정품)|SAPPHIRE 라데온 RX 9070 XT PULSE D6 16GB|32GB|마이크로닉스 WIZMAX 750W 80PLUS실버 ATX3.1|
|amd|6,000,000|3,390,650|AMD 라이젠7-6세대 9800X3D (그래니트 릿지) (멀티팩 정품)|SAPPHIRE 라데온 RX 9070 XT PULSE D6 16GB|32GB|마이크로닉스 WIZMAX 750W 80PLUS실버 ATX3.1|
|amd|8,000,000|3,390,650|AMD 라이젠7-6세대 9800X3D (그래니트 릿지) (멀티팩 정품)|SAPPHIRE 라데온 RX 9070 XT PULSE D6 16GB|32GB|마이크로닉스 WIZMAX 750W 80PLUS실버 ATX3.1|
|amd|10,000,000|3,390,650|AMD 라이젠7-6세대 9800X3D (그래니트 릿지) (멀티팩 정품)|SAPPHIRE 라데온 RX 9070 XT PULSE D6 16GB|32GB|마이크로닉스 WIZMAX 750W 80PLUS실버 ATX3.1|

## 목표 FPS 사례

|조건|선택|평가|
|---|---|---|
|target60|GIGABYTE 지포스 RTX 5060 Ti WINDFORCE MAX OC D7 16GB 피씨디렉트|projected / 출처 69FPS / 이 PC 목표 충족 단정: False|
|target100|갤럭시 GALAZ 지포스 RTX 5070 Ti BLACK 2X OC D7 16GB|projected / 출처 129FPS / 이 PC 목표 충족 단정: False|
|amd-target100|SAPPHIRE 라데온 RX 9070 XT PULSE D6 16GB|projected / 출처 131FPS / 이 PC 목표 충족 단정: False|
|missing-option|GAINWARD 지포스 RTX 5080 피닉스 D7 16GB|missing / 출처 같은 조건 자료 없음 / 이 PC 목표 충족 단정: False|

목표 FPS 모드에서 80만원으로 외장 GPU 구성을 만들 수 없는 요청은 422를 반환한다. 예산을 늘리거나 예산 중심 게임 모드로 명시적으로 전환하는 복구를 제공한다. 해외/중고를 포함하거나 목표 FPS 모드에서 외장 GPU를 조용히 제외하는 복구는 제공하지 않는다.

## 검증

- 전체 테스트:354파일/2,199항목통과 (`full-tests.log`).
- 이후재편집32GB URL기본값 및혼합RAM실합계 회귀보완:관련115항목/별도36항목 통과 (`final-regression-tests.log`, `mixed-ram-tests.log`).
- 마지막 조정 회귀: 6개 파일 / 78항목 통과 (`final-adjustment-tests.log`). 파워·쿨러·보드·케이스의 알려진 최소 조건을 위반하는 인접 후보를 제외하고, 기본 쿨러가 포함된 CPU는 사제 쿨러에서 기본 쿨러로 복귀하는 왕복을 검증했다.
- 최종 TypeScript / Vite / 클라이언트 번들 검사 통과 (`final-build.log`).
- CUA실브라우저: 시작·모드·예산 단일선택자동진행; NVIDIA QHD60 FPS→최종69 FPS/1%low58출처 표시; RAM16→32 같은제품수량1→2; 새로고침조정버튼복원; 목표재편집RAM32 명시URL왕복; AMD100 FPS→RX9070XT/평균131/1%low106출처 표시; 390px가로넘침없음 및성능tooltip탭/ESC; 콘솔오류없음.
- 테스트·빌드는 소스/로컬API/UI 증거이다. 이견적의게임실측·장치설치·CI·배포를검증한결과는아니다.

## 캡처

![최종 AMD 성능/FPS 화면](../artifacts/phase2-evidence/final-amd-desktop.png)

![최종 NVIDIA 성능/FPS 화면](../artifacts/phase2-evidence/final-target-desktop.png)

![모바일 성능 도움말](../artifacts/phase2-evidence/performance-tooltip-mobile.png)

![AMD 설명](../artifacts/phase2-evidence/vendor-tooltip-desktop.png)

## 변경 및 Git

기존 dirty작업을 보존했다. 이번작업에서는 commit/push/deploy하지 않았다. 테스트브라우저와전용서버는세션소유자원으로정리한다.

검증용 브라우저 탭과 API/Vite 서버, 전용 PostgreSQL을 정리했다. 사용자 소유 서버는 건드리지 않았다.
