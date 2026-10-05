# Fractal Design 케이스 제조사 규격 근거 - 2026-10-04

배포 대상 Fractal Design 중 Pop 시리즈를 제외한 31개 상품을 검토했습니다. 기본 제공된 독립 전용 SSD 누락값은 31개 모두 보강할 수 있습니다. 조건을 담는 새 `requirements` 계약에 맞춰 28개 상품의 전체 라디에이터 위치·크기와 조건을 채택했고, 위치 전체 목록을 확정하지 못한 3개는 라디에이터 두 필드를 미해결로 남겼습니다.

현 제조사 매뉴얼의 `Water Cooling Radiator Options` 전체 도해를 primary로 사용했습니다. 숫자가 들어 있는 실제 PDF 페이지를 렌더링하여 위치·크기·각주를 확인했습니다. 최대 크기에서 작은 규격을 추론하지 않았고, 팬 장착 규격을 라디에이터로 전환하지 않았습니다. 웹의 새 표에 빠진 크기나 상충하는 표시는 아래에 별도 기록했습니다.

운영 데이터, 서버, 엔진, 기존 override 파일은 수정하지 않았습니다. `items`만 새 계약을 검증한 뒤 가져갈 수 있는 후보입니다. `radiatorEvidence`는 추가 URL을 포함한 상세 근거이고, `sourceFileHashes`는 이번 확인에 사용한 PDF 해시입니다.

## 기본 SSD 수

공용 HDD/SSD 트레이와 추가 구매 브래킷은 더하지 않았습니다. Terra는 최대2 중 팬과 공유하는 하단1을 제외해1, Era2는 최대4 중 spine 위치·두께 조건이 있는2를 제외해2입니다. 제조사 최대 수와 이번 수의 차이는 아래에 남겼습니다.

| 모델 묶음 | 상품 수 | 채택 SSD 수 | 기본 포함/최대 및 제외 위치 |
| --- | ---: | ---: | --- |
| Meshify 2 Compact | 1 | 2 | 전용 SSD 위치는 최대 4개이나 기본 브래킷은 2개입니다. 공용 3.5/2.5형 2개와 추가 구매 브래킷은 제외합니다. |
| Define 7 Compact | 1 | 2 | 전용 SSD 4개 위치 중 기본 브래킷 2개만 셉니다. 공용 3.5/2.5형 2개와 추가 브래킷은 제외합니다. |
| Meshify 3 XL | 2 | 1 | 제품표 전용 2.5형 장착부는 1개입니다. 공용 브래킷 2개는 각 SSD 2개 또는 HDD 1개를 받아 별도 전용 수에 더하지 않습니다. |
| Meshify 3 | 3 | 2 | 전용 SSD 2개입니다. 최대 SSD 6개는 공용 브래킷 2개에 각 SSD 2개를 더한 수이므로 전용 수에 넣지 않습니다. |
| Epoch XL | 2 | 2 | 전용 SSD 브래킷 2개 포함입니다. 공용 HDD/SSD 트레이 2개는 전용 수에서 제외합니다. |
| Epoch | 3 | 2 | 전용 SSD 장착부 2개입니다. 공용 3.5/2.5형 위치 3개(2개 포함)는 전용 수에서 제외합니다. |
| Define R6 | 2 | 2 | 전용 SSD 브래킷 2개 포함, 전용 위치 최대 4개입니다. 공용 HDD/SSD 6개와 추가 브래킷은 제외합니다. 제품표는 Solid/TG를 함께 다룹니다. |
| North XL Momentum Edition | 1 | 2 | 전용 SSD 브래킷 2개입니다. 공용 3.5/2.5형 트레이 2개는 전용 수에서 제외합니다. |
| North Momentum Edition | 1 | 2 | 전용 SSD 브래킷 2개입니다. 공용 3.5/2.5형 트레이 2개는 전용 수에서 제외합니다. |
| North XL | 3 | 2 | 전용 SSD 브래킷 2개입니다. 공용 3.5/2.5형 트레이 2개는 전용 수에서 제외합니다. TG/RC 각각 제품표 열을 대조했습니다. |
| North | 3 | 2 | 전용 SSD 장착부 2개입니다. 공용 3.5/2.5형 위치 3개(2개 포함)는 전용 수에서 제외합니다. Mesh/TG 표를 각각 대조했습니다. |
| Define 7 XL | 2 | 2 | 전용 SSD 브래킷 2개 포함, 전용 위치 최대 5개입니다. 공용 HDD/SSD 트레이와 추가 브래킷은 제외합니다. Solid/TG 같은 규격입니다. |
| Define 7 | 2 | 2 | 전용 SSD 브래킷 2개 포함, 전용 위치 최대 4개입니다. 공용 HDD/SSD 트레이와 추가 브래킷은 제외합니다. Solid/TG 같은 규격입니다. |
| Torrent | 1 | 4 | 전용 SSD 브래킷 4개 포함입니다. 별도 HDD 트레이 2개는 더하지 않습니다. |
| Meshify 2 XL | 1 | 2 | 전용 SSD 브래킷 2개 포함, 전용 위치 최대 5개입니다. 공용 HDD/SSD 트레이와 멀티브래킷, 추가 구매 SSD 브래킷은 제외합니다. |
| Ridge | 1 | 4 | 전용 SSD 장착부 4개 포함입니다. SSD 사용 시 GPU 최대 길이는 335mm가 아닌 325mm라는 별도 조건을 기록합니다. |
| Era2 | 1 | 2 | 제조사 최대 SSD 4개 중 전면 전용 브래킷 2개만 셉니다. spine 위 2개는 위치 1/2와 SSD 두께 조건이 있어 제외합니다. 상세 근거: https://support.fractal-design.com/support/solutions/articles/4000210395-era-2-2-5-drive-support |
| Terra | 1 | 1 | 제조사 최대 SSD 2개 중 전면 고정 위치 1개만 셉니다. 추가 하단 SSD 1개는 팬과 같은 위치를 써 제외합니다. 상세 근거: https://support.fractal-design.com/support/solutions/articles/4000194857-terra-ssd-installation |

