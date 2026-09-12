import type { AccessoryItem, BuildSelection, Part, PartSelection } from "./types";

type BuildSelectionHydrationRequestInit = RequestInit & {
  retry?: number;
  retryOnRateLimit?: boolean;
};

type BuildSelectionHydrationRequest = <T>(path: string, init?: BuildSelectionHydrationRequestInit) => Promise<T>;

export async function hydrateBuildSelection(nextBuild: BuildSelection, partMap: ReadonlyMap<string, Part>, accessoryMap: ReadonlyMap<string, AccessoryItem>, request: BuildSelectionHydrationRequest, rememberParts: (parts: Part[]) => void, rememberAccessories: (items: AccessoryItem[]) => void, signal?: AbortSignal) {
  const selections = [nextBuild.cpu, nextBuild.cooler, nextBuild.motherboard, nextBuild.gpu, nextBuild.case, nextBuild.psu, ...nextBuild.memory, ...nextBuild.ssd, ...nextBuild.hdd]
    .filter((selection): selection is PartSelection => Boolean(selection));
  const missingPartIds = [...new Set(selections.map((selection) => selection.partId))]
    .filter((partId) => !partMap.has(partId));
  const missingAccessoryIds = [...new Set((nextBuild.accessories ?? []).map((selection) => selection.accessoryId))]
    .filter((accessoryId) => !accessoryMap.has(accessoryId));
  if (missingPartIds.length === 0 && missingAccessoryIds.length === 0) return;
  const [parts, accessories] = await Promise.all([
    missingPartIds.length === 0
      ? Promise.resolve([] as Part[])
      : request<{ items: Part[] }>("/api/parts/batch", { method: "POST", body: JSON.stringify({ ids: missingPartIds }), retry: 1, retryOnRateLimit: true, signal }).then((payload) => payload.items).catch(() => [] as Part[]),
    missingAccessoryIds.length === 0
      ? Promise.resolve([] as AccessoryItem[])
      : request<{ items: AccessoryItem[] }>("/api/accessories/batch", { method: "POST", body: JSON.stringify({ ids: missingAccessoryIds }), retry: 1, retryOnRateLimit: true, signal }).then((payload) => payload.items).catch(() => [] as AccessoryItem[])
  ]);
  rememberParts(parts);
  rememberAccessories(accessories);
}
