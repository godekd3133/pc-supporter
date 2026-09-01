import type { BuildGenerationRequest } from "./types";
import type { BudgetLadderExportPayload } from "./budget-ladder";

export interface BudgetLadderShareSnapshot {
  id: string;
  name: string;
  payload: BudgetLadderExportPayload;
  parentId?: string;
  lineageId?: string;
  versionNumber?: number;
  request?: BuildGenerationRequest;
  catalogSnapshotAt: string;
  catalogCurrentSnapshotAt?: string;
  catalogChangedSinceShare?: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export type SavedBudgetLadderRecord = BudgetLadderShareSnapshot & {
  ownerTokenHash?: string;
};

export interface BudgetLadderShareLineageEntry {
  id: string;
  name: string;
  lineageId: string;
  versionNumber: number;
  parentId?: string;
  createdAt: string;
  updatedAt: string;
  catalogSnapshotAt: string;
  expiresAt?: string;
  expired: boolean;
}

export interface BudgetLadderShareLineageResponse {
  lineageId: string;
  currentId: string;
  entries: BudgetLadderShareLineageEntry[];
}

export interface BudgetLadderShareCreateInput {
  name?: unknown;
  payload?: unknown;
  request?: unknown;
  parentId?: unknown;
  expiresInDays?: unknown;
}

export function budgetLadderDerivedSnapshotNameFor(name: string) {
  const prefix = "현재 기준 · ";
  let trimmed = name.trim();
  while (trimmed.startsWith(prefix)) trimmed = trimmed.slice(prefix.length).trim();
  return `${prefix}${trimmed}`;
}

function budgetLadderShareExpiredAt(expiresAt: string | undefined, now: number) {
  if (!expiresAt) return false;
  const timestamp = Date.parse(expiresAt);
  return !Number.isFinite(timestamp) || timestamp <= now;
}

export function budgetLadderShareLineageEntryFor(record: SavedBudgetLadderRecord, now = Date.now()): BudgetLadderShareLineageEntry {
  return {
    id: record.id,
    name: record.name,
    lineageId: record.lineageId ?? record.id,
    versionNumber: record.versionNumber ?? 1,
    ...(record.parentId ? { parentId: record.parentId } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    catalogSnapshotAt: record.catalogSnapshotAt,
    ...(record.expiresAt ? { expiresAt: record.expiresAt } : {}),
    expired: budgetLadderShareExpiredAt(record.expiresAt, now)
  };
}
