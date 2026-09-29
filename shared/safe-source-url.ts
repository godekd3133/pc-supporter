export const SAFE_EXTERNAL_SOURCE_HOSTS = ["prod.danawa.com", "www.danawa.com", "danawa.com", "img.danawa.com", "img.danuri.io"] as const;
const SAFE_SOURCE_HOSTS = new Set<string>(SAFE_EXTERNAL_SOURCE_HOSTS);

export function safeExternalUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.port && SAFE_SOURCE_HOSTS.has(url.hostname.toLowerCase()) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function safeHttpsUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
