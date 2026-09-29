export type AppDataMode = "remote" | "local-offline";

export const APP_DATA_MODE: AppDataMode = import.meta.env.VITE_APP_DATA_MODE === "offline" ? "local-offline" : "remote";
export const LOCAL_OFFLINE_BUILD = APP_DATA_MODE === "local-offline";

export function appDataMode(): AppDataMode {
  return APP_DATA_MODE;
}

export function localOfflineBuildEnabled() {
  return LOCAL_OFFLINE_BUILD;
}
