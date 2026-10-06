# 저장장치 용량 조정용 공개 상품 확인

확인 시각: 2026-10-05 09:49~09:50 KST. `fetchPhase1CatalogSnapshot(products)`로 각 다나와 상품 페이지를 다시 읽었다. 로컬 카탈로그에서는 후보 상품번호만 찾았으며 가격은 복사하지 않았다.

| 상품 | 용량 | 연결·크기 | 확인 가격 | 상품 페이지 |
|---|---:|---|---:|---|
| 삼성전자 870 EVO | 500GB | SATA, 2.5인치 | 295,910원 | [13190519](https://prod.danawa.com/info/?pcode=13190519) |
| 삼성전자 870 EVO | 2TB | SATA, 2.5인치 | 1,027,900원 | [13190630](https://prod.danawa.com/info/?pcode=13190630) |
| Seagate BarraCuda ST2000DM008 | 2TB | SATA, 3.5인치 | 264,580원 | [6545078](https://prod.danawa.com/info/?pcode=6545078) |
| Western Digital WD RED Plus WD40EFZZ | 4TB | SATA, 3.5인치 | 305,090원 | [102550253](https://prod.danawa.com/info/?pcode=102550253) |

모두 해당 상품의 국내 일반 판매 페이지다. 해외구매·병행수입·중고·벌크·여러 드라이브를 묶은 상품은 사용하지 않았다. SSD는 현재 견적에서 허용하는 삼성전자·SK하이닉스 조건을 통과하며, HDD는 Seagate·Western Digital 제품이다. 이 표의 가격은 확인 시점의 관찰값이다. 전 시장의 최저 제품을 찾았다는 뜻은 아니다.

2.5인치 SATA SSD를 선택해 M.2 슬롯이 없는 A520M-HVS에서도 연결을 검사할 수 있도록 했다. HDD는 각각 드라이브 1개의 용량이다. `− / +`로 용량을 바꿀 때 요청한 HDD 개수는 유지하고 SATA 포트·케이스 베이는 엔진에서 다시 확인한다. HDD의 전력·치수처럼 파서가 읽지 못한 값은 추가로 만들지 않았다.

Samsung 500GB가 기존 다른 1TB 제품보다 비쌀 수 있다. 용량 감소와 가격 감소를 같은 의미로 표시하면 안 된다. 사용자 조정은 실제 부품 가격으로 계산하고 예산을 넘으면 초과 금액을 보여준다.

## 사용하지 않은 상품

[WD Blue WD40EZZX 상품 페이지](https://prod.danawa.com/info/?pcode=104374406)는 상품명이 4TB인데 상세 사양에는 2TB가 표기돼 있었다. 최종 자료에서 제외하고, 이름과 사양에 모두 4TB가 적힌 WD RED Plus WD40EFZZ로 교체했다. [SK하이닉스 Gold S31 500GB](https://prod.danawa.com/info/?pcode=13168247)는 공개 페이지에 단종이 표시돼 사용하지 않았다.

## 파일과 적용 방식

- `server/reference-data/gaming-storage-catalog.json`: 4개 상품의 원문 사양, 확인 가격, 상품번호와 시각.
- `server/gaming-storage-catalog.ts`: 정확한 상품번호·브랜드·국내 일반 판매·SATA·드라이브 크기와 용량을 확인한 뒤 반환한다.
- `applyGamingStorageCatalogSnapshot`: `mergeReferenceCatalogPart`로 기존 제품과 합친다. 더 최근 가격과 판매 중단 관찰, 기존 카탈로그 ID, 별도로 검토한 사양과 출처를 보존한다.
- `server/gaming-storage-catalog.test.ts`: 공개 상품 구성, 중복 방지, 최신 가격·ID, 검토된 사양, 최신 판매 중단 보존을 검사한다. 가격 보존 검사는 원본에서 1원 차이 나는 테스트 값으로 수행한다.

이 문서는 자료와 병합 동작의 확인 기록이다. 전체 견적 API·실제 화면의 용량 변경 검증은 별도 작업에서 수행한다.
