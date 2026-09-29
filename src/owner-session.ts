import { ApiError, api } from "./api";
import { safeLocalStorage } from "./safe-storage";
import { ownerSessionModeSupported } from "./owner-session-mode";
import { isOwnerSessionResourceType, type OwnerSessionResourceType } from "../shared/owner-session-contract";
export { ownerSessionModeSupported } from "./owner-session-mode";
export type { OwnerSessionResourceType } from "../shared/owner-session-contract";
import { SAVED_BUILD_OWNER_TOKENS_STORAGE_KEY } from "./saved-build-storage";
import { GENERATOR_VARIANTS_LOCAL_SHARES_STORAGE_KEY } from "../shared/generator-variants-local-share";

export type OwnerSessionResource = { id: string; kind: OwnerSessionResourceType };
export type OwnerCredential = { ownerToken?: string; owned?: boolean };

export const SAVED_WATCHLIST_OWNER_TOKENS_STORAGE_KEY = "pc-supporter-saved-watchlist-owner-tokens";
export const SAVED_WATCHLIST_LINK_STORAGE_KEY = "pc-supporter-saved-watchlist-link";
export const BUDGET_LADDER_LOCAL_SHARES_STORAGE_KEY = "pc-supporter-budget-ladder-shares";
export const ALTERNATIVE_COMPARISON_LOCAL_SHARES_STORAGE_KEY = "pc-supporter-alternative-comparison-shares";
export const SAVED_BUILD_VERSION_LOCAL_SHARES_STORAGE_KEY = "pc-supporter-saved-build-version-shares";

export const OWNER_SESSION_STORAGE_KEYS = [
  SAVED_BUILD_OWNER_TOKENS_STORAGE_KEY,
  SAVED_WATCHLIST_OWNER_TOKENS_STORAGE_KEY,
  BUDGET_LADDER_LOCAL_SHARES_STORAGE_KEY,
  ALTERNATIVE_COMPARISON_LOCAL_SHARES_STORAGE_KEY,
  SAVED_BUILD_VERSION_LOCAL_SHARES_STORAGE_KEY,
  GENERATOR_VARIANTS_LOCAL_SHARES_STORAGE_KEY
] as const;

export function readSavedWatchlistOwnerToken(resourceId: string) {
  const parsed = recordFromUnknown(parsedJson(SAVED_WATCHLIST_OWNER_TOKENS_STORAGE_KEY));
  const token = parsed?.[resourceId];
  return typeof token === "string" && token.length > 0 ? token : undefined;
}

export function rememberSavedWatchlistOwnerToken(resourceId: string, ownerToken: string) {
  if (!resourceId.trim() || !ownerToken.trim()) return;
  const current = recordFromUnknown(parsedJson(SAVED_WATCHLIST_OWNER_TOKENS_STORAGE_KEY)) ?? {};
  safeLocalStorage.setItem(SAVED_WATCHLIST_OWNER_TOKENS_STORAGE_KEY, JSON.stringify(Object.fromEntries([[resourceId, ownerToken], ...Object.entries(current).filter(([id]) => id !== resourceId)].slice(0, 20))));
  notifyStorageChanged(SAVED_WATCHLIST_OWNER_TOKENS_STORAGE_KEY);
}

export function forgetSavedWatchlistOwnerToken(resourceId: string) {
  const current = recordFromUnknown(parsedJson(SAVED_WATCHLIST_OWNER_TOKENS_STORAGE_KEY));
  if (!current || !(resourceId in current)) return;
  delete current[resourceId];
  safeLocalStorage.setItem(SAVED_WATCHLIST_OWNER_TOKENS_STORAGE_KEY, JSON.stringify(current));
  notifyStorageChanged(SAVED_WATCHLIST_OWNER_TOKENS_STORAGE_KEY);
}

const MAX_MIGRATION_ITEMS = 200;
const MAX_LOCAL_OWNER_RESOURCES = 20;
const resourceSeparator = "\u0000";

type StoredCredential = {
  resourceType: OwnerSessionResourceType;
  resourceId: string;
  ownerToken: string;
  storageKey: string;
  storeKind: "map" | "history";
};

type MigrationItemResult = { index: number; status: "migrated" | "rejected"; code?: string };
type MigrationResponse = { migratedCount?: number; rejectedCount?: number; items?: MigrationItemResult[] };
type MigrationItem = { resourceType: OwnerSessionResourceType; resourceId: string; ownerToken: string };
type MigrationStorage = Pick<Storage, "getItem" | "setItem">;

