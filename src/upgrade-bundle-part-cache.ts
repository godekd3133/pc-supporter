import type { Part } from "../shared/types";
import { api } from "./api";

export type PartDetailsLoader = (partId: string, catalogSnapshotAt?: string) => Promise<Part>;
export type PartDetailsBatchLoader = (partIds: string[], catalogSnapshotAt?: string) => Promise<Part[]>;

function cacheKey(partId: string, catalogSnapshotAt?: string) {
  return `${catalogSnapshotAt?.trim() || "current"}:${partId}`;
}

export function createPartDetailsCache(loader: PartDetailsLoader, batchLoader?: PartDetailsBatchLoader) {
  const values = new Map<string, Part>();
  const pending = new Map<string, Promise<Part>>();

  async function get(partId: string, catalogSnapshotAt?: string) {
    const key = cacheKey(partId, catalogSnapshotAt);
    const cached = values.get(key);
    if (cached) return cached;
    const running = pending.get(key);
    if (running) return running;
    const request = loader(partId, catalogSnapshotAt)
      .then((part) => {
        values.set(key, part);
        return part;
      })
      .finally(() => {
        pending.delete(key);
      });
    pending.set(key, request);
    return request;
  }

  async function prefetch(partIds: string[], catalogSnapshotAt?: string) {
    const uniquePartIds = [...new Set(partIds.filter((partId) => partId.trim()))];
    const targetPartIds = uniquePartIds.filter((partId) => {
      const key = cacheKey(partId, catalogSnapshotAt);
      return !values.has(key) && !pending.has(key);
    });
    if (targetPartIds.length === 0) return;
    if (!batchLoader) {
      await Promise.all(targetPartIds.map((partId) => get(partId, catalogSnapshotAt)));
      return;
    }
    const batchRequest = batchLoader(targetPartIds, catalogSnapshotAt);
    await Promise.all(targetPartIds.map((partId) => {
      const key = cacheKey(partId, catalogSnapshotAt);
      const request = batchRequest
        .then((parts) => {
          const part = parts.find((item) => item.id === partId);
          if (!part) throw new Error(`${partId} 상세 부품을 찾을 수 없습니다.`);
          values.set(key, part);
          return part;
        })
        .finally(() => {
          pending.delete(key);
        });
      pending.set(key, request);
      return request;
    }));
  }

  return {
    get,
    prefetch,
    has: (partId: string, catalogSnapshotAt?: string) => values.has(cacheKey(partId, catalogSnapshotAt)),
    clear: () => {
      values.clear();
      pending.clear();
    }
  };
}

export const upgradeBundlePartDetailsCache = createPartDetailsCache(
  (partId) => api<Part>(`/api/parts/${encodeURIComponent(partId)}`, { retry: 1 }),
  (partIds) => api<{ items: Part[] }>(`/api/parts/batch?ids=${encodeURIComponent(partIds.join(","))}`, { retry: 1 }).then((payload) => payload.items)
);
