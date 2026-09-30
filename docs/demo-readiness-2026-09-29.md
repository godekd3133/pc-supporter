# PC Supporter 시연 준비 검수 — 2026-09-30 현재 보완 / 2026-09-29 기록 보존

## 2026-09-30 현재 판정

로컬 원본 snapshot은 코어 5,648개(필수 사양 확인 4,115개·부분 확인 1,533개), 주변 부품 4,181개입니다. 주변 부품 품질은 `live` 4,018개·`incomplete` 121개·seed 42개이며, 정규화 사양 프로파일은 완전 3,003개·부분 301개·미평가 877개입니다. 가격 값은 4,172개, `priceCheckedAt`은 3,903개입니다. 상세 보강 429개는 실패 없이 완료됐습니다. Danawa 이미지 URL 4,139개가 확인됐고, 나머지 42개는 fallback icon을 사용합니다. CDN 응답은 세 표본에서 HTTP 200을 확인했습니다. CUA에서 팬 PCode 31078118의 34,200원 가격과 120mm·25mm·3개 구성을 확인했습니다. 관측 가격은 결제 가격을 보장하지 않습니다.

Danawa 주변 부품의 기본 목록은 3,463/3,647개입니다. 정렬 보완을 포함한 합집합은 3,911개로 선언 수보다 264개 많고, 쿨링팬만 보면 2,427/2,163개입니다. 현재 응답 진단에서는 `action.data.totalCount`와 pagination metadata 모두 2,163으로 일치하고 대표 페이지의 상품에 category code/name 값이 존재하는 것을 확인했지만, 이 정보만으로 합집합 초과의 원인을 확정할 수 없습니다. 상품 variant나 parser 오류로 단정하지 않으며 목록 source는 `partial`로 유지합니다. 기본 manifest의 상태도 변경하지 않았습니다.

번들 계약은 entry와 App shell 합계 600,000바이트, 개별 lazy feature chunk 160,000바이트 이내입니다. 기존 검증에서 shell 합계 188,482바이트와 feature chunk gate 통과를 확인했지만, 최근 이미지·상세 데이터를 포함한 최종 fresh build와 sidecar 재생성은 대기 중입니다. 현재 catalog가 반영된 `58174/58175` preview는 엔진이 이전 상태이므로 최신 runtime 증거로 사용하지 않습니다. 최종 fresh restart는 `58176/58177`에서 예정되어 있으며 아직 검증되지 않았습니다.

전체 단위 테스트 최신 실행과 최신 코드의 브라우저 검증은 대기/조사 중입니다. 현재 브라우저 실행은 구매 버튼 흐름에서 실패해 진행률 상태 경계와 semantic readiness를 조사하고 있습니다. 앞선 코드의 124 browser flow 및 persistence 통과 결과는 이전 worktree의 증거이며 현재 코드의 pass로 간주하지 않습니다. 이전 보고서에 적힌 284개 파일·1,517개 테스트도 현재 최종 테스트 수가 아닙니다. 새 전체 테스트 수와 final preview port는 root의 최종 실행 후 이 판정을 보완합니다.

현 코드의 고정 게임 조건 계산에서는 2,977,330원 구성(Core Ultra 7 270K Plus + RX 9060 XT 16GB)을 확인했습니다. VRAM 목표 15GB는 충족하지만 확인 필요 1건이 남고 FPS 자료는 없습니다. 이 결과는 이전 엔진을 구동 중인 preview에서 보장되지 않으며 구매 승인이나 성능 보증으로 해석하지 않습니다.

## 2026-09-29 이전 코드·데이터 판정 및 증거

**최신 `npm run build`, 전체 단위 테스트(284개 파일·1,517개 테스트), 최신 코드의 격리 124개 브라우저 흐름 검증이 통과했습니다.** CUA에서 대표 화면도 확인했지만 캡처 파일은 로컬에 저장하지 못해 첨부 이미지가 있는 시각 감사는 부분입니다. 코어 필수 사양은 72.9%, HDD 베이 위치는 7.3%만 확인됐고 주변 공개 목록은 3,647개 선언 중 3,483개 코드만 관측돼 manifest가 `partial`이므로 실구매 견적이나 운영 서비스 상태로 판정하지 않습니다. 최신 로컬 데모는 `http://127.0.0.1:58100/`, API는 `127.0.0.1:58101`입니다. 재현 절차는 [로컬 시연 실행 안내](local-demo-runbook.md)를 따릅니다.

검수 기준은 2026-09-29 KST입니다. 코어 카탈로그 5,648개와 주변 부품 3,886개를 확인했습니다. Danawa 원문에서 GPU 전력값 69개를 복구하고, GPU 상품명에 표기된 512MB를 0.5GB로 정규화해 G210 4개 변형의 VRAM을 확인했습니다. CPU `TDP: 기준값~최댓값 W` 표기 17개는 첫 표기값을 `tdpW`로 정규화했습니다. 현재 구조화된 VRAM은 819개 GPU 중 807개이며 12개는 미확인입니다. 케이스 공식 사양 overlay는 65개이며 source-check 자동 SKU 일치 56개, 직접 검토 `manual_required` 9개입니다. H6 Flow 두 SKU는 공식 NZXT 지원 사양에서 variant를 별도로 대조했고 자동 source-check는 H6 Series 매뉴얼의 모델명을 확인했습니다. 코어·주변 부품 PCode 중복은 0입니다. 기존 주변 부품 목록 수집으로 새로 관측한 상품 517개와 코어 쪽에 섞여 있던 주변 부품 81개를 이동한 데 더해, 쿨링팬의 JBCNC JB-80M 3+4P 화이트 variant (PCode 122714860)를 공개 상세에서 확인해 로컬에 추가했습니다. `data/*.json`은 Git ignore 대상이라 카탈로그와 보강값은 이 작업 폴더의 로컬 데이터입니다. 빌드는 고객 공개용 사양 투영과 정적 웹 경로 밖의 로컬 데모 sidecar를 함께 생성합니다. 가격은 구매 시점 가격이 아니며, 시연을 다시 띄운 뒤 `/api/meta`와 각 상품 페이지에서 범위·확인 시점을 살펴봐야 합니다.

## 카탈로그 범위

### 핵심 부품

현재 코어 카탈로그는 9개 범주 5,648개입니다. 주변 부품 목록과 PCode가 겹친 SSD 부속 7개와 UPS 74개를 코어 범주에서 분리해 주변 부품 범주에 보관했습니다.

