import "dotenv/config";
import { copyFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { CatalogSpecOverride, Part } from "../shared/types";
import { applyCatalogSpecOverrides, readCatalogSpecOverrides, saveCatalogSpecOverrides, validateCatalogSpecOverrideBatch } from "../server/catalog-spec-overrides";
import { appendCatalogChangeRecords, catalogChangeRecord, meaningfulCatalogChangeFields } from "../server/catalog-change-log";
import { catalogSpecSourceCheckBatchFor } from "../server/catalog-spec-source-check-batch";
import { appendCatalogSpecOverrideSourceCheckHistory } from "../server/catalog-spec-override-source-check-history";
import { CATALOG_CHANGE_LOG_PATH, CATALOG_PATH, CATALOG_SPEC_OVERRIDE_SOURCE_CHECK_HISTORY_PATH, CATALOG_SPEC_OVERRIDES_PATH, DATA_DIR, readJson, removeGeneratedFile, writeJson } from "../server/storage";

type OfficialCaseSpec = {
  productCode: string;
  hddBays: number;
  manufacturerModel: string;
  sourceUrl: string;
  sourceNote: string;
  manualSourceReviewed?: boolean;
};

const OFFICIAL_CASE_SPECS: OfficialCaseSpec[] = [
  {
    productCode: "78530048",
    hddBays: 2,
    manufacturerModel: "DS500 RGB",
    sourceUrl: "https://darkflash.co.kr/article/%EB%B3%B4%EB%8F%84%EC%9E%90%EB%A3%8C/2/35637/",
    sourceNote: "공식 수입사 보도자료에 darkFlash DS500 RGB 블랙의 3.5형 HDD 최대 2개 장착을 명시합니다. 다나와 상품코드 78530048의 블랙 모델과 대조했습니다."
  },
  {
    productCode: "17357669",
    hddBays: 3,
    manufacturerModel: "FD-C-POA1A-01",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2022/06/Pop-Air-RGB-Pop-Air_Product-Sheet_EN.pdf",
    sourceNote: "제조사 Pop Air Black Solid 사양의 SKU FD-C-POA1A-01 및 결합 3.5/2.5형 드라이브 장착부 3개를 확인했습니다."
  },
  {
    productCode: "17357537",
    hddBays: 3,
    manufacturerModel: "FD-C-POA1A-02",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2022/06/Pop-Air-RGB-Pop-Air_Product-Sheet_EN.pdf",
    sourceNote: "제조사 Pop Air Black TG 사양의 SKU FD-C-POA1A-02 및 결합 3.5/2.5형 드라이브 장착부 3개를 확인했습니다."
  },
  {
    productCode: "17357018",
    hddBays: 3,
    manufacturerModel: "FD-C-POR1A-02",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2022/06/Pop-Air-RGB-Pop-Air_Product-Sheet_EN.pdf",
    sourceNote: "제조사 Pop Air RGB Cyan Core TG 사양의 SKU FD-C-POR1A-02 및 결합 3.5/2.5형 드라이브 장착부 3개를 확인했습니다."
  },
  {
    productCode: "17357132",
    hddBays: 3,
    manufacturerModel: "FD-C-POR1A-01",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2022/06/Pop-Air-RGB-Pop-Air_Product-Sheet_EN.pdf",
    sourceNote: "제조사 Pop Air RGB White TG 사양의 SKU FD-C-POR1A-01 및 결합 3.5/2.5형 드라이브 장착부 3개를 확인했습니다."
  },
  {
    productCode: "30499121",
    hddBays: 2,
    manufacturerModel: "0-761345-10017-5",
    sourceUrl: "https://www.antec.com/product/case/ax81",
    sourceNote: "Antec AX81 RGB Elite 공식 사양의 UPC 0-761345-10017-5와 3.5/2.5형 드라이브 장착부 2/1을 확인했습니다. 3.5형 HDD 장착부는 2개입니다."
  },
  {
    productCode: "72470105",
    hddBays: 4,
    manufacturerModel: "0-761345-10148-6",
    sourceUrl: "https://www.antec.com/product/case/flux-pro",
    sourceNote: "Antec FLUX PRO 공식 사양의 UPC 0-761345-10148-6과 3.5/2.5형 드라이브 장착부 4/4를 확인했습니다."
  },
  {
    productCode: "108421685",
    hddBays: 4,
    manufacturerModel: "FLUX PRO Noctua Edition",
    sourceUrl: "https://www.antec.com/product/case/flux-pro-noctua-edition",
    sourceNote: "Antec FLUX PRO Noctua Edition 공식 제품 페이지의 모델명과 3.5/2.5형 드라이브 장착부 4/4를 확인했습니다."
  },
  {
    productCode: "18538823",
    hddBays: 2,
    manufacturerModel: "LANCOOL 216X",
    sourceUrl: "https://lian-li.com/product/lancool-216/",
    sourceNote: "Lian Li LANCOOL 216 공식 규격표에서 모델 LANCOOL 216X와 Drive Cage의 3.5형 HDD 2개를 확인했습니다."
  },
  {
    productCode: "18538847",
    hddBays: 2,
    manufacturerModel: "LANCOOL 216RW",
    sourceUrl: "https://lian-li.com/product/lancool-216/",
    sourceNote: "Lian Li LANCOOL 216 공식 규격표에서 모델 LANCOOL 216RW와 Drive Cage의 3.5형 HDD 2개를 확인했습니다."
  },
  {
    productCode: "79556882",
    hddBays: 1,
    manufacturerModel: "H6 Series",
    sourceUrl: "https://cdn-g.nzxt.com/dl/1698993634-h6-flow_digital-manual_231027_v2-pdf.pdf",
    sourceNote: "NZXT 공식 H6 Flow (2023) 사양 문서에 화이트 SKU CC-H61FW-01과 3.5형 드라이브 베이 1개가 함께 명시돼 있고, 공식 H6 Series 매뉴얼도 3.5형 HDD 1개를 확인합니다."
  },
  {
    productCode: "79556969",
    hddBays: 1,
    manufacturerModel: "H6 Series",
    sourceUrl: "https://cdn-g.nzxt.com/dl/1698993634-h6-flow_digital-manual_231027_v2-pdf.pdf",
    sourceNote: "NZXT 공식 H6 Flow (2023) 사양 문서에 화이트 RGB SKU CC-H61FW-R1과 3.5형 드라이브 베이 1개가 함께 명시돼 있고, 공식 H6 Series 매뉴얼도 3.5형 HDD 1개를 확인합니다."
  },
  {
    productCode: "97308200",
    hddBays: 18,
    manufacturerModel: "AX700",
    sourceUrl: "https://br.thermaltake.com/ax700-super-tower-chassis.html",
    sourceNote: "Thermaltake AX700/AX700 TG 공식 매뉴얼의 drive bays 표에 HDD cage 12개와 메인보드 뒤 6개, 총 18개의 3.5/2.5형 장착부를 명시합니다."
  },
  {
    productCode: "97308263",
    hddBays: 18,
    manufacturerModel: "AX700 TG",
    sourceUrl: "https://br.thermaltake.com/ax700-tg-super-tower-chassis.html",
    sourceNote: "Thermaltake AX700/AX700 TG 공식 매뉴얼의 drive bays 표에 HDD cage 12개와 메인보드 뒤 6개, 총 18개의 3.5/2.5형 장착부를 명시합니다."
  },
  {
    productCode: "74012729",
    hddBays: 0,
    manufacturerModel: "NR100-KNNN-S00",
    sourceUrl: "https://www.coolermaster.com/en-global/products/ncore-100-air.html",
    sourceNote: "Cooler Master NCORE 100 AIR 공식 사양에서 블랙 모델 번호 NR100-KNNN-S00와 장착 베이 목록(2.5형 SSD 1개, 3.5형 HDD 베이 없음)을 확인했습니다."
  },
  {
    productCode: "20344595",
    hddBays: 0,
    manufacturerModel: "FD-C-TER1N-03",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2023/05/Terra_Product-sheet_EN.pdf",
    sourceNote: "Fractal Design Terra 공식 제품 사양서에서 Jade SKU FD-C-TER1N-03, 3.5/2.5형 장착부 0개를 확인했습니다."
  },
  {
    productCode: "40016345",
    hddBays: 2,
    manufacturerModel: "FD-C-NOR1X-03",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2025/03/North-XL_Product-Sheet_EN.pdf",
    sourceNote: "Fractal Design North XL 제품 시트에서 SKU FD-C-NOR1X-03과 3.5/2.5형 결합 드라이브 장착부 2개를 확인했습니다."
  },
  {
    productCode: "40016330",
    hddBays: 2,
    manufacturerModel: "FD-C-NOR1X-04",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2025/03/North-XL_Product-Sheet_EN.pdf",
    sourceNote: "Fractal Design North XL 제품 시트에서 SKU FD-C-NOR1X-04와 3.5/2.5형 결합 드라이브 장착부 2개를 확인했습니다."
  },
  {
    productCode: "90158345",
    hddBays: 2,
    manufacturerModel: "FD-C-NOR1X-06",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2025/03/North-XL_Product-Sheet_EN.pdf",
    sourceNote: "Fractal Design North XL 제품 시트에서 SKU FD-C-NOR1X-06과 3.5/2.5형 결합 드라이브 장착부 2개를 확인했습니다."
  },
  {
    productCode: "40016360",
    hddBays: 2,
    manufacturerModel: "FD-C-NOR1X-02",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2025/03/North-XL_Product-Sheet_EN.pdf",
    sourceNote: "Fractal Design North XL 제품 시트에서 SKU FD-C-NOR1X-02와 3.5/2.5형 결합 드라이브 장착부 2개를 확인했습니다."
  },
  {
    productCode: "108416156",
    hddBays: 2,
    manufacturerModel: "FD-C-NOR1X-07",
    sourceUrl: "https://assets.fractal-design.com/files/uxzbxy2o/production/2bf236b6a310d8abe38ff7d334bb592a0965dcb0.pdf",
    sourceNote: "Fractal Design North XL Momentum Edition 공식 사양의 SKU FD-C-NOR1X-07과 3.5/2.5형 결합 드라이브 장착부 2개를 확인했습니다."
  },
  {
    productCode: "18448688",
    hddBays: 3,
    manufacturerModel: "FD-C-NOR1C-01",
    sourceUrl: "https://assets.fractal-design.com/files/uxzbxy2o/production/23a01a08f4b1cecd7b3efda20f85d8dcee09d891.pdf",
    sourceNote: "Fractal Design North 공식 사양의 SKU FD-C-NOR1C-01에서 3.5/2.5형 결합 장착 위치 3개, 포함 트레이 2개를 확인했습니다. `hddBays`는 제조사가 명시한 최대 위치 수 3으로 기록했습니다. 세 번째 드라이브를 장착할 트레이는 별도 확인이 필요합니다."
  },
  {
    productCode: "18448790",
    hddBays: 3,
    manufacturerModel: "FD-C-NOR1C-04",
    sourceUrl: "https://assets.fractal-design.com/files/uxzbxy2o/production/23a01a08f4b1cecd7b3efda20f85d8dcee09d891.pdf",
    sourceNote: "Fractal Design North Chalk White TG Clear 공식 사양의 SKU FD-C-NOR1C-04에서 3.5/2.5형 결합 장착 위치 3개, 포함 트레이 2개를 확인했습니다. `hddBays`는 제조사가 명시한 최대 위치 수 3으로 기록했습니다. 세 번째 드라이브를 장착할 트레이는 별도 확인이 필요합니다."
  },
  {
    productCode: "108416054",
    hddBays: 2,
    manufacturerModel: "FD-C-NOR1C-05",
    sourceUrl: "https://assets.fractal-design.com/files/uxzbxy2o/production/9b2776d0cc8e0249db9357726411061d0d78df1b.pdf",
    sourceNote: "Fractal Design North Momentum Edition 공식 사양의 SKU FD-C-NOR1C-05와 3.5/2.5형 결합 드라이브 장착부 2개를 확인했습니다."
  },
  {
    productCode: "13489595",
    hddBays: 2,
    manufacturerModel: "FD-C-MES2C-01",
    sourceUrl: "https://assets.fractal-design.com/files/uxzbxy2o/production/957ad6ea3e40c76bf4dbae6baf505bad55f3984d.pdf",
    sourceNote: "Fractal Design Meshify 2 Compact Black 공식 사양의 SKU FD-C-MES2C-01과 3.5/2.5형 결합 드라이브 장착부 2개를 확인했습니다."
  },
  {
    productCode: "11479695",
    hddBays: 2,
    manufacturerModel: "FD-C-DEF7C-01",
    sourceUrl: "https://assets.fractal-design.com/files/uxzbxy2o/production/9469a1a218e61563c36ec487d1401fc21f583103.pdf",
    sourceNote: "Fractal Design Define 7 Compact Black Solid 공식 사양의 SKU FD-C-DEF7C-01과 3.5/2.5형 결합 드라이브 장착부 2개를 확인했습니다."
  },
  {
    productCode: "12681041",
    hddBays: 18,
    manufacturerModel: "FD-C-MES2X-02",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2020/10/Meshify-2-XL-_Product-Sheet_EN.pdf",
    sourceNote: "Fractal Design Meshify 2 XL Black TG Light Tint 공식 시트의 SKU FD-C-MES2X-02와 최대 18개의 3.5/2.5형 저장 위치를 확인했습니다. 기본 포함 트레이는 6개이며 추가 위치는 확장 트레이·브라켓 조건 확인이 필요합니다."
  },
  {
    productCode: "17359076",
    hddBays: 3,
    manufacturerModel: "FD-C-POS1A-01",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2022/06/Pop-Silent_Product-Sheet_EN.pdf",
    sourceNote: "Fractal Design Pop Silent Black Solid 공식 시트의 SKU FD-C-POS1A-01과 최대 3개의 3.5인치 HDD 지원을 확인했습니다. 저장 트레이 2개 포함 여부를 source note에 구분했습니다."
  },
  {
    productCode: "17358986",
    hddBays: 3,
    manufacturerModel: "FD-C-POS1A-02",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2022/06/Pop-Silent_Product-Sheet_EN.pdf",
    sourceNote: "Fractal Design Pop Silent Black TG Clear Tint 공식 시트의 SKU FD-C-POS1A-02와 최대 3개의 3.5인치 HDD 지원을 확인했습니다. 저장 트레이 2개 포함 여부를 source note에 구분했습니다."
  },
  {
    productCode: "17359220",
    hddBays: 2,
    manufacturerModel: "FD-C-POS1M-01",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2022/06/Pop-Mini-Silent_Product-Sheet_EN.pdf",
    sourceNote: "Fractal Design Pop Mini Silent Black Solid 공식 시트의 SKU FD-C-POS1M-01과 포함된 결합 트레이 2개를 확인했습니다."
  },
  {
    productCode: "17359325",
    hddBays: 2,
    manufacturerModel: "FD-C-POS1M-02",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2022/06/Pop-Mini-Silent_Product-Sheet_EN.pdf",
    sourceNote: "Fractal Design Pop Mini Silent Black TG Clear Tint 공식 시트의 SKU FD-C-POS1M-02와 포함된 결합 트레이 2개를 확인했습니다."
  },
  {
    productCode: "17359157",
    hddBays: 4,
    manufacturerModel: "FD-C-POS1X-01",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2022/06/Pop-XL-Silent_Product-Sheet_EN.pdf",
    sourceNote: "Fractal Design Pop XL Silent Black Solid 공식 시트의 SKU FD-C-POS1X-01과 최대 4개의 3.5인치 HDD 지원을 확인했습니다. 포함 트레이 3개와 최대 지원 수 4개를 구분했습니다."
  },
  {
    productCode: "10909788",
    hddBays: 14,
    manufacturerModel: "FD-C-DEF7A-01",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2020/10/Define-7_Product-Sheet_EN.pdf",
    sourceNote: "Fractal Design Define 7 Black Solid 공식 시트의 SKU FD-C-DEF7A-01과 최대 14개의 HDD/SSD 위치를 확인했습니다. 기본 포함 트레이 6개와 최대 위치 수를 구분했습니다."
  },
  {
    productCode: "10958601",
    hddBays: 18,
    manufacturerModel: "FD-C-DEF7X-03",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2020/10/Define-7-XL_Product-Sheet_EN.pdf",
    sourceNote: "Fractal Design Define 7 XL Black TG Dark Tint 공식 시트의 SKU FD-C-DEF7X-03과 최대 18개의 HDD/SSD 위치를 확인했습니다. 기본 포함 트레이 6개와 멀티브라켓 2개를 구분했습니다."
  },
  {
    productCode: "10958544",
    hddBays: 18,
    manufacturerModel: "Define 7 XL",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2020/10/Define-7-XL_Product-Sheet_EN.pdf",
    sourceNote: "Fractal Design Define 7 XL 제품 시트의 모델명과 Storage Layout 최대 18개 HDD 위치를 확인했습니다. 다나와 PCode 10958544에는 색상/SKU가 명시되지 않았지만 제조사 Define 7 XL variant 표에서 Black Solid/TG variants가 같은 18개 위치를 사용해 공통 사양으로 보강했습니다. Storage Layout에서 기본 포함은 HDD/SSD 트레이 6개와 멀티브라켓 2개입니다."
  },
  {
    productCode: "17357855",
    hddBays: 4,
    manufacturerModel: "FD-C-POR1X-01",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2022/06/Pop-XL-Air-RGB_Product-Sheet_EN.pdf",
    sourceNote: "Fractal Design Pop XL Air RGB White 제품 페이지에서 SKU FD-C-POR1X-01과 HDD 최대 4개 안내를 확인했습니다. 상세 페이지의 장착부 분류와 공식 제품 시트의 분류가 다르므로 분류별 숫자를 더하지 않고 제조사 최대 HDD 수 4개를 기록합니다. 제품 시트: https://www.fractal-design.com/app/uploads/2022/06/Pop-XL-Air-RGB_Product-Sheet_EN.pdf"
  },
  {
    productCode: "15025229",
    hddBays: 2,
    manufacturerModel: "FD-C-TOR1A-05",
    sourceUrl: "https://assets.fractal-design.com/files/uxzbxy2o/production/03b86180d162fdc4ef0e881e1c9ea24e1fa6d846.pdf",
    sourceNote: "Fractal Design Torrent Black Solid 제품 시트의 SKU FD-C-TOR1A-05와 포함된 전용 3.5인치 HDD 장착부 2개를 확인했습니다."
  },
  {
    productCode: "91561445",
    hddBays: 2,
    manufacturerModel: "FD-C-MES3X-01",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2025/05/Meshify-3-XL_Product_Sheet_EN.pdf",
    sourceNote: "Fractal Design Meshify 3 XL Black Solid 제품 시트의 SKU FD-C-MES3X-01과 3.5인치 2개/2.5인치 4개의 장착부 표기를 확인했습니다."
  },
  {
    productCode: "94087928",
    hddBays: 3,
    manufacturerModel: "FD-C-EPO1A-03",
    sourceUrl: "https://assets.fractal-design.com/files/uxzbxy2o/production/63689e50c0c316464914235f9bb29525bd6787c3.pdf",
    sourceNote: "Fractal Design Epoch White TG Clear tint 제품 시트의 SKU FD-C-EPO1A-03과 3.5/2.5인치 결합 위치 3개(트레이 2개 포함)를 확인했습니다. `hddBays=3`은 제조사 최대 위치 수를 뜻하며, 동일 SKU 제품 페이지의 결합 장착부 표기는 2개입니다. 페이지와 시트의 차이 및 기본 포함 트레이 수를 함께 표시합니다."
  },
  {
    productCode: "17357984",
    hddBays: 2,
    manufacturerModel: "FD-C-POR1M-01",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2022/06/Pop-Mini-Air-RGB_Product-Sheet_EN.pdf",
    sourceNote: "Fractal Design Pop Mini Air RGB White TG Clear Tint 공식 시트의 SKU FD-C-POR1M-01과 3.5/2.5인치 결합 트레이 2개(모두 포함)를 확인했습니다."
  },
  {
    productCode: "104555042",
    hddBays: 1,
    manufacturerModel: "FD-C-POA2A-01",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2026/01/Pop-2-Air_Product-Sheet_EN.pdf",
    sourceNote: "Fractal Design Pop 2 Air Black Solid 공식 시트의 SKU FD-C-POA2A-01과 3.5/2.5인치 결합 장착부 1개를 확인했습니다."
  },
  {
    productCode: "104555225",
    hddBays: 1,
    manufacturerModel: "FD-C-POA2A-02",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2026/01/Pop-2-Air_Product-Sheet_EN.pdf",
    sourceNote: "Fractal Design Pop 2 Air Black TG 공식 시트의 SKU FD-C-POA2A-02와 3.5/2.5인치 결합 장착부 1개를 확인했습니다."
  },
  {
    productCode: "104554937",
    hddBays: 1,
    manufacturerModel: "FD-C-POA2A-04",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2026/01/Pop-2-Air_Product-Sheet_EN.pdf",
    sourceNote: "Fractal Design Pop 2 Air White TG RGB 공식 시트의 SKU FD-C-POA2A-04와 3.5/2.5인치 결합 장착부 1개를 확인했습니다."
  },
  {
    productCode: "94087853",
    hddBays: 3,
    manufacturerModel: "FD-C-EPO1A-01",
    sourceUrl: "https://assets.fractal-design.com/files/uxzbxy2o/production/63689e50c0c316464914235f9bb29525bd6787c3.pdf",
    sourceNote: "Fractal Design Epoch Black Solid 공식 시트의 SKU FD-C-EPO1A-01과 3.5/2.5인치 결합 위치 3개(트레이 2개 포함)를 확인했습니다. 동일 시리즈 제품 페이지는 2개로 표기하므로 최대 위치 3개와 기본 포함 수 2개를 함께 기록했습니다."
  },
  {
    productCode: "94087988",
    hddBays: 3,
    manufacturerModel: "FD-C-EPO1A-04",
    sourceUrl: "https://assets.fractal-design.com/files/uxzbxy2o/production/63689e50c0c316464914235f9bb29525bd6787c3.pdf",
    sourceNote: "Fractal Design Epoch Black TG RGB 공식 시트의 SKU FD-C-EPO1A-04와 3.5/2.5인치 결합 위치 3개(트레이 2개 포함)를 확인했습니다. 동일 시리즈 제품 페이지는 2개로 표기하므로 최대 위치 3개와 기본 포함 수 2개를 함께 기록했습니다."
  },
  {
    productCode: "102124007",
    hddBays: 2,
    manufacturerModel: "FD-C-EPO1X-01",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2025/11/Epoch-XL_Product-Sheet_EN.pdf",
    sourceNote: "Fractal Design Epoch XL Black Solid 공식 시트의 SKU FD-C-EPO1X-01과 포함된 3.5/2.5인치 결합 트레이 2개를 확인했습니다."
  },
  {
    productCode: "102124055",
    hddBays: 2,
    manufacturerModel: "FD-C-EPO1X-02",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2025/11/Epoch-XL_Product-Sheet_EN.pdf",
    sourceNote: "Fractal Design Epoch XL Black TG 공식 시트의 SKU FD-C-EPO1X-02와 포함된 3.5/2.5인치 결합 트레이 2개를 확인했습니다."
  },
  {
    productCode: "102124145",
    hddBays: 2,
    manufacturerModel: "FD-C-EPO1X-05",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2025/11/Epoch-XL_Product-Sheet_EN.pdf",
    sourceNote: "Fractal Design Epoch XL White TG RGB 공식 시트의 SKU FD-C-EPO1X-05와 포함된 3.5/2.5인치 결합 트레이 2개를 확인했습니다."
  },
  {
    productCode: "91561040",
    hddBays: 2,
    manufacturerModel: "FD-C-MES3X-05",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2025/05/Meshify-3-XL_Product_Sheet_EN.pdf",
    sourceNote: "Fractal Design Meshify 3 XL Ambience Pro RGB White TG Clear Tint 공식 시트의 SKU FD-C-MES3X-05와 3.5인치 2개/2.5인치 4개의 장착부 표기를 확인했습니다."
  },
  {
    productCode: "91561397",
    hddBays: 2,
    manufacturerModel: "FD-C-MES3X-04",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2025/05/Meshify-3-XL_Product_Sheet_EN.pdf",
    sourceNote: "Fractal Design Meshify 3 XL Black RGB TG Light Tint 공식 시트의 SKU FD-C-MES3X-04와 3.5인치 2개/2.5인치 4개의 장착부 표기를 확인했습니다."
  },
  {
    productCode: "91561427",
    hddBays: 2,
    manufacturerModel: "FD-C-MES3X-02",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2025/05/Meshify-3-XL_Product_Sheet_EN.pdf",
    sourceNote: "Fractal Design Meshify 3 XL Black TG Light Tint 공식 시트의 SKU FD-C-MES3X-02와 3.5인치 2개/2.5인치 4개의 장착부 표기를 확인했습니다."
  },
  {
    productCode: "91560968",
    hddBays: 2,
    manufacturerModel: "FD-C-MES3A-01",
    sourceUrl: "https://assets.fractal-design.com/files/uxzbxy2o/production/50476fee3b3101e6d05d1bd5c1ff30f1738e378b.pdf",
    sourceNote: "Fractal Design Meshify 3 Black Solid 공식 시트의 SKU FD-C-MES3A-01과 3.5/2.5인치 장착 수 2/4를 확인해 3.5인치 HDD는 2개로 기록했습니다. 현재 제품 페이지는 결합 장착 위치 4개라고 표기해 자료 간 차이가 있으므로, 시트의 명시적 3.5인치 수를 따르고 분류 차이를 남깁니다. PDF가 source-check 자동 판독 한도보다 커 SKU·수량은 원문을 직접 열어 확인했습니다.",
    manualSourceReviewed: true
  },
  {
    productCode: "91560920",
    hddBays: 2,
    manufacturerModel: "FD-C-MES3A-02",
    sourceUrl: "https://assets.fractal-design.com/files/uxzbxy2o/production/50476fee3b3101e6d05d1bd5c1ff30f1738e378b.pdf",
    sourceNote: "Fractal Design Meshify 3 Black TG Light Tint 공식 시트의 SKU FD-C-MES3A-02와 3.5/2.5인치 장착 수 2/4를 확인해 3.5인치 HDD는 2개로 기록했습니다. 현재 제품 페이지는 결합 장착 위치 4개라고 표기해 자료 간 차이가 있으므로, 시트의 명시적 3.5인치 수를 따르고 분류 차이를 남깁니다. PDF가 source-check 자동 판독 한도보다 커 SKU·수량은 원문을 직접 열어 확인했습니다.",
    manualSourceReviewed: true
  },
  {
    productCode: "91560728",
    hddBays: 2,
    manufacturerModel: "FD-C-MES3A-03",
    sourceUrl: "https://assets.fractal-design.com/files/uxzbxy2o/production/50476fee3b3101e6d05d1bd5c1ff30f1738e378b.pdf",
    sourceNote: "Fractal Design Meshify 3 Ambience Pro RGB Black TG Light Tint 공식 시트의 SKU FD-C-MES3A-03과 3.5/2.5인치 장착 수 2/4를 확인해 3.5인치 HDD는 2개로 기록했습니다. 현재 제품 페이지는 결합 장착 위치 4개라고 표기해 자료 간 차이가 있으므로, 시트의 명시적 3.5인치 수를 따르고 분류 차이를 남깁니다. PDF가 source-check 자동 판독 한도보다 커 SKU·수량은 원문을 직접 열어 확인했습니다.",
    manualSourceReviewed: true
  },
  {
    productCode: "91560869",
    hddBays: 2,
    manufacturerModel: "FD-C-MES3A-07",
    sourceUrl: "https://assets.fractal-design.com/files/uxzbxy2o/production/50476fee3b3101e6d05d1bd5c1ff30f1738e378b.pdf",
    sourceNote: "Fractal Design Meshify 3 White RGB TG Clear Tint 공식 시트의 SKU FD-C-MES3A-07과 3.5/2.5인치 장착 수 2/4를 확인해 3.5인치 HDD는 2개로 기록했습니다. 현재 제품 페이지는 결합 장착 위치 4개라고 표기해 자료 간 차이가 있으므로, 시트의 명시적 3.5인치 수를 따르고 분류 차이를 남깁니다. PDF가 source-check 자동 판독 한도보다 커 SKU·수량은 원문을 직접 열어 확인했습니다.",
    manualSourceReviewed: true
  },
  {
    productCode: "68242736",
    hddBays: 0,
    manufacturerModel: "FD-C-ERA2N-03",
    sourceUrl: "https://assets.fractal-design.com/files/uxzbxy2o/production/74b237a6f0ad974a72d19a47b972c0c082b38882.pdf",
    sourceNote: "Fractal Design Era 2 Midnight Blue 제품 시트의 SKU FD-C-ERA2N-03에서 3.5인치 장착 위치가 0개이고 2.5인치 위치가 4개임을 확인했습니다."
  },
  {
    productCode: "18294494",
    hddBays: 0,
    manufacturerModel: "FD-C-RID1N-12",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2023/01/Ridge_Product-Sheet_EN.pdf",
    sourceNote: "Fractal Design Ridge White 공식 시트의 SKU FD-C-RID1N-12와 2.5인치 위치 4개를 확인했습니다. 이 시트에는 3.5인치 장착부가 없으므로 hddBays=0으로 기록했습니다."
  },
  {
    productCode: "60009269",
    hddBays: 1,
    manufacturerModel: "FD-C-MOD1N-02",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2024/06/Mood-Product-Sheet-EN.pdf",
    sourceNote: "Fractal Design Mood Black 공식 시트의 SKU FD-C-MOD1N-02와 포함된 전용 3.5인치 드라이브 마운트 1개를 확인했습니다."
  },
  {
    productCode: "122643621",
    hddBays: 1,
    manufacturerModel: "FD-C-POV2A-01",
    sourceUrl: "https://www.fractal-design.com/products/cases/pop-series/pop-2-vision/pop-2-vision-black/",
    sourceNote: "Fractal Design Pop 2 Vision Black 제품 페이지의 SKU FD-C-POV2A-01과 전용 3.5인치 마운트 1개를 확인했습니다. 대용량 웹페이지의 자동 본문 판독이 제한될 수 있어 해당 페이지 내용을 직접 대조했습니다.",
    manualSourceReviewed: true
  },
  {
    productCode: "122643690",
    hddBays: 1,
    manufacturerModel: "FD-C-POV2A-03",
    sourceUrl: "https://www.fractal-design.com/products/cases/pop-series/pop-2-vision/pop-2-vision-white-rgb/",
    sourceNote: "Fractal Design Pop 2 Vision White RGB 제품 페이지의 SKU FD-C-POV2A-03과 전용 3.5인치 마운트 1개를 확인했습니다. 대용량 웹페이지의 자동 본문 판독이 제한될 수 있어 해당 페이지 내용을 직접 대조했습니다.",
    manualSourceReviewed: true
  },
  {
    productCode: "18448748",
    hddBays: 3,
    manufacturerModel: "FD-C-NOR1C-02",
    sourceUrl: "https://assets.fractal-design.com/files/uxzbxy2o/production/23a01a08f4b1cecd7b3efda20f85d8dcee09d891.pdf",
    sourceNote: "Fractal Design North Charcoal Black TG Dark SKU FD-C-NOR1C-02의 공식 시트에서 3.5/2.5인치 결합 위치 3개와 기본 트레이 2개를 확인했습니다. `hddBays=3`은 최대 위치 수이며 세 번째 트레이의 포함 여부는 별도로 확인해야 합니다."
  },
  {
    productCode: "10910196",
    hddBays: 14,
    manufacturerModel: "FD-C-DEF7A-03",
    sourceUrl: "https://www.fractal-design.com/app/uploads/2020/10/Define-7_Product-Sheet_EN.pdf",
    sourceNote: "Fractal Design Define 7 Black TG Dark SKU FD-C-DEF7A-03의 공식 시트와 제품 페이지에서 Storage Layout 최대 14개 HDD 위치를 확인했습니다. 기본 포함 저장 트레이 6개와 확장 배치를 구분했습니다."
  },
  {
    productCode: "17884586",
    hddBays: 2,
    manufacturerModel: "FD-C-MEL2C-03",
    sourceUrl: "https://www.fractal-design.com/ja/products/cases/meshify/meshify-2-compact-lite/black-tg-light-tint/",
    sourceNote: "Fractal Design Meshify 2 Compact Lite Black TG Light Tint 제조사 페이지에서 SKU FD-C-MEL2C-03과 포함된 3.5/2.5인치 트레이 2개를 직접 확인했습니다. 연결된 제품 시트는 다른 Meshify 2 페이지로 리다이렉트되어 이 exact SKU 확인에는 사용하지 않았습니다.",
    manualSourceReviewed: true
  },
  {
    productCode: "14839061",
    hddBays: 11,
    manufacturerModel: "Define R6",
    sourceUrl: "https://www.fractal-design.com/ja/products/cases/define/define-r6-tempered-glass/blackout/",
    sourceNote: "다나와 상품명은 Fractal Design Define R6 Black입니다. 제조사 Define R6 product sheet는 기본형과 TG variant의 3.5/2.5형 범용 트레이를 각 6개로 표기하며, 제조사 R6 제품 사양은 저장 레이아웃 최대 11개 위치를 명시합니다. 같은 R6 chassis의 최대 HDD 장착 위치를 기록했습니다. non-TG PCode와 제조사 variant SKU의 일대일 대응은 검수된 페이지에서 확인하지 못해 family-level 값으로 직접 검토했습니다.",
    manualSourceReviewed: true
  },
  {
    productCode: "14840138",
    hddBays: 11,
    manufacturerModel: "FD-CA-DEF-R6-BK-TG",
    sourceUrl: "https://www.fractal-design.com/ja/products/cases/define/define-r6-tempered-glass/blackout/",
    sourceNote: "Fractal Design Define R6 Black TG 제조사 제품 사양에서 SKU FD-CA-DEF-R6-BK-TG, 6개의 3.5/2.5형 범용 트레이와 11개 전체 위치를 확인했습니다. HDD 호환 필드는 제조사 최대 위치 11을 기록하며, 포함 기본 트레이 수와 구분했습니다. 제품 페이지와 제품 시트는 직접 검토해 source-check는 manual_required로 남깁니다.",
    manualSourceReviewed: true
  },
];

const { values, positionals } = parseArgs({
  options: { apply: { type: "boolean", default: false } },
  strict: true,
  allowPositionals: true
});

if (positionals.length > 0) throw new Error("Only --apply is supported.");
if (process.env.DATABASE_URL?.trim()) throw new Error("This bounded backfill only supports the file-backed core catalog; unset DATABASE_URL.");
if (DATA_DIR !== resolve(process.cwd(), "data")) throw new Error("This backfill writes only this checkout's data folder; unset PC_SUPPORTER_DATA_DIR.");

const catalog = await readJson<Part[]>(CATALOG_PATH, []);
const existingOverrides = await readCatalogSpecOverrides();
const skipped: Array<{ productCode: string; reason: string }> = [];
const inputItems = OFFICIAL_CASE_SPECS.flatMap((entry) => {
  const part = catalog.find((candidate) => candidate.category === "case" && candidate.sourceProductCode === entry.productCode);
  if (!part) {
    skipped.push({ productCode: entry.productCode, reason: "해당 다나와 상품코드의 케이스가 현재 카탈로그에 없습니다." });
    return [];
  }
  const existing = existingOverrides[part.id];
  const existingCheckPassed = existing?.sourceCheck
    && (existing.sourceCheck.status === "reachable" || existing.sourceCheck.status === "redirected")
    && (existing.sourceCheck.identityStatus === "matched" || (entry.manualSourceReviewed === true && existing.sourceCheck.identityStatus === "manual_required"));
  if (existing?.fields.hddBays === entry.hddBays
    && existing.manufacturerModel === entry.manufacturerModel
    && existing.sourceUrl === entry.sourceUrl
    && existing.sourceNote === entry.sourceNote
    && existingCheckPassed) {
    skipped.push({ productCode: entry.productCode, reason: "동일한 공식 제조사 정보와 모델 확인 결과가 이미 저장돼 있습니다." });
    return [];
  }
  if (!part.missingFields.includes("hddBays") && existingOverrides[part.id]?.fields.hddBays === undefined) {
    skipped.push({ productCode: entry.productCode, reason: "현재 HDD 베이가 누락 항목이 아니며 기존 보강값도 없습니다." });
    return [];
  }
  return [{
    partId: part.id,
    category: "case",
    fields: { hddBays: entry.hddBays },
    manufacturerModel: entry.manufacturerModel,
    sourceNote: entry.sourceNote,
    sourceUrl: entry.sourceUrl
  }];
});

const validation = inputItems.length > 0
  ? validateCatalogSpecOverrideBatch({ items: inputItems }, catalog, existingOverrides)
  : undefined;
if (validation?.errors.length) throw new Error(`Official case HDD-bay validation failed: ${validation.errors.join(" | ")}`);
const validationByPartId = new Map((validation?.items ?? []).map((item) => [item.partId, item]));
const candidateTargets = OFFICIAL_CASE_SPECS.flatMap((entry) => {
  const part = catalog.find((candidate) => candidate.category === "case" && candidate.sourceProductCode === entry.productCode);
  if (!part || !validationByPartId.get(part.id)?.valid) return [];
  return [{ part, entry }];
});

if (!values.apply) {
  console.log(JSON.stringify({
    mode: "dry-run",
    source: "official manufacturer case pages and manuals; only exact PCode/model-or-SKU matches; hddBays counts 3.5-inch HDD mounts",
    candidates: candidateTargets.map(({ part, entry }) => ({ partId: part.id, productCode: entry.productCode, name: part.name, hddBaysAfter: entry.hddBays, manufacturerModel: entry.manufacturerModel, sourceUrl: entry.sourceUrl, validation: validationByPartId.get(part.id)?.operation })),
    skipped,
    count: candidateTargets.length
  }, null, 2));
} else {
  if (candidateTargets.length === 0) {
    console.log(JSON.stringify({ mode: "apply", updated: 0, passedSourceChecks: 0, skipped }, null, 2));
  } else {
  const checks = await catalogSpecSourceCheckBatchFor(candidateTargets.map(({ part, entry }) => ({
    partId: part.id,
    partName: part.name,
    category: part.category,
    sourceUrl: entry.sourceUrl,
    manufacturerModel: entry.manufacturerModel
  })), { limit: 50, concurrency: 2 });
  const checkByPartId = new Map(checks.items.map((item) => [item.partId, item.sourceCheck]));
  const acceptedTargets = candidateTargets.filter(({ part }) => {
    const check = checkByPartId.get(part.id);
    const entry = OFFICIAL_CASE_SPECS.find((candidate) => candidate.productCode === part.sourceProductCode);
    const identityAccepted = check?.identityStatus === "matched" || (entry?.manualSourceReviewed === true && check?.identityStatus === "manual_required");
    return Boolean(check && (check.status === "reachable" || check.status === "redirected") && identityAccepted);
  });
  const rejectedTargets = candidateTargets.filter(({ part }) => !acceptedTargets.some((accepted) => accepted.part.id === part.id));
  if (acceptedTargets.length === 0) {
    console.log(JSON.stringify({ mode: "apply", updated: 0, rejected: rejectedTargets.map(({ part, entry }) => ({ productCode: entry.productCode, name: part.name, sourceCheck: checkByPartId.get(part.id) })) }, null, 2));
    process.exitCode = 1;
  } else {
    const latestCatalog = await readJson<Part[]>(CATALOG_PATH, []);
    for (const { part, entry } of acceptedTargets) {
      const latest = latestCatalog.find((candidate) => candidate.id === part.id);
      if (!latest || latest.sourceProductCode !== entry.productCode || (!latest.missingFields.includes("hddBays") && existingOverrides[part.id]?.fields.hddBays === undefined)) {
        throw new Error(`Catalog changed after official source checks; re-run dry-run: ${entry.productCode}`);
      }
    }
    const acceptedPartIds = new Set(acceptedTargets.map(({ part }) => part.id));
    const acceptedValidation = validateCatalogSpecOverrideBatch({ items: inputItems.filter((item) => acceptedPartIds.has(item.partId)) }, latestCatalog, await readCatalogSpecOverrides());
    if (acceptedValidation.errors.length > 0) throw new Error(`Catalog changed after official source checks; validation failed: ${acceptedValidation.errors.join(" | ")}`);
    const checkedOverrides: CatalogSpecOverride[] = acceptedValidation.validOverrides.map((override) => {
      const sourceCheck = checkByPartId.get(override.partId);
      return sourceCheck ? { ...override, sourceCheck } : override;
    });
    const latestOverrideMap = await readCatalogSpecOverrides();
    const previouslyEffectiveCatalog = applyCatalogSpecOverrides(latestCatalog, latestOverrideMap);
    const combinedOverrideMap = { ...latestOverrideMap, ...Object.fromEntries(checkedOverrides.map((override) => [override.partId, override])) };
    const updatedCatalog = applyCatalogSpecOverrides(latestCatalog, combinedOverrideMap);
    const beforeById = new Map(latestCatalog.map((part) => [part.id, part]));
    const checkedAt = new Date().toISOString();
    const changeRecords = checkedOverrides.flatMap((override) => {
      const before = beforeById.get(override.partId);
      const after = updatedCatalog.find((part) => part.id === override.partId);
      if (!before || !after) return [];
      const changedFields = [...new Set(["수동 스펙 override", ...meaningfulCatalogChangeFields(before, after)])];
      return [catalogChangeRecord("part", before, after, changedFields, { changedAt: override.updatedAt || checkedAt })];
    });
    const backupDirectory = await mkdtemp(join(tmpdir(), "pc-supporter-case-hdd-bays-backfill-"));
    const backupPaths = [CATALOG_SPEC_OVERRIDES_PATH, CATALOG_CHANGE_LOG_PATH, CATALOG_SPEC_OVERRIDE_SOURCE_CHECK_HISTORY_PATH] as const;
    const backedUp = new Set<string>();
    for (const path of backupPaths) {
      try {
        await copyFile(path, join(backupDirectory, path.split("/").at(-1)!));
        backedUp.add(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    try {
      await saveCatalogSpecOverrides(checkedOverrides);
      for (const override of checkedOverrides) {
        const sourceCheck = checkByPartId.get(override.partId);
        if (sourceCheck) await appendCatalogSpecOverrideSourceCheckHistory(override.partId, sourceCheck);
      }
      await appendCatalogChangeRecords(changeRecords);
      console.log(JSON.stringify({
        mode: "apply",
        updated: checkedOverrides.length,
        passedSourceChecks: checkedOverrides.length,
        rejected: rejectedTargets.map(({ part, entry }) => ({ productCode: entry.productCode, name: part.name, sourceCheck: checkByPartId.get(part.id) })),
        skipped,
        completeCasesBefore: previouslyEffectiveCatalog.filter((part) => part.category === "case" && part.missingFields.length === 0).length,
        completeCasesAfter: updatedCatalog.filter((part) => part.category === "case" && part.missingFields.length === 0).length,
        changeLogRecords: changeRecords.length,
        backupDirectory
      }, null, 2));
    } catch (error) {
      for (const path of backupPaths) {
        if (backedUp.has(path)) await copyFile(join(backupDirectory, path.split("/").at(-1)!), path);
        else await removeGeneratedFile(path);
      }
      throw new Error(`Official case HDD-bay backfill failed; prior files were restored from ${backupDirectory}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
}
