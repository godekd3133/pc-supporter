import "dotenv/config";
import { copyFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { AccessoryCategory, AccessoryItem, DanawaCrawlManifest, Part } from "../shared/types";
import { DANAWA_ACCESSORY_CATEGORIES, parseDanawaAccessoryPage } from "../server/accessory-crawler";
import { fetchDanawaHtml, type DanawaCrawlerOptions, type DanawaListItem, isAllowedSourceUrl } from "../server/danawa";
import { upsertAccessories } from "../server/accessories";
import {
  BUNDLE_MEMBERS_SOURCE,
  bundleProductEvidenceEdges,
  canonicalAccessoryDetailUrl,
  detailPageMatchesPCode,
  detailPagePCodeEvidence,
  safeDetailPCodeSourceObjects,
  isDanawaPCode,
  trustedDanawaImageUrl,
  validateBundlePageObservation,
  type BundleMembersArtifact,
  type BundleSortMethod
} from "./danawa-accessory-bundle-members";
import { ACCESSORIES_PATH, CATALOG_PATH, DATA_DIR, readJson } from "../server/storage";

const USER_AGENT = "PCSupporterAccessoryBundleMembers/1.0 (public Danawa product detail pages)";
const MIN_DELAY_MS = 900;
const DEFAULT_LIMIT = 50;
let lastSourceRequestAt = 0;

const { values, positionals } = parseArgs({
  options: {
    apply: { type: "boolean", default: false },
    all: { type: "boolean", default: false },
    category: { type: "string" },
    limit: { type: "string" },
    "product-code": { type: "string", multiple: true }
  },
  strict: true,
  allowPositionals: true
});

if (positionals.length > 0) throw new Error("Use only --apply, --all, --category=ACCESSORY_CATEGORY, --limit=N, and --product-code=PCODE[,PCODE...].");
if (process.env.DATABASE_URL?.trim()) throw new Error("Bundle member import is file-backed only; unset DATABASE_URL before running it.");
if (DATA_DIR !== resolve(process.cwd(), "data")) throw new Error("This importer is limited to this checkout's data directory; unset PC_SUPPORTER_DATA_DIR.");
if (values.all && (values.limit || values["product-code"]?.length)) throw new Error("Choose --all, --limit=N, or explicit --product-code selections.");
if (values.limit && values["product-code"]?.length) throw new Error("Choose --limit=N or explicit --product-code selections.");

const categoryFilter = values.category as AccessoryCategory | undefined;
if (categoryFilter && !DANAWA_ACCESSORY_CATEGORIES.some((entry) => entry.category === categoryFilter)) throw new Error(`Unknown accessory category: ${categoryFilter}`);
const configuredLimit = values.limit === undefined ? DEFAULT_LIMIT : Number(values.limit);
if (!values.all && !values["product-code"]?.length && (!Number.isSafeInteger(configuredLimit) || configuredLimit < 1 || configuredLimit > 500)) {
  throw new Error("--limit must be an integer from 1 to 500.");
}

const requestedProductCodes = [...new Set((values["product-code"] ?? []).flatMap((value) => value.split(",").map((code) => code.trim())).filter(Boolean))];
for (const code of requestedProductCodes) if (!isDanawaPCode(code)) throw new Error(`Invalid --product-code PCode: ${code}`);

const bundleArtifactPath = join(DATA_DIR, "danawa-accessory-bundle-members.json");

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
  sourceEvidence: Array<{
    kind: "bundle_member" | "list_parent";
    parentProductCode: string;
    sortMethod: BundleSortMethod;
    page: number;
    fetchedAt: string;
  }>;
};

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

const [bundleArtifact, accessories, coreParts] = await Promise.all([
  readRequiredJson<BundleMembersArtifact>(bundleArtifactPath),
  readJson<AccessoryItem[]>(ACCESSORIES_PATH, []),
  readJson<Part[]>(CATALOG_PATH, [])
]);
const memberEvidenceByCode = collectMemberEvidence(bundleArtifact);
const coreCodes = new Set(coreParts.flatMap((part) => part.sourceProductCode ? [part.sourceProductCode] : []));
const accessoryRowsByCode = new Map<string, AccessoryItem[]>();
for (const item of accessories) {
  if (item.sourceProductCode) accessoryRowsByCode.set(item.sourceProductCode, [...(accessoryRowsByCode.get(item.sourceProductCode) ?? []), item]);
}

const missingEvidenceCodes = requestedProductCodes.filter((code) => !memberEvidenceByCode.has(code));
if (missingEvidenceCodes.length) throw new Error(`Requested PCode(s) are not present in the verified bundle/list parent artifact: ${missingEvidenceCodes.join(", ")}`);
const inventory = [...memberEvidenceByCode.values()].sort((left, right) => left.productCode.localeCompare(right.productCode));
const candidates: MembershipEvidence[] = [];
const alreadyPresent: string[] = [];
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
  candidates.push(evidence);
}

const selectedCandidates = requestedProductCodes.length
  ? requestedProductCodes.flatMap((code) => candidates.filter((candidate) => candidate.productCode === code))
  : values.all ? candidates : candidates.slice(0, configuredLimit);
if (requestedProductCodes.length && selectedCandidates.length !== requestedProductCodes.filter((code) => !alreadyPresent.includes(code)).length) {
  throw new Error("Some explicitly selected bundle member PCode(s) are already present; review existing catalog rows before importing.");
}
if (selectedCandidates.length === 0) throw new Error("No missing verified bundle member PCode is selected for detail verification.");

