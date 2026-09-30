import "dotenv/config";
import { copyFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { AccessoryCategory, AccessoryItem, Part } from "../shared/types";
import { DANAWA_ACCESSORY_CATEGORIES, parseDanawaAccessoryPage } from "../server/accessory-crawler";
import { fetchDanawaHtml, type DanawaCrawlerOptions, type DanawaListItem, isAllowedSourceUrl } from "../server/danawa";
import { upsertAccessories } from "../server/accessories";
import {
  BUNDLE_MEMBERS_SOURCE,
  bundleProductEvidenceEdges,
  canonicalAccessoryDetailUrl,
  classifyDetailPageIdentity,
  detailPagePCodeEvidence,
  safeDetailPCodeSourceObjects,
  isDanawaPCode,
  trustedDanawaImageUrl,
  validateBundlePageObservation,
  type BundleMembersArtifact,
  type BundleSortMethod
} from "./danawa-accessory-bundle-members";
import { readAccessoryCatalogRecords, readCatalogRecords } from "../server/repository";
import { DATA_DIR, readJson, writeJson } from "../server/storage";

const USER_AGENT = "PCSupporterAccessoryBundleMembers/1.0 (public Danawa product detail pages)";
const MIN_DELAY_MS = 900;
const DEFAULT_LIMIT = 50;
const APPLY_BATCH_SIZE = 25;
const BUNDLE_IMPORT_STATE_SOURCE = "verified Danawa accessory bundle member detail import state";
let lastSourceRequestAt = 0;

const { values, positionals } = parseArgs({
  options: {
    apply: { type: "boolean", default: false },
    all: { type: "boolean", default: false },
    category: { type: "string" },
    limit: { type: "string" },
    "retry-quarantined": { type: "boolean", default: false },
    "resume-pending": { type: "boolean", default: false },
    "product-code": { type: "string", multiple: true }
  },
  strict: true,
  allowPositionals: true
});

if (positionals.length > 0) throw new Error("Use only --apply, --all, --category=ACCESSORY_CATEGORY, --limit=N, --product-code=PCODE[,PCODE...], --retry-quarantined, and --resume-pending.");
if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is required; the catalogs live only in PostgreSQL.");
if (values.all && (values.limit || values["product-code"]?.length)) throw new Error("Choose --all, --limit=N, or explicit --product-code selections.");
if (values.limit && values["product-code"]?.length) throw new Error("Choose --limit=N or explicit --product-code selections.");
if (values["resume-pending"] && (!values.apply || values.all || values.limit || values["product-code"]?.length)) throw new Error("--resume-pending requires --apply and must run without product selection options.");

const categoryFilter = values.category as AccessoryCategory | undefined;
if (categoryFilter && !DANAWA_ACCESSORY_CATEGORIES.some((entry) => entry.category === categoryFilter)) throw new Error(`Unknown accessory category: ${categoryFilter}`);
const configuredLimit = values.limit === undefined ? DEFAULT_LIMIT : Number(values.limit);
if (!values.all && !values["product-code"]?.length && (!Number.isSafeInteger(configuredLimit) || configuredLimit < 1 || configuredLimit > 500)) {
  throw new Error("--limit must be an integer from 1 to 500.");
}

const requestedProductCodes = [...new Set((values["product-code"] ?? []).flatMap((value) => value.split(",").map((code) => code.trim())).filter(Boolean))];
for (const code of requestedProductCodes) if (!isDanawaPCode(code)) throw new Error(`Invalid --product-code PCode: ${code}`);

const bundleArtifactPath = join(DATA_DIR, "danawa-accessory-bundle-members.json");
const importStatePath = join(DATA_DIR, "accessory-bundle-detail-import-state.json");

type SourceEvidenceRef = {
  kind: "bundle_member" | "list_parent";
  parentProductCode: string;
  sortMethod: BundleSortMethod;
  page: number;
  fetchedAt: string;
};
type BundleImportStateEntry = {
  productCode: string;
  category: AccessoryCategory;
  categoryId: string;
  status: "imported" | "quarantined";
  updatedAt: string;
  sourceEvidence: SourceEvidenceRef[];
  reason?: string;
  identityEvidence?: ReturnType<typeof detailPagePCodeEvidence>;
  itemId?: string;
};
type PendingVerifiedItem = {
  productCode: string;
  sourceEvidence: SourceEvidenceRef[];
  identityEvidence: ReturnType<typeof detailPagePCodeEvidence>;
  verifiedItem: AccessoryItem;
};
type BundleImportState = {
  schemaVersion: 1;
  source: typeof BUNDLE_IMPORT_STATE_SOURCE;
  updatedAt: string;
  entries: Record<string, BundleImportStateEntry>;
  pendingBatch?: {
    batchNumber: number;
    startedAt: string;
    phase: "ready-to-commit" | "hard-stop";
    stoppedAt?: string;
    stoppedAtProductCode?: string;
    stopReason?: string;
    plannedProductCodes: string[];
    uncommittedProductCodes: string[];
    verifiedActualParsedItems: PendingVerifiedItem[];
    quarantinedEntries: BundleImportStateEntry[];
  };
  lastBatch?: { batchNumber: number; committedAt: string; importedCount: number; quarantinedCount: number };
};

function emptyBundleImportState(): BundleImportState {
  return { schemaVersion: 1, source: BUNDLE_IMPORT_STATE_SOURCE, updatedAt: new Date().toISOString(), entries: {} };
}

async function createImportBackup() {
  const backupDirectory = await mkdtemp(join(tmpdir(), "pc-supporter-bundle-member-import-"));
  try { await copyFile(importStatePath, join(backupDirectory, "accessory-bundle-detail-import-state.json")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  await writeJson(join(backupDirectory, "accessories.json"), (await readAccessoryCatalogRecords()).items);
  return backupDirectory;
}

async function readRequiredJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function robotsDisallows(robots: string, path: string) {
  let wildcardGroup = false;
  let groupHasRules = false;
  for (const rawLine of robots.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (groupHasRules) { wildcardGroup = false; groupHasRules = false; }
      if (!groupHasRules) wildcardGroup = value === "*";
    } else if ((key === "allow" || key === "disallow") && wildcardGroup) {
      groupHasRules = true;
      if (key === "disallow" && value && path.startsWith(value)) return true;
    }
  }
  return false;
}

async function preflightInfoRobots() {
  const response = await fetch("https://prod.danawa.com/robots.txt", {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(8_000)
  });
  if (response.status === 403 || response.status === 429) throw new Error(`STOP: robots.txt returned HTTP ${response.status}.`);
  if (!response.ok) throw new Error(`Could not verify Danawa robots.txt: HTTP ${response.status}.`);
  const robots = await response.text();
  if (robotsDisallows(robots, "/info/")) throw new Error("STOP: robots.txt disallows public product detail pages.");
  lastSourceRequestAt = Date.now();
}

function sameSet(left: Array<string | number> | undefined, right: Array<string | number> | undefined) {
  if (!left?.length || !right?.length) return true;
  return JSON.stringify([...new Set(left.map(String))].sort()) === JSON.stringify([...new Set(right.map(String))].sort());
}

type MembershipEvidence = {
  category: AccessoryCategory;
  categoryId: string;
  productCode: string;
  sourceEvidence: SourceEvidenceRef[];
};

function bundleImportStateKey(categoryId: string, productCode: string) {
  return `${categoryId}:${productCode}`;
}

function quarantineEntry(evidence: MembershipEvidence, reason: string, identityEvidence?: ReturnType<typeof detailPagePCodeEvidence>): BundleImportStateEntry {
  return {
    productCode: evidence.productCode,
    category: evidence.category,
    categoryId: evidence.categoryId,
    status: "quarantined",
    updatedAt: new Date().toISOString(),
    sourceEvidence: evidence.sourceEvidence,
    reason,
    ...(identityEvidence ? { identityEvidence } : {})
  };
}

function safeFetchErrorReason(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/https?:\/\/\S+/g, "[source URL]").slice(0, 240);
}

function hardStopFetchError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:STOP:|\b403\b|\b429\b|redirect rejected|captcha|challenge|접근이 제한|자동입력 방지)/i.test(message);
}