const historyStores: Array<{ key: string; resourceType: OwnerSessionResourceType }> = [
  { key: BUDGET_LADDER_LOCAL_SHARES_STORAGE_KEY, resourceType: "budget-ladder" },
  { key: ALTERNATIVE_COMPARISON_LOCAL_SHARES_STORAGE_KEY, resourceType: "comparison" },
  { key: SAVED_BUILD_VERSION_LOCAL_SHARES_STORAGE_KEY, resourceType: "version-comparison" },
  { key: GENERATOR_VARIANTS_LOCAL_SHARES_STORAGE_KEY, resourceType: "generator-variants" }
];

let resourcesSnapshot: readonly OwnerSessionResource[] = [];
const resourceListeners = new Set<() => void>();
let ownerSessionInitializationPromise: Promise<{ attempted: number; migrated: number; rejected: number; resources: readonly OwnerSessionResource[] }> | null = null;
let ownerSessionCookieVerified = false;

function resourceKey(resource: OwnerSessionResource) {
  return `${resource.kind}${resourceSeparator}${resource.id}`;
}

function publishResources(resources: Iterable<OwnerSessionResource>, merge = false) {
  const next = new Map<string, OwnerSessionResource>();
  if (merge) for (const resource of resourcesSnapshot) next.set(resourceKey(resource), resource);
  for (const resource of resources) {
    if (resource && typeof resource.id === "string" && resource.id.length > 0 && isOwnerSessionResourceType(resource.kind)) {
      next.set(resourceKey(resource), { id: resource.id, kind: resource.kind });
    }
  }
  const sorted = [...next.values()].sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
  if (JSON.stringify(sorted) === JSON.stringify(resourcesSnapshot)) return;
  resourcesSnapshot = sorted;
  for (const listener of resourceListeners) listener();
}

export function ownerSessionResourcesSnapshot() {
  return resourcesSnapshot;
}

export function subscribeOwnerSessionResources(listener: () => void) {
  resourceListeners.add(listener);
  return () => resourceListeners.delete(listener);
}

export function hasOwnerSessionResource(resourceType: OwnerSessionResourceType, resourceId: string) {
  return resourcesSnapshot.some((resource) => resource.kind === resourceType && resource.id === resourceId);
}

export function ownerSessionCookieIsVerified() {
  return ownerSessionCookieVerified;
}

export function ownerCredentialAvailable(resourceType: OwnerSessionResourceType, resourceId: string, credential: OwnerCredential = {}) {
  return Boolean(credential.ownerToken || (ownerSessionModeSupported() && ownerSessionCookieVerified && (credential.owned === true || hasOwnerSessionResource(resourceType, resourceId))));
}

export function markOwnerSessionResource(resourceType: OwnerSessionResourceType, resourceId: string) {
  publishResources([{ kind: resourceType, id: resourceId }], true);
}

export function removeOwnerSessionResource(resourceType: OwnerSessionResourceType, resourceId: string) {
  publishResources(resourcesSnapshot.filter((resource) => resource.kind !== resourceType || resource.id !== resourceId));
}

export function ownerRequestOptions(resourceType: OwnerSessionResourceType, resourceId: string, credential: OwnerCredential = {}) {
  const ownerManaged = credential.owned === true || hasOwnerSessionResource(resourceType, resourceId);
  if (ownerSessionModeSupported() && ownerSessionCookieVerified && ownerManaged) return { ownerSessionMode: "session-v1" as const };
  if (credential.ownerToken) {
    return {
      ownerSessionMode: "legacy" as const,
      headers: { "X-Share-Owner-Token": credential.ownerToken }
    };
  }
  return { ownerSessionMode: "legacy" as const };
}

export function ownerSessionCreateOptions() {
  return { ownerSessionMode: ownerSessionModeSupported() && ownerSessionCookieVerified ? "session-v1" as const : "legacy" as const };
}

function recordFromUnknown(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function parsedJson(key: string, storage: MigrationStorage = safeLocalStorage): unknown {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) as unknown : undefined;
  } catch {
    return undefined;
  }
}

function storedCredentialsForMap(storageKey: string, resourceType: OwnerSessionResourceType, storage: MigrationStorage): StoredCredential[] {
  const parsed = parsedJson(storageKey, storage);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const entries = Object.entries(parsed);
  if (entries.length > MAX_LOCAL_OWNER_RESOURCES) return [];
  return entries.flatMap(([resourceId, ownerToken]) => typeof ownerToken === "string" && ownerToken.length > 0
    ? [{ resourceType, resourceId, ownerToken, storageKey, storeKind: "map" as const }]
    : []);
}

