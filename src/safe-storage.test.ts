import { describe, expect, it } from "vitest";
import { createSafeStorageAdapter } from "./safe-storage";

class TestStorage implements Storage {
  private readonly values = new Map<string, string>();
  private readonly failWrites: boolean;
  private readonly failClear: boolean;
  private readonly failKeys: ReadonlySet<string>;

  constructor(options: { failWrites?: boolean; failClear?: boolean; failKeys?: ReadonlySet<string> } = {}) {
    this.failWrites = options.failWrites ?? false;
    this.failClear = options.failClear ?? false;
    this.failKeys = options.failKeys ?? new Set();
  }

  seed(key: string, value: string) { this.values.set(String(key), String(value)); }
  get length() { return this.values.size; }
  clear() { if (this.failClear) throw new DOMException("Storage is blocked", "SecurityError"); this.values.clear(); }
  getItem(key: string) { return this.values.get(String(key)) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(String(key)); }
  setItem(key: string, value: string) {
    if (this.failWrites || this.failKeys.has(String(key))) throw new DOMException("Storage is full", "QuotaExceededError");
    this.values.set(String(key), String(value));
  }
}

describe("safe browser storage", () => {
  it("keeps a session-only overlay when the browser denies local storage", () => {
    const adapter = createSafeStorageAdapter(() => { throw new DOMException("Blocked", "SecurityError"); });
    adapter.storage.setItem("draft", "first");

    expect(adapter.storage.getItem("draft")).toBe("first");
    expect(adapter.getStatus()).toEqual({ persistence: "session", reason: "blocked" });

    adapter.storage.removeItem("draft");
    expect(adapter.storage.getItem("draft")).toBeNull();
  });

  it("serves failed writes from memory while preserving the existing native value", () => {
    const native = new TestStorage({ failWrites: true });
    native.seed("draft", "previous");
    const adapter = createSafeStorageAdapter(() => native);
    adapter.storage.setItem("draft", "current");

    expect(adapter.storage.getItem("draft")).toBe("current");
    expect(native.getItem("draft")).toBe("previous");
    expect(adapter.getStatus()).toEqual({ persistence: "session", reason: "quota" });
  });

  it("keeps one failed key in memory without blocking unrelated native writes", () => {
    const native = new TestStorage({ failKeys: new Set(["backup"]) });
    const adapter = createSafeStorageAdapter(() => native);
    adapter.storage.setItem("backup", "session-only-copy");
    adapter.storage.setItem("draft", "persisted-new-draft");

    expect(adapter.storage.getItem("backup")).toBe("session-only-copy");
    expect(native.getItem("backup")).toBeNull();
    expect(native.getItem("draft")).toBe("persisted-new-draft");
    expect(adapter.getStatus()).toEqual({ persistence: "session", reason: "quota" });
  });

  it("flushes the session overlay once persistent storage becomes available", () => {
    let native: Storage | undefined;
    const adapter = createSafeStorageAdapter(() => native);
    adapter.storage.setItem("draft", "current");
    native = new TestStorage();

    adapter.storage.setItem("preferences", "dark");

    expect(native.getItem("draft")).toBe("current");
    expect(native.getItem("preferences")).toBe("dark");
    expect(adapter.getStatus()).toEqual({ persistence: "persistent" });
  });

  it("does not expose native values after a session clear fails", () => {
    const native = new TestStorage({ failWrites: true, failClear: true });
    native.seed("owner-token", "must-not-return-after-clear");
    const adapter = createSafeStorageAdapter(() => native);
    adapter.storage.clear();

    expect(adapter.storage.getItem("owner-token")).toBeNull();
    adapter.storage.setItem("draft", "new-session-value");
    expect(adapter.storage.getItem("draft")).toBe("new-session-value");
    expect(adapter.getStatus().persistence).toBe("session");
  });
});
