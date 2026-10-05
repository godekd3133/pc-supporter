# 케이스 제조사 근거 — 2026-10-04

배포 선택기 스냅샷 56개 중 지정한 우선 모델 8개와 NCORE 100 AIR 1개를 조사했다. [보충 후보 JSON](data/case-spec-evidence-2026-10-04.json)은 검토용 근거이며 운영 카탈로그를 수정하지 않는다. 기존 값은 덮어쓰지 않는다. C8 MESH·P30 MESH는 로컬 파일에 있으나 이번 배포 선택기 스냅샷에 없어 대상에서 제외했다.

PSU는 전원공급장치 규격을 직접 명시한 문구만 사용했다. ATX 메인보드 지원을 ATX PSU 지원으로 해석하지 않는다. 라디에이터는 팬 장착부에서 추정하지 않으며 제조사가 열거한 전체 지원 위치를 기록한다. 장착 조건은 `radiatorSupports[].requirements[]`에 숫자와 확인 메모로 구분하며, 크기별 조건은 `sizesMm`으로 적용 범위를 제한한다. 정확한 두께가 없거나 장착 모드·브라켓·다른 라디에이터 배치 확인이 필요하면 자동으로 호환을 확정하지 않는다. `ssdBays`는 겸용 베이를 합산한 최대치보다 전용 슬롯·명시된 동시 장착 수를 우선한다.

| 배포 ID | 모델 | JSON에 채택한 값 | 보류·보존 |
| --- | --- | --- | --- |
| 79556882 | NZXT H6 Flow 화이트 | PSU ATX, SSD 2, 상단·후면 라디에이터 | 상단 30mm와 팬 포함 약 60mm·부품 간섭 조건 |
| 79556969 | NZXT H6 Flow RGB 화이트 | PSU ATX, SSD 2, 상단·후면 라디에이터 | 상단 30mm와 팬 포함 약 60mm·부품 간섭 조건 |
| 30499121 | Antec AX81 RGB Elite | 전면·상단·후면 라디에이터, SSD 2 | PSU 규격 미확인 |
| 72470105 | Antec FLUX PRO 블랙 | SSD 2, 전면·상단·후면·바닥·PSU 커버 라디에이터 | 420mm 조합·브라켓·커버 조건, PSU 규격 미확인 |
| 108421685 | Antec FLUX PRO Noctua Edition | SSD 2, 전면·상단·후면·바닥·PSU 커버 라디에이터 | 전면 합산 90mm·상단 합산 75mm, 420mm 조합·브라켓·커버 조건, PSU 규격 미확인 |
| 78530048 | darkFlash DS500 RGB 블랙 | 상단·후면 라디에이터, SSD 1 | 기존 PSU ATX·길이 170mm 보존 |
| 18538823 | Lian Li LANCOOL 216X | SSD 4, 전면·상단·하단 라디에이터 | 모드·크기별 팬 포함 두께와 하단 배치 조건, 기존 PSU ATX 보존 |
| 18538847 | Lian Li LANCOOL 216RW | SSD 4, 전면·상단·하단 라디에이터 | 모드·크기별 팬 포함 두께와 하단 배치 조건, 기존 PSU ATX 보존 |
| 74012729 | Cooler Master NCORE 100 AIR 블랙 | SSD 1 | 배포 PSU ATX ↔ 제조사 SFX 충돌, 라디에이터 미확인 |

## NZXT H6 Flow / H6 Flow RGB

