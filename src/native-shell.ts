import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { Keyboard, KeyboardResize } from "@capacitor/keyboard";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";

const STATUS_BAR_COLOR = "#122332";
const HAPTIC_SELECTOR = ".button-primary, .mobile-primary-action, .picker-item";

async function configureStatusBar() {
  try {
    await StatusBar.setStyle({ style: Style.Dark });
    if (Capacitor.getPlatform() === "android") {
      await StatusBar.setBackgroundColor({ color: STATUS_BAR_COLOR });
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
  await configureStatusBar();
  await configureKeyboard();
  registerAndroidBackButton();
  registerHapticFeedback();
  try {
    await SplashScreen.hide();
  } catch (error) {
    console.warn("[PC Supporter] splash screen hide failed", error);
  }
}
