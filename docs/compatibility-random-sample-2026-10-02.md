# 호환성 검사 무작위 부품셋 테스트 — 2026-10-02

## 결론

배포 카탈로그에서 무작위로 뽑은 부품셋 300건(방식별 100건)을 현재 브랜치 엔진(`feature/compatibility` 작업 트리, `ENGINE_VERSION` 2.60.0)으로 검사했습니다.

- **엔진 로직**: 실행 오류 0건, 결과 불변식 위반 0건이었습니다. 핵심 규칙 7개를 원본 스펙으로 따로 판정한 결과와 비교했을 때 불일치도 0건(규칙별 145~300건 대조)입니다.
- **실사용 판정 품질**: 데이터·파서 문제 때문에 잘못된 판정과 판정 불가가 많습니다. 조건을 모두 맞춘 `fit` 방식에서도 "호환"은 100건 중 8건뿐이고, 82건이 "확인 필요"입니다.
- **잘못된 판정 2종**
  - M.2 NVMe SSD를 잘못 차단하는 파서 결함(F1)
  - 노트북용 SO-DIMM RAM을 데스크톱 보드에서 차단하지 못함(F2)
- **이 브랜치의 VRM 추정 규칙**: `cpu-motherboard-power`의 "확인 필요"를 298건에서 30건으로 줄였습니다. 다만 경고 기준이 민감해서 보급형 조합에도 경고가 나옵니다(F5).

## 테스트 대상과 환경

| 항목 | 값 |
| --- | --- |
| 엔진 | 로컬 작업 트리 `feature/compatibility`, `ENGINE_VERSION` 2.60.0. 배포 main은 2.59.0(`/api/health` 기준) |
| 카탈로그 출처 | 배포 서버 `https://pc-supporter.3-39-79-1.sslip.io`의 공개 `GET /api/parts`. 기본 조건(=부품 선택기에서 사용자가 고를 수 있는 목록)으로 카테고리별 전체 페이지를 받음 |
| 수집 시각 | 2026-10-02 19:20 KST 무렵 |
| 표본 풀 | 1,828개. 배포 `/api/meta` 기준 전체 카탈로그는 7,380개이고, 선택기 기본 조건(가격 확인·견적 가능 브랜드·핵심 부품)을 통과한 부분집합만 사용 |
| 카테고리별 풀 | CPU 30 · 쿨러 49 · 메인보드 904 · RAM 34 · GPU 235 · SSD 167 · HDD 213 · 케이스 56 · 파워 140 |
| 평가 시각 고정 | `now = 2026-10-02T00:00:00Z`, `includeSuggestions: false`, `includeAnalysis: true` |
| 난수 seed | `20261002` (mulberry32). 같은 seed와 같은 카탈로그면 같은 부품셋이 다시 뽑힘 |

로컬 `.env`의 `DATABASE_URL`(127.0.0.1:5432)은 꺼져 있었습니다. 그래서 운영 DB를 공개 API로 읽어 대신 사용했습니다.

운영 `POST /api/compatibility/check`는 호출하지 않았습니다. 이 API는 운영 사용량 이벤트(`check`)를 기록하고, 이번 테스트 대상은 배포 엔진이 아니라 이 브랜치 엔진이기 때문입니다.

## 방법

### 추출 방식

| 방식 | 뽑는 방법 | 목적 |
| --- | --- | --- |
| `random` | 카테고리별로 부품을 하나씩 무작위 선택. RAM 수량 1~2개, HDD는 30% 확률, CPU가 내장그래픽이면 25% 확률로 외장 GPU 없이 구성 | 차단(blocker) 탐지 |
| `plausible` | CPU를 먼저 뽑고, 같은 소켓의 메인보드, 같은 메모리 규격의 RAM, CPU 소켓을 지원하는 쿨러를 선택 | 크기·전력 같은 깊은 규칙까지 도달 |
| `fit` | `plausible`에 더해, 메인보드 폼팩터·GPU 길이·쿨러 높이를 수용하는 케이스와 권장 용량·규격·길이를 만족하는 파워를 선택 | 여기서 나오는 차단은 잘못된 판정 후보 |

### 데이터 변형

같은 부품셋 300건을 두 가지 데이터로 평가했습니다.

