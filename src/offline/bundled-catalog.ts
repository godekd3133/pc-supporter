import { offlineCatalogSnapshotFromUnknown } from "../../shared/offline-catalog";
import type { OfflineCatalogSnapshot } from "../../shared/offline-catalog";

let bundledSnapshotPromise: Promise<OfflineCatalogSnapshot | undefined> | undefined;

export function bundledOfflineCatalogSnapshot(): Promise<OfflineCatalogSnapshot | undefined> {
  if (!bundledSnapshotPromise) {
    bundledSnapshotPromise = (async () => {
      try {
        const url = new URL(`${import.meta.env.BASE_URL}offline-catalog.json`, globalThis.location.href);
        if (url.origin !== globalThis.location.origin) return undefined;
        const response = await fetch(url, { cache: "no-store", credentials: "omit", mode: "same-origin", redirect: "error" });
        if (!response.ok) return undefined;
        return offlineCatalogSnapshotFromUnknown(await response.json());
      } catch {
        return undefined;
      }
    })();
  }
  return bundledSnapshotPromise;
}
