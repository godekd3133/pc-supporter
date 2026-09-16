import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { Keyboard, KeyboardResize } from "@capacitor/keyboard";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";
import { THEME_CHANGE_EVENT, type ThemeMode } from "./theme";

const LIGHT_STATUS_BAR_COLOR = "#f9fafb";
const DARK_STATUS_BAR_COLOR = "#0f1218";
const HAPTIC_SELECTOR = ".button-primary, .mobile-primary-action, .picker-item";

async function configureStatusBar(mode: ThemeMode) {
  try {
    await StatusBar.setStyle({ style: mode === "dark" ? Style.Dark : Style.Light });
    if (Capacitor.getPlatform() === "android") {
      await StatusBar.setBackgroundColor({ color: mode === "dark" ? DARK_STATUS_BAR_COLOR : LIGHT_STATUS_BAR_COLOR });
    }
  } catch (error) {
    console.warn("[PC Supporter] status bar setup failed", error);
  }
}

async function configureKeyboard() {
  try {
    await Keyboard.setResizeMode({ mode: KeyboardResize.Body });
  } catch (error) {
    console.warn("[PC Supporter] keyboard setup failed", error);
  }
}

function registerAndroidBackButton() {
  if (Capacitor.getPlatform() !== "android") return;
  void CapacitorApp.addListener("backButton", ({ canGoBack }) => {
    if (canGoBack) {
      window.history.back();
      return;
    }
    void CapacitorApp.exitApp();
  }).catch((error: unknown) => {
    console.warn("[PC Supporter] back button listener failed", error);
  });
}

function registerHapticFeedback() {
  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    if (!event.target.closest(HAPTIC_SELECTOR)) return;
    void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  }, { capture: true, passive: true });
}

export async function initNativeShell() {
  if (!Capacitor.isNativePlatform()) return;
  const currentTheme: ThemeMode = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  await configureStatusBar(currentTheme);
  window.addEventListener(THEME_CHANGE_EVENT, (event) => {
    const mode = (event as CustomEvent<{ mode?: ThemeMode }>).detail?.mode;
    if (mode === "dark" || mode === "light") void configureStatusBar(mode);
  });
  await configureKeyboard();
  registerAndroidBackButton();
  registerHapticFeedback();
  try {
    await SplashScreen.hide();
  } catch (error) {
    console.warn("[PC Supporter] splash screen hide failed", error);
  }
}
