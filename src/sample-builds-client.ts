// 견본견적 클라이언트 로더 — 마법사의 예산 버튼 가격과 결과 화면의 등급 바꾸기가
// 같은 응답을 쓰도록 모듈 단위로 한 번만 요청한다.
import { useEffect, useState } from "react";
import { api } from "./api";
import type { ResolvedSampleBuild, SampleBuildsPayload } from "../shared/sample-builds";

let pending: Promise<SampleBuildsPayload> | null = null;
let loadedAt = 0;
const MAX_AGE_MS = 5 * 60_000;

export function loadSampleBuilds(options: { force?: boolean } = {}): Promise<SampleBuildsPayload> {
  if (!pending || options.force || Date.now() - loadedAt > MAX_AGE_MS) {
    loadedAt = Date.now();
    pending = api<SampleBuildsPayload>("/api/sample-builds", { retry: 1, retryOnRateLimit: true }).catch((error: unknown) => {
      pending = null;
      throw error;
    });
  }
  return pending;
}

export type SampleBuildsState = { status: "loading" } | { status: "ready"; payload: SampleBuildsPayload } | { status: "error"; message: string };

export function useSampleBuilds(enabled = true): SampleBuildsState {
  const [state, setState] = useState<SampleBuildsState>({ status: "loading" });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    loadSampleBuilds()
      .then((payload) => { if (!cancelled) setState({ status: "ready", payload }); })
      .catch((error: unknown) => { if (!cancelled) setState({ status: "error", message: error instanceof Error ? error.message : "견본 견적을 불러오지 못했어요." }); });
    return () => { cancelled = true; };
  }, [enabled]);
  return state;
}

export function resolvedSampleById(payload: SampleBuildsPayload | undefined, id: string | undefined): ResolvedSampleBuild | undefined {
  return payload && id ? payload.samples.find((sample) => sample.id === id) : undefined;
}

/** 만원 단위 반올림 표기 — 예산 버튼과 등급 바꾸기 차액에 쓴다. */
export function formatManWonRounded(won: number) {
  return `${Math.round(won / 10_000).toLocaleString("ko-KR")}만원`;
}
