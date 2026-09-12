import type { CapacitorConfig } from "@capacitor/cli";

const rawApiBaseUrl = (process.env.VITE_API_BASE_URL ?? "").trim();
const webDirectory = process.env.CAPACITOR_WEB_DIR?.trim() || "dist";
const allowLocalHttpApi = (() => {
  try {
    const url = new URL(rawApiBaseUrl);
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "10.0.2.2"].includes(url.hostname);
  } catch {
    return false;
  }
})();

const config: CapacitorConfig = {
  appId: "com.godekd3133.pcsupporter",
  appName: "PC Supporter",
  webDir: webDirectory,
  backgroundColor: "#f4f7f8",
  ios: {
    contentInset: "never",
    backgroundColor: "#f4f7f8"
  },
  android: {
    backgroundColor: "#f4f7f8",
    ...(allowLocalHttpApi ? { allowMixedContent: true } : {})
  }
};

export default config;