function storedCredentialsForHistory(storageKey: string, resourceType: OwnerSessionResourceType, storage: MigrationStorage): StoredCredential[] {
  const parsed = parsedJson(storageKey, storage);
  if (!Array.isArray(parsed) || parsed.length > MAX_LOCAL_OWNER_RESOURCES) return [];
  return parsed.flatMap((value) => {
    const entry = recordFromUnknown(value);
    return entry && typeof entry.id === "string" && entry.id.length > 0 && typeof entry.ownerToken === "string" && entry.ownerToken.length > 0
      ? [{ resourceType, resourceId: entry.id, ownerToken: entry.ownerToken, storageKey, storeKind: "history" as const }]
      : [];
  });
}

export function collectStoredOwnerCredentials(storage: MigrationStorage = safeLocalStorage) {
  const credentials = [
    ...storedCredentialsForMap(SAVED_BUILD_OWNER_TOKENS_STORAGE_KEY, "build", storage),
    ...storedCredentialsForMap(SAVED_WATCHLIST_OWNER_TOKENS_STORAGE_KEY, "watchlist", storage),
    ...historyStores.flatMap((store) => storedCredentialsForHistory(store.key, store.resourceType, storage))
  ];
  const unique = new Map<string, { item: Omit<StoredCredential, "storageKey" | "storeKind">; refs: StoredCredential[] }>();
  for (const credential of credentials) {
    const key = JSON.stringify([credential.resourceType, credential.resourceId, credential.ownerToken]);
    const existing = unique.get(key);
    if (existing) existing.refs.push(credential);
    else unique.set(key, {
      item: { resourceType: credential.resourceType, resourceId: credential.resourceId, ownerToken: credential.ownerToken },
      refs: [credential]
    });
  }
  return [...unique.values()];
}

export function hasStoredOwnerCredentials(storage: MigrationStorage = safeLocalStorage) {
  return collectStoredOwnerCredentials(storage).length > 0;
}

