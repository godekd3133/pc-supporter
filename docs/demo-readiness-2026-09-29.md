# PC Supporter 시연 준비 검수 — 2026-09-29

## 판정

**기능 흐름을 보여주는 내부·로컬 데모는 준비됐습니다. 실구매 견적이나 운영 서비스로 판정할 데이터·인프라 상태는 아닙니다.** 재현 절차는 [로컬 시연 실행 안내](local-demo-runbook.md)를 따릅니다.

검수 기준은 2026-09-29 KST입니다. 코어 카탈로그 5,648개와 주변 부품 3,874개를 확인했습니다. Danawa 원문에서 GPU 전력값 69개를 복구하고, 케이스의 단위가 명시된 냉각기 높이 범위 5개를 파싱했습니다. 제조사 공식 자료·모델/SKU와 다나와 상품 코드가 대조된 케이스 26개에 3.5인치 HDD 베이 수를 보강했습니다. H6 Flow 두 SKU는 공식 NZXT 지원 사양에서 variant를 별도로 대조했고 자동 source-check는 H6 Series 매뉴얼의 모델명을 확인했습니다. 코어·주변 부품 PCode 중복은 0입니다. 주변 부품 목록 수집에서 새로 관측한 상품은 517개이고, 코어 쪽에 섞여 있던 주변 부품 81개는 해당 범주로 이동했습니다. `data/*.json`은 Git ignore 대상이라 카탈로그와 보강값은 이 작업 폴더의 로컬 데이터입니다. 가격은 구매 시점 가격이 아니며, 시연을 다시 띄운 뒤 `/api/meta`와 각 상품 페이지에서 범위·확인 시점을 살펴봐야 합니다.

## 카탈로그 범위

### 핵심 부품

현재 코어 카탈로그는 9개 범주 5,648개입니다. 주변 부품 목록과 PCode가 겹친 SSD 부속 7개와 UPS 74개를 코어 범주에서 분리해 주변 부품 범주에 보관했습니다.

| 범주 | 상품 수 | 필수 사양 확인 |
| --- | ---: | ---: |
| CPU | 380 | 94.5% |
| CPU 쿨러 | 56 | 80.4% |
| 메인보드 | 960 | 94.6% |
| RAM | 591 | 99.8% |
| 그래픽카드 | 819 | 43.1% |
| SSD | 470 | 98.5% |
| HDD | 220 | 100.0% |
| 케이스 | 1,051 | 3.6% |
| 파워서플라이 | 1,101 | 98.5% |
| **전체** | **5,648** | **71.9%** |