## 라디에이터 전체 목록과 조건

| 배포 상품 | 위치별 크기 mm | 제조사 1차 근거 |
| --- | --- | --- |
| `danawa-case-13489595` | front: 120,140,240,280,360; top: 120,240; rear: 120; bottom: 120 | [제조사 근거](https://assets.fractal-design.com/files/uxzbxy2o/production/a401ebedcbd520103b5624df0baae29733f9e5e6.pdf) |
| `danawa-case-11479695` | front: 120,140,240,280,360; top: 120,240; rear: 120; bottom: 120 | [제조사 근거](https://www.fractal-design.com/app/uploads/2023/08/Define-7-Compact-Manual-V.2-2023-08-21.pdf) · [제조사 근거](https://support.fractal-design.com/support/solutions/articles/4000174752-define-7-compact) |
| `danawa-case-91560920` | front: 120,140,240,280,360; top: 120,140,240,280; rear: 120 | [제조사 근거](https://assets.fractal-design.com/files/uxzbxy2o/production/f44d33810a02c53771f131ec4050ce922c536e08.pdf) · [제조사 근거](https://support.fractal-design.com/support/solutions/articles/4000217816-meshify-3-radiator-support) |
| `danawa-case-91560968` | front: 120,140,240,280,360; top: 120,140,240,280; rear: 120 | [제조사 근거](https://assets.fractal-design.com/files/uxzbxy2o/production/f44d33810a02c53771f131ec4050ce922c536e08.pdf) · [제조사 근거](https://support.fractal-design.com/support/solutions/articles/4000217816-meshify-3-radiator-support) |
| `danawa-case-91560869` | front: 120,140,240,280,360; top: 120,140,240,280; rear: 120 | [제조사 근거](https://assets.fractal-design.com/files/uxzbxy2o/production/f44d33810a02c53771f131ec4050ce922c536e08.pdf) · [제조사 근거](https://support.fractal-design.com/support/solutions/articles/4000217816-meshify-3-radiator-support) |
| `danawa-case-102124007` | front: 120,140,240,280,360; top: 120,140,240,280,360; rear: 120 | [제조사 근거](https://assets.fractal-design.com/files/uxzbxy2o/production/6c872113c3ffd3b7f17dd4bab6637188b029a151.pdf) · [제조사 근거](https://support.fractal-design.com/support/solutions/articles/4000224622-epoch-xl-radiator-compatibility) |
| `danawa-case-102124055` | front: 120,140,240,280,360; top: 120,140,240,280,360; rear: 120 | [제조사 근거](https://assets.fractal-design.com/files/uxzbxy2o/production/6c872113c3ffd3b7f17dd4bab6637188b029a151.pdf) · [제조사 근거](https://support.fractal-design.com/support/solutions/articles/4000224622-epoch-xl-radiator-compatibility) |
| `danawa-case-94087853` | front: 120,140,240,280,360; top: 120,240; rear: 120 | [제조사 근거](https://assets.fractal-design.com/files/uxzbxy2o/production/68578f9fa95fce8af9edaba6dd98ecb0cdf73046.pdf) · [제조사 근거](https://support.fractal-design.com/support/solutions/articles/4000219370-epoch-radiator-compatibility) |
| `danawa-case-94087928` | front: 120,140,240,280,360; top: 120,240; rear: 120 | [제조사 근거](https://assets.fractal-design.com/files/uxzbxy2o/production/68578f9fa95fce8af9edaba6dd98ecb0cdf73046.pdf) · [제조사 근거](https://support.fractal-design.com/support/solutions/articles/4000219370-epoch-radiator-compatibility) |
| `danawa-case-94087988` | front: 120,140,240,280,360; top: 120,240; rear: 120 | [제조사 근거](https://assets.fractal-design.com/files/uxzbxy2o/production/68578f9fa95fce8af9edaba6dd98ecb0cdf73046.pdf) · [제조사 근거](https://support.fractal-design.com/support/solutions/articles/4000219370-epoch-radiator-compatibility) |
| `danawa-case-14840138` | front: 120,140,240,280,360; top: 120,140,240,280,360,420; rear: 120; bottom: 120,140,240,280 | [제조사 근거](https://www.fractal-design.cn/app/uploads/2019/06/Define-R6_Product-sheet_EN-0.34-MB-1.pdf) |
| `danawa-case-14839061` | front: 120,140,240,280,360; top: 120,140,240,280,360,420; rear: 120; bottom: 120,140,240,280 | [제조사 근거](https://www.fractal-design.cn/app/uploads/2019/06/Define-R6_Product-sheet_EN-0.34-MB-1.pdf) |
| `danawa-case-108416156` | front: 120,140,240,280,360,420; top: 120,140,240,280,360; rear: 120 | [제조사 근거](https://assets.fractal-design.com/files/uxzbxy2o/production/72710ae076535c2676cc487faddb9517b500c681.pdf) · [제조사 근거](https://support.fractal-design.com/support/solutions/articles/4000203863-north-xl-water-cooling-radiator-compatibility) |
| `danawa-case-108416054` | front: 120,140,240,280,360; top: 120,240; rear: 120 | [제조사 근거](https://assets.fractal-design.com/files/uxzbxy2o/production/0db9c256528400d4d16ab77d6fd3bee9b77ea90e.pdf) · [제조사 근거](https://support.fractal-design.com/support/solutions/articles/4000189454-north-gpu-compatibility) |
| `danawa-case-40016330` | front: 120,140,240,280,360,420; top: 120,140,240,280,360; rear: 120,140 | [제조사 근거](https://support.fractal-design.com/support/solutions/articles/4000203863-north-xl-water-cooling-radiator-compatibility) |
| `danawa-case-90158345` | front: 120,140,240,280,360,420; top: 120,140,240,280,360; rear: 120 | [제조사 근거](https://support.fractal-design.com/support/solutions/articles/4000203863-north-xl-water-cooling-radiator-compatibility) |
| `danawa-case-40016360` | front: 120,140,240,280,360,420; top: 120,140,240,280,360; rear: 120,140 | [제조사 근거](https://support.fractal-design.com/support/solutions/articles/4000203863-north-xl-water-cooling-radiator-compatibility) |
| `danawa-case-18448790` | front: 120,140,240,280,360; top: 120,240; rear: 120 | [제조사 근거](https://assets.fractal-design.com/files/uxzbxy2o/production/6f9ccb3a36843c7b3e696a62dfa5e7370db78da7.pdf) · [제조사 근거](https://support.fractal-design.com/support/solutions/articles/4000189454-north-gpu-compatibility) |
| `danawa-case-18448748` | front: 120,140,240,280,360; top: 120,240; rear: 120 | [제조사 근거](https://assets.fractal-design.com/files/uxzbxy2o/production/6f9ccb3a36843c7b3e696a62dfa5e7370db78da7.pdf) · [제조사 근거](https://support.fractal-design.com/support/solutions/articles/4000189454-north-gpu-compatibility) |
| `danawa-case-10958544` | front: 120,140,240,280,360,420,480; top: 120,140,240,280,360,420,480; rear: 120; bottom: 120,140,240,280 | [제조사 근거](https://www.fractal-design.com/app/uploads/2023/08/Define-7-XL-Manual-V.3-2023-08-21.pdf) |
| `danawa-case-10958601` | front: 120,140,240,280,360,420,480; top: 120,140,240,280,360,420,480; rear: 120; bottom: 120,140,240,280 | [제조사 근거](https://www.fractal-design.com/app/uploads/2023/08/Define-7-XL-Manual-V.3-2023-08-21.pdf) |
| `danawa-case-10909788` | front: 120,140,240,280,360; top: 120,140,240,280,360,420; rear: 120; bottom: 120,140,240,280 | [제조사 근거](https://www.fractal-design.com/app/uploads/2023/08/Define-7-Manual-V.3-2023-08-21.pdf) |
| `danawa-case-10910196` | front: 120,140,240,280,360; top: 120,140,240,280,360,420; rear: 120; bottom: 120,140,240,280 | [제조사 근거](https://www.fractal-design.com/app/uploads/2023/08/Define-7-Manual-V.3-2023-08-21.pdf) |
| `danawa-case-15025229` | front: 120,140,180,240,280,360,420; bottom: 120,140,240,280,360,420; rear: 120,140 | [제조사 근거](https://assets.fractal-design.com/files/uxzbxy2o/production/af5f587352e8fa20cb09151326dae43796eebb44.pdf) · [제조사 근거](https://support.fractal-design.com/support/solutions/articles/4000174902-torrent-radiator-support) |
| `danawa-case-12681041` | front: 120,140,240,280,360,420,480; top: 120,140,240,280,360,420,480; rear: 120; bottom: 120,140,240,280 | [제조사 근거](https://assets.fractal-design.com/files/uxzbxy2o/production/cdf01f190b68cdc6e6f82f47f6b13ebb6a950089.pdf) |
| `danawa-case-18294494` | side: 120,140,240,280 | [제조사 근거](https://www.fractal-design.com/app/uploads/2022/11/Ridge-manual-V1..pdf) · [제조사 근거](https://support.fractal-design.com/support/solutions/articles/4000188958-ridge-radiator-options) |
| `danawa-case-68242736` | top: 120,140,240,280 | [제조사 근거](https://www.fractal-design.com/products/cases/era-series/era-2/era-2-midnight-blue/) · [제조사 근거](https://support.fractal-design.com/support/solutions/articles/4000210382-era-2-radiator-support) |
| `danawa-case-20344595` | side: 120 | [제조사 근거](https://www.fractal-design.com/app/uploads/2023/05/Terra_Product-sheet_EN.pdf) · [제조사 근거](https://support.fractal-design.com/support/solutions/articles/4000194856-terra-radiator-support) |

조건은 JSON 각 위치의 `requirements`에 저장했습니다. `sizesMm`가 있으면 해당 크기에만 적용합니다. 실제 폭이나 동시 장착 구성에 따라 상한이 달라지는 조건은 전체 크기에 임의의 낮은 상한을 적용하지 않고, 가능한 전체 상한과 정확한 분기 설명을 `configurationNote`로 남겼습니다. 이 메모가 있으면 현재 판정은 확인 필요를 유지해야 합니다.

주요 예: Epoch 전면은 실제 폭125mm 이하/초과에서 두께72/52mm로 갈립니다. North 전면은 같은 폭 분기에서55/35mm입니다. Era2는 실제 길이300mm 경계에 따라 팬 포함 두께52/58mm가 갈리고250mm 미만의 별도 배치는68mm입니다. 이런 분기를 특정 명목 라디에이터 크기에 임의로 대응시키지 않았습니다.

## 라디에이터 미해결 3개

부분 위치 목록을 넣으면 엔진이 생략한 실제 지원 위치를 차단할 수 있어 전체 라디에이터 필드 둘을 비워 두었습니다.
- `danawa-case-91561445`: Meshify 3 XL의 측면 지원이 현 매뉴얼 280/360mm와 웹 120/240/360mm로 달라 전체 목록을 제품 리비전에 확정하지 못했습니다. 부분 위치 목록도 입력하지 않습니다. [제조사 근거](https://www.fractal-design.com/app/uploads/2025/05/Meshify-3-XL_Product_Sheet_EN.pdf) · [제조사 근거](https://assets.fractal-design.com/files/uxzbxy2o/production/b88856692511e5475fea5bf34b53a17db36f4ddd.pdf) · [제조사 근거](https://www.fractal-design.com/products/cases/meshify-series/meshify-3-xl/meshify-3-xl-black-solid/)
- `danawa-case-91561427`: Meshify 3 XL의 측면 지원이 현 매뉴얼 280/360mm와 웹 120/240/360mm로 달라 전체 목록을 제품 리비전에 확정하지 못했습니다. 부분 위치 목록도 입력하지 않습니다. [제조사 근거](https://www.fractal-design.com/app/uploads/2025/05/Meshify-3-XL_Product_Sheet_EN.pdf) · [제조사 근거](https://assets.fractal-design.com/files/uxzbxy2o/production/b88856692511e5475fea5bf34b53a17db36f4ddd.pdf) · [제조사 근거](https://www.fractal-design.com/products/cases/meshify-series/meshify-3-xl/meshify-3-xl-black-solid/)
- `danawa-case-18448688`: North Mesh 웹의 측면 라디에이터 항목은 2x120/140mm 팬 형식이고 매뉴얼의 전체 라디에이터 도해는 전면/상단/후면만 표시합니다. 측면 전체 크기를 확정하지 못해 부분 목록도 입력하지 않습니다. [제조사 근거](https://assets.fractal-design.com/files/uxzbxy2o/production/23a01a08f4b1cecd7b3efda20f85d8dcee09d891.pdf) · [제조사 근거](https://assets.fractal-design.com/files/uxzbxy2o/production/6f9ccb3a36843c7b3e696a62dfa5e7370db78da7.pdf) · [제조사 근거](https://www.fractal-design.com/products/cases/north-series/north/north-charcoal-black/)

## 제조사 문서 사이의 차이

매뉴얼에서 전체 목록이 명확한 경우 해당 매뉴얼을 채택했고, 제품 리비전이나 전체 목록을 확정할 수 없는 경우 위 미해결로 남겼습니다.
- **Define 7 Compact**: 웹 top 140mm와 매뉴얼 p.28 top120/240mm가 다릅니다. 매뉴얼 전체 도해를 기준으로 채택했습니다.
- **Meshify 2 XL**: 웹 top/front에서480mm가 빠졌으나 현 매뉴얼 p.43이 명시합니다. 매뉴얼을 채택했습니다.
- **Meshify 3**: 웹 front140mm가 빠졌으나 현 매뉴얼 p.41이 명시합니다. 매뉴얼을 채택했습니다.
- **Epoch**: 웹 top140mm 및 front240mm 표기가 현 매뉴얼 p.34와 다릅니다. 매뉴얼 top120/240, front120/140/240/280/360을 채택했습니다.
- **Epoch XL**: FAQ rear up to140mm와 현 매뉴얼 p.35 rear120mm가 다릅니다. 매뉴얼을 채택했습니다.
- **North XL / RC / Momentum**: 웹 front140mm가 빠졌으나 해당 현 매뉴얼의 전체 도해는140mm를 명시합니다. 매뉴얼을 채택했습니다.
- **Torrent**: 웹 front180mm가 빠졌으나 현 매뉴얼 p.41이 명시합니다. 매뉴얼을 채택했습니다.

## 기존 파워 규격 충돌

비어 있지 않은 현재 값의 교정은 이번 누락값 보강에서 제외했습니다.
- `danawa-case-18294494`: 현재 `['SFX-L', 'ATX']` / 제조사 `SFX, SFX-L`. [제품표](https://www.fractal-design.com/app/uploads/2023/01/Ridge_Product-Sheet_EN.pdf).
- `danawa-case-68242736`: 현재 `['ATX']` / 제조사 `SFX, SFX-L`. [제품표](https://assets.fractal-design.com/files/uxzbxy2o/production/74b237a6f0ad974a72d19a47b972c0c082b38882.pdf).
- `danawa-case-20344595`: 현재 `['ATX']` / 제조사 `SFX, SFX-L`. [제품표](https://www.fractal-design.com/app/uploads/2023/05/Terra_Product-sheet_EN.pdf).

검증: 배포 ID31개 일치, Pop 제외, 중복 없음, 채택3필드 이하, 모든 채택필드 현재누락, 메모500자 이하, 숫자 양수, 위치별 중복 없음, 모든 조건의 크기 범위가 위치 지원 크기에 포함됨, 전체 크기 합집합 일치.
