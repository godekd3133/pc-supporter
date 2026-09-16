export type ThemeMode = "light" | "dark";

export const THEME_STORAGE_KEY = "pc-supporter-theme";
export const THEME_CHANGE_EVENT = "pc-supporter-theme-change";

export function themeModeFromStorage(value: string | null | undefined): ThemeMode {
  return value === "dark" ? "dark" : "light";
}

export function themeColorFor(mode: ThemeMode) {
  return mode === "dark" ? "#0f1218" : "#3182f6";
}

export function applyTheme(mode: ThemeMode, documentRef: Document = document) {
  documentRef.documentElement.dataset.theme = mode;
  documentRef.documentElement.style.colorScheme = mode;
  documentRef.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeColorFor(mode));
}
