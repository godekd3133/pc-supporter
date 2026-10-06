# Pop 케이스 제조사 대조 — 2026-10-04

현재 배포 선택기에서 확인한 Pop 케이스 15개만 대상으로 삼았다. 새 값은 [보강 JSON](data/pop-case-spec-evidence-2026-10-04.json)에 있다. 제품 식별자는 기존 공식 사양서의 SKU와 대조했다. 기본 제공 브래킷으로 사용할 수 있는 전용 2.5인치 장착부만 `ssdBays`에 넣었다. 겸용 슬롯과 추가 구매 브래킷을 포함한 최대치는 넣지 않았다.

| 제품군 | 기본 전용 SSD 장착부 | 라디에이터 반영 | 제조사 근거 |
| --- | ---: | --- | --- |
| Pop Air, Pop Silent | 2 | 전체 위치·크기와 폭·브래킷·GPU 간섭 조건 | [공식 Pop Air 사양서](https://www.fractal-design.com/app/uploads/2022/06/Pop-Air-RGB-Pop-Air_Product-Sheet_EN.pdf), [Pop Silent 사양서](https://www.fractal-design.com/app/uploads/2022/06/Pop-Silent_Product-Sheet_EN.pdf) |
| Pop Mini Air, Pop Mini Silent | 2 | 전체 위치·크기와 폭·리비전·GPU 간섭 조건 | [Pop Mini Air 사양서](https://www.fractal-design.com/app/uploads/2022/06/Pop-Mini-Air-RGB_Product-Sheet_EN.pdf), [Pop Mini Silent 사양서](https://www.fractal-design.com/app/uploads/2022/06/Pop-Mini-Silent_Product-Sheet_EN.pdf) |
| Pop XL Air, Pop XL Silent | 2 | 상단 합산 두께 68mm, 전면 140/280mm 폭 155mm, GPU 배치 조건 | [Pop XL Air 공식 페이지](https://www.fractal-design.com/products/cases/pop-series/pop-xl-air/pop-xl-air-rgb-white-tg-clear-tint/), [Pop XL Silent 공식 페이지](https://www.fractal-design.com/products/cases/pop-series/pop-xl-silent/pop-xl-silent-black-solid/) |
| Pop 2 Air | 2 | 상단 120/240/360mm: RAM 높이 47mm, 폭 121mm, 실제 길이 407mm 및 보드 간섭 확인 | [공식 사양서](https://www.fractal-design.com/app/uploads/2026/01/Pop-2-Air_Product-Sheet_EN.pdf) |
| Pop 2 Vision | 3 | 상단 120/140/240/280/360mm, 후면 120mm | [블랙 SKU FD-C-POV2A-01](https://www.fractal-design.com/products/cases/pop-series/pop-2-vision/pop-2-vision-black/), [화이트 RGB SKU FD-C-POV2A-03](https://www.fractal-design.com/products/cases/pop-series/pop-2-vision/pop-2-vision-white-rgb/) |

전체 지원 목록에 크기별 `requirements`를 함께 저장한다. 확인된 치수 제한을 넘으면 엔진이 차단한다. 실제 치수가 없거나 브래킷·팬·메인보드 배치를 확인할 수 없으면 계속 확인 필요로 남긴다. 전면 GPU 간섭은 팬을 안쪽 또는 바깥쪽에 설치하는 조건과 라디에이터 두께를 함께 확인해야 하므로 단일 GPU 길이로 축약하지 않았다. [Pop 공식 조건](https://support.fractal-design.com/support/solutions/articles/4000184344-pop-radiator-support), [Pop GPU 공간](https://support.fractal-design.com/support/solutions/articles/4000184345-pop-gpu-maximum-length)

Pop Mini의 2023 V2 매뉴얼 도표는 상단 높이 47mm를 표시하지만 공식 FAQ는 브래킷 미사용 35mm·사용 46mm를 설명한다. 상판 리비전 및 연장 브래킷 설치를 확인하는 메모로 이 차이를 보존하며, 단일 46mm 한도를 모든 리비전에 적용하지 않았다. 도표를 직접 렌더링해 전면 140mm와 폭 144mm도 확인했다. [Pop Mini 조건](https://support.fractal-design.com/support/solutions/articles/4000184368-pop-mini-radiator-support), [리비전별 브래킷 안내](https://support.fractal-design.com/support/solutions/articles/4000191452--missing-top-radiator-extension-brackets-pop-air-pop-mini-air-focus-2)

Pop XL Silent의 상단 지원은 공식 매뉴얼 도표와 사양서에서도 확인했다. 상판의 외형만 보고 지원 여부를 추정하지 않았다. 상단의 68mm 제한은 팬을 포함한 두께이며, 전면 140/280mm는 폭 155mm 제한을 적용한다. [Pop XL 조건](https://support.fractal-design.com/support/solutions/articles/4000184337-pop-xl-radiator-support)

Pop 2 Vision의 상단 240/360mm 폭은 120mm, 140/280mm 폭은 160mm이다. 실제 길이는 360mm 규격에서 400mm, 280mm 규격에서 390mm를 넘을 수 없다. 두께 68mm의 팬 포함 범위를 확인하는 메모도 함께 보존한다. [공식 장착 조건](https://support.fractal-design.com/support/solutions/articles/4000228471-pop-2-vision-radiator-compatibility)

이 자료는 제조사 사양과 카탈로그 보강 근거다. 실제 조립, 운영 DB 반영, 원래 2026-10-02 표본 재현을 입증하지 않는다.
