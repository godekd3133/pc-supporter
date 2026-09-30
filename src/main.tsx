import { safeLocalStorage } from "./safe-storage";
import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { applyTheme, THEME_STORAGE_KEY, themeModeFromStorage } from "./theme";
import "./styles.css";

const App = lazy(() => import("./App"));

try {
  applyTheme(themeModeFromStorage(safeLocalStorage.getItem(THEME_STORAGE_KEY)));
} catch {
  applyTheme("light");
}

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
      <Suspense fallback={<div className="app-bootstrap-fallback" role="status" aria-live="polite"><span className="app-bootstrap-spinner" aria-hidden="true" /><span>PC Supporter를 불러오고 있어요.</span></div>}>
        <App />
      </Suspense>
    </AppErrorBoundary>
  </StrictMode>
);
