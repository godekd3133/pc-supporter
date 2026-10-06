import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { BuildSelection, Part, PartCategory } from "../shared/types";
import type { CatalogSpecOverride } from "../shared/catalog-spec-overrides";
import { evaluateBuild, ENGINE_VERSION } from "../server/engine";
import { reparseDanawaPart } from "../server/danawa";
import { applyCatalogSpecOverrides, validateCatalogSpecOverrideBatch } from "../server/catalog-spec-overrides";

// This is a fresh deterministic audit, not a replay of the unavailable October 2
// sampler. Pin the input file and parser/engine source when comparing runs.
const [catalogFile, evidenceFile, baselineParserFile, outputFile] = process.argv.slice(2);
if (!catalogFile || !evidenceFile || !baselineParserFile || !outputFile) {
  throw new Error("Usage: tsx scripts/compatibility-catalog-audit.ts catalog.json evidence.json baseline-parser.ts output.json");
}
const catalogBytes = await readFile(catalogFile);
const input = JSON.parse(catalogBytes.toString("utf8"));
const raw: Part[] = Array.isArray(input) ? input : input.items;
if (!Array.isArray(raw) || new Set(raw.map((part) => part.id)).size !== raw.length) throw new Error("Invalid or duplicate catalog IDs");
const evidenceInput = JSON.parse(await readFile(evidenceFile, "utf8"));
const evidence: CatalogSpecOverride[] = Array.isArray(evidenceInput) ? evidenceInput : evidenceInput.items;
const beforeParser = await import(pathToFileURL(resolve(baselineParserFile)).href);
const before: Part[] = raw.map(beforeParser.reparseDanawaPart);
const reparsed = raw.map(reparseDanawaPart);
const validation = validateCatalogSpecOverrideBatch(evidence, reparsed);
if (validation.errors.length) throw new Error(validation.errors.join("\n"));
const overlays = Object.fromEntries(validation.validOverrides.map((item) => [item.partId, item]));
const after = applyCatalogSpecOverrides(reparsed, overlays);
const seed = 20261002;
let state = seed;
function random() { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; }
function choose(parts: Part[]) { if (!parts.length) throw new Error("Empty candidate pool"); return parts[Math.floor(random() * parts.length)]; }
const categories: PartCategory[] = ["cpu", "cooler", "motherboard", "memory", "gpu", "ssd", "case", "psu"];
const pools = Object.fromEntries(categories.map((category) => [category, before.filter((part) => part.category === category).sort((a, b) => a.id.localeCompare(b.id))])) as Record<PartCategory, Part[]>;
const rows: unknown[] = [];
const summary: Record<string, Record<string, number>> = {};
let consistencyErrors = 0;
let independentM2Mismatches = 0;
for (const mode of ["random", "plausible", "fit"] as const) {
  summary[mode] = {};
  for (let index = 0; index < 100; index += 1) {
    const selected = Object.fromEntries(categories.map((category) => [category, choose(pools[category])])) as Record<PartCategory, Part>;
    if (mode !== "random") {
      const sameSocket = pools.motherboard.filter((part) => selected.cpu.specs.socket !== undefined && part.specs.socket === selected.cpu.specs.socket);
      if (sameSocket.length) selected.motherboard = choose(sameSocket);
      const sameMemory = pools.memory.filter((part) => selected.motherboard.specs.memoryType !== undefined && part.specs.memoryType === selected.motherboard.specs.memoryType);
      if (sameMemory.length) selected.memory = choose(sameMemory);
    }
    if (mode === "fit") {
      const coolers = pools.cooler.filter((part) => part.specs.supportedSockets?.includes(selected.cpu.specs.socket ?? ""));
      if (coolers.length) selected.cooler = choose(coolers);
      const cases = pools.case.filter((part) => part.specs.motherboardFormFactors?.includes(selected.motherboard.specs.formFactor ?? "") && (part.specs.maxGpuLengthMm ?? 0) >= (selected.gpu.specs.lengthMm ?? Infinity));
      if (cases.length) selected.case = choose(cases);
      const psus = pools.psu.filter((part) => (part.specs.wattageW ?? 0) >= (selected.gpu.specs.recommendedPsuW ?? 650));
      if (psus.length) selected.psu = choose(psus);
    }
    const build: BuildSelection = { memory: [], ssd: [], hdd: [], useIntegratedGraphics: false };
    for (const category of categories) {
      const selection = { partId: selected[category].id, quantity: 1 };
      if (category === "memory" || category === "ssd") build[category] = [selection];
      else (build as unknown as Record<string, unknown>)[category] = selection;
    }
    const options = { includeSuggestions: false, now: "2026-10-04T00:00:00Z" };
    const oldResult = evaluateBuild(build, before, options);
    const result = evaluateBuild(build, after, options);
    const repeated = evaluateBuild(build, after, options);
    if (JSON.stringify(result) !== JSON.stringify(repeated)) consistencyErrors += 1;
    summary[mode][`before:${oldResult.status}`] = (summary[mode][`before:${oldResult.status}`] ?? 0) + 1;
    summary[mode][`after:${result.status}`] = (summary[mode][`after:${result.status}`] ?? 0) + 1;
    const board = after.find((part) => part.id === selected.motherboard.id)!;
    const ssd = after.find((part) => part.id === selected.ssd.id)!;
    const segment = board.rawSpecText?.match(/M\.2\s*연결\s*[:：]?\s*([^/]+)/i)?.[1] ?? "";
    // Independent raw-source oracle, intentionally scoped to M.2 connection.
    const rawSupportsNvme = /NVMe|PCIe/i.test(segment);
    if (rawSupportsNvme && ssd.specs.interface === "NVMe" && result.findings.some((finding) => finding.ruleId === "m2-interface" && finding.severity === "blocker")) independentM2Mismatches += 1;
    rows.push({ id: `${mode}-${String(index + 1).padStart(3, "0")}`, mode, build, beforeStatus: oldResult.status, afterStatus: result.status, beforeFindings: oldResult.findings.map(({ ruleId, severity }) => ({ ruleId, severity })), afterFindings: result.findings.map(({ ruleId, severity }) => ({ ruleId, severity })) });
  }
}
const coverage = (parts: Part[]) => {
  const cases = parts.filter((part) => part.category === "case");
  return Object.fromEntries(["radiatorSupports", "radiatorSizesMm", "supportedPsuFormFactors", "ssdBays"].map((field) => [field, cases.filter((part) => { const value = part.specs[field as keyof Part["specs"]]; return value !== undefined && (!Array.isArray(value) || value.length > 0); }).length]));
};
const report = { kind: "fresh-compatibility-audit", sourceBoundary: "Current public catalog; original October 2 snapshot and sampler unavailable. Same seed does not mean same sample.", engineVersion: ENGINE_VERSION, seed, catalogCount: raw.length, catalogSha256: createHash("sha256").update(catalogBytes).digest("hex"), evidenceItems: evidence.length, sampleCount: rows.length, summary, consistencyErrors, independentM2Mismatches, caseCoverageBefore: coverage(before), caseCoverageAfter: coverage(after), rows };
await writeFile(outputFile, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ...report, rows: undefined }));
if (consistencyErrors || independentM2Mismatches) process.exitCode = 1;