[NZXT 공식 조립 안내](https://support.nzxt.com/hc/en-us/articles/19797361854747-Building-in-the-NZXT-H6-Series)의 `Installing the Power Supply`는 H6 Series가 ATX 형태 PSU와 호환한다고 직접 설명한다. `Installing 3.5" and 2.5" Storage Drives`는 하나의 3.5인치 드라이브와 두 개의 2.5인치 드라이브를 함께 설치한다고 설명한다.

직접 발췌: “compatible with most ATX style Power Supplies”.

[NZXT 공식 2023 사양](https://support.nzxt.com/hc/en-us/articles/40183529624347-H6-Flow-2023-Specs)의 모델표에서 화이트 일반 모델 `CC-H61FW-01`, 화이트 RGB 모델 `CC-H61FW-R1`을 대조했다. [H6 FAQ](https://support.nzxt.com/hc/en-us/articles/19796556693019-NZXT-H6-Series-FAQ)는 상단 120/140/240/280/360mm, 후면 120mm를 열거하고 전면 우측·하단은 라디에이터를 지원하지 않는다고 명시한다.

공식 사양의 상단 라디에이터 두께는 30mm이므로 상단에 `maxRadiatorThicknessMm: 30`을 기록했다. 라디에이터+팬 합계는 **약** 60mm로 표기되어 정확한 상한 60mm로 바꾸지 않는다. 더 두꺼운 조합은 메인보드 I/O·전원부와 간섭할 수 있으므로 근삿값과 간섭 확인을 `configurationNote`로 남겼다. 후면 120mm에는 별도 수치 조건을 추정하지 않는다.

## Antec AX81 RGB Elite

[Antec 공식 AX81 페이지](https://www.antec.com/product/case/ax81)의 모델 구분과 UPC `0-761345-10017-5`로 RGB Elite를 대조했다. `Radiator Support`는 전면 120/140/240/280/360mm, 상단 120/140/240/280mm, 후면 120mm를 명시한다. 이 목록의 합집합을 `radiatorSizesMm`으로 정리했다.

직접 발췌: “2.5\" 2”.

독립 2.5인치 2개 외에 `3.5" / 2.5" 2/1` 겸용 장착부가 있다. HDD와 공간을 공유하는 추가 SSD 1개는 합산하지 않는다. PSU 최대 길이는 있으나 PSU form factor를 직접 명시한 제조사 근거는 확보하지 못했다. 공식 GPU 최대 길이 340mm와 배포값 355mm는 충돌하지만 이번 빈 필드 보충에서 변경하지 않는다.

## Antec FLUX PRO / FLUX PRO Noctua Edition

[Antec FLUX PRO 공식 사양](https://www.antec.com/product/case/flux-pro), [Antec Noctua Edition 공식 사양](https://www.antec.com/product/case/flux-pro-noctua-edition), [Noctua 공식 확장 사양](https://www.noctua.at/en/products/antec-flux-pro-noctua-edition/specifications)을 확인했다. 일반 모델 UPC는 `0-761345-10148-6`, Noctua 모델 UPC는 `0-761345-10250-6`이다.

Noctua 직접 발췌: “Combined 3.5\" / 2.5” drive bays 4”; “Dedicated 2.5\" drive bays 2”.

두 모델 모두 독립 SSD 2개만 채택했다. HDD와 공유하는 겸용 4개를 더한 SSD 최대 6개는 숫자 하나로 동시 장착 조건을 표현할 수 없어 사용하지 않는다.

공식 라디에이터 목록은 전면·상단 120/140/240/280/360/420mm, 후면 120/140mm, 바닥 120/240mm, PSU 커버 120/240/360mm이다. 바닥은 `bottom`, PSU 커버 위는 `psu_shroud`로 별도 기록해 360mm를 바닥 지원으로 합치지 않는다. 일반 모델은 전면 420+상단 360 또는 전면 360+상단 420 조합을 명시하므로 420mm 크기에 동시 장착 확인 조건을 기록했다. PSU form factor 직접 근거는 아직 확보하지 못했다.

Noctua 확장 사양은 **팬과 라디에이터를 합친 stack 두께**를 전면 최대 90mm, 상단 최대 75mm로 명시한다. Noctua 모델에만 각 위치의 `maxAssemblyThicknessMm`으로 넣었으며 이 숫자를 일반 FLUX PRO에 추정 적용하지 않았다. [Noctua 공식 설치 매뉴얼](https://cdn.noctua.at/media/7ab9c719/Antec_Flux_Pro_Noctua_Edition_manual_combined_en.pdf?download=true)의 PDF 35·36페이지(인쇄 32·33쪽)를 렌더해 상단 420mm 설치 시 전면 냉각 브라켓을 4번째 또는 5번째 위치로 낮추는 조건을 확인했다. 매뉴얼의 27mm+25mm, 45mm+25mm, 45mm+30mm는 조합 예시이며, 브라켓 상단 여유 55mm·70mm를 라디에이터 합산 두께의 보편적인 최대치로 재해석하지 않는다.

Antec의 PSU 커버 설명은 360mm push-pull 설치 시 커버 3개 제거를 명시한다. 바닥 팬 설치 설명은 PSU 커버 상단 냉각 브라켓 제거를 안내한다. PSU 커버에는 해당 조건을 기록했고 바닥에는 팬을 포함한 라디에이터 배치에서 브라켓·드라이브 케이지 구성을 확인하도록 메모했다. 바닥 안내를 라디에이터의 정확한 두께 제한으로 추정하지 않는다.

국내 공식 수입원 [FLUX PRO MESH 6FAN BLACK 상세](https://newrunglobal.com/module/board/read_form.html?bid=tjAw3T&aid=phtuMl&pn=case)는 모델명까지 확인했으나 상세 사양 이미지 CDN이 403으로 응답해 추가 PSU 근거로 사용하지 않았다.

## darkFlash DS500 RGB 블랙

[국내 공식 제품 페이지](https://darkflash.co.kr/product/ds500-rgb-%EB%B8%94%EB%9E%99/796/)에서 로드되는 [SPECIFICATION 원본 이미지](https://darkflash.speedgabia.com/DB/case/middle/DS500_new/black/DS500_newDB_black_002_08.jpg)를 직접 확인했다. 모델명 DS500 RGB, 크기 413×210×485mm, GPU 405mm, CPU 쿨러 165mm, 기본 RGB 팬 3개가 배포 모델과 일치한다.

직접 발췌: “상단: 120/140/240/280/360”; “후면: 120”.

장착 위치 표에서 라디에이터는 상단과 후면만 열거한다. 기본 멀티브라켓 1개를 HDD 1개+SSD 1개 또는 HDD 2개로 사용하는 선택 조건이 있어 SSD 1개만 채택했다. [국내 공식 출시 자료](https://darkflash.co.kr/article/%EB%B3%B4%EB%8F%84%EC%9E%90%EB%A3%8C/2/35637/)도 최대 SSD 1개와 표준 ATX PSU를 명시한다.

현재 상세 이미지의 PSU 조립 여유 230mm는 배포값 170mm와 다르지만 기존 값은 보존한다. [해외 동명 공식 페이지](https://www.darkflash.com/es/product/001654)는 M-ATX 전용·다른 치수와 GPU 길이를 열거해 국내 SKU 근거에서 제외했다.

## Lian Li LANCOOL 216 / 216 RGB

[Lian Li 공식 모델·사양표](https://lian-li.com/product/lancool-216/)에서 `LANCOOL 216X` 블랙과 `LANCOOL 216RW` 화이트 RGB를 대조했다. PSU cover의 SSD 2개와 메인보드 트레이 뒤 SSD 2개를 합쳐 4개를 채택했다. 드라이브 케이지에 있는 추가 2개는 공유 조건을 단일 숫자로 판정할 수 없어 합산하지 않는다.

직접 발췌: “UP TO 6 SSD OR 4 SDD + 2 HDD”.

페이지의 다른 설명에는 SSD 6개와 HDD 2개를 함께 장착한다는 문구도 있다. 서로 다른 표기를 이유로 최대 6개를 사용하지 않았으며, HDD 2개와 함께 쓸 수 있다고 명시된 SSD 4개를 채택했다. 기존 PSU ATX 값도 공식 PSU 지원표와 일치하여 보존한다.

공식 라디에이터 표는 전면·상단 240/280/360mm, 하단 240mm이다. [공식 제품 페이지에서 제공하는 LAN216 매뉴얼](https://drive.google.com/file/d/1bd8RM6ZibcrKrpMEFGQRtlzj4g9R_lIy/view?usp=sharing)의 PDF 6·7페이지를 렌더해 다음 크기별 조건을 확인했다. PDF 텍스트 추출은 부등호를 `<`로 읽었으나 실제 페이지는 모두 `≤`이므로 포함 상한으로 기록했다.

| 상단 크기 | 수냉 모드: 보드 낮게 설치 | 공랭 모드: 보드 높게 설치 | JSON의 판정용 숫자·확인 메모 |
| --- | --- | --- | --- |
| 360mm | 팬 포함 77mm 이하 | 팬 포함 55mm 이하 | 최대 가능한 모드의 합산 상한 77mm + 실제 모드와 55mm 대안 조건 확인 |
| 280mm | 팬 포함 60mm 이하 | 매뉴얼에 이 모드 지원 표기 없음 | 합산 상한 60mm + 수냉 모드 확인 |
| 240mm | 제품 표는 지원, 별도 두께 수치 미명시 | 별도 두께 수치 미명시 | 수치 추정 없이 실제 모드·간섭 확인 |

웹 본문의 63mm는 보드를 낮춘 상태의 상단 공간 설명이다. 더 구체적인 매뉴얼이 360mm·280mm에 서로 다른 두께를 허용하므로 공통 합산 상한 63mm로 적용하지 않았다.

매뉴얼은 하단 240mm 라디에이터를 공랭 모드에만 표시한다. PDF 15페이지(인쇄 15쪽)의 설치 도표에서 PSU 커버 위 팬·수랭 장착 위치를 확인했다. 이 위치는 SSD·팬 장착 공간과 겹치며 GPU 세로 장착 시 팬 설치 불가 안내도 있어 모드·저장장치·GPU 배치 확인 조건을 기록했다. 전면에 대한 별도 두께·GPU 길이 수치는 추정하지 않았다.

## Cooler Master NCORE 100 AIR

[Cooler Master 공식 사양](https://www.coolermaster.com/en-global/products/ncore-100-air.html)은 블랙 모델 `NR100-KNNN-S00`, 2.5인치 SSD 1개를 명시한다. 팬 120mm 정보를 라디에이터 지원으로 추정하지 않았다. 공식 표에서 라디에이터 지원을 직접 확인하지 못했으며 NCORE 100 MAX의 일체형 수랭 사양도 사용하지 않았다.

직접 발췌: “Power Supply Support SFX”.

배포 PSU 값 ATX는 공식 SFX와 충돌한다. 기존 값을 덮어쓰지 않는 보충 정책에 따라 JSON에는 SSD 1개만 넣었고 PSU는 별도 정정 대상으로 남겼다.
