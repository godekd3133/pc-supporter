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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>
);