class BundleDetailHardStop extends Error {
  constructor(readonly productCode: string, readonly reason: string, readonly identityEvidence?: ReturnType<typeof detailPagePCodeEvidence>) {
    super(`STOP: ${reason} for ${productCode}.`);
    this.name = "BundleDetailHardStop";
  }
}

function collectMemberEvidence(artifact: BundleMembersArtifact) {
  if (artifact.schemaVersion !== 1 || artifact.source !== BUNDLE_MEMBERS_SOURCE || !artifact.categories || !Number.isFinite(Date.parse(artifact.updatedAt))) {
    throw new Error("Unsupported or invalid Danawa accessory bundle member artifact.");
  }
  const byCode = new Map<string, MembershipEvidence>();
  const categoryByCode = new Map<string, AccessoryCategory>();
  for (const [categoryId, categoryArtifact] of Object.entries(artifact.categories)) {
    const config = DANAWA_ACCESSORY_CATEGORIES.find((entry) => entry.categoryId === categoryId);
    if (!config || categoryArtifact.categoryId !== categoryId || categoryArtifact.category !== config.category) {
      throw new Error(`Bundle artifact source category identity mismatch at ${categoryId}.`);
    }
    if (categoryFilter && categoryArtifact.category !== categoryFilter) continue;
    for (const [sortMethod, pages] of Object.entries(categoryArtifact.pagesBySort)) {
      for (const [pageKey, page] of Object.entries(pages)) {
        const pageNumber = Number(pageKey);
        validateBundlePageObservation(page, sortMethod, pageNumber, categoryId);
        for (const edge of bundleProductEvidenceEdges(page)) {
          const parent = page.parents.find((candidate) => candidate.parentProductCode === edge.parentProductCode);
          if (!parent) throw new Error(`Missing parent row for product evidence PCode ${edge.productCode}.`);
          const member = edge.member;
          const previousCategory = categoryByCode.get(edge.productCode);
          if (previousCategory && previousCategory !== config.category) {
            throw new Error(`STOP: product PCode ${edge.productCode} appears in conflicting accessory categories.`);
          }
          categoryByCode.set(edge.productCode, config.category);
          const evidence = {
            kind: edge.kind,
            parentProductCode: parent.parentProductCode,
            sortMethod: sortMethod as BundleSortMethod,
            page: pageNumber,
            fetchedAt: page.fetchedAt
          };
          const existing = byCode.get(edge.productCode);
          if (existing) {
            if (!existing.sourceEvidence.some((entry) => entry.kind === evidence.kind
              && entry.parentProductCode === evidence.parentProductCode
              && entry.sortMethod === evidence.sortMethod && entry.page === evidence.page)) {
              existing.sourceEvidence.push(evidence);
            }
          } else {
            byCode.set(edge.productCode, { category: config.category, categoryId, productCode: edge.productCode, sourceEvidence: [evidence] });
          }
          if (member?.sourceCategoryCodes?.length && parent.sourceCategoryCodes?.length
            && !sameSet(member.sourceCategoryCodes, parent.sourceCategoryCodes)) {
            throw new Error(`STOP: member ${edge.productCode} carries a source category code conflict with parent ${parent.parentProductCode}.`);
          }
          if (member?.sourceCategoryNames?.length && parent.sourceCategoryNames?.length
            && !sameSet(member.sourceCategoryNames, parent.sourceCategoryNames)) {
            throw new Error(`STOP: member ${edge.productCode} carries a source category label conflict with parent ${parent.parentProductCode}.`);
          }
        }
      }
    }
  }
  return byCode;
}