| 범주 | 상품 수 | 필수 사양 확인 |
| --- | ---: | ---: |
| CPU | 380 | 98.9% |
| CPU 쿨러 | 56 | 80.4% |
| 메인보드 | 960 | 94.6% |
| RAM | 591 | 99.8% |
| 그래픽카드 | 819 | 43.1% |
| SSD | 470 | 98.5% |
| HDD | 220 | 100.0% |
| 케이스 | 1,051 | 7.2% |
| 파워서플라이 | 1,101 | 98.5% |
| **전체** | **5,648** | **72.9%** |

필수 사양이 확인된 상품은 4,115개, 부분 확인은 1,533개입니다. CPU TDP 범위 17개를 로컬 원문에서 추가로 읽었습니다. 이 parser는 `TDP: 65~117W`의 첫 값 65W만 `tdpW`로 쓰고 117W를 `pptW`라고 추정하지 않습니다. GPU의 `powerW` 누락은 405개에서 336개로 줄었습니다. 69개 값은 원문에 있는 `사용전력: 최대 N W` 표기에서만 복구했으며, 권장 파워 용량을 GPU 소비전력으로 바꾸지 않았습니다. 상품명에서 512MB를 읽는 parser 보강은 필수 사양 완성도 산식에 포함되지 않는 VRAM 공백 4개를 채웠습니다. GPU 완전 사양은 353/819개(43.1%)입니다. 케이스 냉각기 최대 높이의 닫힌 mm 범위 5개는 상한값을 적용했고, 나머지 단위 없는 값과 열린 범위는 자동 변환하지 않았습니다. 제조사 자료·PCode/SKU와 대조된 overlay 65개를 포함해 76/1,051개 케이스에서 필수 사양을 확인했습니다. 3.5인치 HDD 장착 위치는 77/1,051개에서 확인되어 974개가 비었습니다. 시연 seed Pop XL Air는 제조사 주요 사양의 HDD 최대 4개로 정정했습니다. 제조사 제품 페이지의 전용·겸용 장착부 표기는 HDD 최대 4개 안내와 합산 결과가 맞지 않고, 제품 시트도 장착부 분류를 다르게 기재합니다. 따라서 최대 HDD 수 4개를 사용하고 분류별 장착부 수를 더하지 않았습니다. GPU도 336개에서 `powerW`가 없고 권장 파워 용량이 158개에서 빠져 있어 구매·조립 검증에는 여전히 빈틈이 큽니다. 가격 값은 5,629개에서 있고 19개는 미확인입니다. 코어 가격 중 `priceCheckedAt`이 명시된 것은 194개뿐이며, 가격이 있는 나머지 5,435개는 `updatedAt`을 대신 보여 줄 수 있어도 가격 재확인을 보증하지 않습니다.

케이스 HDD 베이 값은 원본 크롤 결과가 아니라, 공식 제조사 자료·SKU와 다나와 상품 코드가 확인된 관리자 overlay입니다. 공개 API에서 관리자 출처 메모와 source-check 내용은 제거됩니다.

