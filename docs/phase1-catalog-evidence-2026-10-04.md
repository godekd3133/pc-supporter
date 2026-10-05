# 1차 게임 견적 테스트베드: 부품·가격·성능 근거

가격은 `server/reference-data/phase1-catalog.json`의 정확한 다나와 상품 ID를 2026-10-04에 직접 읽어 저장했다. 멤버십 적립·특정 카드 할인 대신 상품 페이지의 일반 최저가를 사용한다. 가격은 고정 시세가 아니며 각 행의 `priceCheckedAt` 이후 실제 원문 갱신값이 있으면 그 값이 우선한다. 원문 가격을 임의로 낮춰 예산을 맞추지 않는다.

`server/phase1-catalog.ts`는 같은 category/sourceProductCode만 보완하고, 누락된 정확한 SKU를 추가한다. 제조사 규격 보완과 가격 갱신은 구분하며 별도로 검수한 관리자 근거를 덮어쓰지 않는다. `server/phase1-catalog-refresh.ts`를 실행하면 같은 30개 상품 원문을 다시 읽을 수 있다.

## 지정 모델과 실제 상품 ID

| 범주 | 모델 | 다나와 상품 ID |
| --- | --- | --- |
| CPU | 5500GT / 5600 / 7500F 멀티팩 정품 | 54218171 / 16741211 / 21694499 |
| CPU | 7800X3D / 9700X / 9800X3D / 9950X3D 멀티팩 정품 | 19627934 / 62794082 / 70531547 / 77790914 |
| 쿨러 | AG400 G2 / Peerless Assassin 120 SE 서린 / NAUTILUS 360 RS | 106047347 / 16525058 / 70003022 |
| 보드 | A520M-HVS 대원씨티에스 / TUF B550M-PLUS STCOM | 77706989 / 11571368 |
| 보드 | B850M GAMING X WIFI6E 제이씨현 / MAG X870E 토마호크 WIFI | 122697197 / 75857021 |
| 메모리 | KLEVV DDR4-3200 CL22 파인인포 16GB / DDR5-5600 CL46 파인인포 16GB | 11787091 / 18965774 |
| 메모리 | PATRIOT DDR5-8000 CL38 VIPER Xtreme5 RGB 32GB(16GB×2) | 95057837 |
| GPU | MSI RTX 3050 벤투스 2X E OC 6GB / AFOX RX580 2048SP 디앤디컴 | 71010053 / 78306452 |

RTX 5050–5090도 동일한 국내 판매 상품 원문을 읽었으며 GPU·쿨러의 유사 이름이나 해외 구매 제품으로 대체하지 않았다. NAUTILUS는 ARGB/LCD가 아닌 지정된 **NAUTILUS 360 RS**다. 5500GT, 5600, 7500F의 원문에는 Wraith Stealth 포함이 명시되어 있다. X3D 3개 상품의 원문은 쿨러 미포함이므로 `coolerIncluded:false`를 유지한다. 9700X 멀티팩 상품 62794082는 확인 당시 원문이 Wraith Stealth 포함으로 표기하며 다른 포장 SKU와 혼동하지 않는다.

## 전원부와 냉각 정책

제조사 사실은 `shared/phase1-hardware-evidence.ts`에 출처와 함께 보관했다. A520의 6페이즈/50A 초크, B550의 8+2 DrMOS/VRM 방열판, B850의 10 Vcore/60A DrMOS/방열판, X870E의 14 Vcore/80A SPS/방열판을 확인했다.

Vcore 정격 합계의 단위 A를 CPU PPT의 단위 W와 직접 비교할 수 없다. 따라서 30% 계산을 제조사 출력 보장값으로 사용하거나 `vrmCapacityW`를 만들어 넣지 않는다. 1차 추천은 기본 설정을 전제로 A520≤65W, B550≤105W, B850≤120W, X870E≤170W TDP를 적용한다. 이 숫자는 **프로젝트의 보수 선택 정책**이며 제조사 보장 출력 상한이나 실측 VRM 온도가 아니다. BIOS와 보드 revision 확인은 별도 구매 조건이다.