const [bundleArtifact, accessorySnapshot, coreParts, storedImportState] = await Promise.all([
  readRequiredJson<BundleMembersArtifact>(bundleArtifactPath),
  readAccessoryCatalogRecords(),
  readCatalogRecords(),
  readJson<BundleImportState>(importStatePath, emptyBundleImportState())
]);
const accessories = accessorySnapshot.items;
if (storedImportState.schemaVersion !== 1 || storedImportState.source !== BUNDLE_IMPORT_STATE_SOURCE || !storedImportState.entries) {
  throw new Error("Unsupported or invalid bundle member import state artifact.");
}
const importState = storedImportState;
const memberEvidenceByCode = collectMemberEvidence(bundleArtifact);
const coreCodes = new Set(coreParts.flatMap((part) => part.sourceProductCode ? [part.sourceProductCode] : []));
const accessoryRowsByCode = new Map<string, AccessoryItem[]>();
for (const item of accessories) {
  if (item.sourceProductCode) accessoryRowsByCode.set(item.sourceProductCode, [...(accessoryRowsByCode.get(item.sourceProductCode) ?? []), item]);
}

if (values["resume-pending"]) {
  const pending = importState.pendingBatch;
  if (!values.apply || !pending) throw new Error("--resume-pending requires --apply and an existing pending batch for review.");
  const pendingItems = pending.verifiedActualParsedItems.map(({ productCode, verifiedItem }) => {
    const config = DANAWA_ACCESSORY_CATEGORIES.find((entry) => entry.category === verifiedItem.category && entry.categoryId === verifiedItem.sourceCategoryId);
    if (!config || !isDanawaPCode(productCode) || verifiedItem.source !== "danawa" || verifiedItem.sourceProductCode !== productCode
      || verifiedItem.id !== `accessory-${verifiedItem.category}-${productCode}`
      || verifiedItem.danawaUrl !== canonicalAccessoryDetailUrl(productCode, config.categoryId)) {
      throw new Error(`STOP: pending parsed product identity is invalid for ${productCode}.`);
    }
    if (coreCodes.has(productCode)) throw new Error(`STOP: pending bundle member ${productCode} conflicts with a core catalog product.`);
    const current = accessoryRowsByCode.get(productCode) ?? [];
    if (current.length > 1 || (current.length === 1 && (current[0].source !== "danawa" || current[0].category !== verifiedItem.category || current[0].sourceCategoryId !== verifiedItem.sourceCategoryId))) {
      throw new Error(`STOP: pending bundle member ${productCode} conflicts with the current accessory catalog.`);
    }
    return verifiedItem;
  });
  const backupDirectory = await createImportBackup();
  if (pendingItems.length > 0) await upsertAccessories(pendingItems);
  for (const item of pendingItems) {
    const key = `${item.sourceCategoryId}:${item.sourceProductCode}`;
    const previous = importState.entries[key];
    importState.entries[key] = {
      productCode: item.sourceProductCode!,
      category: item.category,
      categoryId: item.sourceCategoryId!,
      status: "imported",
      updatedAt: new Date().toISOString(),
      sourceEvidence: pending.verifiedActualParsedItems.find((candidate) => candidate.productCode === item.sourceProductCode)?.sourceEvidence ?? previous?.sourceEvidence ?? [],
      itemId: item.id
    };
  }
  for (const entry of pending.quarantinedEntries) importState.entries[`${entry.categoryId}:${entry.productCode}`] = entry;
  importState.updatedAt = new Date().toISOString();
  importState.lastBatch = { batchNumber: pending.batchNumber, committedAt: importState.updatedAt, importedCount: pendingItems.length, quarantinedCount: pending.quarantinedEntries.length };
  delete importState.pendingBatch;
  await writeJson(importStatePath, importState);
  console.log(JSON.stringify({
    mode: "resume-pending-applied",
    backupDirectory,
    importedCount: pendingItems.length,
    quarantinedCount: pending.quarantinedEntries.length,
    pendingBatchCleared: true
  }, null, 2));
  process.exit(0);
}
if (values.apply && importState.pendingBatch) {
  throw new Error(`STOP: pending batch ${importState.pendingBatch.batchNumber} must be reviewed and resumed explicitly before another --apply run.`);
}

