import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "./AppErrorBoundary";
import "./styles.css";

function registerOfflineShell() {
  if (!import.meta.env.PROD || typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/service-worker.js").catch((error: unknown) => {
      console.warn("[PC Supporter] offline shell registration failed", error);
    });
  });
}

registerOfflineShell();

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
