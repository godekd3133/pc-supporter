# 게임 견적의 부품 티어와 연계 교체 정책

사장님이 요청한 최소 티어·적정 티어를 `shared/gaming-part-tiers.ts`에 구현했다. 티어는 견적 조절 방향과 필요한 지출을 설명한다. 실제 CPU 지원, 전원 커넥터, 메모리 슬롯, GPU·쿨러·케이스 장착 호환성은 기존 호환 엔진의 검사 결과가 최종 판단이다.

## 분류의 근거

| 부품 | 티어를 정하는 기준 | 별도로 맞춰야 할 조건 |
|---|---|---|
| CPU | 입문 AM4 → 기본 AM4 → 기본 AM5 → AM4 X3D → AM5 X3D → Ryzen 9000 X3D | 소켓, DDR 세대, 보드 CPU 지원표·BIOS, 기본 TDP/PPT, 쿨러 |
| GPU | 지정 영상 QHD 상대 성능과 정확한 VRAM 구분. Radeon 등 영상에 없는 모델은 기존 추정값 | GPU 권장 PSU, 실제 보조전원, 길이·폭·두께·점유 슬롯·케이블 여유 |
| 메인보드 | 플랫폼별 기본 전원부 0 / 냉각 전원부 1 / 고전력용 2 | AM4·AM5 소켓과 지정 제품의 CPU 지원 조건 |
| RAM | 선택한 키트 용량 × 선택 수량의 실제 총 용량: 16GB·32GB·64GB 이상 | DDR 세대, DIMM 수, 슬롯 수, 최대 용량, 오버클럭 프로파일 안정성 |
| 쿨러 | 0 기본 쿨러 / 1 AG400 G2 싱글 타워 / 2 PA120 SE 듀얼 타워 / 3 NAUTILUS 360 RS 3열 수랭 | 구매 CPU 패키지의 쿨러 포함 여부, 장착 키트, 높이·라디에이터·RAM 간섭 |
| 파워 | 정격 500W 이하 / 650W 이하 / 850W 이하 / 1000W 이하 / 그 이상 | CPU+GPU 전력 예산, GPU 권장 정격, 전원 커넥터 수·독립 케이블, 케이스 장착 |
| 케이스 | GPU 장착 길이 300mm 이하 / 350mm 이하 / 그 이상 | 실제 보드 외형, GPU 길이·두께·전원 케이블, 쿨러·라디에이터, 파워 외형·길이 |

