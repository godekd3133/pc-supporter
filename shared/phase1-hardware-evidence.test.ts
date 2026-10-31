import { phase1IntelMotherboardSupportsCpu, phase1IntelStockCpuPowerFor } from "./phase1-hardware-evidence";
import { describe, expect, it } from "vitest";
import { phase1CoolerSupportsCpu, phase1MotherboardSupportsCpu } from "./phase1-hardware-evidence";
import { phase1VerifiedCatalog } from "../server/phase1-catalog";
import type { Part } from "./types";

const product = (code: string): Part => phase1VerifiedCatalog.find((part) => part.sourceProductCode === code)!;

describe("source-backed first-testbed CPU and motherboard policy", () => {
  it("allows 65W AM4 CPUs on the exact A520 board and prevents high-power AM4", () => {
    expect(phase1MotherboardSupportsCpu(product("54218171"), product("77706989"))).toBe(true);
    expect(phase1MotherboardSupportsCpu(product("16741211"), product("77706989"))).toBe(true);
    const highPower = { ...product("16741211"), name: "AMD Ryzen 9 5950X", model: "5950X", specs: { ...product("16741211").specs, tdpW: 105 } };
    expect(phase1MotherboardSupportsCpu(highPower, product("77706989"))).toBe(false);
    expect(phase1MotherboardSupportsCpu(highPower, product("11571368"))).toBe(true);
  });

  it("keeps mainstream AM5 on B850 and directs 170W Ryzen 9 to X870E", () => {
    expect(phase1MotherboardSupportsCpu(product("21694499"), product("122697197"))).toBe(true);
    expect(phase1MotherboardSupportsCpu(product("19627934"), product("122697197"))).toBe(true);
    expect(phase1MotherboardSupportsCpu(product("77790914"), product("122697197"))).toBe(false);
    expect(phase1MotherboardSupportsCpu(product("77790914"), product("75857021"))).toBe(true);
  });

  it("fails closed for unknown TDP, socket mismatches and other board distributors", () => {
    expect(phase1MotherboardSupportsCpu({ ...product("21694499"), specs: { socket: "AM5" } }, product("122697197"))).toBe(false);
    expect(phase1MotherboardSupportsCpu(product("21694499"), product("77706989"))).toBe(false);
    expect(phase1MotherboardSupportsCpu(product("21694499"), { ...product("122697197"), name: "GIGABYTE B850M GAMING X WIFI6E 피씨디렉트", model: "B850M GAMING X WIFI6E" })).toBe(false);
  });

  it("allows the exact 360mm cooler without inventing maxCoolingW", () => {
    const cooler = product("70003022");
    expect(cooler.specs.maxCoolingW).toBeUndefined();
    expect(phase1CoolerSupportsCpu(cooler, product("77790914"))).toBe(true);
    expect(phase1CoolerSupportsCpu(product("106047347"), product("77790914"))).toBe(false);
    expect(phase1CoolerSupportsCpu(product("16525058"), product("77790914"))).toBe(true);
    expect(phase1CoolerSupportsCpu({ ...cooler, name: "CORSAIR NAUTILUS 360 RS ARGB", model: "NAUTILUS 360 RS ARGB" }, product("77790914"))).toBe(false);
  });
});

describe("reviewed Intel board policy without synthetic watts", () => {
  it("rejects unreviewed identities, memory mismatches and overclocked power while accepting the reviewed stock pair", () => {
    const cpu: Part = {id:"intel144",category:"cpu",name:"인텔 14400F",source:"manual",dataQuality:"manual",missingFields:[],updatedAt:"2026-10-06",specs:{socket:"LGA1700",tdpW:65}};
    const board: Part = {...cpu,id:"danawa-motherboard-18651545",category:"motherboard",name:"GIGABYTE B760M AORUS ELITE D4 피씨디렉트",specs:{socket:"LGA1700",memoryType:"DDR4"}};
    expect(phase1IntelStockCpuPowerFor(cpu)?.turboW).toBe(148);
    expect(phase1IntelMotherboardSupportsCpu(cpu,board)).toBe(true);
    expect(phase1IntelMotherboardSupportsCpu(cpu,{...board,id:"other"})).toBe(false);
    expect(phase1IntelMotherboardSupportsCpu(cpu,{...board,specs:{...board.specs,memoryType:"DDR5"}})).toBe(false);
    expect(phase1IntelMotherboardSupportsCpu({...cpu,specs:{...cpu.specs,pptW:200}},board)).toBe(false);
    expect(board.specs.vrmCapacityW).toBeUndefined();
  });
});
