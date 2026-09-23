import { setTimeout as sleep } from "node:timers/promises";
import type { Part, PartCategory } from "../shared/types";
import { mergeCatalog } from "../server/catalog";
import { parseDanawaListPage, parseDanawaProductPage, type DanawaListItem } from "../server/danawa";
import { readCatalogRecords, writeCatalogRecords } from "../server/repository";
import { BENCHMARK_OVERRIDES_PATH, readJson } from "../server/storage";
import { isListingAllowed } from "../server/listing";

type Target = { category: PartCategory; categoryId: string; label: string };

// Curated core-PC Danawa list categories. One public HTML page per target keeps
// this first catalog expansion bounded and avoids the robots-disallowed AJAX API.
const TARGETS: Target[] = [
  { category: "cpu", categoryId: "112747", label: "CPU" },
  { category: "cooler", categoryId: "11336857", label: "CPU cooler air" },
  { category: "cooler", categoryId: "11336856", label: "CPU cooler liquid" },
  { category: "motherboard", categoryId: "11353758", label: "Motherboard Intel 1700" },
  { category: "motherboard", categoryId: "11353759", label: "Motherboard AMD AM5" },
  { category: "motherboard", categoryId: "11354784", label: "Motherboard Intel 1851" },
  { category: "memory", categoryId: "11341201", label: "Memory DDR5" },
  { category: "memory", categoryId: "1131326", label: "Memory DDR4" },
  { category: "gpu", categoryId: "1131480", label: "GPU Nvidia" },
  { category: "gpu", categoryId: "1131521", label: "GPU AMD" },
  { category: "gpu", categoryId: "11347368", label: "GPU Intel" },
  { category: "gpu", categoryId: "11255541", label: "GPU RTX 50" },
  { category: "gpu", categoryId: "11255542", label: "GPU RX 9000" },
  { category: "ssd", categoryId: "11338854", label: "SSD NVMe Gen4" },
  { category: "ssd", categoryId: "11352133", label: "SSD NVMe Gen5" },
  { category: "ssd", categoryId: "11335283", label: "SSD SATA" },
  { category: "hdd", categoryId: "112763", label: "HDD" },
  { category: "case", categoryId: "112775", label: "Case" },
  { category: "psu", categoryId: "112777", label: "PSU" }
];

const USER_AGENT = "PCSupporterCatalogResearch/1.0 (public product catalog; contact: pc-supporter project)";
const MIN_DELAY_MS = 900;
const MAX_LIST_PAGES = 30;
const MAX_DETAILS = 120;
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const pilot = args.has("--pilot");
const remaining = args.has("--remaining");
if (args.has("--dry-run") && apply) throw new Error("Choose either --dry-run or --apply.");
if ([...args].some((arg) => !["--dry-run", "--apply", "--pilot", "--remaining"].includes(arg))) throw new Error("Allowed flags: --dry-run (default), --apply, --pilot, --remaining.");

const REMAINING_CATEGORIES = new Set<PartCategory>(["memory", "gpu", "ssd", "hdd", "case", "psu"]);
const MAX_REMAINING_DETAILS = 70;
const MAX_REMAINING_PER_TARGET = 5;
const fetchAttempts = remaining ? 2 : 3;
const requestTimeoutMs = remaining ? 8000 : 25000;
const httpStatusCounts: Record<string, number> = {};
let transportFailures = 0;

function robotsDisallows(robots: string, path: string) {
  let inWildcardGroup = false;
  let groupHasRules = false;
  for (const rawLine of robots.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (groupHasRules) { inWildcardGroup = false; groupHasRules = false; }
      if (!groupHasRules) inWildcardGroup = value === "*";
      continue;
    }
    if (key === "allow" || key === "disallow") {
      groupHasRules = true;
      if (inWildcardGroup && key === "disallow" && value && path.startsWith(value)) return true;
    }
  }
  return false;
}

