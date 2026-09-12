import type { SavedBuild } from "./types";

export const SAVED_BUILD_DECISION_NOTE_MAX_LENGTH = 500;
export const SAVED_BUILD_NAME_MAX_LENGTH = 60;
export const SAVED_BUILD_METADATA_HISTORY_LIMIT = 12;

export type SavedBuildMetadataHistoryField = "name" | "decisionNote";

export interface SavedBuildMetadataHistoryEntry {
  changedAt: string;
  changedFields: SavedBuildMetadataHistoryField[];
  previousName: string;
  previousDecisionNote?: string;
  nextName: string;
  nextDecisionNote?: string;
}

export function savedBuildNameFromUnknown(value: unknown) {
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  if (name.length === 0 || name.length > SAVED_BUILD_NAME_MAX_LENGTH) return undefined;
  return name;
}

export function savedBuildDecisionNoteFromUnknown(value: unknown) {
  if (typeof value !== "string") return undefined;
  const note = value.trim();
  if (note.length === 0 || note.length > SAVED_BUILD_DECISION_NOTE_MAX_LENGTH) return undefined;
  return note;
}

function savedBuildMetadataHistoryEntryFromUnknown(value: unknown): SavedBuildMetadataHistoryEntry | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Partial<SavedBuildMetadataHistoryEntry>;
  const changedFields = Array.isArray(candidate.changedFields)
    ? candidate.changedFields.filter((field): field is SavedBuildMetadataHistoryField => field === "name" || field === "decisionNote")
    : [];
  const previousDecisionNote = savedBuildDecisionNoteFromUnknown(candidate.previousDecisionNote);
  const nextDecisionNote = savedBuildDecisionNoteFromUnknown(candidate.nextDecisionNote);
  if (typeof candidate.changedAt !== "string" || !Number.isFinite(Date.parse(candidate.changedAt)) || typeof candidate.previousName !== "string" || candidate.previousName.trim().length === 0 || typeof candidate.nextName !== "string" || candidate.nextName.trim().length === 0 || changedFields.length === 0) return undefined;
  return {
    changedAt: new Date(candidate.changedAt).toISOString(),
    changedFields: [...new Set(changedFields)],
    previousName: candidate.previousName.trim().slice(0, SAVED_BUILD_NAME_MAX_LENGTH),
    ...(previousDecisionNote ? { previousDecisionNote } : {}),
    nextName: candidate.nextName.trim().slice(0, SAVED_BUILD_NAME_MAX_LENGTH),
    ...(nextDecisionNote ? { nextDecisionNote } : {})
  };
}

export function savedBuildMetadataHistoryFromUnknown(value: unknown): SavedBuildMetadataHistoryEntry[] | undefined {
  if (!Array.isArray(value)) return [];
  if (value.length > SAVED_BUILD_METADATA_HISTORY_LIMIT) return undefined;
  return value.map(savedBuildMetadataHistoryEntryFromUnknown).filter((entry): entry is SavedBuildMetadataHistoryEntry => entry !== undefined).slice(-SAVED_BUILD_METADATA_HISTORY_LIMIT);
}

export function savedBuildMetadataHistoryEntryFor(previous: Pick<SavedBuild, "name" | "decisionNote">, next: Pick<SavedBuild, "name" | "decisionNote">, changedAt: string): SavedBuildMetadataHistoryEntry | undefined {
  const changedFields: SavedBuildMetadataHistoryField[] = [];
  if (previous.name !== next.name) changedFields.push("name");
  if (previous.decisionNote !== next.decisionNote) changedFields.push("decisionNote");
  if (changedFields.length === 0) return undefined;
  return {
    changedAt,
    changedFields,
    previousName: previous.name,
    ...(previous.decisionNote ? { previousDecisionNote: previous.decisionNote } : {}),
    nextName: next.name,
    ...(next.decisionNote ? { nextDecisionNote: next.decisionNote } : {})
  };
}

export function savedBuildMetadataHistoryWithNextEntryFor(history: SavedBuildMetadataHistoryEntry[] | undefined, entry: SavedBuildMetadataHistoryEntry | undefined) {
  return entry ? [...(history ?? []), entry].slice(-SAVED_BUILD_METADATA_HISTORY_LIMIT) : (history ?? []).slice(-SAVED_BUILD_METADATA_HISTORY_LIMIT);
}