CPU 티어는 게임용 추천 정책이다. R23 멀티코어 값을 게임 FPS로 바꾸지 않는다. 같은 게임 역할 안에서만 지정 CPU 영상의 싱글코어 수치를 보조 정렬에 쓴다. 7800X3D는 3D V-Cache 게임 역할로 9700X보다 먼저 둔다. 이 순서는 모든 게임에서의 실측 우열을 뜻하지 않는다. AMD 공식 사양은 7800X3D의 L3 캐시 96MB·TDP 120W, 9700X의 L3 캐시 32MB·TDP 65W를 확인해 준다. [AMD 7800X3D](https://www.amd.com/en/products/processors/desktops/ryzen/7000-series/amd-ryzen-7-7800x3d.html), [AMD 9700X](https://www.amd.com/en/products/processors/desktops/ryzen/9000-series/amd-ryzen-7-9700x.html).

GPU 순서는 `shared/relative-performance-index.ts`의 QHD 표를 재사용한다. RTX 5060 Ti 16GB = 100%, 8GB = 97.4%로 구분한다. AMD Radeon 9000도 같은 원영상에서 추가 확인한 행을 사용한다. 예를 들어 RX 9070 XT는 QHD 161.3%이며 `video_table` 근거로 반환한다. 직접 확인한 행이 없는 모델은 추정 근거로 남긴다. [지정 GPU 영상](https://youtu.be/iVL3KqqzlhM?t=500), [지정 CPU 영상](https://youtu.be/6NoegO2rlkE?t=180).

## 지정 메인보드의 최소·적정 조건

| 플랫폼 | CPU 기본 TDP | 최소·적정 보드 | 티어 |
|---|---:|---|---:|
| AM4 | 65W 이하 | ASRock A520M-HVS 대원씨티에스 | 0 |
| AM4 | 65W 초과~105W | ASUS TUF Gaming B550M-PLUS STCOM | 1 |
| AM5 | 120W 이하 | GIGABYTE B850M GAMING X WIFI6E 제이씨현 | 1 |
| AM5 | 120W 초과~170W | MSI MAG X870E 토마호크 WIFI | 2 |

숫자는 프로젝트의 기본 설정 추천 정책이다. 제조사의 보장 최대 소비전력은 아니다. AMD 5000/7000/9000 모델, 소켓, 기본 TDP가 확인되어야 기존 `phase1MotherboardSupportsCpu` 정책을 통과한다. 보드 CPU 지원표와 실제 구매한 보드 리비전·BIOS는 계속 확인해야 한다.

B850M의 제조사 표기는 Vcore 10개·60A DrMOS와 VRM 방열판이다. **600A를 600W로 바꾸거나 CPU PPT(W)와 그대로 비교하지 않는다.** 전압·효율·발열·설정이 필요한 다른 단위이기 때문이다. A520M-HVS의 DrMOS·전원부 방열판은 기존 확인 원문으로 입증되지 않아 없는 것으로 단정하는 대신 보수적인 65W AM4 정책을 유지한다. [GIGABYTE B850M 공식 사양](https://www.gigabyte.com/Motherboard/B850M-GAMING-X-WIFI6E-rev-10), [ASRock A520M-HVS](https://www.asrock.com/MB/AMD/A520M-HVS/index.asp), [ASUS B550M-PLUS](https://www.asus.com/motherboards-components/motherboards/tuf-gaming/tuf-gaming-b550m-plus/), [MSI X870E TOMAHAWK](https://www.msi.com/Motherboard/MAG-X870E-TOMAHAWK-WIFI).

## GPU 우선 배분과 RAM·쿨러·파워

- RAM 기본 최소는 16GB다. QHD 지수가 160% 이상인 상위 GPU 역할(RTX 5070 Ti·RX 9070 XT 등)에는 적정 32GB를 제안한다. 먼저 최고 GPU와 CPU 플랫폼을 고정하고, 같은 GPU를 유지하면서 남은 예산에 32GB가 들어갈 때 적용한다. 사용자가 이미 64GB 이상을 요청했다면 낮추지 않는다. RAM 적정량은 실측 게임 요구량이 아니라 프로젝트의 균형 정책이다.
- RAM `− / +`는 **실제 총 용량**을 16→32→64→128GB로 바꾼다. DDR 전환만으로 성능 증가라고 취급하지 않는다. 8GB×2를 A520 2슬롯에서 32GB로 늘릴 때는 8GB×4 대신 16GB×2를 선택한다. 같은 제품 ID의 수량을 늘리는 것도 정상적인 증가이므로 API는 ID와 목표 총 용량을 함께 반환한다.
- DDR5-8000 패키지는 높은 표기 속도만으로 기본 DDR5-5600보다 적정하다고 판단하지 않는다. QVL·CPU 메모리 컨트롤러·DIMM 구성과 프로파일 안정성은 확인 필요로 남긴다. 8000MT/s 동작을 일반 보장하지 않는다.
- 기본 쿨러는 `coolerIncluded: true`이고 현재 패키지 전력 조건이 확인될 때 사용한다. 별도 쿨러의 최소 정책은 기존 제품 근거를 재사용해 120W 이하 싱글 타워, 170W 이하 듀얼 타워로 둔다. 3열 수랭은 사용자 조절로 선택할 수 있지만 기본 게임 견적에서 필수로 올리지 않는다. 온도·소음 실측 보장은 별도다.
- 파워 최소는 `max(GPU 제조사 권장 정격, CPU PPT 또는 TDP + GPU 전력 예산 + 150W)`다. 적정 상한은 기존 정책의 `max(시스템 전력 예산 × 1.25, GPU 권장 정격 + 50W, 500W)`다. RX580의 미확인 TGP는 확인한 8핀 1개와 PCIe 슬롯의 전력 상한을 **계획용 상한**으로만 활용한다. 제품 실측 소비전력 필드에 저장하지 않는다.
- 파워 용량·케이스 장착 크기는 품질이나 FPS 등급이 아니다. 물리 조건을 만족한 저렴한 후보를 유지하여 남은 예산을 GPU부터 쓴다.

## 연계 교체

`gamingAdjustmentDependentCategories`는 선택한 부품과 전이적으로 다시 선정해야 할 부품을 반환한다.

- CPU 변경: CPU·보드·RAM·쿨러·파워·케이스를 다시 확인한다. 5600에서 `+`는 요청한 7500F로 이동하고, AM5 보드·DDR5 RAM을 함께 바꾼다. 기존 GPU는 보존한다.
- GPU 변경: GPU·파워·케이스를 다시 확인한다. 케이스 변경으로 공랭 높이·라디에이터 공간이 달라지면 쿨러도 다시 확인한다.
- RAM 총 용량 변경: 같은 DDR 세대에서 현재 보드의 슬롯·최대 용량이 맞는 후보를 고르며 CPU·GPU·보드·쿨러·파워·케이스를 보존한다. 이전 ID만 담긴 메타데이터로 RAM 세대를 바꾸거나 보드를 바꾸는 경우에는 CPU 플랫폼과 쿨러·파워·케이스까지 연계 조건을 해제한다.
- 쿨러·파워 변경: 케이스를 다시 확인한다. 순환 의존은 Set으로 한 번만 방문한다.

## 공유 API

```ts
gamingPartTierFor(part, context?)
// { category, tier?, key, label, order?, evidence, platform?, notes }

gamingSupportRequirementsFor(context)
// { motherboard, cooler, memory, psu, case }

gamingPartSuitabilityFor(part, context)
// { tier, minimum, appropriate, checks, notes }

gamingPartTierAdjacencyFor(pool, currentId, context?)
// { upId?, downId?, upMemoryCapacityGb?, downMemoryCapacityGb? }

gamingTierAssessmentFor(parts, options?)
// { policyVersion, requirements, categories }
```

`context`는 선택 CPU·GPU·보드·쿨러·파워와 `memoryQuantity`(키트 수), `memoryCapacityGb`(요청 최소), `hddCount`를 받는다. 견적 엔진은 현재 RAM 행의 실제 선택 수량을 전달한다. RAM 조절 소비자는 반환된 `upMemoryCapacityGb`/`downMemoryCapacityGb`를 요청의 `memoryCapacityGb`로 보내야 한다. ID만 보내고 16GB를 계속 요청하면 실제 용량이 증가하지 않는다.

`src/generator-balance.ts`는 이 총 용량 메타데이터를 요청에 반영한다. 선택 방향과 실제 용량이 맞지 않거나 현재 API가 받지 않는 용량(16·32·64·128GB 외)이면 요청하지 않는다. CPU 변경은 이미 요청한 RAM 용량을 16GB로 강제로 낮추지 않는다. 최종 결과의 `src/GamingTierRequirementsPanel.tsx`는 최소·적정 조건과 현재 분류, 미확인 원문 항목을 함께 보여준다. 접은 패널을 펼치면 볼 수 있으며 모바일에서도 가로 넘침 없이 비교할 수 있도록 두 열로 배치했다. 실제 화면 검증은 상위 작업에서 수행한다.

`minimum`은 `met / unmet / unknown`, `appropriate`는 `met / below / excessive / unknown`이다. 알려진 불충족은 미확인보다 우선한다. TDP·소켓·DIMM 수·전원 커넥터·GPU 길이·케이블 여유 등의 누락을 통과로 바꾸지 않는다. 상위 GPU의 두께·케이블 공간, 360mm 라디에이터와 RAM·보드·GPU 간섭은 원문 장착 근거 또는 기존 전체 호환 검사로 계속 검증한다. 이 API의 `minimum: met`만으로 전체 견적의 물리 호환성을 선언하면 안 된다.

가격과 무관한 역할·용량을 먼저 정렬하고, 같은 역할의 매물 안에서 최저가 대표를 선택한다. CPU 기본 역할을 같은 모델의 색상·유통사로 나누지 않고, GPU 칩과 VRAM이 다르면 구분한다. 보드 `− / +`는 현재 소켓 안에서만 이동한다. 용량이 작아지는 RAM 후보는 실제 총 가격도 낮아야 한다.

검증 파일은 `shared/gaming-part-tiers.test.ts`다. GPU VRAM·AMD 추정 표기, CPU 캐시 역할, 4개 보드 정책, 기본 쿨러 포함 조건, RAM 총 용량·슬롯·8000 프로파일, 파워 정격·커넥터, 케이스 길이·C10M·라디에이터·16핀 여유, CPU 5600→7500F, RAM 수량 조절, 연계 교체를 검증한다. 이 담당 작업에서는 공유 PostgreSQL 환경에 영향을 줄 수 있는 전체 테스트를 실행하지 않았으며 최종 실행과 엔진 통합은 상위 작업에서 진행한다.