| 모델 | 다나와 PCode | 3.5인치 HDD 장착부 | 공식 근거 |
| --- | --- | ---: | --- |
| darkFlash DS500 RGB (블랙) | 78530048 | 2 | [darkFlash 공식 수입사 보도자료](https://darkflash.co.kr/article/%EB%B3%B4%EB%8F%84%EC%9E%90%EB%A3%8C/2/35637/) |
| Fractal Pop Air Solid/Clear/RGB Cyan/RGB White | 17357669, 17357537, 17357018, 17357132 | 3 | [Fractal Pop Air 공식 제품 사양서](https://www.fractal-design.com/app/uploads/2022/06/Pop-Air-RGB-Pop-Air_Product-Sheet_EN.pdf) |
| Antec AX81 RGB Elite | 30499121 | 2 | [Antec AX81 공식 사양](https://www.antec.com/product/case/ax81) |
| Antec FLUX PRO / Noctua Edition | 72470105, 108421685 | 4 | [Antec FLUX PRO](https://www.antec.com/product/case/flux-pro), [Noctua Edition](https://www.antec.com/product/case/flux-pro-noctua-edition) |
| Lian Li LANCOOL 216 (블랙/화이트 RGB) | 18538823, 18538847 | 2 | [Lian Li LANCOOL 216 공식 사양](https://lian-li.com/product/lancool-216/) |
| Thermaltake AX700 / AX700 TG | 97308200, 97308263 | 18 | [AX700 공식 페이지](https://br.thermaltake.com/ax700-super-tower-chassis.html), [AX700 TG 공식 페이지](https://br.thermaltake.com/ax700-tg-super-tower-chassis.html) |
| Cooler Master NCORE 100 AIR (블랙) | 74012729 | 0 | [Cooler Master 공식 사양](https://www.coolermaster.com/en-global/products/ncore-100-air.html) |
| Fractal Terra Jade | 20344595 | 0 | [Fractal Terra 공식 제품 사양서](https://www.fractal-design.com/app/uploads/2023/05/Terra_Product-sheet_EN.pdf) |
| Fractal North XL 및 Momentum Edition 5종 | 40016345, 40016330, 90158345, 40016360, 108416156 | 2 | [North XL 제품 시트](https://www.fractal-design.com/app/uploads/2025/03/North-XL_Product-Sheet_EN.pdf), [North XL Momentum 제품 시트](https://assets.fractal-design.com/files/uxzbxy2o/production/2bf236b6a310d8abe38ff7d334bb592a0965dcb0.pdf) |
| Fractal North Black Solid / TG Dark / White TG | 18448688, 18448748, 18448790 | 3 | [North 제품 시트](https://assets.fractal-design.com/files/uxzbxy2o/production/23a01a08f4b1cecd7b3efda20f85d8dcee09d891.pdf) — 3개 결합 위치, 트레이 2개 포함 |
| Fractal North Momentum Edition | 108416054 | 2 | [North Momentum 제품 시트](https://assets.fractal-design.com/files/uxzbxy2o/production/9b2776d0cc8e0249db9357726411061d0d78df1b.pdf) |
| Fractal Meshify 2 Compact / Define 7 Compact | 13489595, 11479695 | 2 | [Meshify 2 Compact 제품 시트](https://assets.fractal-design.com/files/uxzbxy2o/production/957ad6ea3e40c76bf4dbae6baf505bad55f3984d.pdf), [Define 7 Compact 제조사 사양](https://www.fractal-design.com/products/cases/define-series/define-7-compact/define-7-compact-black-solid/) |
| Fractal Meshify 2 XL Black TG Light Tint | 12681041 | 18 | [Meshify 2 XL 제품 시트](https://www.fractal-design.com/app/uploads/2020/10/Meshify-2-XL-_Product-Sheet_EN.pdf) |
| Fractal Pop Silent Black Solid / TG Clear Tint | 17359076, 17358986 | 3 | [Pop Silent 제품 시트](https://www.fractal-design.com/app/uploads/2022/06/Pop-Silent_Product-Sheet_EN.pdf) |
| Fractal Pop Mini Silent Black Solid / TG Clear Tint | 17359220, 17359325 | 2 | [Pop Mini Silent 제품 시트](https://www.fractal-design.com/app/uploads/2022/06/Pop-Mini-Silent_Product-Sheet_EN.pdf) |
| Fractal Pop XL Silent Black Solid | 17359157 | 4 | [Pop XL Silent 제품 시트](https://www.fractal-design.com/app/uploads/2022/06/Pop-XL-Silent_Product-Sheet_EN.pdf) |
| Fractal Define 7 Black Solid / Define 7 XL Black TG Dark Tint | 10909788, 10958601 | 14 / 18 | [Define 7 제품 시트](https://www.fractal-design.com/app/uploads/2020/10/Define-7_Product-Sheet_EN.pdf), [Define 7 XL 제품 시트](https://www.fractal-design.com/app/uploads/2020/10/Define-7-XL_Product-Sheet_EN.pdf) |
| Fractal Define 7 XL (공통 family 사양) | 10958544 | 18 | [Define 7 XL 제품 시트](https://www.fractal-design.com/app/uploads/2020/10/Define-7-XL_Product-Sheet_EN.pdf) — PCode에는 variant SKU가 없어 family 공통 HDD 최대 위치 수만 반영 |
| Fractal Define R6 Black / Black TG | 14839061, 14840138 | 11 | [Define R6 공식 사양](https://www.fractal-design.com/ja/products/cases/define/define-r6-tempered-glass/blackout/) — TG 페이지는 SKU FD-CA-DEF-R6-BK-TG와 총 11개 위치를 표시; 공식 제품 시트 검색 자료는 R6와 TG variant 모두 universal bracket 6개로 표기. Black 비-TG는 family-level 추론으로 수동 검토 |
| Fractal Pop XL Air RGB White TG Clear Tint | 17357855 | 4 | [Pop XL Air RGB 제품 시트](https://www.fractal-design.com/app/uploads/2022/06/Pop-XL-Air-RGB_Product-Sheet_EN.pdf) — 공식 SKU FD-C-POR1X-01; 제조사 최대 HDD 수 4개를 사용하고 장착부 분류 차이는 아래 참고 |
| Fractal Torrent Black Solid | 15025229 | 2 | [Torrent 제품 시트](https://assets.fractal-design.com/files/uxzbxy2o/production/03b86180d162fdc4ef0e881e1c9ea24e1fa6d846.pdf) — SKU FD-C-TOR1A-05; 포함 장착부 2개 |
| Fractal Meshify 3 XL Solid / TG / RGB / Ambience Pro | 91561445, 91561427, 91561397, 91561040 | 2 | [Meshify 3 XL 제품 시트](https://www.fractal-design.com/app/uploads/2025/05/Meshify-3-XL_Product_Sheet_EN.pdf) — 모델별 SKU, 3.5인치 2개와 2.5인치 4개 |
| Fractal Epoch White TG Clear Tint | 94087928 | 3 | [Epoch 제품 시트](https://assets.fractal-design.com/files/uxzbxy2o/production/63689e50c0c316464914235f9bb29525bd6787c3.pdf) — SKU FD-C-EPO1A-03; 최대 결합 위치 3개, 기본 트레이 2개 |
| Fractal Pop Mini Air RGB White TG Clear Tint | 17357984 | 2 | [Pop Mini Air 제품 시트](https://www.fractal-design.com/app/uploads/2022/06/Pop-Mini-Air-RGB_Product-Sheet_EN.pdf) |
| Fractal Pop 2 Air Solid / Black TG / White RGB TG | 104555042, 104555225, 104554937 | 1 | [Pop 2 Air 제품 시트](https://www.fractal-design.com/app/uploads/2026/01/Pop-2-Air_Product-Sheet_EN.pdf) — variant SKU별 결합 위치 1개 |
| Fractal Epoch Black Solid / Black RGB TG | 94087853, 94087988 | 3 | [Epoch 제품 시트](https://assets.fractal-design.com/files/uxzbxy2o/production/63689e50c0c316464914235f9bb29525bd6787c3.pdf) — 3개 위치, 트레이 2개 포함 |
| Fractal Epoch XL Black Solid / Black TG / White RGB TG | 102124007, 102124055, 102124145 | 2 | [Epoch XL 제품 시트](https://www.fractal-design.com/app/uploads/2025/11/Epoch-XL_Product-Sheet_EN.pdf) — variant SKU별 트레이 2개 포함 |
| Fractal Meshify 3 Solid / TG / Ambience Pro RGB / White RGB | 91560968, 91560920, 91560728, 91560869 | 2 | [Meshify 3 제품 시트](https://assets.fractal-design.com/files/uxzbxy2o/production/50476fee3b3101e6d05d1bd5c1ff30f1738e378b.pdf) — 3.5/2.5인치 2/4; 현재 제품 페이지의 4개 결합 장착부 표기와 달라 sheet의 3.5인치 수를 사용 |
| Fractal Era 2 Midnight Blue | 68242736 | 0 | [Era 2 제품 시트](https://assets.fractal-design.com/files/uxzbxy2o/production/74b237a6f0ad974a72d19a47b972c0c082b38882.pdf) — 3.5인치 위치 0개, 2.5인치 4개 |
| Fractal Ridge White | 18294494 | 0 | [Ridge 제품 시트](https://www.fractal-design.com/app/uploads/2023/01/Ridge_Product-Sheet_EN.pdf) — 2.5인치 전용 위치 4개 |
| Fractal Mood Black | 60009269 | 1 | [Mood 제품 시트](https://www.fractal-design.com/app/uploads/2024/06/Mood-Product-Sheet-EN.pdf) |
| Fractal Pop 2 Vision Black / White RGB | 122643621, 122643690 | 1 | [Black 제품 페이지](https://www.fractal-design.com/products/cases/pop-series/pop-2-vision/pop-2-vision-black/), [White RGB 제품 페이지](https://www.fractal-design.com/products/cases/pop-series/pop-2-vision/pop-2-vision-white-rgb/) — 각각 SKU와 전용 3.5인치 1개를 대조 |
| Fractal Define 7 Black TG Dark | 10910196 | 14 | [Define 7 제품 시트](https://www.fractal-design.com/app/uploads/2020/10/Define-7_Product-Sheet_EN.pdf) — SKU FD-C-DEF7A-03; 6개 포함, Storage Layout 최대 14개 위치 |
| Fractal Meshify 2 Compact Lite Black TG Light Tint | 17884586 | 2 | [Meshify 2 Compact Lite 제품 페이지](https://www.fractal-design.com/ja/products/cases/meshify/meshify-2-compact-lite/black-tg-light-tint/) — SKU FD-C-MEL2C-03; 연결 제품 시트 redirect가 다른 family여서 제품 페이지를 직접 대조 |
| NZXT H6 Flow / H6 Flow RGB (화이트) | 79556882, 79556969 | 1 | [NZXT H6 Flow (2023) 사양](https://support.nzxt.com/hc/en-us/articles/40183529624347-H6-Flow-2023-Specs), [H6 Series 매뉴얼](https://cdn-g.nzxt.com/dl/1698993634-h6-flow_digital-manual_231027_v2-pdf.pdf) |

Fractal North Black Solid, Black TG Dark, White TG Clear의 공식 시트는 3개의 3.5/2.5형 결합 장착 위치와 트레이 2개 포함을 구분합니다. `hddBays=3`은 제조사 최대 위치 수이며, 기본 트레이 외 한 개는 별도 확인 대상입니다. [North 제품 시트](https://assets.fractal-design.com/files/uxzbxy2o/production/23a01a08f4b1cecd7b3efda20f85d8dcee09d891.pdf) North Momentum Edition은 결합 위치 2개입니다. [North Momentum Edition 제품 시트](https://assets.fractal-design.com/files/uxzbxy2o/production/9b2776d0cc8e0249db9357726411061d0d78df1b.pdf)

Pop XL Air의 두 공식 자료는 3.5인치 장착부 분류에서 차이가 있습니다. [제품 페이지](https://www.fractal-design.com/products/cases/pop-series/pop-xl-air/pop-xl-air-rgb-white-tg-clear-tint/)의 주요 안내는 HDD 최대 4개라고 쓰지만 상세 표는 전용 4개와 결합 2개를 나열하고, [제품 시트](https://www.fractal-design.com/app/uploads/2022/06/Pop-XL-Air-RGB_Product-Sheet_EN.pdf)는 전용 0개와 결합 4개를 표시하면서 최대 HDD 4개라고 명시합니다. 호환 검사에는 명시된 최대 HDD 수 4개를 쓰며, 상세 장착부 분류가 일치한다고 가정하지 않습니다.

Epoch Black Solid, Black RGB TG, White TG Clear variants는 [제품 시트](https://assets.fractal-design.com/files/uxzbxy2o/production/63689e50c0c316464914235f9bb29525bd6787c3.pdf)에서 3개 결합 위치와 트레이 2개 포함으로 표시됩니다. 같은 SKU `FD-C-EPO1A-03`의 [현재 제품 페이지](https://www.fractal-design.com/products/cases/epoch-series/epoch/epoch-white-tg-clear-tint/)에는 결합 장착부 2개로 기재돼 있어, 로컬 `hddBays=3`은 최대 위치 수를 따른 값입니다. Epoch XL은 별도 시트에서 2개 결합 트레이 전부 포함으로 표시됩니다.

Meshify 3 계열은 source-sheet의 SKU/drive mount 표를 기준으로 넣었습니다. 일반 Meshify 3 제품 페이지는 결합 장착부 4개라고 표시하지만 [제품 시트](https://assets.fractal-design.com/files/uxzbxy2o/production/50476fee3b3101e6d05d1bd5c1ff30f1738e378b.pdf)는 3.5/2.5인치 수를 2/4로 분리합니다. HDD 호환 필드는 시트의 3.5인치 수 2를 저장하고, 차이는 local source note에 보존했습니다. XL 시트도 3.5인치 2개와 2.5인치 4개를 나눠 표기합니다.

NZXT 두 variant는 공식 지원 사양에서 흰색 SKU `CC-H61FW-01`, `CC-H61FW-R1`과 3.5인치 베이 1개를 함께 대조했습니다. 지원 페이지는 자동 checker에서 HTTP 403을 반환했기 때문에 자동 모델 일치 검증은 H6 Series 매뉴얼에 한정됩니다. variant별 SKU 대조는 저장된 source note에 기록했으며, 해당 범위는 남은 974개 HDD 베이 미확인 케이스와 별도로 구분합니다.

Define R6는 제조사 R6/TG 제품 시트에서 두 variant 모두 기본 universal drive bracket 6개를 확인했고, 제조사 TG 제품 페이지가 저장 레이아웃에 총 11개 위치라고 명시해 HDD 최대 위치 11을 기록했습니다. 블랙 비-TG PCode의 SKU 직접 연결과 단종 페이지 자동 확인은 완료되지 않아 두 overlay를 `manual_required`로 유지했습니다. Torrent Nano 제품 sheet URL은 조회된 PDF가 일반 Torrent 내용으로 열립니다. Define C TG PCode 5353598의 공식 sheet 색인에는 SKU와 2개 혼합 위치가 있으나, legacy PDF는 404이고 접근 가능한 support 문서에 HDD 수가 없어 값은 아직 적용하지 않았습니다.

`data/danawa-pc9-all-pages.json`은 9개 논리 범주에 필요한 10개 소스 범위를 300페이지, 8,872개 고유 상품 코드로 검증했습니다. 넓은 CPU 쿨러 범위는 페이지 반복 때문에 import 대상에서 빼고 공랭·수랭 범위를 사용합니다. 현재 8,872개 코드 중 5,516개는 코어 카탈로그에서 같은 범주로 확인되고, 499개는 주변 부품에 같은 코드가 있으며, 3,275개는 코어 후보 제외 사유가 기록돼 있습니다. 이 분류는 일부 코드에서 겹치므로 합산하지 않습니다. 원천 코드 가운데 설명·처리 상태가 없는 항목은 0개지만, 제외 상품 전체 상세 사양이 정규화돼 있다는 뜻은 아닙니다. 코어 필수 사양 확인은 4,115/5,648개이고, 특히 GPU 43.1%, 케이스 7.2%만 필수 사양이 확인돼 구매·장착 판정에는 여전히 빈틈이 큽니다.

### 주변 부품

현재 주변 부품은 10개 범주 3,886개입니다. 2,081개 공개 목록 상세를 순차 확인했고 요청 실패는 0건이었습니다. 이 중 2,079개는 상세 원문 파싱 후 `live`로 바뀌었고 2개는 상품 상세에도 구조화할 사양 텍스트가 없어 미완료로 남았습니다. 최종 집계는 `live` 3,589개, `incomplete` 255개, seed 42개이며 3,878개에 숫자 가격이 있습니다. PCode 70103243 ARCTIC P14 MAX 피씨디렉트 5팩은 상세 SKU를 확인했고, 가격 갱신일이 오래된 상세 페이지 금액을 공개 리뷰순 목록 캡처에서 2026-09-29 13:42 UTC에 다시 관측했습니다. 가격 값은 54,500원으로 같아졌고 `priceCheckedAt`은 새 목록 관측 시각으로 기록됐습니다. 같은 공개 캡처에서 JBCNC JB-80M 3+4P (화이트, PCode 122714860)를 찾아 상세의 80mm·1팬·25mm 사양과 1,700원을 확인하고 로컬에 추가했습니다. 공개 목록 코드 증거는 이제 3,483/3,647이고 잔여 164개는 아직 미관측입니다. 기존 `storage_accessory` 1,144개 중 795개가 Danawa SSD 본품 목록 ID `112760`에서 들어온 잘못된 범위였습니다. 코어 SSD/HDD와 상품 코드가 정확히 겹친 324개와 공유 분류 규칙상 일반·중고·벌크·병행수입·해외 상품인 471개를 주변 부품 데이터에서 분리하고, 원본은 로컬 [격리 파일](/Users/kimminkyu/Bagelcode/Repository_Personal/pc-supporter/data/accessory-category-quarantine.json)에 보존했습니다. 추가로 코어 카탈로그와 주변 부품 목록에서 코드가 겹친 81개를 올바른 주변 부품 범주로 이동해 현재 코어·주변 부품 사이 상품 코드 중복은 0입니다. 이동 전 코어 행은 [목록 대조 감사 파일](/Users/kimminkyu/Bagelcode/Repository_Personal/pc-supporter/data/accessory-list-reconciliation.json)에 보존했습니다.

Danawa 기본 공개 목록 10개 범주에서 3,463개 고유 코드와 3,456개 가격을 관찰했습니다. 쿨링팬 낮은가격순·높은가격순·신상품순·리뷰순 66페이지 보완 캡처 4건에서 20개 신규 코드를 추가 확인해 전체 코드 증거는 3,483개, 목록 가격 확인은 3,476개가 됐습니다. 기존 가격과 달랐던 1,532개도 갱신했습니다. 아래 9개 범주는 선언된 상품·페이지 수까지 모두 확인했습니다. 쿨링팬은 페이지 반복과 마지막 페이지의 행 수 불일치 때문에 부분 수집 상태를 유지합니다.

| 범주 | 수집 고유 상품 / 전체 | 페이지 | 목록 상태 |
| --- | ---: | ---: | --- |
| 저장장치 주변기기 | 524 / 524 | 18 / 18 | 전체 |
| 쿨링팬 | 1,999 / 2,163 | 73 / 73 + 4개 정렬 보완 | 부분 |
| 써멀그리스 | 213 / 213 | 8 / 8 | 전체 |
| M.2 방열판 | 119 / 119 | 4 / 4 | 전체 |
| 그래픽카드 지지대 | 89 / 89 | 3 / 3 | 전체 |
| 그래픽카드 쿨러 | 105 / 105 | 4 / 4 | 전체 |
| RAM 쿨러 | 71 / 71 | 3 / 3 | 전체 |
| 써멀패드 | 129 / 129 | 5 / 5 | 전체 |
| 팬 허브·컨트롤러 | 90 / 90 | 3 / 3 | 전체 |
| UPS | 144 / 144 | 5 / 5 | 전체 |

쿨링팬 기본 인기순 66~73페이지에서 같은 30개 코드 집합이 반복되어 고유 상품으로 세지 않았습니다. 73번째 페이지는 사이트가 알려준 3개 예상과 다른 30개 행을 반환합니다. 현재 기본 목록 manifest에는 211개 반복 행이 잡히며 `partial-count-mismatch` 상태를 유지합니다. 기본 정렬 원천 고유 목록은 1,979/2,163개입니다. 공개 UI의 낮은가격순·높은가격순·신상품순·리뷰순 66페이지를 각각 추가 확인해 신규 코드 20개를 얻었고, 합산 고유 코드는 1,999/2,163개입니다. 선언 수량 기준 164개는 여전히 관측되지 않아 목록은 부분 상태로 유지합니다. 브라우저에서 `?page=67`을 직접 열어도 페이지 선택은 1로 돌아가므로 이 경로로 누락을 메우지 않았습니다. 현재 주변 부품 카탈로그에는 이번 목록에서 확인되지 않은 Danawa 행 399개가 남아 있습니다. 이 중 313개는 부분 수집 카테고리라 미등재라고 확정할 수 없습니다. 전체 목록에서 확인되지 않은 나머지 86개도 삭제하지 않았으며, 판매 중인지 확인된 것으로 보지 않습니다.

목록 전용으로 새로 들어온 상품은 `dataQuality=incomplete`와 상세 미수집 표시를 유지합니다. 상세 원문이 수집됐다는 뜻은 범주별 호환 사양이 모두 구조화됐다는 뜻이 아닙니다. 3,886개 주변 부품에 대해 범주별 정규화 사양 프로파일을 별도로 계산한 결과는 완전 2,712개, 부분 297개, 미평가 877개입니다. 미평가에는 기계적 호환 규칙이 아직 정의되지 않은 지지대·GPU 쿨러·RAM 쿨러·써멀패드 457개와 범용 저장장치 주변기기 406개가 포함됩니다. 쿨링팬은 2,275개 중 크기 완전 2,252개·부분 23개지만 모터 전류·허브 연결 조건은 별도 확인이 필요합니다. 저장장치 어댑터는 PCIe 슬롯폭·동시 장착 수가 확인되지 않는 상품이 있고, 팬 허브는 팬·RGB 연결 프로파일을 각각 평가합니다. 고객 비교표는 `필수 누락 없음`이라고 넓게 말하지 않고 수집 상태와 항목별 `정보 부족`을 분리합니다. 목록 범위·상세 수집·정규화 사양·실제 호환 근거도 별도 상태입니다.

## 기능 및 자동화 검수

| 영역 | 결과 | 근거 |
| --- | --- | --- |
| 프로덕션 번들 | 통과 | `npm run build`: TypeScript, Vite production build, bundle contract 통과; entry 187.3 KB / 600,000-byte budget |
| 로컬 카탈로그 동봉 빌드 | 통과, 데이터는 부분 | `dist/catalog-data/` 공개 projection 5,648개 코어·3,886개 주변 부품, `dist-local/data/` 비공개 sidecar manifest 24개 파일. manifest `partial`: 코어 목록 8,872/8,872, 주변 기본 목록 3,463/3,647, 4개 정렬 보완에서 새로 확인한 코드 20개를 포함하면 3,483/3,647(잔여 164개 미관측), 필수 사양 확인 코어 4,115/5,648, 주변 부품 프로파일 완전 2,712·부분 297·미평가 877 |
| 코드 테스트 | 통과 | 최신 코드 `npm test`: 284개 파일·1,517개 테스트 통과. `npm run build`는 TypeScript, Vite production bundle, 600KB entry 예산, 공개 projection과 비공개 sidecar 생성을 통과했습니다. |
| 전체 브라우저 흐름 | 통과 | 최신 코드에서 `npm run test:browser`가 격리된 24파일 사본의 124개 흐름을 전부 통과했습니다. 스케줄러·외부 수집은 꺼뒀고 URL 복원·저장/공유·관리자 인증·카탈로그/주변 부품·가격 추적·구매/조립·오프라인 복구·키보드 모달을 포함합니다. |
| 경로 기록 | 통과 | 카탈로그, 자동 구성, 결과, 가격 추적, 주변 부품의 뒤로·앞으로 복원 6개 흐름 |
| 첫 견적 온보딩 | 통과, 사양 확인 필요 | CUA에서 게임·4K/144Hz·높음 옵션·예산 요약까지 눈으로 확인했습니다. 200만원은 4K 권장 450~530만원보다 낮다고 안내하고, 600만원 결과는 초안·정보 부족·VRAM 16GB 경고를 표시합니다. 124개 browser flow와 390px 이동 검사가 통과했습니다. |
| 일반 예산 목표 전달 | 통과 | 200만원 일반 예산은 `high` 목표를 URL/API까지 전달합니다. 최신 데모 결과는 Ryzen 5 3600 + RTX 2060 12GB, 892,480원이며 예산 한도 안에서 1,107,520원이 남습니다. 결과는 목표 사양을 보장하지 않고 호환 정보 부족을 별도로 표시합니다. |
| 불가능한 성능·예산 조합 | 통과 | 최상급·64GB·2TB·외장 GPU에 300만원을 요청하면 초과 draft를 내지 않고 예산 진단과 조건 완화안을 표시. 직접 입력한 고사양 게임·2TB 조합도 정보 부족 상태를 결과로 노출 |
| 게이밍 예산 내 자동 구성 | 통과 | 4K·144Hz·300만원 smoke에서 2,591,400원 RTX 2060 12GB를 선택; 22GB VRAM 기준 미달은 `정보 부족`으로 표시 |
| 예산 구간 비교 | 경고 확인 | QHD 예산 1.76/2.2/2.64백만원 비교에서 세 구성이 모두 예산 안에 표시됐고, 절약형의 VRAM 0.5GB 부족 경고와 균형형·성능형이 같은 결과가 나온 점을 화면에서 확인했습니다. 124개 브라우저 suite도 비교 흐름을 통과했습니다. |
| 호환 예시 견적 | 집중 흐름 통과 | 최종 데이터 사본에서 `test:browser:compatible-demo`가 호환 불가·주의·정보 부족 0개를 확인하고 업그레이드 조합 미리보기를 렌더링 |
| 공개 응답 경계 | 통과 | provenance/source-check 및 benchmark/trust/FPS 신호를 투영에서 제거합니다. `/api/parts/compatible`은 caller-supplied benchmark/trust filter를 무시해 결과 집합과 개수 차이로 내부 기준을 추론하지 못하게 합니다. `candidateReasons`에도 같은 내부 신호 텍스트 검사가 적용됩니다. |
| 프로덕션 관리자 인증 | 통과 | 공개 `/api/meta`에는 관리자 로그인 상태가 없고 인증 요청에만 `adminSessionAuthenticated=true`가 포함됩니다. 전체 브라우저 흐름에서 로그인, protected API, 로그아웃 경계를 확인했고 관리자 로그인 후 원문 재확인 버튼이 제공됩니다. |
| 모바일 가로 폭 | 통과 | 전체 브라우저 suite의 390px 뷰포트에서 홈·편집기·카탈로그·자동 구성·안내·관리자 문서 폭이 모두 390px이고 키보드 모달 흐름도 통과했습니다. 실기기 성능·터치 검증은 별도입니다. |
| 화면 검토 | 대표 화면 확인 | CUA에서 홈, 온보딩 5~8단계, 4K 견적 초안·호환 결과, JBCNC 80mm 팬 가격/규격 상세, 일반 예산 200만원 추천 결과를 캡처해 눈으로 확인했습니다. 캡처는 CUA 결과에 표시됐지만 로컬 이미지 파일로 저장되지 않아 재현 가능한 스크린샷 묶음은 없습니다. |

현재 빌드는 공식 케이스 overlay 65개(자동 SKU 일치 56, 직접 검토 9)를 공개 projection과 비공개 sidecar manifest에 반영했습니다. 코어 필수 사양은 4,115/5,648개, 케이스 complete는 76/1,051개, HDD 베이 위치 확인은 77개이며 974개가 미확인입니다. 코어 목록은 8,872/8,872, 주변 기본 목록은 3,463/3,647, 4개 정렬 보완을 포함한 목록 코드는 3,483/3,647이며 manifest 상태는 `partial`입니다. Sidecar 24개 파일의 해시는 모두 일치했습니다. 최신 시연 `58100/58101`은 새 임시 데이터 폴더에서 실행되고 `/api/health` 200, `storageMode=file`, `adminAuthEnabled=true`를 확인했습니다. CUA에서 JBCNC 흰색 80mm 팬 상세와 일반 예산 200만원의 상급 GPU 목표 결과를 확인했습니다.

`npm run build:local-bundle`는 고객용 공개 projection `dist/catalog-data/`와 정적 웹 경로 밖의 원본 sidecar `dist-local/data/`를 생성합니다. 기본 `npm run build`는 원격·파일 모드 웹 번들만 생성합니다. 공개 projection에는 관리자 provenance/source-check가 노출되지 않고, 두 manifest 모두 현재 `partial`입니다.

최신 격리 preview에서 `QHD 게이밍 220만원` preset을 생성했습니다. 결과는 2,171,160원이고 예산 잔액은 28,840원입니다. 호환 검사는 불가 0·주의 0·정보 부족 1이며, CPU 전력·메인보드 전원부 용량 확인과 다시 확인해야 할 가격 1종을 표시합니다. QA 흐름에서만 견적을 임시 데이터 사본에 저장하고 저장 목록에서 재열기해 v1 기록을 확인했습니다. 저장 데이터와 일회성 복구 코드는 격리 테스트에만 사용했습니다.

가격 표시도 사양 수집 상태와 가격 확인 시각을 분리합니다. `priceCheckedAt`이 없거나 3일보다 오래된 숫자 가격은 핵심·주변 카탈로그와 가격 추적 검색에서 `다시 확인`으로 표시하고, 사양 수집 상태는 `다나와 상세 수집`으로 표시합니다. 최신 시연의 브라우저 로컬 가격 추적 목록에는 JBCNC JB-80M 3+4P (화이트) 1,700원 항목을 등록해 `가격 추적 중` 상태를 확인했습니다. 목표가는 아직 설정하지 않았고, 기록된 가격 변동이 없는 상태를 화면에 그대로 표시합니다. 이 가격도 실제 판매처 결제 금액을 보증하지 않습니다.

현재 코드 기준 전체 단위 테스트는 284개 파일·1,517개 테스트가 통과했고, 최신 격리 데이터 사본에서 124개 브라우저 흐름도 모두 통과했습니다. browser smoke는 390px 가로 폭과 키보드 모달 흐름을 포함합니다. 실제 휴대전화의 터치·프레임 속도 검수는 하지 않았습니다.
초기 QA 한 번은 이미 다른 프로세스가 사용 중이던 `5204/4216` preview에 접속해 관리자 로그인에서 실패했습니다. 페이지 진입 때 `app_open` 사용 이벤트 한 건이 기록됐을 가능성이 있습니다. 크롤링, 카탈로그 변경, 견적 저장·공유 검증은 그 서버에서 실행하지 않았고 기존 프로세스는 건드리지 않았습니다. 이후 점유된 QA 포트 `58086/58087`도 건드리지 않고, 최신 124개 검수는 새 격리 서버 `58104/58105`에서 통과했습니다. 재발 방지를 위해 `preview-full.mjs`는 Vite strict-port를 사용합니다.

수정 전 경계 동작 기록(2026-09-29): Cyberpunk 2077·QHD·144Hz·높음·2TB SSD와 300만원을 직접 요청하면 합계 780,910원의 Athlon 3000G·AFOX G210 구성이 반환됐습니다. 이 결과는 이후 엔진 수정 전 동작이며 현재 코드의 대표 추천 결과로 사용하지 않습니다. 최신 parser는 GPU VRAM 0.5GB를 제공하고 공개 응답은 QHD 기준에 부족할 수 있다는 경고를 표시하지만, 이 저가 구성은 사용자가 설정한 게임 목표 달성을 뜻하지 않습니다. 시연용 기준 경로는 QHD 220만원 preset이며, 그 결과도 CPU 전력/메인보드 전원부 정보를 확인하기 전까지 구매 확정이 아닙니다.

추가로 원본 `data/`에 대해 GPU `powerW` 누락 4개와 케이스 `hddBays` 누락 4개를 공개 Danawa 상세에서 다시 확인했습니다. 8개 요청 모두 성공했지만 GPU 전력·권장 파워·길이와 케이스 HDD 베이 누락은 그대로였고, 이미지 8개와 케이스 가격 1개만 달라졌습니다. 이 결과는 해당 상세 재확인 경로로 남은 필수 사양이 자동 보강되지 않음을 보여 주며, 제조사 원문 근거가 더 필요합니다.

기존 in-app 브라우저의 5181 origin에서는 `/start`가 일반 오류 화면으로 떨어졌지만, 기존 저장 상태를 지우지 않고 새 5182 origin에서 온보딩을 열었고 자동화의 새 프로필 테스트도 통과했습니다. 저장된 키를 개별적으로 특정하지는 못했습니다. 같은 주소에서 상태 오류를 만나면 기존 브라우저 데이터를 삭제하지 말고 새 포트를 사용하도록 실행 안내에 반영했습니다.

시각 상태는 CUA 캡처로 확인했습니다. 홈, 온보딩 게임 목표와 예산, 4K 견적 초안·VRAM 경고, 호환 상세, 신규 주변 부품 가격 상태를 직접 확인했습니다. CUA는 화면 이미지를 도구 응답에만 표시하고 로컬 파일로 저장하는 경로를 제공하지 않아 보고서에 캡처를 첨부하지 않았습니다. 따라서 스크린샷 파일을 재검토 가능한 완전 시각 감사로는 주장하지 않습니다.

## 서비스 시연 한계

- 자동 구성 예시는 목표와 VRAM 기준이 맞지 않을 수 있습니다. 4K·144Hz·300만원 smoke는 예산 내 2,591,400원 구성을 만들었지만 GPU가 RTX 2060 12GB여서 보수적 VRAM 기준 22GB보다 낮고 `정보 부족`으로 표시됩니다. 실제 게임 FPS를 보장하지 않으며, 구매 전 플레이할 게임의 권장 사양을 확인해야 합니다.
- QHD 144Hz에 고사양 게임·2TB SSD를 지정한 300만원 요청은 예산 안의 저가 부품 초안으로 내려갈 수 있습니다. 이는 부품이 게임 목표를 만족한다는 판정이 아니며, 결과 카드의 `정보 부족`과 목표 조건을 함께 설명해야 합니다. 시연용 기준 경로는 QHD 220만원 preset이며, 그 결과도 메인보드 전원부 용량 확인 전까지 구매 확정 상태가 아닙니다.
- QHD 예산 비교의 절약형은 GTX 1650 4GB를 선택해 QHD 게임 목표에 부족할 수 있습니다. 각 예산 안에서 부품을 찾았다는 표시와 게임 성능 목표 충족 여부는 서로 다릅니다.
- 표기 가격은 관찰된 참고값입니다. 구매 전에 판매처 상품 페이지에서 옵션, 현재 재고, 배송비와 결제 금액을 확인해야 합니다.
- 공식 케이스 overlay의 `hddBays`는 최대 장착 위치 수이며, 포함 트레이 수와 같다고 보장하지 않습니다. 일부 케이스는 추가 트레이·브래킷이 필요하므로 HDD 조립 전 기본 구성품을 확인해야 합니다.
- 시연 서버는 파일 저장이고 PostgreSQL이 연결되지 않았습니다. 다중 사용자 공유, 장애 복구, 백업, 운영 배포는 검증되지 않았습니다.
- 결제, 주문 제출, 판매처 재고 동기화, 실제 조립 및 물리 기기 테스트는 범위 밖입니다.
- 자동 수집과 가격 갱신은 시연 중 꺼져 있습니다. 가격 추적 화면은 저장된 카탈로그 가격을 다시 읽으며 새 원문 가격을 수집하지 않습니다. /admin에서 보호된 수동 재확인을 실행하면 외부 Danawa 요청이 발생합니다. 관리자 인증을 켠 서비스에서는 고객 상세의 원문 갱신 버튼을 숨기고 이 데이터 센터에서만 갱신할 수 있습니다.
- 주변 부품 호환 판정은 저장장치 어댑터, M.2 방열판, 쿨링팬·허브의 일부 커넥터·전기 조건, UPS 출력 용량에 한정됩니다. 써멀그리스, GPU 지지대·쿨러, RAM 쿨러, 써멀패드는 실제 장착·기계적 호환 판정 규칙이 없으므로 직접 맞는지 확인해야 합니다.
- 주변 부품 `dataQuality=live`는 “다나와 상세 수집” 상태이지 “최신 정보” 또는 각 추천·호환 규칙의 모든 사양 확인이 아닙니다. 표에는 필요한 값별 `정보 부족`을 표시합니다. 그래픽카드 지지대·GPU 쿨러·메모리 쿨러·써멀패드 등은 기계적 호환 검사가 없습니다.
- 관리자 주변 부품 범위의 누락 표기 비율은 `missingFields`를 계산한 값이며, 구매 적합성이나 기계적·전기적 호환 통과율이 아닙니다.
- 고객 공개 응답과 공유 비교 요청에서는 benchmark/trust/FPS 내부 근거를 제외했습니다. 내부 검수 패널은 관리자 전용이며 고객용 추천 점수로 표시하지 않습니다.

## 검수 단계 요약

| 단계 | 화면·동작 | 상태 |
| ---: | --- | --- |
| 1 | 홈에서 새 견적 진입과 부품 직접 선택 진입 | 124개 browser flow 통과; CUA 홈 화면도 육안 확인 |
| 2 | 게임·작업·예산·사양 온보딩의 다음/뒤로 이동 | 124개 browser flow 통과; CUA에서 각 단계의 진행 위치·4K 권장 예산 상태 확인 |
| 3 | 자동 구성 및 결과 확인, 설정을 URL로 복원 | 124개 browser flow 통과; CUA에서 4K 144Hz 결과의 VRAM 부족 경고 확인 |
| 4 | 코어 부품 목록·필터·상세·가격 참고 안내 | 124개 browser flow 통과; 누락 사양과 재확인 가격 표기 확인 |
| 5 | 주변 부품 10개 범주·상세·가격 이력 | 124개 browser flow 통과; JBCNC 화이트 80mm 팬·1,700원·가격 확인 시각을 상세에서 확인 |
| 6 | 저장 견적·공유 비교·가격 추적·구매 준비·조립 확인 | 124개 browser flow 통과; 최신 데모 브라우저에는 JBCNC 팬의 로컬 가격 추적 예시가 준비됨 |
| 7 | 관리자 카탈로그 및 사양 보강 패널 | 124개 browser flow 통과; 로그인/로그아웃, 관리자 큐 및 인증된 갱신 동작 확인 |
| 8 | 390px 모바일 배치와 키보드 모달 이동 | 124개 browser flow에서 가로폭·키보드 이동 통과; 실기기 검증은 별도 |

## 증거를 다시 만드는 명령

`test:browser`는 관리자·저장·공유 상태를 테스트 서버 데이터에 씁니다. 현재 데모 `58100/58101`은 건드리지 말고 별도 QA preview 예시 `58104/58105`에 새 임시 데이터 사본을 사용하세요. 실행 전 두 포트가 비어 있는지 `lsof -nP -iTCP:58104 -sTCP:LISTEN` 및 `lsof -nP -iTCP:58105 -sTCP:LISTEN`으로 확인하고, 어느 쪽이든 사용 중이면 다른 빈 포트 쌍을 선택합니다. `preview:full`은 Vite preview를 strict port 모드로 실행해 사용 중인 포트에서 자동으로 다른 서버를 띄우지 않습니다. 테스트 데이터 사본은 [2단계](local-demo-runbook.md#2-시연-전용-데이터-폴더-만들기)의 복사 절차를 사용합니다.

```sh
npm run build
npm test
export NODE_ENV=production
export DATABASE_URL=''
export PC_SUPPORTER_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pc-supporter-browser-qa.XXXXXX")"
cp data/catalog.json data/accessories.json data/catalog-change-log.json \
  data/benchmark-overrides.json data/gaming-performance-evidence.json \
  data/gpu-physical-overrides.json data/case-rgb-load-overrides.json \
  data/cooling-fan-load-overrides.json data/m2-slot-overrides.json \
  data/catalog-spec-overrides.json data/catalog-spec-override-source-check-history.json \
  data/accessory-coverage.json data/accessory-crawl-manifest.json data/accessory-crawl-state.json \
  "$PC_SUPPORTER_DATA_DIR/"
for optional_data_file in data/physical-source-check-history.json data/benchmark-source-check-history.json \
  data/catalog-spec-refresh-history.json data/catalog-seed-mappings.json; do
  if [ -f "$optional_data_file" ]; then cp "$optional_data_file" "$PC_SUPPORTER_DATA_DIR/"; fi
done
read -s "ADMIN_PASSWORD?격리 QA 관리자 비밀번호: "
printf '\n'
export ADMIN_PASSWORD
export ADMIN_SESSION_SECRET="$(openssl rand -hex 32)"
export PRICE_REFRESH_SCHEDULER_ENABLED=false
export BUILD_MONITOR_SCHEDULER_ENABLED=false
export DANAWA_CRAWL_SCHEDULER_ENABLED=false
export DANAWA_CRAWL_ON_START=false
export PREVIEW_PORT=58104
export PREVIEW_API_PORT=58105
export PREVIEW_HOST=127.0.0.1
export PREVIEW_API_HOST=127.0.0.1
npm run preview:full
```

별도 터미널에서 같은 격리 QA 관리자 비밀번호를 `BROWSER_SMOKE_ADMIN_PASSWORD`로 입력해 검수를 실행합니다.

```sh
read -s "BROWSER_SMOKE_ADMIN_PASSWORD?격리 QA 관리자 비밀번호: "
printf '\n'
export BROWSER_SMOKE_ADMIN_PASSWORD
BROWSER_SMOKE_BASE_URL=http://127.0.0.1:58104 npm run test:browser
BROWSER_SMOKE_BASE_URL=http://127.0.0.1:58104 npm run test:browser:compatible-demo
BROWSER_SMOKE_BASE_URL=http://127.0.0.1:58104 npm run test:browser:generator-selection-reasons
BUDGET_LADDER_SUMMARY_SMOKE_BASE_URL=http://127.0.0.1:58104 npm run test:browser:budget-ladder-summary
BROWSER_SMOKE_BASE_URL=http://127.0.0.1:58104 QUOTE_ONBOARDING_SMOKE_TIMEOUT_MS=30000 npm run test:browser:quote-onboarding
```

저장된 화면 캡처 파일은 첨부하지 않았습니다. 브라우저 smoke와 가로 폭 검사는 동작·가로 넘침만 확인하며, 시각적 위계·글꼴·실기기 화면 검토를 대신하지 않습니다.
