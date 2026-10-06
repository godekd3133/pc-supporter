/**
 * Random part-set compatibility audit.
 *
 * Draws reproducible random builds from the catalog, runs
 * the same compatibility evaluation the API uses, and cross-checks core rules
 * against an independent spec oracle plus result invariants.
 *
 *   npx tsx scripts/compatibility-random-sample.mts [--seed=20261002] [--count=100] [--out=<path.json>]
 *     [--api=<origin> [--catalog-out=<path.json>] | --catalog-file=<path.json>] [--reparse] [--targeted]
 *
 * Catalog source: DATABASE_URL by default, a deployed origin's public picker listing
 * with --api (GET only), or a previously saved snapshot with --catalog-file.
 *
 * Modes (each draws --count builds):
 * - random:    one uniformly random part per category; exercises blocker detection.
 * - plausible: CPU-first draw with matching socket/memory type so the deeper
 *              physical and power rules are reached instead of failing early.
 * - fit:       plausible plus case/PSU chosen to satisfy every known size and power
 *              limit; any blocker here is a false-positive candidate to review.
 * - --targeted adds hand-picked catalog combinations on both sides of the
 *   thresholds of rules random draws rarely reach (psu-system-power,
 *   memory-module-capacity, case-ssd-bays).
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { reparseDanawaPart } from "../server/danawa";
import { ENGINE_VERSION, evaluateBuild } from "../server/engine";
import type { BuildSelection, CompatibilityResult, Finding, Part, PartCategory } from "../shared/types";

type Mode = "random" | "plausible" | "fit";
const MODES: readonly Mode[] = ["random", "plausible", "fit"];
type Expectation = "blocker" | "pass" | "unknown" | "skip";

interface OracleCheck {
  ruleId: string;
  expected: Expectation;
  actual: Expectation | "warning";
  detail: string;
}

interface SampleCase {
  id: string;
  mode: Mode;
  parts: Partial<Record<PartCategory, string[]>>;
  useIntegratedGraphics: boolean;
  status?: CompatibilityResult["status"];
  blockerCount?: number;
  warningCount?: number;
  unknownCount?: number;
  findings?: Array<Pick<Finding, "ruleId" | "severity" | "title">>;
  oracle: OracleCheck[];
  invariantFailures: string[];
  error?: string;
  elapsedMs: number;
}

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, "").split("=");
  return [key, value ?? "true"] as const;
}));
const seed = Number(args.get("seed") ?? 20261002);
const count = Number(args.get("count") ?? 100);
const outPath = args.get("out");
const NOW = "2026-10-02T00:00:00.000Z";

// mulberry32: small deterministic PRNG so a seed reproduces the same draw.
function prng(initial: number) {
  let state = initial >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = prng(seed);
const pick = <T,>(items: readonly T[]): T | undefined => items.length === 0 ? undefined : items[Math.floor(random() * items.length)];

const CATEGORIES: readonly PartCategory[] = ["cpu", "cooler", "motherboard", "memory", "gpu", "ssd", "hdd", "case", "psu"];

/** Pages the public picker listing (`/api/parts` defaults) so the pool matches what users can select. */
async function fetchCatalogFromApi(base: string): Promise<Part[]> {
  const parts: Part[] = [];
  for (const category of CATEGORIES) {
    for (let offset = 0; ; offset += 100) {
      const response = await fetch(`${base.replace(/\/$/, "")}/api/parts?category=${category}&limit=100&offset=${offset}`);
      if (!response.ok) throw new Error(`GET /api/parts ${category}@${offset} → ${response.status}`);
      const page = await response.json() as { items: Part[]; total: number };
      parts.push(...page.items);
      if (page.items.length === 0 || offset + page.items.length >= page.total) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 400));
    }
  }
  return parts;
}

async function loadSampleCatalog(): Promise<{ catalog: Part[]; source: string }> {
  const api = args.get("api");
  const file = args.get("catalog-file");
  if (api) {
    const fetched = await fetchCatalogFromApi(api);
    const catalogOut = args.get("catalog-out");
    if (catalogOut) writeFileSync(catalogOut, `${JSON.stringify(fetched)}\n`);
    return { catalog: fetched, source: `${api} /api/parts` };
  }
  if (file) return { catalog: JSON.parse(readFileSync(file, "utf8")) as Part[], source: file };
  // Imported lazily so API/file runs never open a Postgres pool.
  const { loadCatalog } = await import("../server/catalog");
  return { catalog: await loadCatalog(), source: "DATABASE_URL loadCatalog()" };
}

