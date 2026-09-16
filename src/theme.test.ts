import { describe, expect, it } from "vitest";
import { themeColorFor, themeModeFromStorage } from "./theme";

describe("theme preferences", () => {
  it("accepts only the explicit dark preference", () => {
    expect(themeModeFromStorage("dark")).toBe("dark");
    expect(themeModeFromStorage("light")).toBe("light");
    expect(themeModeFromStorage(null)).toBe("light");
    expect(themeModeFromStorage("system")).toBe("light");
  });

  it("keeps the native and browser theme colors aligned", () => {
    expect(themeColorFor("light")).toBe("#3182f6");
    expect(themeColorFor("dark")).toBe("#0f1218");
  });
});
