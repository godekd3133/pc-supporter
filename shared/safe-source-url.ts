const SAFE_SOURCE_HOSTS = new Set(["prod.danawa.com", "www.danawa.com", "danawa.com", "img.danawa.com", "img.danuri.io"]);

export function safeExternalUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && SAFE_SOURCE_HOSTS.has(url.hostname.toLowerCase()) ? url.toString() : undefined;
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