/**
 * --reparse: fill spec fields the snapshot lacks from rawSpecText with this
 * checkout's Danawa parser (what loadCatalog() would add). Fill-only, so the
 * deployed override values already in an API snapshot are never replaced.
 */
function withCurrentParserFill(parts: Part[]) {
  let filledParts = 0;
  const filledFields: Record<string, number> = {};
  const result = parts.map((part) => {
    if (part.source !== "danawa") return part;
    const reparsed = reparseDanawaPart(part).specs as Record<string, unknown>;
    const specs = { ...part.specs } as Record<string, unknown>;
    let changed = false;
    for (const [key, value] of Object.entries(reparsed)) {
      if (value === undefined || specs[key] !== undefined) continue;
      specs[key] = value;
      filledFields[key] = (filledFields[key] ?? 0) + 1;
      changed = true;
    }
    if (changed) filledParts += 1;
    return changed ? { ...part, specs: specs as Part["specs"] } : part;
  });
  return { parts: result, filledParts, filledFields };
}

const loaded = await loadSampleCatalog();
const reparse = args.has("reparse") ? withCurrentParserFill(loaded.catalog) : undefined;
const catalog = reparse?.parts ?? loaded.catalog;
const catalogSource = reparse ? `${loaded.source} + current parser fill` : loaded.source;
const active = catalog.filter((part) => !part.delistedAt);
const byCategory = new Map<PartCategory, Part[]>();
for (const part of active) byCategory.set(part.category, [...(byCategory.get(part.category) ?? []), part]);
const pool = (category: PartCategory) => byCategory.get(category) ?? [];

function memoryFor(motherboard: Part | undefined, cpu: Part | undefined, constrained: boolean) {
  const expectedType = motherboard?.specs.memoryType ?? cpu?.specs.memoryType;
  const expectedFormFactor = motherboard?.specs.memoryFormFactor;
  const candidates = constrained
    ? pool("memory").filter((part) => (!expectedType || part.specs.memoryType === expectedType)
      && (!expectedFormFactor || part.specs.formFactor === undefined || part.specs.formFactor === expectedFormFactor))
    : pool("memory");
  return pick(candidates.length > 0 ? candidates : pool("memory"));
}

