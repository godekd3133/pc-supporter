import type { Part } from "../shared/types";

function timestamp(value: string | undefined): number {
  const parsed = value === undefined ? NaN : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function priceObservationTime(part: Part, requireExplicitObservation = false): number {
  return Math.max(timestamp(part.priceCheckedAt ?? (requireExplicitObservation ? undefined : part.updatedAt)), timestamp(part.priceUnavailableAt));
}

function listingObservationTime(part: Part): number {
  // The crawler can record a delisting without refreshing the previous price.
  return Math.max(timestamp(part.updatedAt), timestamp(part.delistedAt));
}

/** Merge an already matched product without conflating price and listing observations. */
export function mergeReferenceCatalogPart(current: Part, reference: Part): Part {
  let merged: Part = current;
  // A physical-spec timestamp cannot contradict an explicit observation of no offers.
  const hasUnavailableObservation = Boolean(current.priceUnavailableAt || reference.priceUnavailableAt);
  if (priceObservationTime(current, hasUnavailableObservation) < priceObservationTime(reference, hasUnavailableObservation)) {
    const hasReviewedSpecs = Boolean(current.specs.catalogSpecProvenance || current.specs.physicalEvidenceSourceUrl);
    merged = {
      ...current,
      ...reference,
      id: current.id,
      imageUrl: reference.imageUrl ?? current.imageUrl,
      specs: hasReviewedSpecs ? { ...reference.specs, ...current.specs } : { ...current.specs, ...reference.specs },
      ...(hasReviewedSpecs ? { dataQuality: current.dataQuality, missingFields: [...current.missingFields] } : {})
    };
  }

  // Spreading an unavailable reference over a priced record must actually remove the old field.
  if (merged !== current) {
    if (reference.priceUnavailableAt && timestamp(reference.priceUnavailableAt) >= timestamp(reference.priceCheckedAt)) {
      delete merged.priceWon;
    } else {
      delete merged.priceUnavailableAt;
    }
  }

  const currentListingTime = listingObservationTime(current);
  const referenceListingTime = listingObservationTime(reference);
  const listing = currentListingTime > referenceListingTime
    ? current
    : referenceListingTime > currentListingTime
      ? reference
      // A tied active snapshot must not erase a recorded sales stop.
      : current.delistedAt ? current : reference;
  const updatedAt = timestamp(current.updatedAt) >= timestamp(reference.updatedAt) ? current.updatedAt : reference.updatedAt;
  if (merged.delistedAt === listing.delistedAt && merged.updatedAt === updatedAt) return merged;

  const result: Part = { ...merged, updatedAt };
  if (listing.delistedAt !== undefined) result.delistedAt = listing.delistedAt;
  else delete result.delistedAt;
  return result;
}
