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
  backgroundColor: "#f9fafb",
  ios: {
    contentInset: "never",
    backgroundColor: "#f9fafb"
  },
  android: {
    backgroundColor: "#f9fafb",
    ...(allowLocalHttpApi ? { allowMixedContent: true } : {})
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: true,
      backgroundColor: "#f9fafb",
      androidScaleType: "CENTER_CROP",
      showSpinner: false
    },
    Keyboard: {
      resize: "body",
      resizeOnFullScreen: true
    }
  }
};

export default config;
