import { SAFE_EXTERNAL_SOURCE_HOSTS } from "./safe-source-url";

export const THEME_SCRIPT_CSP_HASH = "sha256-vuFNM0XLG+dW1eLJdToNcsE6KfWegxQVYwCHD6Cjmbk=";
export const BOOTSTRAP_FAILURE_SCRIPT_CSP_HASH = "sha256-+a2ANYx3v8+/v0hkZG57FunixoHvQQX4UNh+K0xRGXk=";
export const BOOTSTRAP_STYLE_CSP_HASH = "sha256-1BY3L5pvVp4HnnrV+biE+/kMn0A+2bR+WGQ7MxvfM6E=";

const remoteImageSources = SAFE_EXTERNAL_SOURCE_HOSTS.map((host) => `https://${host}`);
const remoteFontStyleSource = "https://fonts.googleapis.com";
const remoteFontAssetSource = "https://fonts.gstatic.com";

export function apiBaseUrlCspOrigin(value: string | undefined) {
  const candidate = value?.trim();
  if (!candidate) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("VITE_API_BASE_URL must be an absolute HTTP(S) URL to build a Content Security Policy.");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("VITE_API_BASE_URL must use HTTP(S) without embedded credentials to build a Content Security Policy.");
  }
  return parsed.origin;
}

export function parseCspConnectOrigins(value: string | undefined) {
  const origins = new Set<string>();
  for (const entry of (value ?? "").split(",").map((origin) => origin.trim()).filter(Boolean)) {
    let parsed: URL;
    try {
      parsed = new URL(entry);
    } catch {
      throw new Error("CSP connect sources must contain comma-separated HTTP(S) origins.");
    }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== entry || parsed.username || parsed.password) {
      throw new Error("CSP connect sources must contain comma-separated HTTP(S) origins without paths or credentials.");
    }
    origins.add(parsed.origin);
  }
  return [...origins];
}

export function contentSecurityPolicyMetaFromHtml(html: string) {
  const cspTags = [...html.matchAll(/<meta\b[^>]*>/gi)]
    .map((match) => {
      const attributes = new Map<string, string>();
      for (const attribute of match[0].matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)) {
        attributes.set(attribute[1].toLowerCase(), attribute[3]
          .replace(/&#39;|&#x27;/gi, "'")
          .replace(/&quot;/gi, '"')
          .replace(/&amp;/gi, "&")
          .replace(/&lt;/gi, "<")
          .replace(/&gt;/gi, ">"));
      }
      return attributes;
    })
    .filter((attributes) => attributes.get("http-equiv")?.toLowerCase() === "content-security-policy");
  if (cspTags.length > 1) throw new Error("HTML cannot contain multiple Content-Security-Policy meta tags.");
  return cspTags[0]?.get("content");
}

export function createContentSecurityPolicy(options: {
  connectOrigins?: readonly string[];
  includeFrameAncestors?: boolean;
} = {}) {
  const connectOrigins = parseCspConnectOrigins(options.connectOrigins?.join(","));
  const directives = [
    "default-src 'none'",
    `script-src 'self' '${THEME_SCRIPT_CSP_HASH}' '${BOOTSTRAP_FAILURE_SCRIPT_CSP_HASH}'`,
    "script-src-attr 'none'",
    `style-src 'self' 'unsafe-inline' ${remoteFontStyleSource}`,
    `style-src-elem 'self' '${BOOTSTRAP_STYLE_CSP_HASH}' ${remoteFontStyleSource}`,
    "style-src-attr 'unsafe-inline'",
    `font-src 'self' ${remoteFontAssetSource}`,
    `img-src 'self' ${remoteImageSources.join(" ")}`,
    `connect-src 'self'${connectOrigins.length > 0 ? ` ${connectOrigins.join(" ")}` : ""}`,
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    "frame-src 'none'",
    "manifest-src 'self'",
    "worker-src 'self'"
  ];
  if (options.includeFrameAncestors ?? false) directives.push("frame-ancestors 'none'");
  return directives.join("; ");
}