function clearCredentialReference(reference: StoredCredential, storage: MigrationStorage = safeLocalStorage) {
  const parsed = parsedJson(reference.storageKey, storage);
  if (reference.storeKind === "map") {
    const record = recordFromUnknown(parsed);
    if (!record || record[reference.resourceId] !== reference.ownerToken) return false;
    delete record[reference.resourceId];
    try {
      storage.setItem(reference.storageKey, JSON.stringify(record));
      return true;
    } catch {
      return false;
    }
  }
  if (!Array.isArray(parsed)) return false;
  let changed = false;
  const next = parsed.map((value) => {
    const record = recordFromUnknown(value);
    if (!record || record.id !== reference.resourceId || record.ownerToken !== reference.ownerToken) return value;
    const { ownerToken: _ownerToken, ...metadata } = record;
    changed = true;
    return { ...metadata, owned: true };
  });
  if (!changed) return false;
  try {
    storage.setItem(reference.storageKey, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

function notifyStorageChanged(storageKey: string, storage: MigrationStorage = safeLocalStorage) {
  if (typeof window === "undefined" || typeof StorageEvent !== "function") return;
  try {
    window.dispatchEvent(new StorageEvent("storage", { key: storageKey, newValue: storage.getItem(storageKey) }));
  } catch {
    // The persisted value remains authoritative if this browser cannot synthesize StorageEvent.
  }
}

export async function migrateStoredOwnerCredentials(options: {
  storage?: MigrationStorage;
  sessionModeSupported?: boolean;
  migrate?: (items: MigrationItem[]) => Promise<MigrationResponse>;
} = {}) {
  const storage = options.storage ?? safeLocalStorage;
  if (!(options.sessionModeSupported ?? ownerSessionModeSupported())) return { attempted: 0, migrated: 0, rejected: 0 };
  const candidates = collectStoredOwnerCredentials(storage);
  const pendingResources = new Map<string, OwnerSessionResource>();
  const referencesByResource = new Map<string, StoredCredential[]>();
  for (const candidate of candidates) {
    const key = JSON.stringify([candidate.item.resourceType, candidate.item.resourceId]);
    referencesByResource.set(key, [...(referencesByResource.get(key) ?? []), ...candidate.refs]);
  }
  let migrated = 0;
  let rejected = 0;
  for (let offset = 0; offset < candidates.length; offset += MAX_MIGRATION_ITEMS) {
    const batch = candidates.slice(offset, offset + MAX_MIGRATION_ITEMS);
    let result: MigrationResponse;
    try {
      result = options.migrate
        ? await options.migrate(batch.map(({ item }) => item))
        : await api<MigrationResponse>("/api/owner-sessions/migrate", {
          method: "POST",
          ownerSessionMode: "session-v1",
          body: JSON.stringify({ items: batch.map(({ item }) => item) }),
          retry: 0
        });
    } catch {
      // Preserve this batch and every later credential for a subsequent retry.
      break;
    }
    if (!Array.isArray(result?.items)) break;
    const resultsByIndex = new Map(result.items.filter((item) => Number.isInteger(item?.index)).map((item) => [item.index, item]));
    for (const [index, candidate] of batch.entries()) {
      const itemResult = resultsByIndex.get(index);
      if (itemResult?.status !== "migrated") {
        rejected += 1;
        continue;
      }
      migrated += 1;
      pendingResources.set(JSON.stringify([candidate.item.resourceType, candidate.item.resourceId]), { kind: candidate.item.resourceType, id: candidate.item.resourceId });
    }
  }
  if (pendingResources.size > 0) {
    try {
      await refreshOwnerSessionResources();
      for (const [key, resource] of pendingResources) {
        if (!hasOwnerSessionResource(resource.kind, resource.id)) continue;
        markOwnerSessionResource(resource.kind, resource.id);
        const resourceRefs = referencesByResource.get(key) ?? [];
        const changedKeys = new Set(resourceRefs.filter((reference) => clearCredentialReference(reference, storage)).map((reference) => reference.storageKey));
        for (const storageKey of changedKeys) notifyStorageChanged(storageKey, storage);
      }
    } catch {
      // Migration responses alone are not enough to discard secrets; a cookie-authenticated resource read must confirm delivery.
    }
  }
  return { attempted: candidates.length, migrated, rejected };
}

function scrubUnownedMarkers(resources: readonly OwnerSessionResource[]) {
  const ownedKeys = new Set(resources.map(resourceKey));
  for (const store of historyStores) {
    const parsed = parsedJson(store.key);
    if (!Array.isArray(parsed)) continue;
    let changed = false;
    const next = parsed.map((value) => {
      const record = recordFromUnknown(value);
      if (!record || record.owned !== true || typeof record.id !== "string" || ownedKeys.has(resourceKey({ kind: store.resourceType, id: record.id }))) return value;
      const { owned: _owned, ...metadata } = record;
      changed = true;
      return metadata;
    });
    if (!changed) continue;
    try {
      safeLocalStorage.setItem(store.key, JSON.stringify(next));
      notifyStorageChanged(store.key);
    } catch {
      // Keep existing history intact when browser storage is unavailable.
    }
  }
}

export async function refreshOwnerSessionResources() {
  if (!ownerSessionModeSupported()) {
    ownerSessionCookieVerified = false;
    publishResources([]);
    return resourcesSnapshot;
  }
  let result: { resources?: unknown };
  try {
    result = await api<{ resources?: unknown }>("/api/owner-sessions/resources", { ownerSessionMode: "session-v1", retry: 0 });
  } catch (error: unknown) {
    if (error instanceof ApiError && error.status === 401) {
      ownerSessionCookieVerified = false;
      publishResources([]);
      scrubUnownedMarkers([]);
    }
    throw error;
  }
  const resources = Array.isArray(result.resources)
    ? result.resources.flatMap((value) => {
      const record = recordFromUnknown(value);
      return record && typeof record.id === "string" && isOwnerSessionResourceType(record.kind)
        ? [{ id: record.id, kind: record.kind }]
        : [];
    })
    : [];
  ownerSessionCookieVerified = true;
  publishResources(resources);
  scrubUnownedMarkers(resources);
  return resourcesSnapshot;
}

export async function initializeOwnerSession() {
  if (!ownerSessionModeSupported()) return { attempted: 0, migrated: 0, rejected: 0, resources: resourcesSnapshot };
  if (ownerSessionInitializationPromise) return ownerSessionInitializationPromise;
  ownerSessionInitializationPromise = (async () => {
  const migration = await migrateStoredOwnerCredentials();
  if (!ownerSessionCookieVerified) {
    try {
      await refreshOwnerSessionResources();
    } catch {
      // Retain already-confirmed local ownership markers until the server can be queried again.
    }
  }
    return { ...migration, resources: resourcesSnapshot };
  })().finally(() => { ownerSessionInitializationPromise = null; });
  return ownerSessionInitializationPromise;
}

export function retryOwnerSessionMigration() {
  const current = ownerSessionInitializationPromise;
  return current ? current.then(() => initializeOwnerSession(), () => initializeOwnerSession()) : initializeOwnerSession();
}
