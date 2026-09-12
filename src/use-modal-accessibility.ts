import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable=true]",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

type ModalAccessibilityOptions = {
  onClose?: () => void;
  closeOnEscape?: boolean;
  restoreFocus?: boolean;
  selector?: string;
};

function focusableElements(modal: HTMLElement) {
  return [...modal.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
    .filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");
}

/** Keeps keyboard focus inside a modal and returns it to the trigger on close. */
export function useModalAccessibility<T extends HTMLElement = HTMLElement>({ onClose, closeOnEscape = true, restoreFocus = true, selector }: ModalAccessibilityOptions = {}) {
  const modalRef = useRef<T | null>(null);
  const onCloseRef = useRef(onClose);
  const closeOnEscapeRef = useRef(closeOnEscape);
  onCloseRef.current = onClose;
  closeOnEscapeRef.current = closeOnEscape;

  useEffect(() => {
    const modal = modalRef.current ?? (selector ? document.querySelector<T>(selector) : null);
    if (!modal) return undefined;
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusInitialElement = () => {
      const target = modal.querySelector<HTMLElement>("[data-modal-autofocus]") ?? focusableElements(modal)[0] ?? modal;
      target.focus({ preventScroll: true });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && closeOnEscapeRef.current) {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusableElements(modal);
      if (elements.length === 0) {
        event.preventDefault();
        modal.focus({ preventScroll: true });
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      const active = document.activeElement;
      if (!modal.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ preventScroll: true });
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    if (!modal.hasAttribute("tabindex")) modal.tabIndex = -1;
    if (!modal.contains(document.activeElement)) focusInitialElement();
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (restoreFocus && previousActiveElement?.isConnected) previousActiveElement.focus({ preventScroll: true });
    };
  }, [restoreFocus, selector]);

  return modalRef;
}
