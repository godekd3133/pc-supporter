const STATIC_OFFLINE_SHELL_URLS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/favicon-32.png",
  "/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/offline-catalog.json"
] as const;

type RecordValue = Record<string, unknown>;

function record(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function manifestAssetUrl(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.length === 0 || value.startsWith("/") || value.includes("\\") || value.includes("?") || value.includes("#")) {
    throw new Error(`Vite manifest ${fieldName} is not a safe output-relative asset path.`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..") || value.includes("://")) {
    throw new Error(`Vite manifest ${fieldName} is not a safe output-relative asset path.`);
  }
  return `/${value}`;
}

export function offlinePrecacheUrlsFromViteManifest(value: unknown): string[] {
  if (!record(value) || !record(value["index.html"])) {
    throw new Error("Vite manifest is missing its index.html entry.");
  }

  const urls = new Set<string>(STATIC_OFFLINE_SHELL_URLS);
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  for (const [key, rawEntry] of entries) {
    if (!record(rawEntry)) throw new Error(`Vite manifest entry ${key} is invalid.`);
    const fields: Array<[string, unknown]> = [
      [`${key}.file`, rawEntry.file],
      ...["css", "assets"].flatMap((field) => {
        const assets = rawEntry[field];
        if (assets === undefined) return [];
        if (!Array.isArray(assets)) throw new Error(`Vite manifest entry ${key}.${field} is invalid.`);
        return assets.map((asset, index) => [`${key}.${field}[${index}]`, asset] as [string, unknown]);
      })
    ];
    for (const [fieldName, asset] of fields) urls.add(manifestAssetUrl(asset, fieldName));
  }

  return [...urls];
}

function replaceExactlyOnce(source: string, marker: string, replacement: string) {
  const first = source.indexOf(marker);
  if (first < 0 || source.indexOf(marker, first + marker.length) >= 0) {
    throw new Error(`service worker template must contain exactly one ${marker} marker.`);
  }
  return source.slice(0, first) + replacement + source.slice(first + marker.length);
}

export function offlineServiceWorkerForBuild(
  template: string,
  options: { buildRevision: string; catalogRevision: string; precacheUrls: readonly string[] }
) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(options.buildRevision)) {
    throw new Error("local-offline build revision must be a UUID.");
  }
  if (!/^catalog-\d+-[a-f0-9]{16}$/.test(options.catalogRevision)) {
    throw new Error("local-offline catalog revision is invalid.");
  }
  if (new Set(options.precacheUrls).size !== options.precacheUrls.length
    || !options.precacheUrls.includes("/index.html")
    || !options.precacheUrls.includes("/offline-catalog.json")
    || options.precacheUrls.some((url) => !url.startsWith("/") || url.startsWith("//") || url.includes("\\") || url.includes("?") || url.includes("#"))) {
    throw new Error("local-offline precache URL set is incomplete or unsafe.");
  }

  let output = template;
  output = replaceExactlyOnce(output, 'const LOCAL_OFFLINE_BUILD_REVISION = "";', `const LOCAL_OFFLINE_BUILD_REVISION = ${JSON.stringify(options.buildRevision)};`);
  output = replaceExactlyOnce(output, 'const LOCAL_OFFLINE_CATALOG_REVISION = "";', `const LOCAL_OFFLINE_CATALOG_REVISION = ${JSON.stringify(options.catalogRevision)};`);
  output = replaceExactlyOnce(output, "const LOCAL_OFFLINE_SHELL_URLS = [];", `const LOCAL_OFFLINE_SHELL_URLS = ${JSON.stringify(options.precacheUrls)};`);
  return output;
}
