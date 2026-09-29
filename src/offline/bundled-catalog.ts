import { offlineCatalogSnapshotFromUnknown } from "../../shared/offline-catalog";
import type { OfflineCatalogSnapshot } from "../../shared/offline-catalog";

let bundledSnapshotPromise: Promise<OfflineCatalogSnapshot | undefined> | undefined;

const OFFLINE_BUILD_REVISION_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const OFFLINE_CATALOG_REVISION_PATTERN = /^catalog-\d+-[a-f0-9]{16}$/;

export function offlineCatalogRevisionMatches(snapshotRevision: unknown, expectedRevision: unknown) {
  return typeof snapshotRevision === "string"
    && typeof expectedRevision === "string"
    && OFFLINE_CATALOG_REVISION_PATTERN.test(expectedRevision)
    && snapshotRevision === expectedRevision;
}

export function bundledOfflineCatalogSnapshot(): Promise<OfflineCatalogSnapshot | undefined> {
  if (!bundledSnapshotPromise) {
    bundledSnapshotPromise = (async () => {
      try {
        const expectedBuildRevision = import.meta.env.VITE_OFFLINE_BUILD_REVISION ?? "";
        const expectedCatalogRevision = import.meta.env.VITE_OFFLINE_CATALOG_REVISION ?? "";
        if (!OFFLINE_BUILD_REVISION_PATTERN.test(expectedBuildRevision)
          || !OFFLINE_CATALOG_REVISION_PATTERN.test(expectedCatalogRevision)) return undefined;
        const url = new URL(`${import.meta.env.BASE_URL}offline-catalog.json`, globalThis.location.href);
        if (url.origin !== globalThis.location.origin) return undefined;
        const response = await fetch(url, { cache: "no-store", credentials: "omit", mode: "same-origin", redirect: "error" });
        if (!response.ok) return undefined;
        const snapshot = offlineCatalogSnapshotFromUnknown(await response.json());
        if (!snapshot || !offlineCatalogRevisionMatches(snapshot.manifest.revision, expectedCatalogRevision)) return undefined;
        return snapshot;
      } catch {
        return undefined;
      }
    })();
  }
  return bundledSnapshotPromise;
}
