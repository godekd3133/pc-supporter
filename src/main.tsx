import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { applyTheme, THEME_STORAGE_KEY, themeModeFromStorage } from "./theme";
import "./styles.css";

try {
  applyTheme(themeModeFromStorage(window.localStorage.getItem(THEME_STORAGE_KEY)));
} catch {
  applyTheme("light");
}

function registerOfflineShell() {
  if (!import.meta.env.PROD || typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/service-worker.js").catch((error: unknown) => {
      console.warn("[PC Supporter] offline shell registration failed", error);
    });
  });
}

registerOfflineShell();

let printOpenedDetails: HTMLDetailsElement[] = [];
window.addEventListener("beforeprint", () => {
  printOpenedDetails = Array.from(document.querySelectorAll<HTMLDetailsElement>("details:not([open])"));
  for (const details of printOpenedDetails) details.open = true;
});
window.addEventListener("afterprint", () => {
  for (const details of printOpenedDetails) details.open = false;
  printOpenedDetails = [];
});

const nativeWindow = window as { Capacitor?: { isNativePlatform?: () => boolean } };
if (nativeWindow.Capacitor?.isNativePlatform?.() === true) {
  void import("./native-shell")
    .then((module) => module.initNativeShell())
    .catch((error: unknown) => {
      console.warn("[PC Supporter] native shell initialization failed", error);
    });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>
);
