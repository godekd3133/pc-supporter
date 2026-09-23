import type { CompatibilityResult } from "../shared/types";

export type SavedBuildLiveCheck =
  | { status: "loading" }
  | { status: "ready"; result: CompatibilityResult }
  | { status: "error"; message: string };
