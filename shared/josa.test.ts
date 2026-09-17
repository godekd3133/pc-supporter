import { describe, expect, it } from "vitest";
import { eul, eun, euro, gwa, hasBatchim, iGa } from "./josa";

describe("josa", () => {
  it("handles hangul batchim", () => {
    expect(eul("메인보드")).toBe("메인보드를");
    expect(eul("케이스")).toBe("케이스를");
    expect(eun("그래픽카드")).toBe("그래픽카드는");
    expect(eun("파워")).toBe("파워는");
    expect(iGa("메인보드")).toBe("메인보드가");
    expect(iGa("라이젠")).toBe("라이젠이");
    expect(gwa("메인보드")).toBe("메인보드와");
    expect(gwa("파워")).toBe("파워와");
  });

  it("handles english letters by korean pronunciation", () => {
    expect(eul("GIGABYTE B650M K")).toBe("GIGABYTE B650M K를");
    expect(eul("DDR5-7200 32GB")).toBe("DDR5-7200 32GB를");
    expect(eul("RTX 5090")).toBe("RTX 5090을");
    expect(eul("SK하이닉스 Platinum P41")).toBe("SK하이닉스 Platinum P41을");
    expect(iGa("RTX 5090")).toBe("RTX 5090이");
  });

  it("handles digits by korean pronunciation", () => {
    expect(eul("DDR4")).toBe("DDR4를");
    expect(eul("RAM 8GB")).toBe("RAM 8GB를");
    expect(eul("SSD 1TB")).toBe("SSD 1TB를");
    expect(eun("850W")).toBe("850W는");
  });

  it("handles euro with rieul exception", () => {
    expect(euro("8GB")).toBe("8GB로");
    expect(euro("메인보드")).toBe("메인보드로");
    expect(euro("케이스")).toBe("케이스로");
    expect(euro("게이밍")).toBe("게이밍으로");
  });

  it("ignores trailing punctuation and parentheses", () => {
    expect(hasBatchim("라이젠5-7500F (정품)")).toBe(true);
    expect(eul("DDR5-7200 (32GBx4)")).toBe("DDR5-7200 (32GBx4)를");
  });
});