냉각도 같은 방식으로 싱글타워 AG400 G2≤120W, 듀얼타워 PA120 SE≤170W, 360mm NAUTILUS≤170W 기본 설정 조합을 고른다. 소켓·케이스 높이·라디에이터 장착 공간은 실제 규격으로 따로 확인한다. NAUTILUS의 소비전력 대응값이나 장착 위치를 임의의 제품 스펙으로 만들지 않는다.

## 가격만으로 찾을 수 없었던 물리 규격

- [앱코 C10M 공식 제품](https://www.abko.co.kr/brand/detail.php?it_id=1770626260)의 이미지에서 HDD 2개/SSD 2개와 **234×203mm 이하 Micro-ATX(Minimum)** 제한을 확인했다. A520M-HVS 230×201mm는 맞지만 B550M/B850M 244×244mm는 맞지 않는다. CPU를 AM5로 바꿀 때 이 케이스도 바꿔야 한다. 검수용 이미지: `artifacts/phase1-evidence/c10m-manufacturer-spec.png`.
- [디앤디 제조사 제공 RX580 이미지](https://image3.compuzone.co.kr/img/product_img_detail/2025/0324/1225450/0d4bf5d683d49a1a7318b580f6dbf752.jpg)는 212×111×41.5mm, 400W 이상 파워, 8핀 1개, KC `R-R-ACl-RX580H3V3`를 명시한다. 대원씨티에스 H3 제품의 다른 규격을 복사하지 않았다. 검수용 이미지: `artifacts/phase1-evidence/afox-dnd-manufacturer-spec.png`.
- RX580의 실측 TGP는 그 이미지에도 없다. `powerW`는 미확인으로 두고, 전력 예산 계산만 PCIe 슬롯 75W와 [GPU 8핀 정격 150W](https://help.corsair.com/hc/en-us/articles/10700487373197-PSU-How-to-Avoid-Current-Overload-Connector-Issues)를 더한 225W 상한을 사용한다. 이 값은 실측 소비전력이 아니다.
- [MANLI 제조사가 COMPUTEX에 제출한 정확한 제품 시트](https://storage.googleapis.com/www.taiwantradeshow.com.tw/product/202503/T-32063560.pdf)는 SKU `M-N509GO/D732G-M3626`, TGP 600W, 권장 시스템 파워 1000W, 359×145×69mm, 4슬롯 공간, 16핀 1개와 8핀 4개 변환 케이블을 명시한다. 일반 5090의 TGP 575W와 구분했다.

## 성능 영상 계약

게임 성능은 [지정 GPU 영상](https://youtu.be/iVL3KqqzlhM)에서 직접 확인한 QHD 평균 게임 성능 열을 사용하며 RTX 5060 Ti **16GB**를 100%로 둔다. 8GB 모델은 QHD 97.4%로 구분한다. RTX50, RTX3050 6GB, RX580 2048SP의 확인한 수치와 나머지 모델·내장 GPU 추정을 `video_table`/`model_estimate`로 구분한다.

CPU는 [지정 CPU 영상](https://youtu.be/6NoegO2rlkE)의 Cinebench R23 상대 수치를 그대로 사용한다. 영상의 싱글코어 기준은 **13600K**, 멀티코어 기준은 **14600K**로 서로 다르다. 영상 직접 수치를 R23 원점수로 취급하지 않는다. 모델명 비교는 9950X3D2/9950X3D/9950X를 정확히 구분하며 9800X3D 싱글코어는 독립 이미지 재검수 후 **107.1%**로 교정했다.

7500F처럼 직접 전사가 아직 확보되지 않은 모델은 영상에서 검증했다고 표시하지 않고 기존 모델 추정과 정규화 기준을 명시한다. 프레임 안정성도 CPU 등급·캐시 기반 추정으로서 실측 1% low 값으로 표기하지 않는다.