function drawBuild(mode: Mode): { build: BuildSelection; parts: Partial<Record<PartCategory, Part[]>> } {
  const constrained = mode !== "random";
  const fit = mode === "fit";
  const cpu = pick(pool("cpu"));
  const socketBoards = pool("motherboard").filter((part) => cpu?.specs.socket && part.specs.socket === cpu.specs.socket);
  const motherboard = constrained && socketBoards.length > 0 ? pick(socketBoards) : pick(pool("motherboard"));
  const memory = memoryFor(motherboard, cpu, constrained);
  const socketCoolers = pool("cooler").filter((part) => cpu?.specs.socket && part.specs.supportedSockets?.includes(cpu.specs.socket));
  const cooler = constrained && socketCoolers.length > 0 ? pick(socketCoolers) : pick(pool("cooler"));
  const useIntegratedGraphics = cpu?.specs.integratedGraphics === true && random() < 0.25;
  const gpu = useIntegratedGraphics ? undefined : pick(pool("gpu"));
  const ssd = pick(pool("ssd"));
  const hdd = random() < 0.3 ? pick(pool("hdd")) : undefined;
  const fittingCases = pool("case").filter((part) => {
    const boardForm = motherboard?.specs.formFactor;
    return (!boardForm || part.specs.motherboardFormFactors?.includes(boardForm))
      && (gpu?.specs.lengthMm === undefined || (part.specs.maxGpuLengthMm ?? 0) >= gpu.specs.lengthMm)
      && (cooler?.specs.maxCoolerHeightMm === undefined || (part.specs.maxCoolerHeightMm ?? 0) >= cooler.specs.maxCoolerHeightMm);
  });
  const computerCase = fit && fittingCases.length > 0 ? pick(fittingCases) : pick(pool("case"));
  const cpuPower = cpu?.specs.pptW ?? cpu?.specs.tdpW ?? 0;
  const requiredPsuW = gpu
    ? gpu.specs.recommendedPsuW ?? (gpu.specs.powerW ?? 0) + cpuPower + 150
    : (cpuPower + 100) * 1.44;
  const casePsuForms = computerCase?.specs.supportedPsuFormFactors;
  const casePsuLength = computerCase?.specs.maxPsuLengthMm;
  const fittingPsus = pool("psu").filter((part) => (part.specs.wattageW ?? 0) >= requiredPsuW
    && (!casePsuForms || !part.specs.psuFormFactor || casePsuForms.includes(part.specs.psuFormFactor))
    && (casePsuLength === undefined || part.specs.psuDepthMm === undefined || part.specs.psuDepthMm <= casePsuLength));
  const psu = fit && fittingPsus.length > 0 ? pick(fittingPsus) : pick(pool("psu"));
  const memoryQuantity = (memory?.specs.memoryModuleCountPerKit ?? 1) >= 2 ? 1 : (random() < 0.6 ? 2 : 1);
  const build: BuildSelection = {
    cpu: cpu && { partId: cpu.id, quantity: 1 },
    cooler: cooler && { partId: cooler.id, quantity: 1 },
    motherboard: motherboard && { partId: motherboard.id, quantity: 1 },
    memory: memory ? [{ partId: memory.id, quantity: memoryQuantity }] : [],
    gpu: gpu && { partId: gpu.id, quantity: 1 },
    ssd: ssd ? [{ partId: ssd.id, quantity: 1 }] : [],
    hdd: hdd ? [{ partId: hdd.id, quantity: 1 }] : [],
    case: computerCase && { partId: computerCase.id, quantity: 1 },
    psu: psu && { partId: psu.id, quantity: 1 },
    useIntegratedGraphics
  };
  return {
    build,
    parts: {
      cpu: cpu ? [cpu] : [], cooler: cooler ? [cooler] : [], motherboard: motherboard ? [motherboard] : [],
      memory: memory ? [memory] : [], gpu: gpu ? [gpu] : [], ssd: ssd ? [ssd] : [], hdd: hdd ? [hdd] : [],
      case: computerCase ? [computerCase] : [], psu: psu ? [psu] : []
    }
  };
}

function engineVerdict(result: CompatibilityResult, ruleId: string): Expectation | "warning" {
  const severities = new Set(result.findings.filter((finding) => finding.ruleId === ruleId).map((finding) => finding.severity));
  if (severities.has("blocker")) return "blocker";
  if (severities.has("unknown")) return "unknown";
  if (severities.has("warning")) return "warning";
  return "pass";
}

