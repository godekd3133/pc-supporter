import type { Part, UpgradeBundleCandidatePayload, UpgradeBundlePayload, UpgradeBundleRecommendation, UpgradeRecommendation } from "./types";

function candidateKey(category: string, partId: string) {
  return `${category}:${partId}`;
}

export function upgradeBundlePayloadFor(bundles: UpgradeBundleRecommendation[]): UpgradeBundlePayload {
  const candidates = new Map<string, UpgradeBundleCandidatePayload>();
  const transportBundles = bundles.map((bundle, index) => {
    const changes = bundle.changes.map((change) => {
      const key = candidateKey(change.category, change.part.id);
      if (!candidates.has(key)) {
        const { part, ...candidate } = change;
        const { specs: _specs, rawSpecText: _rawSpecText, ...partSummary } = part;
        candidates.set(key, { ...candidate, part: partSummary });
      }
      return { category: change.category, partId: change.part.id };
    });
    const id = `upgrade-bundle-${index + 1}-${changes.map((change) => candidateKey(change.category, change.partId)).sort().join("|")}`;
    const { changes: _changes, ...metadata } = bundle;
    return { id, ...metadata, changes };
  });
  return { version: 1, candidates: [...candidates.values()], bundles: transportBundles };
}

export function upgradeBundlePartNeedsHydration(part: Part) {
  return Object.keys(part.specs).length === 0 && part.rawSpecText === undefined;
}

export function upgradeBundlesFromPayload(payload: UpgradeBundlePayload | undefined, hydratedParts?: ReadonlyMap<string, Part>): UpgradeBundleRecommendation[] | undefined {
  if (!payload || payload.version !== 1 || !Array.isArray(payload.candidates) || !Array.isArray(payload.bundles)) return undefined;
  const candidates = new Map(payload.candidates.map((candidate) => {
    const hydratedPart = hydratedParts?.get(candidate.part.id);
    const part = hydratedPart ?? { ...candidate.part, specs: {} };
    return [candidateKey(candidate.category, candidate.part.id), { ...candidate, part }] as const;
  }));
  const hydrated = payload.bundles.map((bundle) => {
    const changes = bundle.changes.map((change) => candidates.get(candidateKey(change.category, change.partId)));
    if (changes.some((change) => change === undefined)) return undefined;
    const { id: _id, changes: _references, ...metadata } = bundle;
    return { ...metadata, changes: changes as UpgradeBundleRecommendation["changes"] };
  });
  return hydrated.some((bundle) => bundle === undefined) ? undefined : hydrated as UpgradeBundleRecommendation[];
}
