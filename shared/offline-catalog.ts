import { ACCESSORY_CATEGORIES, PART_CATEGORIES } from "./types";
import type { AccessoryCategory, AccessoryItem, Part, PartCategory } from "./types";

export const OFFLINE_CATALOG_SCHEMA_VERSION = 1 as const;
export const OFFLINE_CATALOG_KIND = "pc-supporter-offline-catalog" as const;
export const OFFLINE_CATALOG_ASSET_MAX_BYTES = 32 * 1024 * 1024;

export interface OfflineCatalogManifest {
  schemaVersion: typeof OFFLINE_CATALOG_SCHEMA_VERSION;
  kind: typeof OFFLINE_CATALOG_KIND;
  revision: string;
  snapshotAt: string;
  accessorySnapshotAt: string;
  catalogRevision: number;
  privateRecommendationEvidenceIncluded: false;
  generatedAt: string;
  selectedCategories: {
    parts: PartCategory[];
    accessories: AccessoryCategory[];
  };
  counts: {
    parts: number;
    accessories: number;
  };
  sourceHashes: {
    catalog: string;
    accessories: string;
  };
  bundleHashes: {
    parts: string;
    accessories: string;
  };
}

export interface OfflineCatalogSnapshot {
  manifest: OfflineCatalogManifest;
  parts: Part[];
  accessories: AccessoryItem[];
}

const normalizedSnapshots = new WeakMap<object, OfflineCatalogSnapshot>();

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

const RESTRICTED_BUNDLE_KEYS = new Set([
  "imageUrl", "benchmarkProvenance", "benchmarkSnapshot", "benchmarkEvidence", "gamingPerformanceEvidence",
  "cinebenchR23Single", "cinebenchR23Multi", "gpu3dmarkTimeSpyScore", "gpu3dmarkPortRoyalScore",
  "ownerToken", "ownerTokenHash", "recoveryCode", "recoveryCodeHash", "authorization", "password", "secret"
]);

function containsRestrictedBundleKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsRestrictedBundleKey);
  if (!record(value)) return false;
  return Object.entries(value).some(([key, item]) => RESTRICTED_BUNDLE_KEYS.has(key) || containsRestrictedBundleKey(item));
}

function validCategoryList<T extends string>(value: unknown, allowed: readonly T[]): value is T[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every((item) => typeof item === "string" && allowed.includes(item as T))
    && new Set(value).size === value.length;
}

function validItems(value: unknown, categories: readonly string[]): value is Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length === 0) return false;
  const ids = new Set<string>();
  return value.every((item) => {
    if (!record(item) || containsRestrictedBundleKey(item) || typeof item.id !== "string" || item.id.length === 0 || ids.has(item.id)) return false;
    if (typeof item.category !== "string" || !categories.includes(item.category)) return false;
    if (typeof item.name !== "string" || typeof item.updatedAt !== "string" || !record(item.specs)) return false;
    ids.add(item.id);
    return true;
  });
}

function frozenJsonCopy<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => frozenJsonCopy(item))) as unknown as T;
  }
  if (!record(value)) return value;

  const copy = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, frozenJsonCopy(item)]));
  return Object.freeze(copy) as unknown as T;
}

/**
 * Validate a raw local-offline snapshot at its trust boundary, then return an
 * immutable normalized copy. The normalized object is safe to reuse by identity
 * for later in-process requests; the caller's raw object is never cached.
 */
export function offlineCatalogSnapshotFromUnknown(value: unknown): OfflineCatalogSnapshot | undefined {
  if (!record(value)) return undefined;
  const normalized = normalizedSnapshots.get(value);
  if (normalized) return normalized;
  if (!record(value.manifest)) return undefined;
  const manifest = value.manifest;
  if (manifest.schemaVersion !== OFFLINE_CATALOG_SCHEMA_VERSION || manifest.kind !== OFFLINE_CATALOG_KIND) return undefined;
  if (typeof manifest.revision !== "string" || !/^catalog-\d+-[a-f0-9]{16}$/.test(manifest.revision)) return undefined;
  if (!isIsoTimestamp(manifest.snapshotAt) || !isIsoTimestamp(manifest.accessorySnapshotAt) || !isIsoTimestamp(manifest.generatedAt)) return undefined;
  if (!Number.isSafeInteger(manifest.catalogRevision) || (manifest.catalogRevision as number) < 0) return undefined;
  if (manifest.privateRecommendationEvidenceIncluded !== false) return undefined;
  if (!record(manifest.selectedCategories) || !record(manifest.counts) || !record(manifest.sourceHashes) || !record(manifest.bundleHashes)) return undefined;
  if (!validCategoryList(manifest.selectedCategories.parts, PART_CATEGORIES) || !validCategoryList(manifest.selectedCategories.accessories, ACCESSORY_CATEGORIES)) return undefined;
  if (!isHash(manifest.sourceHashes.catalog) || !isHash(manifest.sourceHashes.accessories)) return undefined;
  if (!isHash(manifest.bundleHashes.parts) || !isHash(manifest.bundleHashes.accessories)) return undefined;
  if (!Number.isSafeInteger(manifest.counts.parts) || (manifest.counts.parts as number) <= 0 || !Number.isSafeInteger(manifest.counts.accessories) || (manifest.counts.accessories as number) <= 0) return undefined;
  if (!validItems(value.parts, manifest.selectedCategories.parts) || !validItems(value.accessories, manifest.selectedCategories.accessories)) return undefined;
  if (value.parts.length !== manifest.counts.parts || value.accessories.length !== manifest.counts.accessories) return undefined;
  if (!value.accessories.every((item) => item.listingType === "accessory")) return undefined;
  const snapshot = frozenJsonCopy(value) as unknown as OfflineCatalogSnapshot;
  normalizedSnapshots.set(snapshot, snapshot);
  return snapshot;
}

export function requireOfflineCatalogSnapshot(value: unknown): OfflineCatalogSnapshot {
  const snapshot = offlineCatalogSnapshotFromUnknown(value);
  if (!snapshot) throw new Error("로컬 카탈로그 묶음의 manifest 또는 데이터 구조가 올바르지 않습니다.");
  return snapshot;
}
