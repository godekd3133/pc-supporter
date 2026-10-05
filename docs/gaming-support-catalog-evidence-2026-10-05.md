# 게임 견적 지원 부품 공개 스냅샷

기존 공개 1차 부품 스냅샷은 파워 500W 하나와 GPU 장착 길이가 짧은 케이스만 포함하여, private `data/catalog.json`이 없는 checkout에서는 상위 RTX 50 견적을 끝까지 만들 수 없었다. 공개 원문을 다시 읽은 파워 5개·케이스 3개를 `server/reference-data/gaming-support-catalog.json`에 추가했다.

수집은 `fetchPhase1CatalogSnapshot(products)`를 사용하여 상품 코드를 지정하고 순서대로 진행했다. 최신 가격이 없거나 해외·중고·병행 상품으로 판별되면 기록하지 않는다. 이번 8개는 모두 `source: danawa`, `listingType: retail`이며, 가격·원문·상품 코드·확인 시각을 함께 저장했다. private 카탈로그는 후보의 상품 코드를 찾는 데만 사용했고 가격·사양을 복사하지 않았다.

확인 시점은 **2026-10-05 07:15 KST**다. 가격은 이후 바뀔 수 있다.

| 제품 | 확인 가격 | 확인한 기본 조건 | 상품 원문 |
|---|---:|---|---|
| 마이크로닉스 COOLMAX ELITE II 600W | 44,880원 | ATX·140mm·8핀 PCIe 2개 | [98760842](https://prod.danawa.com/info/?pcode=98760842) |
| 마이크로닉스 COOLMAX FOCUS II 700W ETA브론즈 ATX3.1 | 70,130원 | ATX·140mm·12V2x6 1개·8핀 PCIe 2개 | [99732404](https://prod.danawa.com/info/?pcode=99732404) |
| 마이크로닉스 WIZMAX 750W 80PLUS실버 ATX3.1 | 87,190원 | ATX·140mm·12V2x6 1개·8핀 PCIe 2개 | [74484749](https://prod.danawa.com/info/?pcode=74484749) |
| 마이크로닉스 WIZMAX 850W 80PLUS실버 ATX3.1 | 106,590원 | ATX·140mm·12V2x6 1개·8핀 PCIe 2개 | [74484791](https://prod.danawa.com/info/?pcode=74484791) |
| 마이크로닉스 WIZMAX G-1000W 80PLUS골드 ATX3.1 | 193,000원 | ATX·150mm·12V2x6 1개·8핀 PCIe 4개 | [90643607](https://prod.danawa.com/info/?pcode=90643607) |
| 3RSYS L200 블랙 | 32,690원 | mATX/ITX·GPU 410mm·쿨러 167mm·PSU 200mm | [124217320](https://prod.danawa.com/info/?pcode=124217320) |
| 앱코 G26 메가플로우 MESH 블랙 | 39,900원 | ATX/mATX/ITX·GPU 400mm·쿨러 165mm·PSU 200mm | [94088714](https://prod.danawa.com/info/?pcode=94088714) |
| darkFlash DS900 ARGB 강화유리 블랙 | 64,200원 | ATX/mATX/ITX·GPU 425mm·쿨러 170mm·PSU 260mm | [32861099](https://prod.danawa.com/info/?pcode=32861099) |

파워는 기존 시소닉·마이크로닉스 브랜드 제한을 유지한다. 600W는 저렴한 일반 8핀 구성용이고, 700·750·850·1000W는 확인한 native 12V2x6 경로를 제공한다. 전원 커넥터 개수를 독립 케이블 수로 바꾸지 않는다. 필요한 경우 독립 케이블 토폴로지와 GPU 제조사 권장 정격을 별도로 검사한다.

DS900은 [제조사 DS900 공식 페이지](https://www.darkflash.com/product/ds900)에서 기본 외형 434×218×454mm, GPU 425mm·CPU 쿨러 170mm와 상단 240/360mm·측면 240mm 라디에이터, SSD/HDD 2/2를 확인했다. 새 Danawa 원문의 동일 외형과 2024년 8월 상단 라디에이터 변경 정보를 대조하여 loader가 이 누락 사양만 근거와 함께 보완한다. DS900M·Air·PRO는 다른 제품이므로 사용하지 않는다. 라디에이터 두께·RAM 간섭·GPU 측면 전원 케이블 여유는 보완하지 않았다.

L200·G26의 HDD 베이와 라디에이터 조건은 해당 원문만으로 확인되지 않아 `missingFields`와 미확인 상태를 보존했다. 이것을 0개 또는 미지원으로 확정하지 않는다.

`server/gaming-support-catalog.ts`의 `applyGamingSupportCatalogSnapshot`은 기존 AMD/phase1 snapshot과 같은 경계로 동작한다. 정확한 범주+상품 코드로만 합치며 기존 로컬 ID는 유지한다. 더 최근 live 가격·수집이 있으면 기존 항목을 그대로 사용한다. 더 오래된 항목을 보완해도 관리자 spec provenance나 별도 물리 검토가 있으면 그 사양과 상태를 보존한다. 다른 제품·색상·유통사로 교체하지 않고, snapshot에 없는 항목도 유지한다.

이 작업에서는 데이터베이스·runtime 카탈로그·기존 spec override 파일을 수정하지 않았다. 최종 카탈로그 연결과 clean-checkout 견적·전체 테스트는 상위 작업에서 수행한다.
