/**
 * Shared build-selection limits used by both the API parser and browser JSON
 * import. Keeping these values in shared code prevents the two input seams
 * from accepting different shapes.
 */
export const BUILD_INPUT_MAX_SELECTIONS_PER_LIST = 100;
export const BUILD_INPUT_MAX_ID_LENGTH = 160;
export const BUILD_INPUT_MAX_M2_SLOTS = 8;
