import { describe, expect, it } from "vitest";
import { assemblyVerificationCsvTemplateFor, parseAssemblyVerificationCsv } from "./assembly-verification-csv";

describe("assembly verification measurement CSV", () => {
  it("parses HWiNFO-style headers and aggregates peak telemetry", () => {
    const csv = [
      "Date/Time,CPU Package [°C],GPU Temperature [°C],Ambient Temperature [°C],CPU Fan [RPM],GPU Fan [RPM],CPU Total Usage [%],GPU Utilization [%],CPU Clock [MHz],GPU Core Clock [MHz],CPU Package Power [W],GPU Board Power [W]",
      "2026-09-01 20:00:00,70,60,24,1000,1100,95,99,4500,2500,120,300",
      "2026-09-01 20:01:00,80,72,26,1400,1500,98,100,4600,2600,140,320"
    ].join("\n");

    const parsed = parseAssemblyVerificationCsv(csv);

    expect(parsed.errors).toEqual([]);
    expect(parsed.import).toMatchObject({
      rowCount: 2,
      sampleCount: 2,
      skippedRowCount: 0,
      invalidValueCount: 0,
      delimiter: ",",
      values: { cpuMaxTempC: 80, gpuMaxTempC: 72, ambientTempC: 25, cpuFanRpm: 1400, gpuFanRpm: 1500 },
      detectedHeaders: {
        cpuMaxTempC: "CPU Package [°C]",
        gpuMaxTempC: "GPU Temperature [°C]",
        ambientTempC: "Ambient Temperature [°C]"
      },
      telemetryColumnCount: 6,
      detectedTelemetryHeaders: {
        cpuUsagePercent: "CPU Total Usage [%]",
        gpuUsagePercent: "GPU Utilization [%]",
        cpuClockMHz: "CPU Clock [MHz]",
        gpuClockMHz: "GPU Core Clock [MHz]",
        cpuPowerW: "CPU Package Power [W]",
        gpuPowerW: "GPU Board Power [W]"
      },
      timeColumn: "Date/Time",
      quality: { status: "complete", rowCount: 2, validSampleCount: 2, skippedRowCount: 0, invalidValueCount: 0, recognizedCoreColumnCount: 5, coreColumnCount: 5, telemetryColumnCount: 6, hasTimeAxis: true, seriesPointCount: 2 },
      series: [
        { sampleIndex: 0, elapsedSeconds: 0, cpuTempC: 70, gpuTempC: 60, ambientTempC: 24, cpuFanRpm: 1000, gpuFanRpm: 1100, cpuUsagePercent: 95, gpuUsagePercent: 99, cpuClockMHz: 4500, gpuClockMHz: 2500, cpuPowerW: 120, gpuPowerW: 300 },
        { sampleIndex: 1, elapsedSeconds: 60, cpuTempC: 80, gpuTempC: 72, ambientTempC: 26, cpuFanRpm: 1400, gpuFanRpm: 1500, cpuUsagePercent: 98, gpuUsagePercent: 100, cpuClockMHz: 4600, gpuClockMHz: 2600, cpuPowerW: 140, gpuPowerW: 320 }
      ]
    });
  });

  it("supports semicolon CSV, quoted fields, decimal commas, and partial sensor exports", () => {
    const csv = [
      '"Time";"CPU (Tctl/Tdie) [°C]";"GPU Core [°C]";"Room Temperature [°C]";"CPU Fan Speed [RPM]"',
      '"20:00";"78,5";"70,2";"23,5";"1200"',
      '"20:01";"79,5";"N/A";"24,5";"1300"'
    ].join("\r\n");

    const parsed = parseAssemblyVerificationCsv(csv);

    expect(parsed.errors).toEqual([]);
    expect(parsed.import).toMatchObject({
      rowCount: 2,
      sampleCount: 2,
      delimiter: ";",
      values: { cpuMaxTempC: 79.5, ambientTempC: 24, cpuFanRpm: 1300 },
      missingMetrics: ["gpuFanRpm"],
      timeColumn: "Time",
      quality: { status: "partial", recognizedCoreColumnCount: 4, coreColumnCount: 5, telemetryColumnCount: 0, hasTimeAxis: true, seriesPointCount: 2 },
      series: [
        { sampleIndex: 0, elapsedSeconds: 0, cpuTempC: 78.5, gpuTempC: 70.2, ambientTempC: 23.5, cpuFanRpm: 1200 },
        { sampleIndex: 1, elapsedSeconds: 60, cpuTempC: 79.5, ambientTempC: 24.5, cpuFanRpm: 1300 }
      ]
    });
    expect(parsed.import?.warnings[0]).toContain("GPU 팬 RPM");
  });

  it("rejects exports without supported sensor columns or valid numeric samples", () => {
    expect(parseAssemblyVerificationCsv("time,load\n20:00,100").errors[0]).toContain("열을 찾지 못했습니다");
    expect(parseAssemblyVerificationCsv("time,CPU Package [°C]\n20:00,151\n20:01,N/A").errors[0]).toContain("유효한");
  });

  it("provides a canonical template that can be parsed again", () => {
    const parsed = parseAssemblyVerificationCsv(assemblyVerificationCsvTemplateFor());

    expect(parsed.errors).toEqual([]);
    expect(parsed.import).toMatchObject({ sampleCount: 1, values: { cpuMaxTempC: 78, gpuMaxTempC: 72, ambientTempC: 24, cpuFanRpm: 1200, gpuFanRpm: 1450 } });
  });

  it("compresses long exports to a bounded time-series without changing representative values", () => {
    const rows = ["Time,CPU Package [°C]", ...Array.from({ length: 300 }, (_, index) => `${index},${50 + (index % 20)}`)].join("\n");
    const parsed = parseAssemblyVerificationCsv(rows);

    expect(parsed.errors).toEqual([]);
    expect(parsed.import).toMatchObject({ rowCount: 300, sampleCount: 300, values: { cpuMaxTempC: 69 } });
    expect(parsed.import?.series).toHaveLength(240);
    expect(parsed.import?.series[0]).toMatchObject({ sampleIndex: 0, elapsedSeconds: 0, cpuTempC: 50 });
    expect(parsed.import?.series.at(-1)).toMatchObject({ sampleIndex: 299, elapsedSeconds: 299, cpuTempC: 69 });
  });
});
