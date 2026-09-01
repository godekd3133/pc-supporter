import { describe, expect, it } from "vitest";
import {
  buildDanawaListAjaxParams,
  parseDanawaListPage,
  parseDanawaListPageInfo,
  parseDanawaListRequestContext,
  parseM2FormFactors,
  parseM2LaneSharing,
  parsePciePowerAdapterOptions,
  parsePciePowerConnectors,
  parsePciePowerOptions,
  parseDanawaProductPage,
  reparseDanawaPart
} from "./danawa";

describe("Danawa parser", () => {
  it("extracts product codes from the structured list markup", () => {
    const html = `
      <script type="application/ld+json">
        {"@type":"ItemList","itemListElement":[
          {"name":"AMD CPU","url":"https://prod.danawa.com/info/?pcode=12345&cate=112747","image":"//img.danawa.com/cpu.jpg","position":1}
        ]}
      </script>
      <ul><li><p class="prod_name"><a class="prod_name" href="https://prod.danawa.com/info/?pcode=12345&cate=112747">AMD CPU</a></p><div class="prod_pricelist"><p class="price_sect"><strong>123,400</strong>원</p></div></li></ul>
    `;
    expect(parseDanawaListPage(html)).toEqual([
      {
        name: "AMD CPU",
        url: "https://prod.danawa.com/info/?pcode=12345&cate=112747",
        imageUrl: "https://img.danawa.com/cpu.jpg",
        priceWon: undefined,
        rawSpecText: undefined,
        sourceProductCode: "12345"
      }
    ]);
  });

  it("extracts the full product rows and total count from a category page", () => {
    const html = `
      <input id="totalProductCount" value="516" />
      <ul>
        <li class="prod_item" id="productItem1"><p class="prod_name"><a name="productName" href="https://prod.danawa.com/info/?pcode=1&cate=112747">CPU one</a></p><div class="prod_pricelist"><p class="price_sect"><strong>100,000</strong>원</p></div></li>
        <li class="prod_item" id="productItem2"><p class="prod_name"><a name="productName" href="https://prod.danawa.com/info/?pcode=2&cate=112747">CPU two</a></p><div class="prod_pricelist"><p class="price_sect"><strong>200,000</strong>원</p></div></li>
      </ul>
    `;
    const items = parseDanawaListPage(html);
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.sourceProductCode)).toEqual(["1", "2"]);
    expect(items.map((item) => item.priceWon)).toEqual([100000, 200000]);
    expect(parseDanawaListPageInfo(html)).toEqual({ totalProductCount: 516, pageSize: 2 });
  });

  it("drops non-HTTPS and non-Danawa product URLs at the parser boundary", () => {
    const html = `
      <ul>
        <li class="prod_item" id="productItem1"><p class="prod_name"><a name="productName" href="https://prod.danawa.com/info/?pcode=11&cate=112747">Valid CPU</a></p></li>
        <li class="prod_item" id="productItem2"><p class="prod_name"><a name="productName" href="javascript:location.href='https://prod.danawa.com/info/?pcode=12'">Unsafe scheme</a></p></li>
        <li class="prod_item" id="productItem3"><p class="prod_name"><a name="productName" href="https://evil.example/info/?pcode=13">Untrusted host</a></p></li>
      </ul>
    `;

    expect(parseDanawaListPage(html).map((item) => item.name)).toEqual(["Valid CPU"]);
  });

  it("derives the AJAX pagination contract from Danawa's initial page", () => {
    const html = `
      <script>
        var oGlobalSetting = {
          nGroup: 11,
          nDepth: 2,
          nCategoryCode: 747,
          nListCategoryCode: 747,
          nListGroup: 11,
          nListDepth: 2,
          sPhysicsCate1: "861",
          sPhysicsCate2: "873",
          sPhysicsCate3: "0",
          sPhysicsCate4: "0",
          sCategoryMappingCode: "699",
          bAssemblyGalleryCategory: "Y",
          sPowerLinkKeyword: "CPU",
          sQuickDeliveryCategoryYN: "N",
          sQuickDeliveryDisplay: "",
          sPriceUnitSort: "N",
          sPriceUnitSortOrder: "A",
          sSimpleDescriptionDisplayYN: "Y"
        };
        var oCurrentCategoryCode = "a:2:{i:1;i:97;i:2;i:747;}";
      </script>
    `;
    const context = parseDanawaListRequestContext(html);
    expect(context).toMatchObject({
      group: "11",
      depth: "2",
      categoryCode: "747",
      listCategoryCode: "747",
      physicsCate1: "861",
      physicsCate2: "873",
      currentCategoryCode: "a:2:{i:1;i:97;i:2;i:747;}"
    });
    expect(buildDanawaListAjaxParams(2, context!)).toMatchObject({
      page: "2",
      viewMethod: "LIST",
      sortMethod: "BEST",
      listCount: "30",
      categoryCode: "747",
      physicsCate2: "873",
      sProductListApi: "search"
    });
  });

  it("normalizes the fields needed by the compatibility engine", () => {
    const item = {
      name: "AMD 라이젠7-5세대 7800X3D",
      url: "https://prod.danawa.com/info/?pcode=19627934&cate=112747",
      sourceProductCode: "19627934",
      priceWon: 477200
    };
    const html = `
      <title>AMD 라이젠7-5세대 7800X3D : 다나와 가격비교</title>
      <meta name="description" content="AMD(소켓AM5) / 메모리 규격: DDR5 / 탑재 / PCIe5.0 / 5200MHz / TDP: 120W / AMD 라데온 그래픽 / 쿨러: 미포함" />
      <meta property="og:image" content="//img.danawa.com/product.jpg" />
      <div class="spec_set_wrap"><div class="spec_list"><div class="items">AMD(소켓AM5) / DDR5 / TDP: 120W</div></div></div>
    `;
    const part = parseDanawaProductPage("cpu", item, html, "112747");
    expect(part.id).toBe("danawa-cpu-19627934");
    expect(part.specs.socket).toBe("AM5");
    expect(part.specs.memoryType).toBe("DDR5");
    expect(part.specs.maxMemorySpeedMhz).toBe(5200);
    expect(part.specs.tdpW).toBe(120);
    expect(part.specs.integratedGraphics).toBe(true);
    expect(part.imageUrl).toBe("https://img.danawa.com/product.jpg");
    expect(part.priceWon).toBe(477200);
  });

  it("does not treat an explicit no-integrated-graphics label as graphics support", () => {
    const part = parseDanawaProductPage("cpu", {
      name: "Intel Core KF",
      url: "https://prod.danawa.com/info/?pcode=27010&cate=112747",
      sourceProductCode: "27010"
    }, `<title>Intel Core KF : 다나와 가격비교</title><meta name="description" content="인텔(소켓1700) / 8코어 / 내장그래픽:미탑재 / TDP: 125W" />`, "112747");

    expect(part.specs.integratedGraphics).toBe(false);
  });

  it("converts terabytes to gigabytes for storage comparisons", () => {
    const item = {
      name: "Seagate BarraCuda 8TB",
      url: "https://prod.danawa.com/info/?pcode=5764992&cate=112763",
      sourceProductCode: "5764992"
    };
    const html = `
      <title>Seagate BarraCuda 8TB : 다나와 가격비교</title>
      <meta name="description" content="HDD (8TB) / 3.5인치 / SATA3" />
    `;
    const part = parseDanawaProductPage("hdd", item, html, "112763");
    expect(part.specs.capacityGb).toBe(8000);
    expect(part.specs.formFactor).toBe("3.5인치");
    expect(part.specs.interface).toBe("SATA");
  });

  it("prefers the product capacity over a smaller internal DRAM capacity", () => {
    const part = parseDanawaProductPage("ssd", {
      name: "Samsung 990 PRO 2TB",
      url: "https://prod.danawa.com/info/?pcode=5764993&cate=112760",
      sourceProductCode: "5764993"
    }, `<title>Samsung 990 PRO 2TB : 다나와 가격비교</title><meta name="description" content="M.2 2280 / NVMe / DRAM 탑재 DDR4 2GB / 순차읽기: 7,450MB/s / 순차쓰기: 6,900MB/s / 2TB" />`, "112760");

    expect(part.specs.capacityGb).toBe(2000);
  });

  it("does not treat gigabit link speed as storage capacity", () => {
    const part = parseDanawaProductPage("ssd", {
      name: "M.2 SATA SSD",
      url: "https://prod.danawa.com/info/?pcode=27012&cate=112760",
      sourceProductCode: "27012"
    }, `<title>M.2 SATA SSD : 다나와 가격비교</title><meta name="description" content="M.2 (2280) / SATA3 (6Gb/s) / 순차읽기: 530MB/s / 순차쓰기: 400MB/s" />`, "112760");

    expect(part.specs.interface).toBe("SATA");
    expect(part.specs.formFactor).toBe("M.2 2280");
    expect(part.specs.capacityGb).toBeUndefined();
    expect(part.missingFields).toContain("capacityGb");
  });

  it("preserves the exact M.2 form factor dimension", () => {
    const part = parseDanawaProductPage("ssd", {
      name: "M.2 SATA 2242 SSD",
      url: "https://prod.danawa.com/info/?pcode=27013&cate=112760",
      sourceProductCode: "27013"
    }, `<title>M.2 SATA 2242 SSD : 다나와 가격비교</title><meta name="description" content="M.2 (2242) / SATA3 (6Gb/s) / 256GB" />`, "112760");

    expect(part.specs.formFactor).toBe("M.2 2242");
  });

  it("collects all M.2 dimensions from a multi-fit product description", () => {
    expect(parseM2FormFactors("M.2 SSD 쿨러 / M.2 호환규격: M.2 22110 , M.2 2280 , M.2 2260 , M.2 2242"))
      .toEqual(["M.2 22110", "M.2 2280", "M.2 2260", "M.2 2242"]);
  });

  it("does not classify storage adapters as internal SSDs", () => {
    const part = parseDanawaProductPage("ssd", {
      name: "USB 3.0 to SATA 컨버터 4TB 지원",
      url: "https://prod.danawa.com/info/?pcode=5764994&cate=112760",
      sourceProductCode: "5764994"
    }, `<title>USB 3.0 to SATA 컨버터 4TB 지원 : 다나와 가격비교</title><meta name="description" content="USB 3.0 to SATA / 2.5인치 / 4TB 지원" />`, "112760");

    expect(part.specs.capacityGb).toBe(4000);
    expect(part.dataQuality).toBe("incomplete");
    expect(part.missingFields).toContain("internal storage device");
  });

  it("reads the lowest price from a product detail meta description", () => {
    const item = {
      name: "DEEPCOOL AG620 G2",
      url: "https://prod.danawa.com/info/?pcode=105679832&cate=11347549",
      sourceProductCode: "105679832"
    };
    const html = `
      <title>DEEPCOOL AG620 G2 : 다나와 가격비교</title>
      <meta property="og:description" content="최저가 38,450원, 현금최저가: 36,400원" />
      <meta name="description" content="CPU 쿨러 / 공랭 / TDP: 270W / AMD 소켓: AM5 / 인텔 소켓: LGA1700 / 높이: 159mm" />
    `;
    const part = parseDanawaProductPage("cooler", item, html, "11347549");
    expect(part.priceWon).toBe(38450);
  });

  it("normalizes numeric Intel socket labels to the canonical LGA form", () => {
    const item = {
      name: "인텔 CPU",
      url: "https://prod.danawa.com/info/?pcode=27001&cate=112747",
      sourceProductCode: "27001"
    };
    const html = `
      <title>인텔 CPU : 다나와 가격비교</title>
      <meta name="description" content="인텔 소켓: 1851 / TDP: 125W / DDR5" />
    `;
    const part = parseDanawaProductPage("cpu", item, html, "112747");
    expect(part.specs.socket).toBe("LGA1851");
  });

  it("reads alternate CPU labels used by newer Danawa products", () => {
    const item = {
      name: "인텔 코어 울트라7",
      url: "https://prod.danawa.com/info/?pcode=27002&cate=112747",
      sourceProductCode: "27002"
    };
    const html = `
      <title>인텔 코어 울트라7 : 다나와 가격비교</title>
      <meta name="description" content="인텔(LGA4710-2) / P8+E16코어 / 24스레드 / 최대 클럭: 5.5GHz / 메모리 규격: DDR5 / PBP-MTP: 125-250W / 인텔 그래픽스(Xe LPG) / 쿨러: 인텔 기본쿨러 포함 / 시네벤치R23(싱글): 2320 / 시네벤치R23(멀티): 41558" />
    `;
    const part = parseDanawaProductPage("cpu", item, html, "112747");
    expect(part.specs.socket).toBe("LGA4710-2");
    expect(part.specs.cores).toBe(24);
    expect(part.specs.threads).toBe(24);
    expect(part.specs.boostClockGhz).toBe(5.5);
    expect(part.specs.cinebenchR23Single).toBe(2320);
    expect(part.specs.cinebenchR23Multi).toBe(41558);
    expect(part.specs.tdpW).toBe(125);
    expect(part.specs.integratedGraphics).toBe(true);
    expect(part.specs.coolerIncluded).toBe(true);
  });

  it("sums compound motherboard M.2 slot labels and reads memory slot counts", () => {
    const item = {
      name: "ASUS ROG 보드",
      url: "https://prod.danawa.com/info/?pcode=27003&cate=112751",
      sourceProductCode: "27003"
    };
    const html = `
      <title>ASUS ROG 보드 : 다나와 가격비교</title>
      <meta name="description" content="AMD(소켓AM5) / DDR5 / [메모리] 8200MHz (PC5-65600) / 4개 / 메모리 용량: 최대 256GB / [확장슬롯] PCIe버전: PCIe5.0 / PCIex16: 1개 / PCIex4: 1개 / [저장장치] M.2: 4+2개 / M.2 연결: PCIe4.0, NVMe / SATA3: 4개" />
    `;
    const part = parseDanawaProductPage("motherboard", item, html, "112751");
    expect(part.specs.memorySlots).toBe(4);
    expect(part.specs.m2Slots).toBe(6);
    expect(part.specs.m2Interfaces).toEqual(["NVMe"]);
    expect(part.specs.pcieX16Slots).toBe(1);
    expect(part.specs.pcieX8Slots).toBe(0);
    expect(part.specs.memoryFormFactor).toBeUndefined();
    expect(part.missingFields).toEqual([]);
  });

  it("normalizes desktop and laptop memory slot form factors", () => {
    const desktop = parseDanawaProductPage("motherboard", {
      name: "데스크톱 DIMM 보드",
      url: "https://prod.danawa.com/info/?pcode=27014&cate=112751",
      sourceProductCode: "27014"
    }, `<title>데스크톱 DIMM 보드 : 다나와 가격비교</title><meta name="description" content="AMD(소켓AM5) / DDR5 / DIMM / 6400MHz / 2개 / 메모리 용량: 최대 128GB / M.2: 1개 / SATA3: 4개" />`, "112751");
    const laptop = parseDanawaProductPage("motherboard", {
      name: "노트북 SO-DIMM 보드",
      url: "https://prod.danawa.com/info/?pcode=27015&cate=112751",
      sourceProductCode: "27015"
    }, `<title>노트북 SO-DIMM 보드 : 다나와 가격비교</title><meta name="description" content="인텔(소켓1700) / DDR4 노트북용 / 3200MHz / 2개 / 메모리 용량: 최대 64GB / M.2: 1개 / SATA3: 2개" />`, "112751");

    expect(desktop.specs.memoryFormFactor).toBe("DIMM");
    expect(laptop.specs.memoryFormFactor).toBe("SO-DIMM");
  });

  it("normalizes motherboard fan and RGB header counts and case fan counts", () => {
    const motherboard = parseDanawaProductPage("motherboard", {
      name: "팬 헤더 보드",
      url: "https://prod.danawa.com/info/?pcode=27010&cate=112751",
      sourceProductCode: "27010"
    }, `<title>팬 헤더 보드 : 다나와 가격비교</title><meta name="description" content="AMD(소켓AM5) / DDR5 / [메모리] 6400MHz / 4개 / 메모리 용량: 최대 256GB / 저장장치 M.2: 2개 / SATA3: 4개 / [내부I/O] RGB 12V 4핀 헤더 , ARGB 5V 3핀 헤더 , CPU추가팬(OPT) 헤더 / 시스템팬 4핀: 4개" />`, "112751");
    const computerCase = parseDanawaProductPage("case", {
      name: "세븐팬 케이스",
      url: "https://prod.danawa.com/info/?pcode=27011&cate=112775",
      sourceProductCode: "27011"
    }, `<title>세븐팬 케이스 : 다나와 가격비교</title><meta name="description" content="ATX 케이스 / 지원보드규격: ATX, M-ATX / VGA 길이: 400mm / CPU쿨러 높이: 170mm / 3.5인치 베이: 2개 / 쿨링팬: 총7개 / LED팬: 7개 / LED 색상: ARGB / RGB 컨트롤 / LED팬 1개당 소비전류: 0.4A / RGB 장치 소비전력: 2.5W/개" />`, "112775");

    expect(motherboard.specs.fanPortCount).toBe(5);
    expect(motherboard.specs.rgbPortCount).toBe(2);
    expect(motherboard.specs.rgb5vPortCount).toBe(1);
    expect(motherboard.specs.rgb12vPortCount).toBe(1);
    expect(computerCase.specs.fanCount).toBe(7);
    expect(computerCase.specs.rgbDeviceCount).toBe(7);
    expect(computerCase.specs.rgbDeviceVoltage).toBe("5V");
    expect(computerCase.specs.rgbDeviceCurrentA).toBe(0.4);
    expect(computerCase.specs.rgbDevicePowerW).toBe(2.5);
    expect(computerCase.specs.rgbControllerIncluded).toBe(true);
    expect(computerCase.specs.motherboardFormFactors).toEqual(expect.arrayContaining(["ATX", "mATX"]));
  });

  it("recognizes DDR2 laptop memory and 2.5형 storage products", () => {
    const memory = parseDanawaProductPage("memory", {
      name: "노트북 DDR2-800 1GB",
      url: "https://prod.danawa.com/info/?pcode=27004&cate=112752",
      sourceProductCode: "27004"
    }, `<title>노트북 DDR2-800 1GB : 다나와 가격비교</title><meta name="description" content="노트북용 / DDR2 / 800MHz (PC2-6400) / 1GB" />`, "112752");
    const ssd = parseDanawaProductPage("ssd", {
      name: "SATA SSD 500GB",
      url: "https://prod.danawa.com/info/?pcode=27005&cate=112760",
      sourceProductCode: "27005"
    }, `<title>SATA SSD 500GB : 다나와 가격비교</title><meta name="description" content="6.4cm(2.5형) / SATA3 (6Gb/s) / TLC / 500GB" />`, "112760");
    expect(memory.specs.memoryType).toBe("DDR2");
    expect(memory.specs.speedMhz).toBe(800);
    expect(memory.specs.formFactor).toBe("SO-DIMM");
    expect(ssd.specs.formFactor).toBe("2.5인치");
  });

  it("normalizes EXPO and XMP memory profile labels for RAM and motherboards", () => {
    const memory = parseDanawaProductPage("memory", {
      name: "DDR5 EXPO 메모리",
      url: "https://prod.danawa.com/info/?pcode=27011&cate=112752",
      sourceProductCode: "27011"
    }, `<title>DDR5 EXPO 메모리 (32GB(16Gx2)) : 다나와 가격비교</title><meta name="description" content="데스크탑용 / DDR5 / 6000MHz / 램타이밍: CL30-36-36-76 / 1.35V / 램개수: 2개 / XMP3.0 / EXPO / 32GB" />`, "112752");
    const motherboard = parseDanawaProductPage("motherboard", {
      name: "AM5 메인보드",
      url: "https://prod.danawa.com/info/?pcode=27012&cate=112751",
      sourceProductCode: "27012"
    }, `<title>AM5 메인보드 : 다나와 가격비교</title><meta name="description" content="AMD(소켓AM5) / DDR5 / 메모리 용량: 최대 128GB / 4개 / EXPO / XMP3.0 / M.2: 2개 / SATA3: 4개" />`, "112751");

    expect(memory.specs.memoryProfiles).toEqual(["EXPO", "XMP"]);
    expect(memory.specs.memoryModuleCountPerKit).toBe(2);
    expect(memory.specs.memoryTiming).toBe("CL30-36-36-76");
    expect(memory.specs.memoryCasLatency).toBe(30);
    expect(memory.specs.memoryEffectiveLatencyNs).toBe(10);
    expect(memory.specs.memoryRcdLatency).toBe(36);
    expect(memory.specs.memoryTrpLatency).toBe(36);
    expect(memory.specs.memoryTrasLatency).toBe(76);
    expect(memory.specs.memoryVoltageV).toBe(1.35);
    expect(motherboard.specs.memoryProfiles).toEqual(["EXPO", "XMP"]);
  });

  it("extracts GPU memory and storage throughput for similarity ranking", () => {
    const gpu = parseDanawaProductPage("gpu", {
      name: "GeForce RTX 5080 16GB",
      url: "https://prod.danawa.com/info/?pcode=27007&cate=112753",
      sourceProductCode: "27007"
    }, `<title>GeForce RTX 5080 16GB : 다나와 가격비교</title><meta name="description" content="RTX 5080 / PCIe5.0x16(at x8) / GDDR6X / VRAM: 16GB / 부스트클럭: 2600MHz / 스트림 프로세서: 10752 / VRAM 대역폭: 960 GB/s / 3DMark Time Spy: 12,345점 / 3DMark Port Royal: 9,876점 / 소비전력: 360W / 가로(길이): 360mm" />`, "112753");
    const ssd = parseDanawaProductPage("ssd", {
      name: "NVMe SSD 1TB",
      url: "https://prod.danawa.com/info/?pcode=27008&cate=112760",
      sourceProductCode: "27008"
    }, `<title>NVMe SSD 1TB : 다나와 가격비교</title><meta name="description" content="M.2 2280 / PCIe4.0x4 / NVMe / TLC / 컨트롤러: Phison E18 / 순차읽기: 7,000MB/s / 순차쓰기: 6,000MB/s / 읽기IOPS: 1,000K / 쓰기IOPS: 900K / TBW: 700TB / 1TB" />`, "112760");
    const ssdWithoutNandLabel = parseDanawaProductPage("ssd", {
      name: "NVMe SSD SLC 캐싱 모델",
      url: "https://prod.danawa.com/info/?pcode=270081&cate=112760",
      sourceProductCode: "270081"
    }, `<title>NVMe SSD SLC 캐싱 모델 : 다나와 가격비교</title><meta name="description" content="M.2 2280 / NVMe / 컨트롤러: 기타 / SLC캐싱 / 순차읽기: 3,500MB/s / 순차쓰기: 3,000MB/s / 1TB" />`, "112760");
    const motherboard = parseDanawaProductPage("motherboard", {
      name: "PCIe 세대 지원 메인보드",
      url: "https://prod.danawa.com/info/?pcode=270082&cate=112751",
      sourceProductCode: "270082"
    }, `<title>PCIe 세대 지원 메인보드 : 다나와 가격비교</title><meta name="description" content="AMD(소켓AM5) / DDR5 / 메모리 용량: 최대 128GB / 4개 / M.2: 2개 / SATA3: 4개 / M.2 연결: PCIe4.0, PCIe5.0, NVMe" />`, "112751");
    expect(gpu.specs.vramGb).toBe(16);
    expect(gpu.specs.gpuMemoryType).toBe("GDDR6X");
    expect(gpu.specs.gpuVendor).toBe("nvidia");
    expect(gpu.specs.gpuArchitectureFamily).toBe("RTX 50");
    expect(gpu.specs.pcieSlotWidth).toBe(16);
    expect(gpu.specs.gpuBoostClockMhz).toBe(2600);
    expect(gpu.specs.gpuStreamProcessors).toBe(10752);
    expect(gpu.specs.gpuMemoryBandwidthGbps).toBe(960);
    expect(gpu.specs.gpu3dmarkTimeSpyScore).toBe(12345);
    expect(gpu.specs.gpu3dmarkPortRoyalScore).toBe(9876);
    expect(ssd.specs.m2PcieGeneration).toBe(4);
    expect(motherboard.specs.m2PcieGenerations).toEqual([4, 5]);
    expect(ssd.specs.sequentialReadMbps).toBe(7000);
    expect(ssd.specs.sequentialWriteMbps).toBe(6000);
    expect(ssd.specs.ssdNandType).toBe("TLC");
    expect(ssd.specs.ssdController).toBe("Phison E18");
    expect(ssd.specs.ssdTbwTb).toBe(700);
    expect(ssd.specs.ssdReadIops).toBe(1_000_000);
    expect(ssd.specs.ssdWriteIops).toBe(900_000);
    expect(ssdWithoutNandLabel.specs.ssdNandType).toBeUndefined();
  });

  it("parses GPU auxiliary power options and does not confuse VRAM bandwidth with VRAM capacity", () => {
    const gpu = parseDanawaProductPage("gpu", {
      name: "GeForce RTX 5070 12GB",
      url: "https://prod.danawa.com/info/?pcode=27016&cate=112753",
      sourceProductCode: "27016"
    }, `<title>GeForce RTX 5070 12GB : 다나와 가격비교</title><meta name="description" content="RTX 5070 / PCIe5.0x16 / 전원 포트: 16핀(12V2x6) x1 / VRAM 대역폭: 672 GB/s / 사용전력: 250W / 두께: 50mm / 구성품: 2x8핀 to 16핀 커넥터" />`, "112753");

    expect(gpu.specs.vramGb).toBe(12);
    expect(gpu.specs.pciePowerOptions).toEqual([
      [{ kind: "12v2x6", count: 1 }],
      [{ kind: "pcie_8pin_6plus2", count: 2 }]
    ]);
    expect(gpu.specs.pciePowerAdapterOptions).toEqual([[{ kind: "pcie_8pin_6plus2", count: 2 }]]);
    expect(gpu.specs.thicknessMm).toBe(50);
  });

  it("keeps GPU adapter evidence and case radiator evidence limited to stable source text", () => {
    expect(parsePciePowerAdapterOptions("GPU 구성품: 2x8핀 to 16핀 커넥터 / [변경사항] 구성품: 3x8핀 to 16핀으로 변경")).toEqual([[{ kind: "pcie_8pin_6plus2", count: 2 }]]);
    expect(parsePciePowerAdapterOptions("GPU 구성품: 4x8핀 to 16핀 커넥터")).toEqual([[{ kind: "pcie_8pin_6plus2", count: 4 }]]);
    expect(parsePciePowerAdapterOptions("GPU / [변경사항] 구성품: 2x8핀 to 16핀으로 변경")).toBeUndefined();
    expect(parsePciePowerOptions("전원 포트: 16핀(12V2x6) x1 / [변경사항] 구성품: 2x8핀 to 16핀으로 변경")).toEqual([[{ kind: "12v2x6", count: 1 }]]);

    const casePart = parseDanawaProductPage("case", {
      name: "수랭 지원 케이스",
      url: "https://prod.danawa.com/info/?pcode=27018&cate=112775",
      sourceProductCode: "27018"
    }, `<title>수랭 지원 케이스 : 다나와 가격비교</title><meta name="description" content="ATX 케이스 / VGA 길이: 400mm / CPU쿨러 높이: 170mm / 120mm 1열 수랭쿨러 제공 / [변경사항] 상단 라디에이터 120, 140, 240, 280, 360 →120, 240, 360으로 변경" />`, "112775");
    expect(casePart.specs.radiatorSizesMm).toEqual([120]);
  });

  it("parses PSU cable and rail topology as descriptive evidence without using change notes", () => {
    const psu = parseDanawaProductPage("psu", {
      name: "ATX 850W 풀모듈러 파워",
      url: "https://prod.danawa.com/info/?pcode=27019&cate=112777",
      sourceProductCode: "27019"
    }, `<title>ATX 850W 풀모듈러 파워 : 다나와 가격비교</title><meta name="description" content="ATX 파워/850W/케이블연결: 풀모듈러/+12V 싱글레일/[커넥터] PCIe 8핀(6+2): 3개 / [변경사항] 케이블연결: 세미모듈러로 변경 / +12V 다중레일로 변경" />`, "112777");

    expect(psu.specs.psuCableType).toBe("fully_modular");
    expect(psu.specs.psuRailType).toBe("single");
  });

  it("parses radiator positions separately from the case-wide size list", () => {
    const casePart = parseDanawaProductPage("case", {
      name: "위치별 수랭 케이스",
      url: "https://prod.danawa.com/info/?pcode=27020&cate=112775",
      sourceProductCode: "27020"
    }, `<title>위치별 수랭 케이스 : 다나와 가격비교</title><meta name="description" content="ATX 케이스 / VGA 길이: 400mm / 전면 라디에이터: 240mm, 360mm / 상단 라디에이터: 240mm / [변경사항] 전면 라디에이터 360mm → 420mm" />`, "112775");
    const cooler = parseDanawaProductPage("cooler", {
      name: "상단 장착 수랭 쿨러",
      url: "https://prod.danawa.com/info/?pcode=27021&cate=11347549",
      sourceProductCode: "27021"
    }, `<title>상단 장착 수랭 쿨러 : 다나와 가격비교</title><meta name="description" content="CPU 쿨러 / 수랭 / 라디에이터: 240mm / 라디에이터 위치: 상단 / AMD 소켓: AM5" />`, "11347549");

    expect(casePart.specs.radiatorSizesMm).toEqual([240, 360]);
    expect(casePart.specs.radiatorSupports).toEqual([
      { position: "front", sizesMm: [240, 360] },
      { position: "top", sizesMm: [240] }
    ]);
    expect(cooler.specs.radiatorPosition).toBe("top");
  });

  it("accepts only current PSU PCIe connector evidence and ignores change-history text", () => {
    const raw = "ATX 파워/850W/[변경사항] PCIe 8핀(6+2) 2개→3개로 변경";
    expect(parsePciePowerConnectors(raw)).toBeUndefined();

    expect(parsePciePowerConnectors("ATX 파워/[커넥터] PCIe 8핀(6+2): 3개 / PCIe 6핀: 1개")).toEqual({
      pcie_8pin_6plus2: 3,
      pcie_6pin: 1
    });
    expect(parsePciePowerConnectors("ATX 파워/[커넥터] PCIe 16핀(12+4) 12VHPWR: 1개 / 12V2x6: 2개")).toEqual({
      "12vhpwr": 1,
      "12v2x6": 2
    });
    expect(parsePciePowerConnectors("ATX 파워/[변경사항] PCIe 8핀(6+2) 2개→3개로 변경")).toBeUndefined();
    expect(parsePciePowerConnectors("ATX 파워/[커넥터] 보조전원: 8핀(4+4) 2개")).toBeUndefined();
    expect(parsePciePowerConnectors("ATX 파워/12VHPWR 최대 600W 지원")).toBeUndefined();

    const psu = parseDanawaProductPage("psu", {
      name: "ATX 850W 파워",
      url: "https://prod.danawa.com/info/?pcode=27017&cate=112777",
      sourceProductCode: "27017"
    }, `<title>ATX 850W 파워 : 다나와 가격비교</title><meta name="description" content="ATX 파워/850W/PCIe 8핀(6+2) 2개→3개로 변경" />`, "112777");
    expect(psu.specs.pciePowerConnectors).toBeUndefined();
    expect(parsePciePowerOptions("GPU / 전원 포트: 없음")).toEqual([]);
    const capabilityOnly = parseDanawaProductPage("psu", {
      name: "ATX 파워",
      url: "https://prod.danawa.com/info/?pcode=27023&cate=112777",
      sourceProductCode: "27023"
    }, `<title>ATX 파워 : 다나와 가격비교</title><meta name="description" content="ATX 파워/12VHPWR 최대 600W 지원" />`, "112777");
    expect(capabilityOnly.specs.wattageW).toBeUndefined();
    expect(capabilityOnly.specs.pciePowerConnectors).toBeUndefined();
    expect(capabilityOnly.dataQuality).toBe("incomplete");
    expect(capabilityOnly.missingFields).toContain("wattageW");
    expect(parsePciePowerOptions("GPU / 전원 포트: 12VHPWR 최대 600W 지원")).toBeUndefined();
  });

  it("normalizes PSU depth and case power-bay limits", () => {
    const computerCase = parseDanawaProductPage("case", {
      name: "ATX 파워 수용 케이스",
      url: "https://prod.danawa.com/info/?pcode=27020&cate=112775",
      sourceProductCode: "27020"
    }, `<title>ATX 파워 수용 케이스 : 다나와 가격비교</title><meta name="description" content="ATX 케이스 / 지원보드규격: ATX, M-ATX / VGA 길이: 400mm / CPU쿨러 높이: 170mm / 지원파워규격: 표준-ATX / 파워 장착 길이: 200mm" />`, "112775");
    const psu = parseDanawaProductPage("psu", {
      name: "ATX 850W 파워",
      url: "https://prod.danawa.com/info/?pcode=27021&cate=112777",
      sourceProductCode: "27021"
    }, `<title>ATX 850W 파워 : 다나와 가격비교</title><meta name="description" content="ATX 파워/850W/깊이: 140mm" />`, "112777");

    expect(computerCase.specs.maxPsuLengthMm).toBe(200);
    expect(computerCase.specs.supportedPsuFormFactors).toEqual(["ATX"]);
    const rangedCase = parseDanawaProductPage("case", {
      name: "범위형 파워 수용 케이스",
      url: "https://prod.danawa.com/info/?pcode=27022&cate=112775",
      sourceProductCode: "27022"
    }, `<title>범위형 파워 수용 케이스 : 다나와 가격비교</title><meta name="description" content="ATX 케이스 / 지원파워규격: 표준-ATX / VGA 길이: 285~435mm / 파워 장착 길이: 180~220mm" />`, "112775");
    expect(rangedCase.specs.maxGpuLengthMm).toBe(435);
    expect(rangedCase.specs.maxPsuLengthMm).toBe(220);
    expect(psu.specs.psuDepthMm).toBe(140);
    expect(psu.specs.psuFormFactor).toBe("ATX");
  });

  it("marks motherboard lane-sharing text without inventing a disabled slot", () => {
    const text = "M.2 연결: PCIe5.0, NVMe, PCIe 레인공유 / USB4 레인공유";
    expect(parseM2LaneSharing(text)).toEqual({
      scopes: ["pcie", "usb4"],
      notes: ["PCIe 레인공유", "USB4 레인공유"]
    });
    const motherboard = parseDanawaProductPage("motherboard", {
      name: "레인 공유 보드",
      url: "https://prod.danawa.com/info/?pcode=27018&cate=112751",
      sourceProductCode: "27018"
    }, `<title>레인 공유 보드 : 다나와 가격비교</title><meta name="description" content="AMD(소켓AM5) / DDR5 / 4개 / 메모리 용량: 최대 256GB / M.2: 2개 / SATA3: 4개 / ${text}" />`, "112751");
    expect(motherboard.specs.m2LaneSharing).toBe(true);
    expect(motherboard.specs.m2LaneSharingScopes).toEqual(["pcie"]);
    expect(motherboard.specs.m2LaneSharingNote).toContain("레인공유");
  });

  it("keeps SATA and USB4 sharing separate from PCIe sharing", () => {
    expect(parseM2LaneSharing("PCIe5.0, NVMe, SATA 레인공유")).toEqual({ scopes: ["sata"], notes: ["SATA 레인공유"] });
    expect(parseM2LaneSharing("PCIe5.0, NVMe, USB4 레인공유")).toEqual({ scopes: ["usb4"], notes: ["USB4 레인공유"] });
    expect(parseM2LaneSharing("PCIex16: 1개(동시사용시 x8)")).toEqual({ scopes: [], notes: [] });
  });

  it("reparses stored Danawa records without touching seed records", () => {
    const stored = {
      id: "danawa-cpu-27006",
      category: "cpu" as const,
      name: "인텔 CPU",
      source: "danawa" as const,
      sourceProductCode: "27006",
      rawSpecText: "인텔(LGA1851) / DDR5 / PBP-MTP: 65-125W",
      specs: {},
      dataQuality: "incomplete" as const,
      missingFields: ["tdpW"],
      updatedAt: "2026-08-27T00:00:00.000Z"
    };
    const reparsed = reparseDanawaPart(stored);
    expect(reparsed.specs.socket).toBe("LGA1851");
    expect(reparsed.specs.tdpW).toBe(65);
    expect(reparsed.missingFields).toEqual([]);
  });

  it("reparses Cinebench R23 scores and removes stale benchmark values", () => {
    const stored = {
      id: "danawa-cpu-27010",
      category: "cpu" as const,
      name: "AMD CPU",
      source: "danawa" as const,
      sourceProductCode: "27010",
      rawSpecText: "AMD(소켓AM5) / 8코어 / DDR5 / 시네벤치R23(멀티): 18,208",
      specs: { cinebenchR23Single: 9999, cinebenchR23Multi: 9999 },
      dataQuality: "live" as const,
      missingFields: [],
      updatedAt: "2026-08-27T00:00:00.000Z"
    };

    const reparsed = reparseDanawaPart(stored);

    expect(reparsed.specs.cinebenchR23Single).toBeUndefined();
    expect(reparsed.specs.cinebenchR23Multi).toBe(18208);
  });

  it("removes stale GPU benchmark values when refreshed raw text has none", () => {
    const stored = {
      id: "danawa-gpu-27024",
      category: "gpu" as const,
      name: "GeForce GPU",
      source: "danawa" as const,
      sourceProductCode: "27024",
      rawSpecText: "RTX 5070 / VRAM: 12GB / 소비전력: 250W",
      specs: { gpu3dmarkTimeSpyScore: 15000, gpu3dmarkPortRoyalScore: 11000, benchmarkProvenance: { sourceKind: "official" as const, sourceNote: "오래된 override", updatedAt: "2026-08-27T00:00:00.000Z" } },
      dataQuality: "live" as const,
      missingFields: [],
      updatedAt: "2026-08-27T00:00:00.000Z"
    };

    const reparsed = reparseDanawaPart(stored);

    expect(reparsed.specs.gpu3dmarkTimeSpyScore).toBeUndefined();
    expect(reparsed.specs.gpu3dmarkPortRoyalScore).toBeUndefined();
    expect(reparsed.specs.benchmarkProvenance).toBeUndefined();
  });

  it("removes stale GPU adapter and PSU topology evidence when refreshed raw text no longer confirms it", () => {
    const gpu = {
      id: "danawa-gpu-27025",
      category: "gpu" as const,
      name: "GeForce GPU",
      source: "danawa" as const,
      sourceProductCode: "27025",
      rawSpecText: "RTX 5070 / 전원 포트: 16핀(12V2x6) x1",
      specs: { pciePowerOptions: [[{ kind: "12v2x6" as const, count: 1 }]], pciePowerAdapterOptions: [[{ kind: "pcie_8pin_6plus2" as const, count: 2 }]] },
      dataQuality: "live" as const,
      missingFields: [],
      updatedAt: "2026-08-27T00:00:00.000Z"
    };
    const psu = {
      id: "danawa-psu-27026",
      category: "psu" as const,
      name: "ATX 850W 파워",
      source: "danawa" as const,
      sourceProductCode: "27026",
      rawSpecText: "ATX 파워/850W",
      specs: { psuCableType: "fully_modular" as const, psuRailType: "single" as const },
      dataQuality: "live" as const,
      missingFields: [],
      updatedAt: "2026-08-27T00:00:00.000Z"
    };

    expect(reparseDanawaPart(gpu).specs.pciePowerAdapterOptions).toBeUndefined();
    expect(reparseDanawaPart(psu).specs.psuCableType).toBeUndefined();
    expect(reparseDanawaPart(psu).specs.psuRailType).toBeUndefined();
  });

  it("does not keep stale lane-sharing evidence when the refreshed raw text has none", () => {
    const stored = {
      id: "danawa-motherboard-27019",
      category: "motherboard" as const,
      name: "레인 공유 보드",
      source: "danawa" as const,
      sourceProductCode: "27019",
      rawSpecText: "AMD(소켓AM5) / DDR5 / SATA3: 4개",
      specs: { m2Slots: 2, m2Interfaces: ["SATA" as const], m2PcieGenerations: [5], m2LaneSharing: true as const, m2LaneSharingScopes: ["pcie" as const], m2LaneSharingNote: "오래된 원문" },
      dataQuality: "live" as const,
      missingFields: [],
      updatedAt: "2026-08-27T00:00:00.000Z"
    };
    const reparsed = reparseDanawaPart(stored);
    expect(reparsed.specs.m2Slots).toBeUndefined();
    expect(reparsed.specs.m2Interfaces).toBeUndefined();
    expect(reparsed.specs.m2PcieGenerations).toBeUndefined();
    expect(reparsed.specs.m2LaneSharing).toBeUndefined();
    expect(reparsed.specs.m2LaneSharingScopes).toBeUndefined();
    expect(reparsed.specs.m2LaneSharingNote).toBeUndefined();
  });

  it("marks storage capacity as unknown when raw text only contains DRAM and SLC cache sizes", () => {
    const stored = {
      id: "danawa-ssd-27009",
      category: "ssd" as const,
      name: "Samsung 990 PRO M.2 NVMe",
      source: "danawa" as const,
      sourceProductCode: "27009",
      rawSpecText: "M.2 2280 / NVMe / DRAM 탑재 DDR4 2GB / SLC: 226GB / 순차읽기: 7,450MB/s",
      specs: { capacityGb: 2, interface: "NVMe", formFactor: "M.2 2280", m2PcieGeneration: 5 },
      dataQuality: "live" as const,
      missingFields: [],
      updatedAt: "2026-08-26T00:00:00.000Z"
    };

    const reparsed = reparseDanawaPart(stored);

    expect(reparsed.specs.capacityGb).toBeUndefined();
    expect(reparsed.specs.m2PcieGeneration).toBeUndefined();
    expect(reparsed.dataQuality).toBe("incomplete");
    expect(reparsed.missingFields).toContain("capacityGb");
  });

  it("treats liquid coolers as radiator-sized hardware instead of tower height", () => {
    const item = {
      name: "ARCTIC Liquid Freezer III PRO 360",
      url: "https://prod.danawa.com/info/?pcode=36001&cate=11347549",
      sourceProductCode: "36001"
    };
    const html = `
      <title>ARCTIC Liquid Freezer III PRO 360 : 다나와 가격비교</title>
      <meta name="description" content="CPU 쿨러 / 수랭 / 라디에이터: 360mm / TDP: 350W / 인텔 소켓: LGA1700 / AMD 소켓: AM5 / 높이: 52mm" />
    `;
    const part = parseDanawaProductPage("cooler", item, html, "11347549");
    expect(part.specs.coolerType).toBe("liquid");
    expect(part.specs.radiatorSizeMm).toBe(360);
    expect(part.specs.maxCoolerHeightMm).toBeUndefined();
    expect(part.missingFields).toEqual([]);
  });
});
