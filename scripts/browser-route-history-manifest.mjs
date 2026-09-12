/**
 * Route-history evidence owned by browser-smoke.mjs.
 * Keep this manifest descriptive: the executable probes remain close to the
 * flow they exercise, while the evidence contract has one independently
 * reviewable source.
 */
export const BROWSER_ROUTE_HISTORY_MANIFEST = Object.freeze([
  Object.freeze({ id: "catalog-route-history", surface: "catalog", route: "/catalog", evidence: "category and benchmark-sort state restore across back/forward" }),
  Object.freeze({ id: "catalog-query-history-coalesce", surface: "catalog", route: "/catalog", evidence: "rapid query edits coalesce to one final URL and back restores the empty query" }),
  Object.freeze({ id: "generator-route-history", surface: "generator", route: "/recommend", evidence: "profile and budget form state restore across back/forward" }),
  Object.freeze({ id: "result-route-history", surface: "result", route: "/result", evidence: "finding filter and hash focus restore across warning/blocker back navigation" }),
  Object.freeze({ id: "price-watchlist-route-history", surface: "price-watchlist", route: "/watchlist", evidence: "part/accessory search filters restore across back/forward" }),
  Object.freeze({ id: "accessory-route-history", surface: "accessories", route: "/accessories", evidence: "category/brand filters restore across back/forward" })
]);

export const BROWSER_ROUTE_HISTORY_FLOW_IDS = Object.freeze(BROWSER_ROUTE_HISTORY_MANIFEST.map((entry) => entry.id));
