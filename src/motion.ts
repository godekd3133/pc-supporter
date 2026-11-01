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

const QUOTE_SOURCE_SELECTOR = ".catalog-part-card-image, .accessory-row-image, .catalog-detail-image, img";

function visibleQuoteTarget() {
  return [...document.querySelectorAll<HTMLElement>("[data-quote-target]")].find((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== "hidden";
  });
}

/** Sends a copy of the item's thumbnail from the clicked control to the quote tab, then bumps the tab. */
export function flyToQuote(trigger: Element | null) {
  if (typeof document === "undefined" || prefersReducedMotion() || !(trigger instanceof HTMLElement)) return;
  const target = visibleQuoteTarget();
  if (!target) return;
  const container = trigger.closest("article, section, li") ?? trigger.parentElement;
  const source = container?.querySelector<HTMLElement>(QUOTE_SOURCE_SELECTOR) ?? trigger;
  const from = source.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  if (from.width === 0 || to.width === 0 || typeof source.animate !== "function") return;

  const size = Math.min(56, Math.max(28, Math.min(from.width, from.height)));
  const ghost = source === trigger ? document.createElement("span") : source.cloneNode(true) as HTMLElement;
  ghost.className = "quote-fly-ghost";
  ghost.setAttribute("aria-hidden", "true");
  Object.assign(ghost.style, {
    position: "fixed", zIndex: "400", display: "grid", placeItems: "center", overflow: "hidden", margin: "0", padding: source === trigger ? "0" : "4px", pointerEvents: "none",
    left: `${from.left + from.width / 2 - size / 2}px`, top: `${from.top + from.height / 2 - size / 2}px`, width: `${size}px`, height: `${size}px`,
    border: source === trigger ? "0" : "1px solid var(--line)", borderRadius: source === trigger ? "50%" : "12px", color: "var(--teal)",
    background: source === trigger ? "var(--teal)" : "var(--surface)", boxShadow: "0 12px 28px -12px rgba(0, 0, 0, .4)", fontSize: `${Math.round(size * 0.5)}px`
  });
  ghost.querySelectorAll("img").forEach((image) => Object.assign(image.style, { width: "100%", height: "100%", objectFit: "contain" }));
  document.body.appendChild(ghost);

  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const lift = Math.min(120, Math.abs(dx) * 0.25 + 40);
  const animation = ghost.animate([
    { transform: "translate(0, 0) scale(1)", opacity: 1 },
    { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - lift}px) scale(0.8)`, opacity: 1, offset: 0.55 },
    { transform: `translate(${dx}px, ${dy}px) scale(0.25)`, opacity: 0.2 }
  ], { duration: 640, easing: "cubic-bezier(.45, 0, .25, 1)" });
  const finish = () => {
    ghost.remove();
    target.classList.remove("quote-target-bump");
    void target.offsetWidth;
    target.classList.add("quote-target-bump");
    window.setTimeout(() => target.classList.remove("quote-target-bump"), 520);
  };
  animation.onfinish = finish;
  animation.oncancel = () => ghost.remove();
  window.setTimeout(() => ghost.remove(), 1200);
}
