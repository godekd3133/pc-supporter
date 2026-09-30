import { Capacitor } from "@capacitor/core";

export type OwnerSessionLocation = {
  protocol: string;
  hostname: string;
  port: string;
  origin?: string;
};

export function ownerSessionModeSupportedFor(location: OwnerSessionLocation, options: { native?: boolean; apiOrigin?: string } = {}) {
  if (options.native) return false;
  if (options.apiOrigin && (!location.origin || options.apiOrigin !== location.origin)) return false;
  if (location.protocol === "https:") return true;
  return location.protocol === "http:"
    && (location.hostname === "localhost" || location.hostname === "127.0.0.1")
    && location.port === "5173";
}

export function ownerSessionModeSupported() {
  if (typeof window === "undefined") return false;
  const pageOrigin = window.location.origin;
  const configuredApiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").trim().replace(/\/+$/, "");
  let apiOrigin = pageOrigin;
  try {
    if (configuredApiBaseUrl) apiOrigin = new URL(configuredApiBaseUrl, pageOrigin).origin;
  } catch {
    return false;
  }
  return ownerSessionModeSupportedFor(window.location, { native: Capacitor.isNativePlatform(), apiOrigin });
}