const missingEvidenceCodes = requestedProductCodes.filter((code) => !memberEvidenceByCode.has(code));
if (missingEvidenceCodes.length) throw new Error(`Requested PCode(s) are not present in the verified bundle/list parent artifact: ${missingEvidenceCodes.join(", ")}`);
const inventory = [...memberEvidenceByCode.values()].sort((left, right) => left.productCode.localeCompare(right.productCode));
const candidates: MembershipEvidence[] = [];
const alreadyPresent: string[] = [];
const skippedQuarantined: string[] = [];
const skippedImportedState: string[] = [];
const skippedPending: string[] = [];
const pendingProductCodes = new Set(importState.pendingBatch?.uncommittedProductCodes ?? []);
for (const evidence of inventory) {
  if (coreCodes.has(evidence.productCode)) throw new Error(`STOP: bundle member PCode ${evidence.productCode} conflicts with a core catalog product.`);
  const matches = accessoryRowsByCode.get(evidence.productCode) ?? [];
  if (matches.length > 1) throw new Error(`STOP: accessory catalog has duplicate source PCode ${evidence.productCode}.`);
  const sameIdManual = accessories.find((item) => item.id === `accessory-${evidence.category}-${evidence.productCode}` && item.source !== "danawa");
  if (sameIdManual) throw new Error(`STOP: bundle member PCode ${evidence.productCode} conflicts with a manual accessory row.`);
  const current = matches[0];
  if (current) {
    if (current.source !== "danawa" || current.category !== evidence.category || current.sourceCategoryId !== evidence.categoryId) {
      throw new Error(`STOP: bundle member PCode ${evidence.productCode} conflicts with existing accessory source/category identity.`);
    }
    alreadyPresent.push(evidence.productCode);
    continue;
  }
  const priorState = importState.entries[`${evidence.categoryId}:${evidence.productCode}`];
  if (priorState?.status === "quarantined" && !values["retry-quarantined"]) {
    skippedQuarantined.push(evidence.productCode);
    continue;
  }
  if (priorState?.status === "imported") {
    skippedImportedState.push(evidence.productCode);
    continue;
  }
  if (pendingProductCodes.has(evidence.productCode)) {
    skippedPending.push(evidence.productCode);
    continue;
  }
  candidates.push(evidence);
}