let lastRequestAt = 0;
async function getText(url: string) {
  if (!url.startsWith("https://prod.danawa.com/list/?cate=") && !url.startsWith("https://prod.danawa.com/info/?pcode=")) {
    throw new Error(`Blocked non-allowlisted URL: ${url}`);
  }
  for (let attempt = 0; attempt < fetchAttempts; attempt += 1) {
    const wait = Math.max(0, MIN_DELAY_MS - (Date.now() - lastRequestAt));
    if (wait) await sleep(wait);
    lastRequestAt = Date.now();
    try {
      const response = await fetch(url, {
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
        signal: AbortSignal.timeout(requestTimeoutMs)
      });
      httpStatusCounts[String(response.status)] = (httpStatusCounts[String(response.status)] ?? 0) + 1;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      if (html.length < 500 || /접근이 제한|비정상적인 접근|자동입력 방지|보안문자/.test(html)) {
        throw new Error("Empty, blocked, or challenge HTML response");
      }
      return html;
    } catch (error) {
      if (attempt === fetchAttempts - 1) {
        if (error instanceof TypeError && /fetch failed/i.test(error.message)) transportFailures += 1;
        throw error;
      }
      await sleep(MIN_DELAY_MS * (attempt + 1));
    }
  }
  throw new Error("Request retries exhausted");
}

function eligibleCore(part: Part) {
  return part.listingType !== "accessory" && part.listingType !== "used" && part.listingType !== "overseas";
}

