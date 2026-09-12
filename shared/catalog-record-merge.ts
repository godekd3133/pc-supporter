export type CatalogRecordVersion = {
  id: string;
  updatedAt: string;
};

function timestampFor(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

/**
 * Keeps the record with the newest catalog source timestamp. Equal timestamps
 * intentionally allow the incoming response to win because it may contain a
 * newer transport projection of the same source version.
 */
export function incomingCatalogRecordWins<T extends CatalogRecordVersion>(current: T | undefined, incoming: T) {
  if (!current) return true;
  const currentTimestamp = timestampFor(current.updatedAt);
  const incomingTimestamp = timestampFor(incoming.updatedAt);
  if (incomingTimestamp === undefined) return currentTimestamp === undefined;
  if (currentTimestamp === undefined) return true;
  return incomingTimestamp >= currentTimestamp;
}

export function mergeCatalogRecords<T extends CatalogRecordVersion>(current: ReadonlyArray<T>, incoming: ReadonlyArray<T>) {
  const byId = new Map(current.map((record) => [record.id, record]));
  for (const record of incoming) {
    if (incomingCatalogRecordWins(byId.get(record.id), record)) byId.set(record.id, record);
  }
  return [...byId.values()];
}