필수 사양이 확인된 상품은 4,060개, 부분 확인은 1,588개입니다. GPU의 `powerW` 누락은 405개에서 336개로 줄었습니다. 69개 값은 원문에 있는 `사용전력: 최대 N W` 표기에서만 복구했으며, 권장 파워 용량을 GPU 소비전력으로 바꾸지 않았습니다. GPU 완전 사양은 353/819개(43.1%)입니다. 케이스 냉각기 최대 높이의 닫힌 mm 범위 5개는 상한값을 적용했고, 나머지 단위 없는 값과 열린 범위는 자동 변환하지 않았습니다. 제조사 자료로 베이 수를 확인한 케이스는 26개이며, 확인 전 26개에서 38개로 늘었습니다. 시연 예시 Pop XL Air의 HDD 베이 수도 [제조사 사양](https://www.fractal-design.com/products/cases/pop/pop-xl-air/rgb-black-tg-clear)의 4개 전용+2개 겸용 장착부에 맞춰 8개에서 6개로 정정했습니다. 여전히 1,013/1,051 케이스에서 `hddBays`가 없고, GPU도 336개에서 `powerW`가 없어 카탈로그 전체가 구매·조립 검증용으로 충분하지는 않습니다. 가격 값은 5,629개에서 있고 19개는 미확인입니다. 코어 가격 중 `priceCheckedAt`이 명시된 것은 194개뿐이며, 가격이 있는 나머지 5,435개는 `updatedAt`을 대신 보여 줄 수 있어도 가격 재확인을 보증하지 않습니다.

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
| Fractal North 및 Momentum Edition 3종 | 18448688, 18448790, 108416054 | 2 | [North 제품 시트](https://assets.fractal-design.com/files/uxzbxy2o/production/23a01a08f4b1cecd7b3efda20f85d8dcee09d891.pdf), [North Momentum 제품 시트](https://assets.fractal-design.com/files/uxzbxy2o/production/9b2776d0cc8e0249db9357726411061d0d78df1b.pdf) |
| Fractal Meshify 2 Compact / Define 7 Compact | 13489595, 11479695 | 2 | [Meshify 2 Compact 제품 시트](https://assets.fractal-design.com/files/uxzbxy2o/production/957ad6ea3e40c76bf4dbae6baf505bad55f3984d.pdf), [Define 7 Compact 제조사 사양](https://www.fractal-design.com/products/cases/define-series/define-7-compact/define-7-compact-black-solid/) |
| NZXT H6 Flow / H6 Flow RGB (화이트) | 79556882, 79556969 | 1 | [NZXT H6 Flow (2023) 사양](https://support.nzxt.com/hc/en-us/articles/40183529624347-H6-Flow-2023-Specs), [H6 Series 매뉴얼](https://cdn-g.nzxt.com/dl/1698993634-h6-flow_digital-manual_231027_v2-pdf.pdf) |

Fractal North 일반 모델 시트에는 3개의 3.5/2.5형 결합 위치 중 2개가 포함된다고 적혀 있습니다. [North 제품 시트](https://assets.fractal-design.com/files/uxzbxy2o/production/23a01a08f4b1cecd7b3efda20f85d8dcee09d891.pdf) 기준 두 일반 모델의 `hddBays=2`는 포함된 장착부 수를 뜻하며, 구성에 포함되지 않은 세 번째 위치는 기본 조립 가능 수에 넣지 않았습니다. North Momentum Edition은 제조사 시트에서 결합 위치 2개로 표기됩니다. [North Momentum Edition 제품 시트](https://assets.fractal-design.com/files/uxzbxy2o/production/9b2776d0cc8e0249db9357726411061d0d78df1b.pdf)

NZXT 두 variant는 공식 지원 사양에서 흰색 SKU `CC-H61FW-01`, `CC-H61FW-R1`과 3.5인치 베이 1개를 함께 대조했습니다. 지원 페이지는 자동 checker에서 HTTP 403을 반환했기 때문에 자동 모델 일치 검증은 H6 Series 매뉴얼에 한정됩니다. variant별 SKU 대조는 저장된 source note에 기록했으며, 해당 범위는 남은 1,013개 미확인 케이스와 별도로 구분합니다.

`data/danawa-pc9-all-pages.json`은 9개 논리 범주에 필요한 10개 소스 범위를 300페이지, 8,872개 고유 상품 코드로 검증했습니다. 넓은 CPU 쿨러 범위는 페이지 반복 때문에 import 대상에서 빼고 공랭·수랭 범위를 사용합니다. 현재 8,872개 코드 중 5,516개는 코어 카탈로그에서 같은 범주로 확인되고, 499개는 주변 부품에 같은 코드가 있으며, 3,275개는 코어 후보 제외 사유가 기록돼 있습니다. 이 분류는 일부 코드에서 겹치므로 합산하지 않습니다. 원천 코드 가운데 설명·처리 상태가 없는 항목은 0개지만, 제외 상품 전체 상세 사양이 정규화돼 있다는 뜻은 아닙니다. 코어 필수 사양 확인은 4,060/5,648개이고, 특히 GPU 43.1%, 케이스 3.6%만 필수 사양이 확인돼 구매·장착 판정에는 여전히 빈틈이 큽니다.

### 주변 부품

현재 주변 부품은 10개 범주 3,874개입니다. 2,081개 공개 목록 상세를 순차 확인했고, 요청 실패는 0건입니다. 이 중 2,079개는 상세 원문 파싱 후 `live`로 바뀌었고 2개는 상품 상세에도 구조화할 사양 텍스트가 없어 미완료로 남았습니다. 최종 집계는 `live` 3,587개, `incomplete` 245개, seed 42개이며 3,866개에 가격 값이 있습니다. 미완료 245개 중 241개 쿨링팬은 이번 부분 목록에서 확인되지 않았고, 2개는 다른 수집 범위의 기존 데이터, 2개는 상세 원문이 없는 APC 교체 배터리와 Coms G3527입니다. APC 배터리는 UPS 본체가 아니므로 범주 정합성 검토 대상으로 남겼습니다. 기존 `storage_accessory` 1,144개 중 795개가 Danawa SSD 본품 목록 ID `112760`에서 들어온 잘못된 범위였습니다. 코어 SSD/HDD와 상품 코드가 정확히 겹친 324개와 공유 분류 규칙상 일반·중고·벌크·병행수입·해외 상품인 471개를 주변 부품 데이터에서 분리하고, 원본은 로컬 [격리 파일](/Users/kimminkyu/Bagelcode/Repository_Personal/pc-supporter/data/accessory-category-quarantine.json)에 보존했습니다. 추가로 코어 카탈로그와 주변 부품 목록에서 코드가 겹친 81개를 올바른 주변 부품 범주로 이동해 현재 코어·주변 부품 사이 상품 코드 중복은 0입니다. 이동 전 코어 행은 [목록 대조 감사 파일](/Users/kimminkyu/Bagelcode/Repository_Personal/pc-supporter/data/accessory-list-reconciliation.json)에 보존했습니다.

Danawa 공개 목록을 대조한 결과 10개 범주에서 3,463개 고유 코드를 확보하고, 3,456개 가격을 관찰했습니다. 기존 가격과 달랐던 1,532개도 갱신했습니다. 아래 9개 범주는 선언된 상품·페이지 수까지 모두 확인했습니다. 쿨링팬은 페이지 반복과 마지막 페이지의 행 수 불일치 때문에 부분 수집 상태를 유지합니다.

| 범주 | 수집 고유 상품 / 전체 | 페이지 | 목록 상태 |
| --- | ---: | ---: | --- |
| 저장장치 주변기기 | 524 / 524 | 18 / 18 | 전체 |
| 쿨링팬 | 1,979 / 2,163 | 73 / 73 | 부분 |
| 써멀그리스 | 213 / 213 | 8 / 8 | 전체 |
| M.2 방열판 | 119 / 119 | 4 / 4 | 전체 |
| 그래픽카드 지지대 | 89 / 89 | 3 / 3 | 전체 |
| 그래픽카드 쿨러 | 105 / 105 | 4 / 4 | 전체 |
| RAM 쿨러 | 71 / 71 | 3 / 3 | 전체 |
| 써멀패드 | 129 / 129 | 5 / 5 | 전체 |
| 팬 허브·컨트롤러 | 90 / 90 | 3 / 3 | 전체 |
| UPS | 144 / 144 | 5 / 5 | 전체 |

쿨링팬은 뒤쪽 페이지에서 동일 상품코드 181행이 반복되어 고유 상품으로 세지 않았습니다. 73번째 페이지는 사이트가 알려준 3개 예상과 다른 30개 행을 반환하고, 30개 코드가 앞선 페이지와 중복되어 목록을 `partial-count-mismatch`로 남겼습니다. 고유 목록은 1,979/2,163개이며 184개 코드는 아직 보지 못했습니다. 현재 주변 부품 카탈로그에는 이번 목록에서 확인되지 않은 Danawa 행 399개가 남아 있습니다. 이 중 313개는 부분 수집 카테고리라 미등재라고 확정할 수 없습니다. 전체 목록에서 확인되지 않은 나머지 86개도 삭제하지 않았으며, 판매 중인지 확인된 것으로 보지 않습니다.

목록 전용으로 새로 들어온 상품은 `dataQuality=incomplete`와 상세 미수집 표시를 유지합니다. 상세 원문이 수집됐다는 뜻은 범주별 호환 사양이 모두 구조화됐다는 뜻이 아닙니다. 3,874개 주변 부품에 대해 범주별 정규화 사양 프로파일을 별도로 계산한 결과는 완전 2,700개, 부분 297개, 미평가 877개입니다. 미평가에는 기계적 호환 규칙이 아직 정의되지 않은 지지대·GPU 쿨러·RAM 쿨러·써멀패드 457개와 범용 저장장치 주변기기 406개가 포함됩니다. 쿨링팬은 2,263개 중 크기 완전 2,240개·부분 23개지만 모터 전류·허브 연결 조건은 별도 확인이 필요합니다. 저장장치 어댑터는 PCIe 슬롯폭·동시 장착 수가 확인되지 않는 상품이 있고, 팬 허브는 팬·RGB 연결 프로파일을 각각 평가합니다. 고객 비교표는 `필수 누락 없음`이라고 넓게 말하지 않고 수집 상태와 항목별 `정보 부족`을 분리합니다. 목록 범위·상세 수집·정규화 사양·실제 호환 근거도 별도 상태입니다.

## 기능 및 자동화 검수

| 영역 | 결과 | 근거 |
| --- | --- | --- |
| 프로덕션 번들 | 통과 | `npm run build`: TypeScript, Vite production build, bundle contract 통과; entry 187.3 KB / 600,000-byte budget |
| 로컬 카탈로그 동봉 빌드 | 빌드 통과, 데이터는 부분 | `dist/catalog-data/` 공개 projection 5,648개 코어·3,874개 주변 부품, `dist-local/data/` 비공개 sidecar 23개. manifest `partial`: 코어 목록 8,872/8,872, 주변 목록 3,463/3,647(팬 184개 미관측), 필수 사양 확인 코어 4,060/5,648, 주변 부품 프로파일 완전 2,700·부분 297·미평가 877 |
| 코드 테스트 | 통과 | 현재 변경 후 `npm test`: 283개 파일·1,505개 테스트 통과. 주변 부품·가격·온보딩 관련 3개 파일 56개 focused tests도 통과했고, `npm run build`의 TypeScript 검사도 통과했습니다. |
| 전체 브라우저 흐름 | 통과 | 현재 빌드와 새 카탈로그 사본을 쓴 격리 preview `5210/4223`에서 홈·생성·저장·공유·관리자·액세서리·구매·조립·복구 등 124개 흐름 통과; 5206 시연 데이터와 분리 |
| 경로 기록 | 통과 | 카탈로그, 자동 구성, 결과, 가격 추적, 주변 부품의 뒤로·앞으로 복원 6개 흐름 |
| 첫 견적 온보딩 | 흐름 통과, 사양 확인 필요 | `test:browser:quote-onboarding` 데스크톱·390px 모바일 분기 통과. 5206 실제 화면에서 QHD·144Hz 목표가 예산 화면·최종 요약까지 유지되는 것을 확인. QHD 220만원 preset은 2,171,160원 구성을 만들고 28,840원 여유를 남겼습니다. 호환 검사는 불가 0·주의 0·정보 부족 1이며, 메인보드 전원부 용량 확인이 남습니다. |
| 불가능한 성능·예산 조합 | 통과 | 최상급·64GB·2TB·외장 GPU에 300만원을 요청하면 초과 draft를 내지 않고 예산 진단과 조건 완화안을 표시. 직접 입력한 고사양 게임·2TB 조합도 정보 부족 상태를 결과로 노출 |
| 예산 내 자동 구성 | 통과 | 4K·144Hz·300만원 smoke에서 2,591,400원 RTX 2060 12GB를 선택; 22GB VRAM 기준 미달은 `정보 부족`으로 표시 |
| 예산 구간 비교 | 통과 | 1.76/2.2/2.64백만원 안이 각 목표 예산 이내이고 GPU·합계 차이를 비교표에서 표시 |
| 호환 예시 견적 | 통과 | 현재 빌드에서 `test:browser:compatible-demo`가 호환 불가·주의·정보 부족 0개를 확인하고 업그레이드 조합 미리보기를 렌더링 |
| 공개 응답 경계 | 통과 | 관리자 provenance/source-check 및 benchmark/trust/FPS 신호 제거; 공개 benchmark sort는 점수 순서를 드러내지 않음 |
| 프로덕션 관리자 인증 | 통과 | 관리자 로그인 포함 전체 smoke 통과; 공개 `/api/meta`에는 benchmark coverage가 없고 `/api/admin/*`는 관리자 인증 대상 |
| 모바일 가로 폭 | 통과 | 390px에서 홈·편집기·카탈로그·자동 구성·안내·관리자 모두 문서 가로 폭 390px |
| 화면 검토 | 수동 화면 확인, 저장 캡처 미완료 | 5206 로컬 관리자 화면에서 프로파일 커버리지와 경고 문구를 확인하고 온보딩·결과 흐름을 다시 살폈습니다. 브라우저 캡처 파일 저장 경로가 없어 화면 배치·폰트·시각 위계의 재현 가능한 이미지 증거는 남기지 못했습니다. |

2026-09-29 최종 카탈로그 사본을 사용한 격리 preview에서 기능 검수를 끝냈습니다. 이번 변경 후 브라우저 smoke 124개 흐름, 온보딩 데스크톱·모바일, 선택 이유, 예산 ladder, 호환 예시 견적을 통과했습니다. 호환 예시 견적은 결과 상태 0/0/0을 확인했습니다. 예산이 목표와 맞지 않는 조합은 초과 가격으로 최종 draft를 내지 않고 사용자가 조건을 조정하도록 진단을 보여 줍니다. 이전 preview는 loopback `http://127.0.0.1:5201/`, API `127.0.0.1:4213`이었습니다. 이번 변경을 포함한 현재 bundle preview는 `http://127.0.0.1:5206/`, API `127.0.0.1:4219`에서 `/api/health` 200, `storageMode=file`, 관리자 인증 활성화, 코어 5,648개·주변 부품 3,874개를 반환합니다. manifest 상태는 `partial`입니다.

`npm run build`는 고객용 공개 projection `dist/catalog-data/`와 정적 웹 경로 밖의 원본 sidecar `dist-local/data/`를 모두 생성합니다. 공개 projection에는 관리자 provenance/source-check가 노출되지 않고, 두 manifest 모두 현재 `partial`입니다.

현재 빌드의 고객 흐름을 다시 재생했습니다. QHD·144Hz 목표는 300만원 예산과 최종 요약에서도 유지됩니다. `QHD 게이밍 220만원` preset에서 재생성한 결과는 2,171,160원이고 예산 잔액은 28,840원입니다. 결과 상태는 `정보 부족`이며 세부 호환 검사는 CPU 전력·메인보드 전원부 용량 데이터 1개를 확인하도록 표시합니다. 화면의 경고를 확인한 뒤 견적 저장·공유는 실행하지 않았습니다.

전체 브라우저 smoke는 사용 중인 demo copy를 건드리지 않도록 별도 데이터 사본과 loopback `http://127.0.0.1:5210/`, API `127.0.0.1:4223`에서 실행해 124개 흐름을 통과했습니다.

별도 경계 입력도 확인했습니다. Cyberpunk 2077·QHD·144Hz·높음·2TB SSD와 300만원을 직접 요청하면 합계 780,910원의 Athlon 3000G·AFOX G210 구성이 `정보 부족` 3개와 함께 나옵니다. 생성기는 예산을 상한으로 쓰며 게임 성능은 FPS·VRAM 확인 자료로만 확정합니다. 이 결과를 QHD 게이밍 목표 달성으로 소개하지 않고, 데모에서는 결과 경고와 목표 충족 여부를 같이 보여줘야 합니다.

추가로 원본 `data/`에 대해 GPU `powerW` 누락 4개와 케이스 `hddBays` 누락 4개를 공개 Danawa 상세에서 다시 확인했습니다. 8개 요청 모두 성공했지만 GPU 전력·권장 파워·길이와 케이스 HDD 베이 누락은 그대로였고, 이미지 8개와 케이스 가격 1개만 달라졌습니다. 이 결과는 해당 상세 재확인 경로로 남은 필수 사양이 자동 보강되지 않음을 보여 주며, 제조사 원문 근거가 더 필요합니다.

기존 in-app 브라우저의 5181 origin에서는 `/start`가 일반 오류 화면으로 떨어졌지만, 기존 저장 상태를 지우지 않고 새 5182 origin에서 온보딩을 열었고 자동화의 새 프로필 테스트도 통과했습니다. 저장된 키를 개별적으로 특정하지는 못했습니다. 같은 주소에서 상태 오류를 만나면 기존 브라우저 데이터를 삭제하지 말고 새 포트를 사용하도록 실행 안내에 반영했습니다.

시각 상태는 in-app browser screenshot으로 확인했으나, 그 캡처를 로컬 파일로 저장하는 지원 경로가 없어 현재 보고서에는 첨부하지 않았습니다. 따라서 재현 가능한 스크린샷 기반 시각 감사로 간주하지 않습니다.

## 서비스 시연 한계

- 자동 구성 예시는 목표와 VRAM 기준이 맞지 않을 수 있습니다. 4K·144Hz·300만원 smoke는 예산 내 2,591,400원 구성을 만들었지만 GPU가 RTX 2060 12GB여서 보수적 VRAM 기준 22GB보다 낮고 `정보 부족`으로 표시됩니다. 실제 게임 FPS를 보장하지 않으며, 구매 전 플레이할 게임의 권장 사양을 확인해야 합니다.
- QHD 144Hz에 고사양 게임·2TB SSD를 지정한 300만원 요청은 예산 안의 저가 부품 초안으로 내려갈 수 있습니다. 이는 부품이 게임 목표를 만족한다는 판정이 아니며, 결과 카드의 `정보 부족`과 목표 조건을 함께 설명해야 합니다. 시연용 기준 경로는 QHD 220만원 preset이며, 그 결과도 메인보드 전원부 용량 확인 전까지 구매 확정 상태가 아닙니다.
- QHD 예산 비교의 절약형은 GTX 1650 4GB를 선택해 QHD 게임 목표에 부족할 수 있습니다. 각 예산 안에서 부품을 찾았다는 표시와 게임 성능 목표 충족 여부는 서로 다릅니다.
- 표기 가격은 관찰된 참고값입니다. 구매 전에 판매처 상품 페이지에서 옵션, 현재 재고, 배송비와 결제 금액을 확인해야 합니다.
- 시연 서버는 파일 저장이고 PostgreSQL이 연결되지 않았습니다. 다중 사용자 공유, 장애 복구, 백업, 운영 배포는 검증되지 않았습니다.
- 결제, 주문 제출, 판매처 재고 동기화, 실제 조립 및 물리 기기 테스트는 범위 밖입니다.
- 자동 수집과 가격 갱신은 시연 중 임의 실행되지 않도록 껐습니다. 관리자에서 수동 실행하면 외부 Danawa 요청이 발생합니다.
- 주변 부품 호환 판정은 저장장치 어댑터, M.2 방열판, 쿨링팬·허브의 일부 커넥터·전기 조건, UPS 출력 용량에 한정됩니다. 써멀그리스, GPU 지지대·쿨러, RAM 쿨러, 써멀패드는 실제 장착·기계적 호환 판정 규칙이 없으므로 직접 맞는지 확인해야 합니다.
- 주변 부품 `dataQuality=live`는 “다나와 상세 수집” 상태이지 “최신 정보” 또는 각 추천·호환 규칙의 모든 사양 확인이 아닙니다. 표에는 필요한 값별 `정보 부족`을 표시합니다. 그래픽카드 지지대·GPU 쿨러·메모리 쿨러·써멀패드 등은 기계적 호환 검사가 없습니다.
- 관리자 주변 부품 범위의 누락 표기 비율은 `missingFields`를 계산한 값이며, 구매 적합성이나 기계적·전기적 호환 통과율이 아닙니다.
- 고객 공개 응답과 공유 비교 요청에서는 benchmark/trust/FPS 내부 근거를 제외했습니다. 내부 검수 패널은 관리자 전용이며 고객용 추천 점수로 표시하지 않습니다.

## 검수 단계 요약

| 단계 | 화면·동작 | 상태 |
| ---: | --- | --- |
| 1 | 홈에서 새 견적 진입과 부품 직접 선택 진입 | 양호 |
| 2 | 게임·작업·예산·사양 온보딩의 다음/뒤로 이동 | 양호, 데스크톱·모바일 smoke 통과 |
| 3 | 자동 구성 및 결과 확인, 설정을 URL로 복원 | 기능 통과, 결과 성능은 사용자 확인 필요 |
| 4 | 코어 부품 목록·필터·상세·가격 참고 안내 | 기능 통과, GPU·케이스 필수 사양 부족 |
| 5 | 주변 부품 10개 범주·상세·가격 이력 | 화면 흐름 통과, 공개 목록 9개 범주 완전·쿨링팬 1개 범주 부분; 상세 사양 검수는 별도 |
| 6 | 저장 견적·공유 비교·가격 추적·구매 준비·조립 확인 | 자동화 흐름 통과 |
| 7 | 관리자 카탈로그 및 사양 보강 패널 | 격리 로컬 데이터에서 로딩 확인 |
| 8 | 390px 모바일 배치와 키보드 모달 이동 | 자동화 통과, 실기기 검증은 미수행 |

## 증거를 다시 만드는 명령

`test:browser`는 관리자·저장·공유 흐름에서 서버 데이터를 바꿀 수 있습니다. 아래 흐름 검수는 별도 임시 데이터 사본으로 띄운 테스트 preview에서 실행하세요. 현재 bundle preview 5206/4219의 데이터는 유지하고, 문서 예시는 별도 테스트 preview 5201/4213을 사용합니다.

```sh
npm run build
npm test
read -s "BROWSER_SMOKE_ADMIN_PASSWORD?데모용 관리자 비밀번호: "
printf '\n'
export BROWSER_SMOKE_ADMIN_PASSWORD
BROWSER_SMOKE_BASE_URL=http://127.0.0.1:5202 npm run test:browser
BROWSER_SMOKE_BASE_URL=http://127.0.0.1:5202 npm run test:browser:compatible-demo
BROWSER_SMOKE_BASE_URL=http://127.0.0.1:5202 npm run test:browser:generator-selection-reasons
BUDGET_LADDER_SUMMARY_SMOKE_BASE_URL=http://127.0.0.1:5202 npm run test:browser:budget-ladder-summary
BROWSER_SMOKE_BASE_URL=http://127.0.0.1:5202 QUOTE_ONBOARDING_SMOKE_TIMEOUT_MS=30000 npm run test:browser:quote-onboarding
```

저장된 화면 캡처 파일은 첨부하지 않았습니다. 브라우저 smoke와 가로 폭 검사는 동작·가로 넘침만 확인하며, 시각적 위계·글꼴·실기기 화면 검토를 대신하지 않습니다.
