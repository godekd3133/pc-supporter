# 게임 목표 FPS 참고 자료와 판정 계약

2026-10-05 KST 기준. 지정 영상의 GPU 상대 성능 %와 Cinebench 싱글/멀티 %는 절대 게임 FPS로 환산하지 않는다. 새 자료는 원저자가 직접 측정한 평균 FPS와 1% low를 읽은 별도 자료다.

## 자료 범위

`server/reference-data/gaming-fps-reference.json`에 80개 조건을 기록했다. 게임은 사이버펑크 2077: 팬텀 리버티, 포르자 호라이즌 5, 카운터 스트라이크 2, 포트나이트, ARK: Survival Ascended, 헬다이버즈 2다. GPU는 RTX 5060 Ti **16GB**, RTX 5070 12GB, RTX 5070 Ti 16GB, RX 9070 XT 16GB다. 5060 Ti 8GB에 16GB의 수치를 붙이지 않는다.

다음 원저자 리뷰의 시스템 표, 원문 그래프와 평균/1% low를 확인했다.

| 원저자 자료 | 공개일 | 사용한 그래프 |
|---|---|---|
| [TechSpot: RTX 5070 Ti vs RX 9070 XT](https://www.techspot.com/review/3130-geforce-rtx-5070-ti-vs-radeon-rx-9070-xt/) | 2026-05-22 | [사이버펑크](https://www.techspot.com/articles-info/3130/bench/CP2077.png), [포르자 5](https://www.techspot.com/articles-info/3130/bench/FH5.png), [CS2](https://www.techspot.com/articles-info/3130/bench/CS2.png), [포트나이트](https://www.techspot.com/articles-info/3130/bench/Fortnite.png) |
| [TechSpot: RTX 5070 vs RX 9070 XT, 2026 Update](https://www.techspot.com/review/3168-geforce-rtx-5070-vs-radeon-rx-9070-xt/) | 2026-09-07 | [사이버펑크](https://www.techspot.com/articles-info/3168/bench/CP2077.png), [포르자 5](https://www.techspot.com/articles-info/3168/bench/FH5.png), [CS2](https://www.techspot.com/articles-info/3168/bench/CS2.png), [헬다이버즈 2](https://www.techspot.com/articles-info/3168/bench/HD2.png) |
| [TechSpot: RX 9070 XT vs RTX 5060 Ti 16GB](https://www.techspot.com/review/3176-madness-9070-xt-vs-5060-ti/) | 2026-09-24 | [사이버펑크](https://www.techspot.com/articles-info/3176/bench/CP2077-o.png), [포트나이트](https://www.techspot.com/articles-info/3176/bench/Fortnite-o.png), [ARK](https://www.techspot.com/articles-info/3176/bench/Ark-o.png) |

공통 CPU는 Ryzen 7 9800X3D, 메모리는 G.Skill DDR5-6000 CL30-38-38-96, OS는 Windows 11 25H2다. 5월과 9월은 보드와 드라이버가 다르며 각 레코드에 출처의 드라이버를 남겼다. 원문 시스템 표가 기재하지 않은 RAM 용량, 모듈 수, 게임 버전은 채우지 않았다. `publishedAt`은 리뷰 공개일이고, 정확한 개별 측정 시각으로 표현하지 않는다. `verifiedAt`은 이번 원문 확인 시각이다.

일부 대표값은 다음과 같다. 모두 QHD 네이티브이며 출처 PC의 관측값이다.

| 게임·원문 옵션 | GPU | 평균 / 1% low |
|---|---|---:|
| 사이버펑크 Ultra | RTX 5060 Ti 16GB | 69 / 58 FPS |
| 사이버펑크 Ultra | RTX 5070 | 90 / 79 FPS |
| 사이버펑크 Ultra | RTX 5070 Ti | 129 / 104 FPS |
| 사이버펑크 Ultra | RX 9070 XT | 131 / 106 FPS |
| 포르자 5 Max | RTX 5070 | 130 / 109 FPS |
| CS2 Very High | RTX 5070 | 291 / 110 FPS |
| 헬다이버즈 2 Ultra | RTX 5070 | 104 / 87 FPS |

## 게임 옵션 대응

여러 게임의 같은 표시 단계가 같은 실제 프리셋 이름이라는 뜻은 아니다. 결과에 `sourcePreset`과 출처 조건을 노출해야 한다.

| 서비스 옵션 | 게임별 원문 옵션 |
|---|---|
| high | 사이버펑크 Ultra / RT Ultra, 포르자 5 Max, CS2 Very High, 포트나이트 Epic + RT, ARK Epic, 헬다이버즈 2 Ultra |
| balanced | CS2·ARK·헬다이버즈 2 Medium |
| competitive | 포트나이트 Performance Mode |

포르자 5는 원문 Max 표를 사용하며 Ultra 표를 같은 조건에 함께 넣지 않았다. RT 별도 실행 표는 사이버펑크와 포트나이트에만 연결했다. 해상도는 QHD와 4K다. 아직 없는 FHD, DLSS/FSR, 프레임 생성 켜짐, 다른 게임·GPU 조합의 값을 역산하거나 생성하지 않는다. 다른 게임과 조건은 `missing` 또는 `partial`로 명시한다.

## producer → consumer 계약

1. 서버의 `gamingFpsReferences`는 검증한 bundled JSON만 읽는다. 관리자가 쓰는 legacy `data/gaming-performance-evidence.json`과 분리한다.
2. `gamingTargetAssessmentFor()`는 게임, GPU 모델과 VRAM, 해상도, 옵션 단계, RT, 업스케일링, 프레임 생성 조건이 맞는 관측치를 찾는다. 목표 FPS는 검색키가 아니라 비교값이므로 같은 90 FPS 측정치를 60 FPS와 144 FPS 목표에 각각 비교할 수 있다.
3. 가장 최근의 자료를 먼저 사용하고, 동일한 시점의 선택에서는 CPU가 일치한 자료를 먼저 사용한다. `sourcePreset`이 요청에 정확히 지정되면 원문 이름도 일치해야 한다.
4. `sourceAverageFps`와 `sourceOnePercentLowFps`는 원문 수치를 그대로 보존한다. CPU 상대 성능·GPU 평균 %·해상도 픽셀 수·옵션 가중치를 곱하여 절대 FPS를 만들지 않는다.
5. `referenceTargetMet`은 원문 PC에 대한 비교다. CPU 또는 RAM이 다른 견적에서 이 값을 **해당 PC의 목표 달성**으로 표시할 수 없다. `minimumTargetRatio`도 후보를 비교하는 참고값이다.
6. CPU 모델과 RAM 규격·용량이 모두 알려져 일치하면 `estimatedTargetMet`을 만들 수 있다. RAM 속도·타이밍 또는 GPU 제조사 제품이 다르면 여전히 `projected`다. CPU·RAM 규격·용량이 다르거나 미기록이면 이 추정 달성 값은 제공하지 않는다.
7. `targetMet`은 선택한 모든 게임에서 CPU, 정확한 GPU 제품, RAM 규격/속도/용량/모듈 수/타이밍, 상세 프리셋, 드라이버, OS, 게임 버전, 측정 구간이 모두 일치하고 목표 평균 FPS 이상일 때만 참이다. 기록이 부족한 원저자 GPU 리뷰를 생성 PC의 실측 완료로 표시하지 않는다.
8. 현재 참고 자료의 RAM 용량·게임 버전이 미기록이므로 현재 실데이터 판정은 `projected` 또는 다른 미완료 상태다. 원문 FPS를 보여주고, CPU·RAM·환경 차이를 설명한다.
9. 기본 자료 나이 기준은 공개일로부터 180일이며 요청에 `referenceMaxAgeDays`를 지정하면 최대 365일 안에서 비교 기준을 바꿀 수 있다. 옛 리뷰를 다시 읽은 날짜를 새 측정일로 쓰지 않는다. 기준을 넘으면 `stale`로 낮추고 목표 달성을 표시하지 않는다.
10. 사용자 JSON 가져오기·브라우저 저장 복원의 raw assessment는 현재 서버 근거가 아니다. raw 객체를 그대로 `verified`로 복원하지 않고, 저장한 게임 요청으로 서버에서 재평가한 응답을 사용한다.

## 기존 자료와의 차이

기존 레코드는 CPU·RAM·프레임 생성 필드 없이 GPU와 옵션만 매칭했다. native에 생성 프레임을 포함한 196 FPS가 들어 있고, 일부 실제 GPU와 카탈로그 GPU가 서로 다르며, 소매사 보도치도 섞여 있다. 신규 strict reference parser는 이 레코드를 그대로 받아들이지 않는다. 목표 FPS 모드가 이 legacy `verified` 값을 목표 달성의 근거로 사용하면 안 된다.

## 검증

`shared/gaming-target-assessment.test.ts`에는 원문 데이터 80건/게임 6종의 구조 확인, CPU 차이, GPU 제조사 차이, RAM 차이/미기록, VRAM 8GB/16GB 분리, 목표 FPS 변경, 게임·해상도·옵션·RT·업스케일링·프레임 생성 불일치, 자료 나이, 누락 게임과 비정상 입력을 다루는 회귀 테스트를 작성했다.

이 담당 작업에서는 공용 Postgres 포트 충돌을 피하기 위해 테스트·타입 검사를 실행하지 않았다. 루트 담당자의 단일 통합 검증 결과를 별도 최종 검증 기록에 추가한다.

## 배포에 포함하는 국내 실상품

깨끗한 체크아웃에서도 AMD 선택과 RTX 5060 Ti 16GB 비교를 할 수 있도록 다음 정확한 SKU만 공개 상품 페이지에서 다시 읽었다. private 전체 카탈로그를 번들에 옮기지 않았다. 원문 상품 ID를 확인한 가격 parser, 국내 신품 분류, raw spec과 조회 시각을 snapshot에 보존했다.

| 정확한 상품 | 다나와 원문 | 확인 가격 | 가격 확인 시각 UTC |
|---|---|---:|---|
| ASUS DUAL RX 9060 D6 8GB 대원씨티에스 | [95985854](https://prod.danawa.com/info/?pcode=95985854) | 364,700원 | 2026-10-04 22:10:36 |
| SAPPHIRE RX 9060 XT PULSE OC D6 16GB | [91909571](https://prod.danawa.com/info/?pcode=91909571) | 821,000원 | 2026-10-04 22:10:37 |
| SAPPHIRE RX 9070 PURE OC D6 16GB | [77382623](https://prod.danawa.com/info/?pcode=77382623) | 1,129,000원 | 2026-10-04 22:10:38 |
| SAPPHIRE RX 9070 XT PULSE D6 16GB | [77378039](https://prod.danawa.com/info/?pcode=77378039) | 1,451,000원 | 2026-10-04 22:10:38 |
| GIGABYTE RTX 5060 Ti WINDFORCE MAX OC D7 16GB 피씨디렉트 | [93704792](https://prod.danawa.com/info/?pcode=93704792) | 719,200원 | 2026-10-04 22:15:58 |
| GIGABYTE RTX 5060 Ti WINDFORCE OC D7 16GB 피씨디렉트 | [81715985](https://prod.danawa.com/info/?pcode=81715985) | 900,000원 | 2026-10-04 22:15:58 |

AMD 4개 상품은 `server/reference-data/gaming-amd-catalog.json`, 5060 Ti 16GB 2개 상품은 `server/reference-data/gaming-target-catalog.json`에 있다. 각 loader는 더 최근의 live 조회와 별도로 검수한 물리 규격을 보존한다. 상품의 전원 포트, 권장 PSU, 길이, 두께, VRAM을 원문에서 확인했다. GIGABYTE 두 상품의 소비전력은 다나와 원문에 없어 `powerW`를 임의로 채우지 않고 미확인 필드를 유지했다. 이 두 정확한 상품의 PCIe 슬롯 75W와 8핀 1개 150W를 합한 225W는 파워 구성에 쓰는 보수적인 계획값이며 개별 GPU의 실측 소비전력이나 TGP로 표시하지 않는다. 다나와 원문과 일치하는 제조사 권장 파워 650W도 최소 조건으로 보전한다. [CORSAIR의 GPU 측 PCIe 8핀 규격 설명](https://www.corsair.com/uk/en/explorer/diy-builder/power-supply-units/individual-8-pin-vs-pigtail-connectors-for-gpus/)은 GPU 측 8핀 커넥터의 PCI-SIG 기준을 150W로 구분하고, [SilverStone의 공식 설명](https://www.silverstonetek.com/kr/product/info/power-supplies/ET500/)은 슬롯 75W를 합한 표준 총량 225W를 명시한다. 이 값은 순간 최대전력이나 실제 게임 부하를 측정한 결과가 아니다.
