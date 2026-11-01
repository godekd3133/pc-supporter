// Small motion helpers shared across routes. Every effect is skipped when the
// user prefers reduced motion or the browser lacks the API.
import { flushSync } from "react-dom";

export function prefersReducedMotion() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type ViewTransitionDocument = Document & { startViewTransition?: (update: () => void) => unknown };

/** Runs a route change inside a view transition so screens cross-fade instead of jumping. */
export function withViewTransition(update: () => void) {
  const doc = typeof document === "undefined" ? undefined : document as ViewTransitionDocument;
  if (!doc?.startViewTransition || prefersReducedMotion() || doc.visibilityState === "hidden") {
    update();
    return;
  }
  let applied = false;
  const apply = () => {
    if (applied) return;
    applied = true;
    update();
  };
  try {
    doc.startViewTransition(() => flushSync(apply));
  } catch {
    apply();
    return;
  }
  // The callback waits for the next rendered frame; never let a stalled page hold the route change.
  window.setTimeout(apply, 250);
}
