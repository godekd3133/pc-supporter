// Small motion helpers shared across routes. Every effect is skipped when the
// user prefers reduced motion or the browser lacks the API.
import { useEffect, useRef } from "react";
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

// ── Entrance choreography ──
// After every route change the visible content of the route stage enters in a
// staggered sequence (blocks rise, text wipes in, buttons fade up), content below the
// fold reveals as it scrolls in, and nodes React adds later get a quicker version
// of the same treatment. It only touches data attributes and a CSS variable, so
// React's own DOM stays intact, and it never runs under reduced motion.

type MotionKind = "block" | "text" | "title" | "button" | "field";

const KIND_SELECTORS: Array<[MotionKind, string]> = [
  ["button", ".button, button, a[class*='button'], [role='tab'], [class*='chip'], [class*='pill']"],
  ["field", "input:not([type='hidden']), select, textarea"],
  ["title", "h1, h2"],
  ["text", "h3, h4, p, .eyebrow, small, dt, dd, th, label"],
  ["block", "section, article, aside, figure, table, li, [class*='card'], [class*='panel'], [class*='tile'], [class*='row']"],
];
const ALL_SELECTOR = KIND_SELECTORS.map(([, selector]) => selector).join(", ");
const SKIP_SELECTOR = "[data-motion-skip], [role='dialog'], .modal-backdrop, .toast, .mobile-bottom-nav, svg";
const MAX_PER_PASS = 220;
const MAX_STAGGER = 22;

function motionKindOf(element: Element): MotionKind {
  for (const [kind, selector] of KIND_SELECTORS) if (element.matches(selector)) return kind;
  return "block";
}

function motionSupported() {
  return typeof window !== "undefined"
    && typeof IntersectionObserver === "function"
    && typeof MutationObserver === "function"
    && !prefersReducedMotion();
}

function canAnimate(element: HTMLElement) {
  if (element.hasAttribute("data-motion") || element.closest(SKIP_SELECTOR)) return false;
  if (!element.getClientRects().length) return false;
  const style = window.getComputedStyle(element);
  // Leave fixed/sticky chrome alone and never fight an animation the element already owns (spinners, existing rises).
  if (style.position === "fixed" || style.position === "sticky") return false;
  if (style.animationName && style.animationName !== "none") return false;
  return true;
}

function collect(root: Element) {
  const found: HTMLElement[] = [];
  if (root instanceof HTMLElement && root.matches(ALL_SELECTOR)) found.push(root);
  root.querySelectorAll<HTMLElement>(ALL_SELECTOR).forEach((element) => { if (found.length < MAX_PER_PASS) found.push(element); });
  return found.filter(canAnimate);
}

function mark(element: HTMLElement, state: "enter" | "reveal" | "pending", index: number) {
  element.style.setProperty("--motion-i", String(Math.min(index, MAX_STAGGER)));
  element.setAttribute("data-motion-kind", motionKindOf(element));
  element.setAttribute("data-motion", state);
  if (state !== "pending") {
    element.addEventListener("animationend", () => element.setAttribute("data-motion", "done"), { once: true });
  }
}

let revealObserver: IntersectionObserver | null = null;
let revealBatch = 0;
let revealResetFrame = 0;

const pendingReveals = new Set<HTMLElement>();
let scrollCheckTimer = 0;

function reveal(element: HTMLElement) {
  if (!pendingReveals.delete(element)) return;
  revealObserver?.unobserve(element);
  mark(element, "reveal", revealBatch++);
  cancelAnimationFrame(revealResetFrame);
  revealResetFrame = requestAnimationFrame(() => { revealBatch = 0; });
}

// Safety net beside the IntersectionObserver: whatever reaches the viewport while
// still pending is revealed on scroll, so content can never stay invisible.
function checkPendingOnScroll() {
  if (scrollCheckTimer) return;
  scrollCheckTimer = window.setTimeout(() => {
    scrollCheckTimer = 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    for (const element of pendingReveals) {
      if (!element.isConnected) { pendingReveals.delete(element); continue; }
      const rect = element.getBoundingClientRect();
      if (rect.top < viewportHeight && rect.bottom > 0) reveal(element);
    }
  }, 160);
}