- **배포 데이터 그대로**(`deployed-data.json`): API가 준 스펙을 그대로 사용합니다.
- **브랜치 파서 보충**(`branch-parser-fill.json`, `--reparse`): 비어 있는 스펙 필드만, 이 브랜치의 `reparseDanawaPart()`로 원문 스펙(`rawSpecText`)에서 채웁니다.
  - 서버의 `loadCatalog()`는 DB 행을 매번 다시 파싱하므로, 이 브랜치를 배포했을 때 서버가 보게 될 데이터에 가깝습니다.
  - 이미 있는 값은 덮어쓰지 않습니다. 그래서 API에 반영된 관리자 오버라이드는 유지됩니다.
  - 채워진 필드: 메인보드 813개(`vrmPhaseCount` 793, `vrmVcoreOutputA` 512), CPU 18개(`cinebenchR23*`. 호환성 판정과는 무관).

### 검증 항목

1. **독립 판정 대조**: 아래 규칙을 엔진 코드가 아니라 원본 스펙만으로 다시 판정하고, 엔진의 해당 `ruleId` 결과와 비교했습니다.
   - 대상 규칙: `cpu-motherboard-socket`, `memory-type`, `cpu-cooler-socket`, `case-motherboard-form-factor`, `gpu-case-length`, `case-cooler-height`, `gpu-psu-power`
   - 독립 판정이 "통과"인데 엔진이 "경고"를 내는 경우는 불일치로 보지 않았습니다(예: 파워 여유 경고).
2. **결과 불변식**
   - `blockerCount`/`warningCount`/`unknownCount`가 실제 finding 개수와 같은가
   - `status`가 세 개수에서 유도한 값과 같은가
   - finding id에 중복이 없는가
   - `affectedPartIds`가 선택한 부품만 가리키는가
   - title·message가 비어 있지 않은가
   - 같은 입력을 캐시 없이 다시 평가하면 같은 결과가 나오는가
3. **실행 오류와 응답 시간**: 건별 평가 시간.

## 결과

### 판정 상태 분포

| 방식 | 배포 데이터 그대로 | 브랜치 파서 보충 |
| --- | --- | --- |
| `random` | 장착 불가 96 · 확인 필요 4 · 호환 0 | 장착 불가 96 · 확인 필요 4 · 호환 0 |
| `plausible` | 장착 불가 31 · 확인 필요 67 · 호환 2 | 장착 불가 31 · 확인 필요 61 · 호환 8 |
| `fit` | 장착 불가 10 · 확인 필요 90 · 호환 0 | 장착 불가 10 · 확인 필요 82 · 호환 8 |

두 데이터 변형 모두에서 실행 오류 0건, 불변식 위반 0건, 독립 판정 불일치 0건이었습니다.

평가 시간은 건당 p50 1~2ms, p95 2~3ms, 최대 17ms입니다.

### 독립 판정 대조 (브랜치 파서 보충, 300건)

"통과→경고"는 엔진이 파워 여유 부족 경고를 낸 경우이며, 불일치로 세지 않았습니다.

| 규칙 | 대조 건수 | 차단→차단 | 통과→통과 | 통과→경고 | 불일치 |
| --- | --- | --- | --- | --- | --- |
| `cpu-motherboard-socket` | 300 | 76 | 224 | 0 | 0 |
| `memory-type` | 300 | 71 | 229 | 0 | 0 |
| `cpu-cooler-socket` | 300 | 14 | 286 | 0 | 0 |
| `case-motherboard-form-factor` | 300 | 23 | 277 | 0 | 0 |
| `gpu-case-length` | 230 | 3 | 227 | 0 | 0 |
| `case-cooler-height` | 145 | 7 | 138 | 0 | 0 |
| `gpu-psu-power` | 230 | 34 | 189 | 7 | 0 |

`case-cooler-height`는 쿨러 높이와 케이스 허용 높이가 둘 다 있는 145건만 대조했습니다. 쿨러 높이 값은 49개 중 25개에만 있습니다.

`psu-case-length` 차단 23건은 파워 깊이가 케이스 허용 길이를 실제로 넘는지 따로 확인했고, 모두 스펙과 맞았습니다.

### 규칙별 발생 빈도 (브랜치 파서 보충, 300건)

