/**
 * Browser file imports are read into memory before format-specific parsing.
 * Keep the raw text seam bounded consistently with the API JSON body limit.
 */
export const LOCAL_IMPORT_MAX_BYTES = 1_000_000;