async function main() {
  const robots = await getRobots();
  for (const path of ["/list/", "/info/"]) {
    if (robotsDisallows(robots, path)) throw new Error(`Robots.txt now disallows ${path}; crawl stopped.`);
  }

  const eligibleTargets = remaining ? TARGETS.filter((target) => REMAINING_CATEGORIES.has(target.category)) : TARGETS;
  const pilotTargets = remaining
    ? eligibleTargets.filter((target, index, all) => all.findIndex((candidate) => candidate.category === target.category) === index).slice(0, 3)
    : eligibleTargets.slice(0, 3);
  const targets = (pilot ? pilotTargets : eligibleTargets.slice(0, MAX_LIST_PAGES));
  const detailBudget = pilot ? 15 : remaining ? MAX_REMAINING_DETAILS : MAX_DETAILS;
  const perTargetBudget = remaining ? MAX_REMAINING_PER_TARGET : detailBudget;
  const existing = await readCatalogRecords();
  const existingCodes = new Set(existing.filter((p) => p.source === "danawa").map((p) => `${p.category}:${p.sourceProductCode}`));
  const seen = new Set<string>();
  const collected: Part[] = [];
  const errors: string[] = [];
  const categoryCounts = new Map<string, {
    listedRows: number;
    uniqueListedCodes: number;
    detailAttempts: number;
    coreProducts: number;
    generatorUsable: number;
    incomplete: number;
    errors: number;
  }>();
  let details = 0;

  for (const target of targets) {
    const key = `${target.category}:${target.categoryId}`;
    const counts = categoryCounts.get(key) ?? {
      listedRows: 0, uniqueListedCodes: 0, detailAttempts: 0,
      coreProducts: 0, generatorUsable: 0, incomplete: 0, errors: 0
    };
    try {
      const html = await getText(`https://prod.danawa.com/list/?cate=${target.categoryId}`);
      const items = parseDanawaListPage(html);
      if (!items.length) throw new Error("no valid product rows parsed");
      counts.listedRows = items.length;
      counts.uniqueListedCodes = new Set(items.map((item) => item.sourceProductCode)).size;
      const candidates = items.filter((item) => {
        if (!/^\d+$/.test(item.sourceProductCode)) return true;
        if (seen.has(item.sourceProductCode)) return false;
        if (remaining && existingCodes.has(`${target.category}:${item.sourceProductCode}`)) return false;
        return true;
      }).slice(0, perTargetBudget);
      for (const item of candidates) {
        if (!/^\d+$/.test(item.sourceProductCode)) {
          counts.errors += 1;
          errors.push(`${target.label}: skipped non-numeric product code`);
          continue;
        }
        if (seen.has(item.sourceProductCode) || details >= detailBudget) continue;
        seen.add(item.sourceProductCode);
        try {
          const detailHtml = await getText(`https://prod.danawa.com/info/?pcode=${item.sourceProductCode}`);
          const part = parseDanawaProductPage(target.category, item, detailHtml, target.categoryId);
          details += 1;
          counts.detailAttempts += 1;
          if (!part.sourceProductCode || !part.name || part.category !== target.category) throw new Error("invalid parsed product detail");
          if (part.dataQuality === "incomplete") counts.incomplete += 1;
          if (!eligibleCore(part)) continue;
          counts.coreProducts += 1;
          if (part.dataQuality !== "incomplete" && part.missingFields.length === 0 && isListingAllowed(part, "retail_only")) counts.generatorUsable += 1;
          collected.push(part);
        } catch (error) {
          details += 1;
          counts.detailAttempts += 1;
          counts.errors += 1;
          errors.push(`${target.label} pcode=${item.sourceProductCode}: ${message(error)}`);
        }
      }
    } catch (error) {
      counts.errors += 1;
      errors.push(`${target.label} cate=${target.categoryId}: ${message(error)}`);
    }
    categoryCounts.set(key, counts);
  }

  const newParts = collected.filter((p) => !existingCodes.has(`${p.category}:${p.sourceProductCode}`));
  const benchmarkOverridesBefore = await readJson<unknown>(BENCHMARK_OVERRIDES_PATH, {});

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    remaining,
    pilot,
    requestsBound: {
      maxListPages: MAX_LIST_PAGES,
      maxUniqueDetailPages: detailBudget,
      maxUniqueDetailsPerTarget: perTargetBudget,
      fetchAttempts,
      timeoutMs: requestTimeoutMs,
      delayMs: MIN_DELAY_MS
    },
    listPages: targets.length,
    detailAttempts: details,
    httpStatusCounts,
    transportFailures,
    uniqueCoreProductsParsed: collected.length,
    coreProducts: collected.length,
    generatorUsableProducts: collected.filter((p) => p.dataQuality !== "incomplete" && p.missingFields.length === 0 && isListingAllowed(p, "retail_only")).length,
    incompleteProducts: collected.filter((p) => p.dataQuality === "incomplete").length,
    newCoreProducts: newParts.length,
    newGeneratorUsableProducts: newParts.filter((p) => p.dataQuality !== "incomplete" && p.missingFields.length === 0 && isListingAllowed(p, "retail_only")).length,
    categoryCounts: Object.fromEntries(categoryCounts),
    errors: errors.slice(0, 30),
    errorCount: errors.length
  }, null, 2));

  if (apply && newParts.length > 0) {
    // Write raw persisted records directly. loadCatalog()/upsertCatalog() return
    // benchmark-enriched rows, so using them here could bake local overlays into
    // the base catalog. This path merges against raw repository rows instead.
    const latestExisting = await readCatalogRecords();
    const latestKeys = new Set(latestExisting.map((p) => `${p.category}:${p.sourceProductCode ?? p.id}`));
    const safeNewParts = newParts.filter((p) => !latestKeys.has(`${p.category}:${p.sourceProductCode ?? p.id}`));
    await writeCatalogRecords(mergeCatalog(latestExisting, safeNewParts));
    const benchmarkOverridesAfter = await readJson<unknown>(BENCHMARK_OVERRIDES_PATH, {});
    if (JSON.stringify(benchmarkOverridesBefore) !== JSON.stringify(benchmarkOverridesAfter)) {
      throw new Error("Benchmark overrides changed during catalog write; inspect persistence immediately.");
    }
    console.log(`Applied ${safeNewParts.length} new products; benchmark override file unchanged.`);
  }
}

async function getRobots() {
  // Robots fetch counts as a request and is subject to the same delay policy.
  const wait = Math.max(0, MIN_DELAY_MS - (Date.now() - lastRequestAt));
  if (wait) await sleep(wait);
  lastRequestAt = Date.now();
  const response = await fetch("https://prod.danawa.com/robots.txt", {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`robots.txt fetch failed: HTTP ${response.status}`);
  return response.text();
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

main().catch((error) => {
  console.error(message(error));
  process.exitCode = 1;
});