| 규칙 | 차단 | 경고 | 확인 필요 |
| --- | --- | --- | --- |
| `cpu-motherboard-socket` | 76 | – | – |
| `memory-type` | 71 | – | – |
| `gpu-psu-power` | 34 | 7 | – |
| `m2-interface` | 28 | – | 6 |
| `case-motherboard-form-factor` | 23 | – | – |
| `psu-case-length` | 23 | – | 34 |
| `cpu-cooler-socket` | 14 | – | – |
| `case-cooler-height` | 7 | – | – |
| `case-hdd-bays` | 4 | – | – |
| `psu-case-form-factor` | 3 | – | 34 |
| `gpu-case-length` | 3 | – | – |
| `gpu-psu-connector` | 1 | – | 20 |
| `gpu-motherboard-pcie` | 1 | – | 1 |
| `case-radiator-support` | – | – | 172 |
| `memory-form-factor` | – | – | 100 |
| `cpu-motherboard-power` | – | 31 | 30 (배포 데이터 그대로: 298) |
| `memory-speed` | – | 2 | 49 |
| `case-ssd-bays` | – | – | 47 |
| `m2-pcie-lane-sharing` | – | – | 40 |
| `case-fan-headers` | – | 96 | 8 |
| `memory-dual-channel` | – | 104 | – |
| `gpu-thickness` | – | 57 | – |
| `case-rgb-headers` | – | 49 | 13 |
| `case-rgb-voltage` | – | 18 | 13 |
| `hdd-interface` | – | – | 9 |
| `m2-pcie-generation` | – | 4 | – |
| `cpu-cooler-capacity` | – | 1 | – |

## 발견 사항

### F1. M.2 NVMe SSD를 잘못 차단함 — 파서 결함 (심각도: 높음)

- **증상**
  - 메인보드 원문이 `M.2 연결: PCIe5.0, PCIe4.0, SATA`처럼 "NVMe" 단어 없이 PCIe만 적혀 있습니다.
  - 그러면 `m2Interfaces`가 `["SATA"]`로 파싱되어, NVMe SSD에 `m2-interface` 차단이 걸립니다.
- **재현**
  - `plausible-012`: ASRock Z890 Taichi OCF + 삼성 PM9E1 NVMe
  - `random-026`: ASUS ROG ZENITH EXTREME ALPHA + 삼성 970 EVO NVMe
- **영향 범위**
  - 선택기 메인보드 904개 중 28개가 M.2 연결에 PCIe가 있는데 `m2Interfaces`에 NVMe가 없습니다.
  - 그중 일부는 `["SATA"]`라서 NVMe 차단(잘못된 판정)이 나고, 일부는 값이 없어 "확인 필요"가 됩니다.
  - 예: MSI PRO B760M-E DDR4 `PCIe4.0, SATA`, COLORFUL B760M-D PRO `PCIe4.0`
- **원인**: [server/danawa.ts:839](../server/danawa.ts:839)가 `NVMe`·`SATA` 단어만 찾습니다.
- **제안**: `M.2 연결` 구간에 `PCIe`가 있으면 NVMe 지원으로 해석하고, 파서 테스트를 추가합니다.

이 문제를 빼면 `m2-interface` 차단 28건 중 나머지 26건은 원문 기준으로 맞는 판정이었습니다. 메인보드는 NVMe만 지원하는데 M.2 SATA SSD를 고른 경우입니다. 다만 선택기 SSD 풀에 PM871·860 EVO M.2 같은 구형 OEM/중고 M.2 SATA 제품이 많아서 이 차단이 자주 나옵니다.

### F2. 데스크톱 보드에 노트북용 SO-DIMM을 골라도 차단하지 않음 (심각도: 높음)

- **증상**: SO-DIMM RAM에 대해 `memory-form-factor`가 "확인 필요"만 내고 차단하지 않습니다(300건 중 100건, `fit` 방식에서도 28건).
- **원인**
  - 메인보드 904개 중 898개에 `memoryFormFactor` 값이 없습니다(ATX 354 · mATX 499 · ITX 39 포함).
  - 엔진은 보드 값이 없으면 "확인 필요"로 처리합니다.
  - `fit` 방식은 메모리 규격(DDR4/DDR5)만 맞췄으므로, 실제로는 장착할 수 없는 DDR5 SO-DIMM + 데스크톱 보드 조합이 "확인 필요"로 남았습니다.
- **제안**
  - 데스크톱 폼팩터(ATX/mATX/ITX/E-ATX) 보드는 별도 표기가 없으면 DIMM으로 추론합니다(파서 또는 엔진).
  - 또는 선택기에서 SO-DIMM을 데스크톱 견적 후보에서 제외합니다.

