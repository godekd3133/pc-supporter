import { catalogUpdatedAtFor, currentCatalogRuntimeRevision, loadCatalog } from "./catalog";
import { currentAccessoryUpdatedAt, loadAccessories } from "./accessories";

export type CatalogSnapshot = {
  catalog: Awaited<ReturnType<typeof loadCatalog>>;
  accessories: Awaited<ReturnType<typeof loadAccessories>>;
  catalogUpdatedAt: string;
  accessoryUpdatedAt: string;
  catalogRevision: number;
};

/** Captures the data arrays and every cache dependency that describes one coherent read snapshot. */
export async function loadCatalogSnapshot(): Promise<CatalogSnapshot> {
  const [catalog, accessories] = await Promise.all([loadCatalog(), loadAccessories()]);
  return {
    catalog,
    accessories,
    catalogUpdatedAt: await catalogUpdatedAtFor(catalog),
    accessoryUpdatedAt: currentAccessoryUpdatedAt(),
    catalogRevision: currentCatalogRuntimeRevision()
  };
}

export async function loadCatalogSnapshotTimestamp() {
  const catalog = await loadCatalog();
  return {
    catalogUpdatedAt: await catalogUpdatedAtFor(catalog),
    catalogRevision: currentCatalogRuntimeRevision()
  };
}