/** Independent re-statement of the physical rules from raw specs only. */
function oracleFor(parts: Partial<Record<PartCategory, Part[]>>): Array<Omit<OracleCheck, "actual">> {
  const [cpu] = parts.cpu ?? [];
  const [cooler] = parts.cooler ?? [];
  const [motherboard] = parts.motherboard ?? [];
  const [gpu] = parts.gpu ?? [];
  const [computerCase] = parts.case ?? [];
  const [psu] = parts.psu ?? [];
  const memory = parts.memory ?? [];
  const checks: Array<Omit<OracleCheck, "actual">> = [];
  const compare = (ruleId: string, left: unknown, right: unknown, mismatch: boolean, detail: string) => {
    checks.push({ ruleId, expected: left === undefined || right === undefined ? "unknown" : mismatch ? "blocker" : "pass", detail });
  };
  if (cpu && motherboard) {
    compare("cpu-motherboard-socket", cpu.specs.socket, motherboard.specs.socket,
      cpu.specs.socket !== motherboard.specs.socket, `CPU ${cpu.specs.socket ?? "?"} / MB ${motherboard.specs.socket ?? "?"}`);
  }
  if (cpu && motherboard && memory.length > 0) {
    const expected = motherboard.specs.memoryType ?? cpu.specs.memoryType;
    const actual = memory[0].specs.memoryType;
    compare("memory-type", expected, actual, expected !== actual, `기대 ${expected ?? "?"} / RAM ${actual ?? "?"}`);
  }
  if (cpu && motherboard && memory[0]?.specs.formFactor) {
    // Full-size desktop boards (ATX/E-ATX/mATX on a desktop socket) take DIMM even when the listing omits it;
    // ITX stays unknown because Thin Mini-ITX boards use SO-DIMM.
    const ramForm = memory[0].specs.formFactor;
    const desktopBoard = ["ATX", "E-ATX", "mATX"].includes(motherboard.specs.formFactor ?? "")
      && /^(?:AM\d|LGA\d{4})/i.test(motherboard.specs.socket ?? "");
    const slotForm = motherboard.specs.memoryFormFactor ?? (desktopBoard ? "DIMM" : undefined);
    checks.push({
      ruleId: "memory-form-factor",
      expected: slotForm ? (slotForm === ramForm ? "pass" : "blocker") : ramForm === "SO-DIMM" ? "unknown" : "pass",
      detail: `슬롯 ${slotForm ?? "?"}(${motherboard.specs.formFactor ?? "?"}) / RAM ${ramForm}`
    });
  }
  if (cpu && cooler) {
    const sockets = cooler.specs.supportedSockets;
    compare("cpu-cooler-socket", cpu.specs.socket, sockets,
      !sockets?.includes(cpu.specs.socket ?? ""), `CPU ${cpu.specs.socket ?? "?"} / 쿨러 ${sockets?.join(",") ?? "?"}`);
  }
  if (motherboard?.specs.formFactor && computerCase) {
    const supported = computerCase.specs.motherboardFormFactors;
    compare("case-motherboard-form-factor", motherboard.specs.formFactor, supported,
      !supported?.includes(motherboard.specs.formFactor), `MB ${motherboard.specs.formFactor} / 케이스 ${supported?.join(",") ?? "?"}`);
  }
  if (gpu && computerCase) {
    const length = gpu.specs.lengthMm;
    const max = computerCase.specs.maxGpuLengthMm;
    compare("gpu-case-length", length, max, (length ?? 0) > (max ?? 0), `GPU ${length ?? "?"}mm / 케이스 ${max ?? "?"}mm`);
  }
  if (cpu && cooler && computerCase) {
    const height = cooler.specs.maxCoolerHeightMm;
    const max = computerCase.specs.maxCoolerHeightMm;
    // The engine only blocks when both heights are known; a missing height is not reported under this rule.
    checks.push({
      ruleId: "case-cooler-height",
      expected: height === undefined || max === undefined ? "skip" : height > max ? "blocker" : "pass",
      detail: `쿨러 ${height ?? "?"}mm / 케이스 ${max ?? "?"}mm`
    });
  }
  if (gpu && psu) {
    const cpuPower = cpu?.specs.pptW ?? cpu?.specs.tdpW ?? 0;
    const recommended = gpu.specs.recommendedPsuW ?? (gpu.specs.powerW === undefined ? undefined : gpu.specs.powerW + cpuPower + 150);
    const wattage = psu.specs.wattageW;
    const missing = gpu.specs.powerW === undefined || wattage === undefined || recommended === undefined;
    checks.push({
      ruleId: "gpu-psu-power",
      expected: missing ? "unknown" : wattage < recommended ? "blocker" : "pass",
      detail: `권장 ${recommended ?? "?"}W / 파워 ${wattage ?? "?"}W`
    });
  }
  return checks;
}