### F3. 선택기의 RAM 풀이 구형·노트북 제품 위주 (심각도: 중간, 카탈로그)

- 기본 조건으로 받은 RAM은 34개뿐입니다.
- 그중 16개가 노트북 SO-DIMM이고, DDR2/DDR3 2~8GB 제품이 다수입니다.
- 일반 데스크톱 DDR5 킷은 소수입니다(삼성·SK하이닉스 DDR5 단품 위주).
- F2와 겹쳐서 `random` 방식에서 메모리 관련 차단과 "확인 필요"가 크게 늘었습니다.
- `quoteBrandRestricted`·`quoteSellableOnly` 필터가 RAM 카테고리에서 의도대로 동작하는지 확인이 필요합니다.

### F4. VRM 추정 규칙(이 브랜치) — 판정 불가 대폭 감소, 배포 시 자동 적용 (확인)

- **배포 데이터 그대로일 때**: 메인보드에 VRM 필드가 전혀 없어서(`vrmCapacityW` 5/904, `vrmPhaseCount`·`vrmVcoreOutputA` 0/904), `cpu-motherboard-power`가 300건 중 298건에서 "확인 필요"였습니다.
- **브랜치 파서로 채운 뒤**: "확인 필요" 30건, 경고 31건, 나머지 통과.
  - `fit` 방식의 호환 판정이 0건에서 8건으로 늘었습니다.
- **배포 시 적용 방식**: 서버 `loadCatalog()`가 DB 행을 매번 `reparseDanawaPart()`로 다시 파싱하므로, 브랜치 배포만으로 적용됩니다. 별도 백필은 필요 없습니다.
- **남은 "확인 필요" 30건의 원인**
  - 원문에 전원부 정보 없음: 17건
  - `전원부 방열판`만 표기: 11건
  - `전원부: 11~12페이즈` 범위 표기를 파싱하지 못함: 2건. 범위 표기는 낮은 값을 채택하는 식으로 보강할 수 있습니다.

### F5. VRM 추정 경고가 보급형 조합에도 나옴 (심각도: 중간, 기준 결정 필요)

- **현재 기준**: 추정 공급량보다 CPU 전력이 조금이라도 크면(비율 > 1.0) 경고합니다.
  - 추정 공급 = 페이즈 수 × 50A × 0.35 또는 Vcore 출력 합계 × 0.35
- **사례**: 경고 31건 중 상당수가 흔한 조합입니다.
  - 코어 울트라5 245K/245KF(125W) + ASRock B860M-X·B760M Pro RS(7페이즈): 비율 1.02
  - 코어 울트라 + H810M/B860M(6페이즈): 비율 1.19
- **추정의 한계**
  - 페이즈당 50A는 원문에 값이 없을 때 쓰는 가정입니다.
  - CPU 전력은 `pptW ?? tdpW`를 씁니다. 그런데 선택기 CPU 30개 중 `pptW`가 있는 것은 6개라, 인텔 K 모델은 PBP 125W로 계산됩니다(실제 최대 전력은 더 높음).
  - 즉 추정 공급과 CPU 전력 양쪽 모두 오차 방향이 일정하지 않습니다.
- **제안**: 허용 오차 구간(예: 비율 1.1 미만은 안내만)을 둘지, 또는 인텔 K 모델의 PL2/MTP 데이터를 보강할지 결정이 필요합니다.
  - 지금 `VRM_ESTIMATE_SEVERE_RATIO`(1.1)는 문구만 바꾸고 경고 여부에는 영향을 주지 않습니다.

### F6. "확인 필요"가 결과를 지배함 — 데이터 공백 (심각도: 중간)

`fit` 방식(브랜치 파서 보충)에서 "확인 필요" 82건의 주요 원인은 다음과 같습니다. 한 건에 여러 원인이 겹칠 수 있습니다.