const selectedCandidates = requestedProductCodes.length
  ? requestedProductCodes.flatMap((code) => candidates.filter((candidate) => candidate.productCode === code))
  : values.all ? candidates : candidates.slice(0, configuredLimit);
if (requestedProductCodes.length && selectedCandidates.length !== requestedProductCodes.filter((code) =>
  !alreadyPresent.includes(code) && !skippedQuarantined.includes(code) && !skippedImportedState.includes(code) && !skippedPending.includes(code)
).length) {
  throw new Error("Some explicitly selected PCode(s) are not eligible for detail verification; inspect category conflict or quarantine state.");
}
if (selectedCandidates.length === 0) {
  console.log(JSON.stringify({
    mode: "dry-run-no-pending-candidates",
    selectedProductCodes: requestedProductCodes,
    alreadyPresentCount: alreadyPresent.length,
    skippedQuarantinedCount: skippedQuarantined.length,
    skippedImportedStateCount: skippedImportedState.length,
    skippedPendingCount: skippedPending.length,
    outputWritten: false
  }, null, 2));
  process.exit(0);
}

await preflightInfoRobots();
type VerifiedDetailResult = {
  status: "verified";
  evidence: MembershipEvidence;
  item: AccessoryItem;
  identityEvidence: ReturnType<typeof detailPagePCodeEvidence>;
};
type QuarantinedDetailResult = {
  status: "quarantined";
  entry: BundleImportStateEntry;
};
const verifyCandidate = async (evidence: MembershipEvidence): Promise<VerifiedDetailResult | QuarantinedDetailResult> => {
  const url = canonicalAccessoryDetailUrl(evidence.productCode, evidence.categoryId);
  const parsedUrl = new URL(url);
  if (!isAllowedSourceUrl(parsedUrl.href) || parsedUrl.pathname !== "/info/" || parsedUrl.searchParams.get("pcode") !== evidence.productCode
    || parsedUrl.searchParams.get("cate") !== evidence.categoryId) {
    throw new BundleDetailHardStop(evidence.productCode, "canonical-request-url-mismatch");
  }
  const waitMs = Math.max(0, MIN_DELAY_MS - (Date.now() - lastSourceRequestAt));
  if (waitMs > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, waitMs));
  lastSourceRequestAt = Date.now();
  let html: string;
  try {
    html = await fetchDanawaHtml(url, { timeoutMs: 20_000, retries: 2, userAgent: USER_AGENT } satisfies DanawaCrawlerOptions);
  } catch (error) {
    if (hardStopFetchError(error)) throw new BundleDetailHardStop(evidence.productCode, "source-blocked-or-redirected");
    return {
      status: "quarantined",
      entry: quarantineEntry(evidence, `detail-fetch-failed:${safeFetchErrorReason(error)}`)
    };
  }
  const identity = classifyDetailPageIdentity(html, evidence.productCode, evidence.categoryId);
  if (identity.status === "hard-stop") throw new BundleDetailHardStop(evidence.productCode, identity.reason, identity.evidence);
  if (identity.status === "quarantined") {
    return { status: "quarantined", entry: quarantineEntry(evidence, identity.reason, identity.evidence) };
  }
  const listItem: DanawaListItem = { name: "", url, sourceProductCode: evidence.productCode };
  const parsed = parseDanawaAccessoryPage(evidence.category, listItem, html, evidence.categoryId);
  if (parsed.sourceProductCode !== evidence.productCode || parsed.category !== evidence.category || parsed.sourceCategoryId !== evidence.categoryId) {
    throw new BundleDetailHardStop(evidence.productCode, "detail-parser-returned-mismatched-source-identity", identity.evidence);
  }
  if (!parsed.name.trim()) {
    return { status: "quarantined", entry: quarantineEntry(evidence, "detail-title-missing", identity.evidence) };
  }
  parsed.imageUrl = trustedDanawaImageUrl(parsed.imageUrl);
  if (parsed.priceWon !== undefined && parsed.priceWon > 0) parsed.priceCheckedAt = new Date().toISOString();
  return { status: "verified", evidence, item: parsed, identityEvidence: identity.evidence };
};