function invariantFailuresFor(result: CompatibilityResult, build: BuildSelection, repeat: CompatibilityResult): string[] {
  const failures: string[] = [];
  const count = (severity: Finding["severity"]) => result.findings.filter((finding) => finding.severity === severity).length;
  if (result.blockerCount !== count("blocker")) failures.push(`blockerCount ${result.blockerCount} ≠ blocker findings ${count("blocker")}`);
  if (result.warningCount !== count("warning")) failures.push(`warningCount ${result.warningCount} ≠ warning findings ${count("warning")}`);
  if (result.unknownCount !== count("unknown")) failures.push(`unknownCount ${result.unknownCount} ≠ unknown findings ${count("unknown")}`);
  const expectedStatus = result.blockerCount > 0 ? "incompatible" : result.unknownCount > 0 ? "needs_review" : "compatible";
  if (result.status !== expectedStatus) failures.push(`status ${result.status} ≠ derived ${expectedStatus}`);
  const ids = result.findings.map((finding) => finding.id);
  if (new Set(ids).size !== ids.length) failures.push("중복 finding id");
  const selectedIds = new Set([
    build.cpu?.partId, build.cooler?.partId, build.motherboard?.partId, build.gpu?.partId, build.case?.partId, build.psu?.partId,
    ...build.memory.map((item) => item.partId), ...build.ssd.map((item) => item.partId), ...build.hdd.map((item) => item.partId)
  ].filter(Boolean));
  for (const finding of result.findings) {
    const foreign = finding.affectedPartIds.filter((id) => !selectedIds.has(id));
    if (foreign.length > 0) failures.push(`${finding.ruleId}: 선택되지 않은 부품 참조 ${foreign.join(",")}`);
    if (!finding.title.trim() || !finding.message.trim()) failures.push(`${finding.ruleId}: 빈 title/message`);
  }
  const fingerprint = (value: CompatibilityResult) => JSON.stringify(value.findings.map((finding) => [finding.id, finding.severity, finding.facts]));
  if (fingerprint(result) !== fingerprint(repeat)) failures.push("동일 입력 재평가 결과 불일치");
  return failures;
}