| 원인 규칙 | `fit` 해당 건수 | 공백 데이터 |
| --- | --- | --- |
| `case-radiator-support` | 58 (단독 원인 12) | 선택기 케이스 56개 모두 원문에 라디에이터 지원 정보가 없음. 쿨러 49개 중 27개가 수랭이라, 수랭을 고르면 항상 "확인 필요" |
| `memory-form-factor` | 28 | F2 참조 |
| `psu-case-form-factor` | 21 | NZXT H6 Flow·Antec FLUX PRO·AX81 등 케이스의 `supportedPsuFormFactors` 없음 |
| `m2-pcie-lane-sharing` | 15 | 메인보드 레인 공유 정보 부족(`m2LaneSharingScopes` 205/904) |
| `psu-case-length` | 14 | 파워 `psuDepthMm` 없음(127/140만 보유) |
| `memory-speed` | 13 | 메인보드 `maxMemorySpeedMhz` 없음(731/904) |
| `case-ssd-bays` | 12 | 케이스 `ssdBays` 1/56만 보유 → 2.5인치 SSD를 고르면 항상 "확인 필요" |

케이스 라디에이터 지원, 케이스 2.5인치 베이, 케이스 파워 규격 세 필드만 보강해도 `fit` 방식의 "확인 필요"가 크게 줄어들 것으로 보입니다.

### F7. 이 브랜치에서 새로 추가한 규칙의 실데이터 도달 범위 (참고)

| 규칙 | 실데이터 결과 |
| --- | --- |
| `case-ssd-bays` (차단 추가) | 케이스 `ssdBays` 공백으로 47건 모두 "확인 필요". 실데이터에서 차단까지 도달하지 못함 |
| `psu-system-power` (외장 GPU 없는 구성의 전력 경고) | 내장그래픽 구성 70건에서 한 번도 발생하지 않음. 선택기 파워가 모두 충분한 용량 |
| `memory-module-capacity` | 표본에서 발생하지 않음 |

이 세 규칙은 이번 표본으로 검증되지 않았으므로, 단위 테스트([server/engine.test.ts](../server/engine.test.ts))에 의존합니다.

## 한계

- 독립 판정은 같은 규칙 문서를 원본 스펙으로 다시 구현한 것입니다. 일치는 "엔진이 데이터를 규칙대로 해석했다"는 뜻이지, 실물 장착 가능성을 보증하지 않습니다. 실물 판단은 F1·F2처럼 원문 대조로만 확인했습니다.
- 표본은 선택기 기본 조건을 통과한 1,828개에서만 뽑았습니다. 관리자 질의로만 보이는 부품, 가격이 없는 부품, 견적 제외 브랜드는 포함되지 않습니다.
- seed 1개, 방식별 100건의 단일 실행입니다. 드문 규칙(`cpu-cooler-capacity`, `gpu-motherboard-pcie` 등)은 표본 수가 적습니다.
- 브랜치 파서 보충은 빈 필드만 채우는 근사입니다. 서버는 파서 결과 위에 오버라이드를 적용하지만, 이 테스트는 오버라이드가 이미 반영된 API 값 위에 빈 필드만 채웠습니다.
- 주변 부품(팬·허브·RGB 등)과 M.2 슬롯 수동 지정은 포함하지 않았습니다.
- 배포 엔진(2.59.0)과 브랜치 엔진(2.60.0)의 판정 차이는 VRM 규칙만 분리해서 확인했습니다.

## 재현

```bash
# 배포 카탈로그를 받아 저장하면서 실행 (GET /api/parts만 호출)
npx tsx scripts/compatibility-random-sample.mts --api=https://pc-supporter.3-39-79-1.sslip.io --catalog-out=<snapshot.json> --seed=20261002 --count=100 --out=<deployed-data.json>

# 저장한 스냅샷으로 브랜치 파서 보충 변형 실행
npx tsx scripts/compatibility-random-sample.mts --catalog-file=<snapshot.json> --reparse --seed=20261002 --count=100 --out=<branch-parser-fill.json>

# DB가 켜져 있으면 DATABASE_URL에서 직접
npx tsx scripts/compatibility-random-sample.mts --seed=20261002 --count=100 --out=<result.json>
```

카탈로그 스냅샷(약 2.8MB)은 저장소에 넣지 않았습니다. 배포 카탈로그가 바뀌면 같은 seed라도 다른 부품셋이 뽑힙니다.

## 근거 파일

`docs/evidence/compatibility-random-sample-2026-10-02/` 폴더에 있습니다.

- `deployed-data.json`: 배포 데이터 그대로 실행한 결과(요약, 불일치, 불변식, 300건 전체의 부품 ID·이름·findings)
- `branch-parser-fill.json`: `--reparse` 결과(같은 300건)

케이스 ID(`random-026`, `plausible-012` 등)로 각 건의 부품 구성과 findings를 찾을 수 있습니다.