function getRevealObserver() {
  if (revealObserver) return revealObserver;
  revealObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) if (entry.isIntersecting) reveal(entry.target as HTMLElement);
  }, { rootMargin: "0px 0px -6% 0px", threshold: 0.01 });
  window.addEventListener("scroll", checkPendingOnScroll, { passive: true });
  window.addEventListener("resize", checkPendingOnScroll, { passive: true });
  return revealObserver;
}

/** Stages every animatable element under `root`: visible ones enter now, the rest wait for scroll. */
function choreograph(root: Element, startIndex: number, mode: "route" | "update") {
  const elements = collect(root);
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  let index = startIndex;
  for (const element of elements) {
    const rect = element.getBoundingClientRect();
    const inView = rect.top < viewportHeight && rect.bottom > 0;
    if (inView || rect.height > viewportHeight * 1.4) {
      mark(element, "enter", mode === "route" ? index++ : Math.floor(index++ / 3));
    } else {
      mark(element, "pending", 0);
      pendingReveals.add(element);
      getRevealObserver().observe(element);
    }
  }
  return index;
}

let routeProgressTimer = 0;
function playRouteProgress() {
  let bar = document.querySelector<HTMLElement>(".route-progress");
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "route-progress";
    bar.setAttribute("aria-hidden", "true");
    document.body.appendChild(bar);
  }
  bar.removeAttribute("data-active");
  void bar.offsetWidth; // restart the sweep
  bar.setAttribute("data-active", "");
  window.clearTimeout(routeProgressTimer);
  routeProgressTimer = window.setTimeout(() => bar?.removeAttribute("data-active"), 900);
}

/**
 * Plays the entrance sequence for the route stage whenever `routeKey` changes and
 * keeps animating nodes React inserts afterwards (lazy routes, results, list items).
 */
export function useMotionChoreography(routeKey: string) {
  const firstRun = useRef(true);
  useEffect(() => {
    if (!motionSupported()) return;
    document.documentElement.setAttribute("data-motion-ready", "");
    const main = document.getElementById("main-content");
    if (!main) return;
    if (!firstRun.current) playRouteProgress();
    firstRun.current = false;

    const routeStartedAt = performance.now();
    let nextIndex = 0;
    let frame = requestAnimationFrame(() => {
      const stage = main.querySelector(".route-stage") ?? main;
      nextIndex = choreograph(stage, 0, "route");
    });

    const pending = new Set<Element>();
    let flushFrame = 0;
    const flush = () => {
      flushFrame = 0;
      const inRouteWindow = performance.now() - routeStartedAt < 1200;
      for (const node of pending) {
        if (!node.isConnected) continue;
        nextIndex = choreograph(node, inRouteWindow ? nextIndex : 0, inRouteWindow ? "route" : "update");
      }
      pending.clear();
    };
    const mutations = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => { if (node instanceof Element && !node.closest(SKIP_SELECTOR)) pending.add(node); });
      }
      if (pending.size && !flushFrame) flushFrame = requestAnimationFrame(flush);
    });
    mutations.observe(main, { childList: true, subtree: true });

    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(flushFrame);
      mutations.disconnect();
      frame = 0;
    };
  }, [routeKey]);
}

// ── Pointer ripple on buttons ──
let rippleInstalled = false;
/** Installs one delegated listener that draws a ripple from the press point on `.button`s. */
export function installButtonRipple() {
  if (rippleInstalled || typeof document === "undefined") return;
  rippleInstalled = true;
  document.addEventListener("pointerdown", (event) => {
    if (prefersReducedMotion()) return;
    const target = (event.target as Element | null)?.closest?.<HTMLElement>(".app-shell .button, .app-shell .icon-button");
    if (!target || (target as HTMLButtonElement).disabled) return;
    const rect = target.getBoundingClientRect();
    target.style.setProperty("--ripple-x", `${event.clientX - rect.left}px`);
    target.style.setProperty("--ripple-y", `${event.clientY - rect.top}px`);
    target.style.setProperty("--ripple-size", `${Math.max(rect.width, rect.height) * 2.2}px`);
    target.removeAttribute("data-ripple");
    void target.offsetWidth;
    target.setAttribute("data-ripple", "");
    window.setTimeout(() => target.removeAttribute("data-ripple"), 620);
  }, { passive: true });
}
