export type StoragePersistence = "persistent" | "session";
export type StorageFailureReason = "blocked" | "quota";

export interface LocalStorageHealth {
  persistence: StoragePersistence;
  reason?: StorageFailureReason;
}

export interface SafeStorageAdapter {
  storage: Storage;
  getStatus(): LocalStorageHealth;
  subscribe(listener: (status: LocalStorageHealth) => void): () => void;
}

export function createSafeStorageAdapter(getNativeStorage: () => Storage | undefined): SafeStorageAdapter {
  const fallbackValues = new Map<string, string | null>();
  const listeners = new Set<(status: LocalStorageHealth) => void>();
  let clearNativeValues = false;
  let status: LocalStorageHealth = { persistence: "persistent" };

  function statusAfterFailure(error: unknown): LocalStorageHealth {
    const name = error && typeof error === "object" && "name" in error ? String((error as { name: unknown }).name) : "";
    return { persistence: "session", reason: name === "QuotaExceededError" ? "quota" : "blocked" };
  }

  function setStatus(next: LocalStorageHealth) {
    if (status.persistence === next.persistence && status.reason === next.reason) return;
    status = next;
    for (const listener of listeners) listener(status);
  }

  function markFailure(error: unknown) {
    setStatus(statusAfterFailure(error));
  }

  function nativeStorageOrThrow() {
    const storage = getNativeStorage();
    if (!storage) throw new DOMException("Browser storage is unavailable.", "SecurityError");
    return storage;
  }

  function flushFallbackValues(storage: Storage) {
    if (clearNativeValues) {
      try {
        storage.clear();
        clearNativeValues = false;
      } catch (error: unknown) {
        markFailure(error);
        return false;
      }
    }
    for (const [key, value] of fallbackValues) {
      try {
        if (value === null) storage.removeItem(key);
        else storage.setItem(key, value);
        fallbackValues.delete(key);
      } catch (error: unknown) {
        markFailure(error);
      }
    }
    tryMarkPersistent();
    return true;
  }

  function tryMarkPersistent() {
    if (!clearNativeValues && fallbackValues.size === 0) setStatus({ persistence: "persistent" });
  }

  function keysFromStorage() {
    const keys = new Set<string>();
    if (!clearNativeValues) {
      try {
        const storage = nativeStorageOrThrow();
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index);
          if (key !== null) keys.add(key);
        }
      } catch (error: unknown) {
        markFailure(error);
      }
    }
    for (const [key, value] of fallbackValues) {
      if (value === null) keys.delete(key);
      else keys.add(key);
    }
    return [...keys];
  }

  const storage: Storage = {
    get length() {
      return keysFromStorage().length;
    },
    clear() {
      try {
        nativeStorageOrThrow().clear();
        fallbackValues.clear();
        clearNativeValues = false;
        tryMarkPersistent();
      } catch (error: unknown) {
        clearNativeValues = true;
        fallbackValues.clear();
        markFailure(error);
      }
    },
    getItem(key: string) {
      const normalizedKey = String(key);
      if (fallbackValues.has(normalizedKey)) return fallbackValues.get(normalizedKey) ?? null;
      if (clearNativeValues) return null;
      try {
        return nativeStorageOrThrow().getItem(normalizedKey);
      } catch (error: unknown) {
        markFailure(error);
        return null;
      }
    },
    key(index: number) {
      if (!Number.isInteger(index) || index < 0) return null;
      return keysFromStorage()[index] ?? null;
    },
    removeItem(key: string) {
      const normalizedKey = String(key);
      try {
        const native = nativeStorageOrThrow();
        if (!flushFallbackValues(native)) throw new DOMException("Browser storage is unavailable.", "SecurityError");
        native.removeItem(normalizedKey);
        fallbackValues.delete(normalizedKey);
        tryMarkPersistent();
      } catch (error: unknown) {
        fallbackValues.set(normalizedKey, null);
        markFailure(error);
      }
    },
    setItem(key: string, value: string) {
      const normalizedKey = String(key);
      const normalizedValue = String(value);
      try {
        const native = nativeStorageOrThrow();
        if (!flushFallbackValues(native)) throw new DOMException("Browser storage is unavailable.", "SecurityError");
        native.setItem(normalizedKey, normalizedValue);
        fallbackValues.delete(normalizedKey);
        tryMarkPersistent();
      } catch (error: unknown) {
        fallbackValues.set(normalizedKey, normalizedValue);
        markFailure(error);
      }
    }
  };

  return {
    storage,
    getStatus: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

function browserStorage(name: "localStorage" | "sessionStorage") {
  if (typeof window === "undefined") return undefined;
  return window[name];
}

const localStorageAdapter = createSafeStorageAdapter(() => browserStorage("localStorage"));
const sessionStorageAdapter = createSafeStorageAdapter(() => browserStorage("sessionStorage"));

export const safeLocalStorage = localStorageAdapter.storage;
export const safeSessionStorage = sessionStorageAdapter.storage;
export const getLocalStorageHealth = localStorageAdapter.getStatus;
export const subscribeLocalStorageHealth = localStorageAdapter.subscribe;
