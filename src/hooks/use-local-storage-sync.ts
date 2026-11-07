import { useEffect, useRef } from "react";
import { safeLocalStorage } from "../safe-storage";

/**
 * Writes `value` to localStorage whenever it changes. Write failures (full or blocked storage)
 * are swallowed: persistence here is a convenience and must never break the page.
 */
export function usePersistToLocalStorage<T>(key: string, value: T, serialize: (value: T) => string) {
  const serializeRef = useRef(serialize);
  serializeRef.current = serialize;
  useEffect(() => {
    try {
      safeLocalStorage.setItem(key, serializeRef.current(value));
    } catch {
      // A full local storage bucket must not prevent the rest of the service from working.
    }
  }, [key, value]);
}

/**
 * Calls `onChange` when another tab changes `key`. The handler captured on mount is used for the
 * lifetime of the listener, so it should only touch state setters and refs.
 */
export function useStorageKeyListener(key: string, onChange: (newValue: string | null) => void) {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    const handler = onChangeRef.current;
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) handler(event.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);
}