await preflightInfoRobots();
const verifiedItems: AccessoryItem[] = [];
const verificationRows: Array<{ productCode: string; category: AccessoryCategory; result: "verified"; sourceKinds: Array<"bundle_member" | "list_parent">; sourceParents: string[]; sortMethod: BundleSortMethod; page: number; verifiedName: string; dataQuality: string; specFieldCount: number; priceWon?: number; priceCheckedAt?: string; imageUrl?: string }> = [];
for (const evidence of selectedCandidates) {
  const url = canonicalAccessoryDetailUrl(evidence.productCode, evidence.categoryId);
  const parsedUrl = new URL(url);
  if (!isAllowedSourceUrl(parsedUrl.href) || parsedUrl.pathname !== "/info/" || parsedUrl.searchParams.get("pcode") !== evidence.productCode
    || parsedUrl.searchParams.get("cate") !== evidence.categoryId) {
    throw new Error(`STOP: bundle member ${evidence.productCode} canonical detail identity mismatch.`);
  }
  const waitMs = Math.max(0, MIN_DELAY_MS - (Date.now() - lastSourceRequestAt));
  if (waitMs > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, waitMs));
  lastSourceRequestAt = Date.now();
  const html = await fetchDanawaHtml(url, { timeoutMs: 20_000, retries: 2, userAgent: USER_AGENT } satisfies DanawaCrawlerOptions);
  if (/접근이 제한|비정상적인 접근|자동입력 방지|보안문자|로봇이 아닙니다|captcha/i.test(html)) {
    throw new Error(`STOP: product detail returned an access challenge for PCode ${evidence.productCode}.`);
  }
  if (!detailPageMatchesPCode(html, evidence.productCode, evidence.categoryId)) {
    const detailIdentity = detailPagePCodeEvidence(html);
    const sourceObjects = safeDetailPCodeSourceObjects(html, evidence.productCode);
    throw new Error(`STOP: product detail canonical/primary PCode identity mismatch for ${evidence.productCode}: ${JSON.stringify({ detailIdentity, matchingPCodeSourceObjects: sourceObjects })}`);
  }
  const listItem: DanawaListItem = { name: "", url, sourceProductCode: evidence.productCode };
  const parsed = parseDanawaAccessoryPage(evidence.category, listItem, html, evidence.categoryId);
  if (parsed.sourceProductCode !== evidence.productCode || parsed.category !== evidence.category || parsed.sourceCategoryId !== evidence.categoryId) {
    throw new Error(`STOP: accessory detail parser returned mismatched source identity for ${evidence.productCode}.`);
  }
  if (!parsed.name.trim()) throw new Error(`STOP: source detail title is missing for verified PCode ${evidence.productCode}.`);
  parsed.imageUrl = trustedDanawaImageUrl(parsed.imageUrl);
  if (parsed.priceWon !== undefined && parsed.priceWon > 0) parsed.priceCheckedAt = new Date().toISOString();
  verifiedItems.push(parsed);
  verificationRows.push({
    productCode: evidence.productCode,
    category: evidence.category,
    result: "verified",
    sourceKinds: [...new Set(evidence.sourceEvidence.map((source) => source.kind))],
    sourceParents: [...new Set(evidence.sourceEvidence.map((source) => source.parentProductCode))].sort(),
    sortMethod: evidence.sourceEvidence[0].sortMethod,
    page: evidence.sourceEvidence[0].page,
    verifiedName: parsed.name,
    dataQuality: parsed.dataQuality,
    specFieldCount: Object.keys(parsed.specs).length,
    ...(parsed.priceWon !== undefined ? { priceWon: parsed.priceWon } : {}),
    ...(parsed.priceCheckedAt ? { priceCheckedAt: parsed.priceCheckedAt } : {}),
    ...(parsed.imageUrl ? { imageUrl: parsed.imageUrl } : {})
  });
}

const report = {
  mode: values.apply ? "apply" : "dry-run-source-verified",
  bundleArtifact: "data/danawa-accessory-bundle-members.json",
  bundleArtifactUpdatedAt: bundleArtifact.updatedAt,
  artifactUniqueObservedProductPCodes: memberEvidenceByCode.size,
  artifactUniqueBundleMemberPCodes: new Set(Object.values(bundleArtifact.categories).flatMap((category) => Object.values(category.pagesBySort).flatMap((pages) => Object.values(pages).flatMap((page) => page.parents.flatMap((parent) => parent.members.map((member) => member.memberProductCode)))))).size,
  artifactUniqueListParentPCodes: new Set(Object.values(bundleArtifact.categories).flatMap((category) => Object.values(category.pagesBySort).flatMap((pages) => Object.values(pages).flatMap((page) => page.parents.map((parent) => parent.parentProductCode))))).size,
  selectedMissingProductPCodes: selectedCandidates.map((candidate) => candidate.productCode),
  alreadyPresentProductCount: alreadyPresent.length,
  alreadyPresentProductPCodeExamples: alreadyPresent.slice(0, 5),
  verifiedDetails: verificationRows.length,
  verifiedRows: verificationRows,
  currentAccessoryCount: accessories.length,
  projectedAccessoryCount: accessories.length + verifiedItems.length,
  sourceListStatus: "partial; bundle member evidence is tracked separately from declared page group totals",
  detailCoverage: "Only actual product detail page fields were parsed; parent geometry/spec/price/image were not copied.",
  outputWritten: Boolean(values.apply)
};

if (!values.apply) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const backupDirectory = await mkdtemp(join(tmpdir(), "pc-supporter-bundle-member-import-"));
  await copyFile(ACCESSORIES_PATH, join(backupDirectory, "accessories.json"));
  await upsertAccessories(verifiedItems);
  console.log(JSON.stringify({ ...report, backupDirectory, writtenAccessoryCount: verifiedItems.length }, null, 2));
}