const verifiedRows: Array<Record<string, unknown>> = [];
const quarantinedRows: BundleImportStateEntry[] = [];
const batchSummaries: Array<{ batchNumber: number; plannedCount: number; verifiedCount: number; quarantinedCount: number; importedCount: number }> = [];
let importedCount = 0;
let quarantinedCount = 0;
let batchNumber = importState.lastBatch?.batchNumber ?? 0;
const backupDirectory = values.apply ? await createImportBackup() : undefined;

for (let offset = 0; offset < selectedCandidates.length; offset += APPLY_BATCH_SIZE) {
  batchNumber += 1;
  const batch = selectedCandidates.slice(offset, offset + APPLY_BATCH_SIZE);
  const startedAt = new Date().toISOString();
  const verifiedActualParsedItems: PendingVerifiedItem[] = [];
  const batchQuarantined: BundleImportStateEntry[] = [];
  let hardStop: BundleDetailHardStop | undefined;

  for (const evidence of batch) {
    try {
      const result = await verifyCandidate(evidence);
      if (result.status === "quarantined") {
        batchQuarantined.push(result.entry);
        quarantinedRows.push(result.entry);
        continue;
      }
      const { item, identityEvidence } = result;
      verifiedActualParsedItems.push({ productCode: evidence.productCode, sourceEvidence: evidence.sourceEvidence, identityEvidence, verifiedItem: item });
      verifiedRows.push({
        productCode: evidence.productCode,
        category: evidence.category,
        result: "verified",
        sourceKinds: [...new Set(evidence.sourceEvidence.map((source) => source.kind))],
        sourceParents: [...new Set(evidence.sourceEvidence.map((source) => source.parentProductCode))].sort(),
        sortMethod: evidence.sourceEvidence[0].sortMethod,
        page: evidence.sourceEvidence[0].page,
        verifiedName: item.name,
        dataQuality: item.dataQuality,
        specFieldCount: Object.keys(item.specs).length,
        ...(item.priceWon !== undefined ? { priceWon: item.priceWon } : {}),
        ...(item.priceCheckedAt ? { priceCheckedAt: item.priceCheckedAt } : {}),
        ...(item.imageUrl ? { imageUrl: item.imageUrl } : {})
      });
    } catch (error) {
      if (!(error instanceof BundleDetailHardStop)) throw error;
      hardStop = error;
      const evidence = batch.find((candidate) => candidate.productCode === error.productCode)!;
      const hardStopEntry = quarantineEntry(evidence, `hard-stop:${error.reason}`, error.identityEvidence);
      batchQuarantined.push(hardStopEntry);
      quarantinedRows.push(hardStopEntry);
      break;
    }
  }

  if (hardStop) {
    if (values.apply) {
      for (const entry of batchQuarantined) importState.entries[bundleImportStateKey(entry.categoryId, entry.productCode)] = entry;
      const now = new Date().toISOString();
      importState.pendingBatch = {
        batchNumber,
        startedAt,
        phase: "hard-stop",
        stoppedAt: now,
        stoppedAtProductCode: hardStop.productCode,
        stopReason: hardStop.reason,
        plannedProductCodes: batch.map((candidate) => candidate.productCode),
        uncommittedProductCodes: selectedCandidates.slice(offset).map((candidate) => candidate.productCode),
        verifiedActualParsedItems,
        quarantinedEntries: batchQuarantined
      };
      importState.updatedAt = now;
      await writeJson(importStatePath, importState);
    }
    const stopped = {
      mode: values.apply ? "apply-stopped-hard-stop" : "dry-run-stopped-hard-stop",
      stopReason: hardStop.reason,
      stoppedAtProductCode: hardStop.productCode,
      verifiedActualParsedItemsInUncommittedBatch: verifiedActualParsedItems.length,
      quarantinedInUncommittedBatch: batchQuarantined.length,
      uncommittedProductCodes: selectedCandidates.slice(offset).map((candidate) => candidate.productCode),
      previouslyCommittedAccessoryCount: importedCount,
      pendingBatchCheckpointWritten: Boolean(values.apply),
      importStatePath: values.apply ? importStatePath : undefined
    };
    console.log(JSON.stringify(stopped, null, 2));
    throw new Error(`STOP: ${hardStop.message}`);
  }

  let batchImportedCount = 0;
  if (values.apply) {
    for (const entry of batchQuarantined) importState.entries[bundleImportStateKey(entry.categoryId, entry.productCode)] = entry;
    if (verifiedActualParsedItems.length > 0) {
      const now = new Date().toISOString();
      importState.pendingBatch = {
        batchNumber,
        startedAt,
        phase: "ready-to-commit",
        plannedProductCodes: batch.map((candidate) => candidate.productCode),
        uncommittedProductCodes: verifiedActualParsedItems.map((item) => item.productCode),
        verifiedActualParsedItems,
        quarantinedEntries: batchQuarantined
      };
      importState.updatedAt = now;
      await writeJson(importStatePath, importState);

      const latestAccessories = (await readAccessoryCatalogRecords()).items;
      const latestAccessoryByCode = new Map<string, AccessoryItem[]>();
      for (const item of latestAccessories) {
        if (item.sourceProductCode) latestAccessoryByCode.set(item.sourceProductCode, [...(latestAccessoryByCode.get(item.sourceProductCode) ?? []), item]);
      }
      const newVerifiedItems: AccessoryItem[] = [];
      for (const { productCode, verifiedItem } of verifiedActualParsedItems) {
        if (coreCodes.has(productCode)) throw new Error(`STOP: verified member PCode ${productCode} now conflicts with core catalog before batch apply.`);
        const existing = latestAccessoryByCode.get(productCode) ?? [];
        if (existing.length > 1 || (existing.length === 1 && (existing[0].source !== "danawa" || existing[0].category !== verifiedItem.category || existing[0].sourceCategoryId !== verifiedItem.sourceCategoryId))) {
          throw new Error(`STOP: verified member PCode ${productCode} now conflicts with accessory catalog before batch apply.`);
        }
        if (existing.length === 0) newVerifiedItems.push(verifiedItem);
      }
      if (newVerifiedItems.length > 0) await upsertAccessories(newVerifiedItems);
      batchImportedCount = newVerifiedItems.length;
      importedCount += batchImportedCount;
      for (const { productCode, verifiedItem, sourceEvidence } of verifiedActualParsedItems) {
        const key = bundleImportStateKey(verifiedItem.sourceCategoryId!, productCode);
        importState.entries[key] = {
          productCode,
          category: verifiedItem.category,
          categoryId: verifiedItem.sourceCategoryId!,
          status: "imported",
          updatedAt: new Date().toISOString(),
          sourceEvidence,
          itemId: verifiedItem.id
        };
      }
      delete importState.pendingBatch;
    }
    quarantinedCount += batchQuarantined.length;
    importState.updatedAt = new Date().toISOString();
    importState.lastBatch = { batchNumber, committedAt: importState.updatedAt, importedCount: batchImportedCount, quarantinedCount: batchQuarantined.length };
    await writeJson(importStatePath, importState);
  } else {
    importedCount += verifiedActualParsedItems.length;
    quarantinedCount += batchQuarantined.length;
  }

  const batchSummary = { batchNumber, plannedCount: batch.length, verifiedCount: verifiedActualParsedItems.length, quarantinedCount: batchQuarantined.length, importedCount: batchImportedCount };
  batchSummaries.push(batchSummary);
  console.log(JSON.stringify({ progress: batchSummary, mode: values.apply ? "apply" : "dry-run" }));
}

