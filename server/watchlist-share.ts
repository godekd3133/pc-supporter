import type { SavedCatalogWatchlist } from "./watchlist-store";

export type SavedCatalogWatchlistRecord = SavedCatalogWatchlist & {
  ownerTokenHash?: string;
};

export function publicSavedCatalogWatchlist(record: SavedCatalogWatchlistRecord): SavedCatalogWatchlist {
  const { ownerTokenHash: _ownerTokenHash, ...watchlist } = record;
  return watchlist;
}