const cases: SampleCase[] = [];
for (const mode of MODES) {
  for (let index = 0; index < count; index += 1) {
    const { build, parts } = drawBuild(mode);
    const sample: SampleCase = {
      id: `${mode}-${String(index + 1).padStart(3, "0")}`,
      mode,
      parts: Object.fromEntries(Object.entries(parts).filter(([, list]) => list.length > 0).map(([category, list]) => [category, list.map((part) => part.id)])),
      useIntegratedGraphics: build.useIntegratedGraphics,
      oracle: [],
      invariantFailures: [],
      elapsedMs: 0
    };
    const started = performance.now();
    try {
      const result = evaluateBuild(build, catalog, { now: NOW, includeSuggestions: false, includeAnalysis: true });
      sample.elapsedMs = Math.round(performance.now() - started);
      const repeat = evaluateBuild(build, catalog, { now: NOW, includeSuggestions: false, includeAnalysis: true, evaluationCache: new Map() });
      sample.status = result.status;
      sample.blockerCount = result.blockerCount;
      sample.warningCount = result.warningCount;
      sample.unknownCount = result.unknownCount;
      sample.findings = result.findings.map(({ ruleId, severity, title }) => ({ ruleId, severity, title }));
      sample.oracle = oracleFor(parts).map((check) => ({ ...check, actual: engineVerdict(result, check.ruleId) }));
      sample.invariantFailures = invariantFailuresFor(result, build, repeat);
    } catch (error) {
      sample.elapsedMs = Math.round(performance.now() - started);
      sample.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
    cases.push(sample);
  }
}

/**
 * --targeted: rules whose trigger is too rare for random draws are exercised
 * with hand-picked catalog combinations on both sides of each threshold.
 */
interface TargetedCase {
  id: string;
  ruleId: string;
  expected: "warning" | "pass";
  actual: string;
  detail: string;
  parts: Partial<Record<PartCategory, string[]>>;
  invariantFailures: string[];
}

function targetedCases(): TargetedCase[] {
  const results: TargetedCase[] = [];
  const dimmFor = (memoryType: string | undefined) => pool("memory").filter((part) => part.specs.formFactor === "DIMM" && part.specs.memoryType === memoryType);
  const boardFor = (cpu: Part) => pool("motherboard").find((part) => part.specs.socket === cpu.specs.socket && part.specs.memoryType && dimmFor(part.specs.memoryType).length > 0);
  const coolerFor = (cpu: Part) => pool("cooler").find((part) => part.specs.supportedSockets?.includes(cpu.specs.socket ?? ""));
  const caseFor = (board: Part | undefined) => pool("case").find((part) => board?.specs.formFactor && part.specs.motherboardFormFactors?.includes(board.specs.formFactor));
  const run = (id: string, ruleId: string, expected: "warning" | "pass", detail: string, selection: {
    cpu?: Part; motherboard?: Part; memory?: Part; memoryQuantity?: number; cooler?: Part; computerCase?: Part; psu?: Part;
    ssd?: Part; ssdQuantity?: number; hdd?: Part; hddQuantity?: number;
  }) => {
    const one = (part: Part | undefined, quantity = 1) => part && { partId: part.id, quantity };
    const build: BuildSelection = {
      cpu: one(selection.cpu), motherboard: one(selection.motherboard), cooler: one(selection.cooler),
      memory: selection.memory ? [one(selection.memory, selection.memoryQuantity)!] : [],
      ssd: selection.ssd ? [one(selection.ssd, selection.ssdQuantity)!] : [],
      hdd: selection.hdd && (selection.hddQuantity ?? 1) > 0 ? [one(selection.hdd, selection.hddQuantity)!] : [],
      case: one(selection.computerCase), psu: one(selection.psu), useIntegratedGraphics: true
    };
    const result = evaluateBuild(build, catalog, { now: NOW, includeSuggestions: false, includeAnalysis: true });
    const repeat = evaluateBuild(build, catalog, { now: NOW, includeSuggestions: false, includeAnalysis: true, evaluationCache: new Map() });
    const severities = result.findings.filter((finding) => finding.ruleId === ruleId).map((finding) => finding.severity);
    const parts: Partial<Record<PartCategory, string[]>> = {};
    for (const [category, part] of [["cpu", selection.cpu], ["motherboard", selection.motherboard], ["memory", selection.memory], ["cooler", selection.cooler],
      ["case", selection.computerCase], ["psu", selection.psu], ["ssd", selection.ssd], ["hdd", selection.hdd]] as const) {
      if (part) parts[category] = [part.id];
    }
    results.push({ id, ruleId, expected, actual: severities[0] ?? "pass", detail, parts, invariantFailures: invariantFailuresFor(result, build, repeat) });
  };

  // psu-system-power: no discrete GPU, warning when PSU ≤ 1.2 × 1.2 × (CPU power + 100W).
  const psus = [...pool("psu")].filter((part) => part.specs.wattageW !== undefined).sort((left, right) => left.specs.wattageW! - right.specs.wattageW!);
  const igpuCpus = pool("cpu").filter((part) => part.specs.integratedGraphics && (part.specs.pptW ?? part.specs.tdpW) !== undefined);
  const seenPower = new Set<number>();
  for (const cpu of igpuCpus) {
    const cpuPower = (cpu.specs.pptW ?? cpu.specs.tdpW)!;
    const motherboard = boardFor(cpu);
    if (seenPower.has(cpuPower) || !motherboard) continue;
    seenPower.add(cpuPower);
    const threshold = 1.2 * 1.2 * (cpuPower + 100);
    const atOrBelow = psus.filter((part) => part.specs.wattageW! <= threshold);
    const above = psus.find((part) => part.specs.wattageW! > threshold);
    const picks = new Map<string, Part>();
    if (atOrBelow[0]) picks.set(atOrBelow[0].id, atOrBelow[0]);
    if (atOrBelow.at(-1)) picks.set(atOrBelow.at(-1)!.id, atOrBelow.at(-1)!);
    if (above) picks.set(above.id, above);
    for (const psu of picks.values()) {
      const expected = psu.specs.wattageW! <= threshold ? "warning" : "pass";
      run(`psu-system-power-${cpuPower}w-${psu.specs.wattageW}w`, "psu-system-power", expected,
        `CPU ${cpuPower}W → 경계 ${threshold.toFixed(1)}W / 파워 ${psu.specs.wattageW}W`, {
          cpu, motherboard, memory: dimmFor(motherboard.specs.memoryType)[0], cooler: coolerFor(cpu), computerCase: caseFor(motherboard), psu
        });
    }
  }

  // memory-module-capacity: warning when one module exceeds maxMemoryGb ÷ memorySlots.
  const moduleGb = (part: Part) => part.specs.capacityGb === undefined ? undefined : part.specs.capacityGb / (part.specs.memoryModuleCountPerKit ?? 1);
  const smallSlotBoards = pool("motherboard").filter((part) => part.specs.maxMemoryGb && part.specs.memorySlots && part.specs.maxMemoryGb / part.specs.memorySlots < 32);
  for (const motherboard of smallSlotBoards) {
    const perSlot = motherboard.specs.maxMemoryGb! / motherboard.specs.memorySlots!;
    const cpu = pool("cpu").find((part) => part.specs.socket === motherboard.specs.socket) ?? pool("cpu")[0];
    const modules = dimmFor(motherboard.specs.memoryType).filter((part) => moduleGb(part) !== undefined).sort((left, right) => moduleGb(right)! - moduleGb(left)!);
    const picks = [modules[0], modules.find((part) => moduleGb(part) === perSlot)].filter((part): part is Part => Boolean(part));
    for (const memory of new Set(picks)) {
      const expected = moduleGb(memory)! > perSlot ? "warning" : "pass";
      run(`memory-module-capacity-${motherboard.id}-${moduleGb(memory)}gb`, "memory-module-capacity", expected,
        `${motherboard.name}: 슬롯당 ${perSlot}GB(${motherboard.specs.maxMemoryGb}GB/${motherboard.specs.memorySlots}) / 모듈 ${moduleGb(memory)}GB`,
        { cpu, motherboard, memory, cooler: coolerFor(cpu), computerCase: caseFor(motherboard) });
    }
  }

  // case-ssd-bays: warning when 2.5" SSD count > ssdBays + spare 3.5" bays.
  const ssd25 = pool("ssd").find((part) => /2\.5/.test(part.specs.formFactor ?? ""));
  const hdd35 = pool("hdd").find((part) => /3\.5/.test(part.specs.formFactor ?? ""));
  for (const computerCase of pool("case").filter((part) => part.specs.ssdBays !== undefined)) {
    const motherboard = pool("motherboard").find((part) => part.specs.formFactor && computerCase.specs.motherboardFormFactors?.includes(part.specs.formFactor)
      && pool("cpu").some((cpu) => cpu.specs.socket === part.specs.socket));
    const cpu = motherboard && pool("cpu").find((part) => part.specs.socket === motherboard.specs.socket);
    if (!ssd25 || !hdd35 || !motherboard || !cpu) continue;
    for (let hddQuantity = 0; hddQuantity <= (computerCase.specs.hddBays ?? 0); hddQuantity += 1) {
      const capacity = computerCase.specs.ssdBays! + Math.max(0, (computerCase.specs.hddBays ?? 0) - hddQuantity);
      for (const ssdQuantity of [capacity, capacity + 1]) {
        run(`case-ssd-bays-hdd${hddQuantity}-ssd${ssdQuantity}`, "case-ssd-bays", ssdQuantity > capacity ? "warning" : "pass",
          `${computerCase.name}: SSD 베이 ${computerCase.specs.ssdBays} + 남는 3.5인치 ${capacity - computerCase.specs.ssdBays!} = ${capacity} / 2.5인치 SSD ${ssdQuantity}`,
          { cpu, motherboard, memory: dimmFor(motherboard.specs.memoryType)[0], cooler: coolerFor(cpu), computerCase, ssd: ssd25, ssdQuantity, hdd: hdd35, hddQuantity });
      }
    }
  }
  return results;
}

const targeted = args.has("targeted") ? targetedCases() : [];

// Oracle mismatch: the engine may add a warning on a passing rule (e.g. headroom), which is not a contradiction.
const isMismatch = (check: OracleCheck) => check.expected !== "skip"
  && check.actual !== check.expected
  && !(check.expected === "pass" && check.actual === "warning");

const partName = new Map(catalog.map((part) => [part.id, part.name]));
const summary = {
  seed,
  countPerMode: count,
  engineVersion: ENGINE_VERSION,
  catalogSource,
  ...(reparse ? { parserFill: { filledParts: reparse.filledParts, filledFields: reparse.filledFields } } : {}),
  evaluatedAt: NOW,
  catalog: {
    total: catalog.length,
    active: active.length,
    byCategory: Object.fromEntries([...byCategory].map(([category, list]) => [category, list.length]))
  },
  byMode: Object.fromEntries(MODES.map((mode) => {
    const scoped = cases.filter((sample) => sample.mode === mode);
    const statusCounts: Record<string, number> = {};
    for (const sample of scoped) statusCounts[sample.status ?? "error"] = (statusCounts[sample.status ?? "error"] ?? 0) + 1;
    const elapsed = scoped.map((sample) => sample.elapsedMs).sort((a, b) => a - b);
    return [mode, {
      statusCounts,
      errors: scoped.filter((sample) => sample.error).length,
      invariantFailureCases: scoped.filter((sample) => sample.invariantFailures.length > 0).length,
      oracleMismatchCases: scoped.filter((sample) => sample.oracle.some(isMismatch)).length,
      elapsedMs: { p50: elapsed[Math.floor(elapsed.length * 0.5)], p95: elapsed[Math.floor(elapsed.length * 0.95)], max: elapsed.at(-1) }
    }];
  })),
  ruleFrequency: (() => {
    const frequency: Record<string, Record<string, number>> = {};
    for (const sample of cases) for (const finding of sample.findings ?? []) {
      frequency[finding.ruleId] ??= {};
      frequency[finding.ruleId][finding.severity] = (frequency[finding.ruleId][finding.severity] ?? 0) + 1;
    }
    return frequency;
  })(),
  oracleByRule: (() => {
    const byRule: Record<string, { checked: number; agree: number; mismatch: number; matrix: Record<string, number> }> = {};
    for (const sample of cases) for (const check of sample.oracle) {
      if (check.expected === "skip") continue;
      byRule[check.ruleId] ??= { checked: 0, agree: 0, mismatch: 0, matrix: {} };
      const entry = byRule[check.ruleId];
      entry.checked += 1;
      if (isMismatch(check)) entry.mismatch += 1; else entry.agree += 1;
      const key = `${check.expected}→${check.actual}`;
      entry.matrix[key] = (entry.matrix[key] ?? 0) + 1;
    }
    return byRule;
  })()
};

const mismatches = cases.flatMap((sample) => sample.oracle.filter(isMismatch).map((check) => ({ caseId: sample.id, ...check })));
const targetedByRule: Record<string, { checked: number; agree: number; matrix: Record<string, number> }> = {};
for (const sample of targeted) {
  const entry = targetedByRule[sample.ruleId] ??= { checked: 0, agree: 0, matrix: {} };
  entry.checked += 1;
  if (sample.actual === sample.expected) entry.agree += 1;
  entry.matrix[`${sample.expected}→${sample.actual}`] = (entry.matrix[`${sample.expected}→${sample.actual}`] ?? 0) + 1;
}

const report = {
  summary: targeted.length > 0 ? { ...summary, targeted: targetedByRule } : summary,
  mismatches,
  ...(targeted.length > 0 ? {
    targeted: targeted.map((sample) => ({
      ...sample,
      partNames: Object.fromEntries(Object.entries(sample.parts).map(([category, ids]) => [category, ids!.map((id) => partName.get(id) ?? id)]))
    }))
  } : {}),
  invariantFailures: cases.filter((sample) => sample.invariantFailures.length > 0).map((sample) => ({ caseId: sample.id, failures: sample.invariantFailures })),
  errors: cases.filter((sample) => sample.error).map((sample) => ({ caseId: sample.id, error: sample.error, parts: sample.parts })),
  cases: cases.map((sample) => ({
    ...sample,
    partNames: Object.fromEntries(Object.entries(sample.parts).map(([category, ids]) => [category, ids!.map((id) => partName.get(id) ?? id)]))
  }))
};

if (outPath) writeFileSync(outPath, `${JSON.stringify(report)}\n`);
console.log(JSON.stringify({ summary: report.summary, targetedFailures: targeted.filter((sample) => sample.actual !== sample.expected || sample.invariantFailures.length > 0), mismatchCount: mismatches.length, mismatchesPreview: mismatches.slice(0, 20), invariantFailures: report.invariantFailures.slice(0, 20), errors: report.errors.slice(0, 10) }, null, 2));
process.exit(0);