const report = {
  mode: values.apply ? "apply-complete" : "dry-run-source-verified",
  bundleArtifact: "data/danawa-accessory-bundle-members.json",
  bundleArtifactUpdatedAt: bundleArtifact.updatedAt,
  importStatePath: values.apply ? importStatePath : undefined,
  artifactUniqueObservedProductPCodes: memberEvidenceByCode.size,
  artifactUniqueBundleMemberPCodes: new Set(Object.values(bundleArtifact.categories).flatMap((category) => Object.values(category.pagesBySort).flatMap((pages) => Object.values(pages).flatMap((page) => page.parents.flatMap((parent) => parent.members.map((member) => member.memberProductCode)))))).size,
  artifactUniqueListParentPCodes: new Set(Object.values(bundleArtifact.categories).flatMap((category) => Object.values(category.pagesBySort).flatMap((pages) => Object.values(pages).flatMap((page) => page.parents.map((parent) => parent.parentProductCode))))).size,
  selectedMissingProductPCodes: selectedCandidates.map((candidate) => candidate.productCode),
  alreadyPresentProductCount: alreadyPresent.length,
  alreadyPresentProductPCodeExamples: alreadyPresent.slice(0, 5),
  skippedQuarantinedCount: skippedQuarantined.length,
  skippedImportedStateCount: skippedImportedState.length,
  skippedPendingCount: skippedPending.length,
  verifiedDetails: verifiedRows.length,
  quarantinedDetails: quarantinedRows.length,
  verifiedRows,
  quarantinedRows,
  batches: batchSummaries,
  importedThisRun: values.apply ? importedCount : 0,
  currentAccessoryCount: accessories.length,
  projectedAccessoryCount: accessories.length + verifiedRows.length,
  sourceListStatus: "partial; bundle member evidence is tracked separately from declared page group totals",
  detailCoverage: "Only actual product detail page fields were parsed; parent geometry/spec/price/image were not copied.",
  catalogWrites: Boolean(values.apply && importedCount > 0),
  importStateWritten: Boolean(values.apply)
};

console.log(JSON.stringify(report, null, 2));
