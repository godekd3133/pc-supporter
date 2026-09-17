import { useEffect, useRef, useState } from "react";
import { FiCopy, FiExternalLink, FiInfo, FiRefreshCw, FiSearch, FiShare2, FiTrash2, FiXCircle } from "react-icons/fi";
import { alternativeComparisonLocalShareExpired } from "../shared/alternative-comparison-local-history";
import type { AlternativeComparisonLocalShareEntry } from "../shared/alternative-comparison-local-history";
import type { AlternativeComparisonSnapshot } from "../shared/alternative-comparison-share";
import { ApiError, api } from "./api";

type AlternativeComparisonShareHealthStatus = "checking" | "active" | "expired" | "revoked" | "error";

function shareHealthLabel(status: AlternativeComparisonShareHealthStatus) {
  return status === "checking" ? "상태 확인 중" : status === "active" ? "사용 가능" : status === "expired" ? "만료됨" : status === "revoked" ? "취소되었거나 없음" : "상태 확인 실패";
}

function shareHealthTone(status: AlternativeComparisonShareHealthStatus) {
  return status === "active" ? "active" : status === "checking" ? "checking" : status === "expired" || status === "revoked" ? "expired" : "error";
}

function healthFromError(error: unknown, localExpired: boolean): AlternativeComparisonShareHealthStatus {
  if (localExpired) return "expired";
  return error instanceof ApiError && error.status === 404 ? "revoked" : "error";
}

export function HomeAlternativeComparisonSharePanel({ entries, onCopy, onRemove, onRevoke, onToast }: { entries: AlternativeComparisonLocalShareEntry[]; onCopy: (entry: AlternativeComparisonLocalShareEntry) => void; onRemove: (id: string) => void; onRevoke: (entry: AlternativeComparisonLocalShareEntry) => Promise<boolean>; onToast: (message: string) => void }) {
  const [showAll, setShowAll] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [serverHealthById, setServerHealthById] = useState<Record<string, { status: AlternativeComparisonShareHealthStatus; checkedAt?: string }>>({});
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const refreshSequenceRef = useRef(0);
  const mountedRef = useRef(false);
  const mutationRequestVersionRef = useRef(0);
  const mutationContextKey = JSON.stringify(entries);
  const mutationContextKeyRef = useRef(mutationContextKey);
  const committedMutationContextKeyRef = useRef(mutationContextKey);
  mutationContextKeyRef.current = mutationContextKey;
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      mutationRequestVersionRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (committedMutationContextKeyRef.current === mutationContextKey) return;
    committedMutationContextKeyRef.current = mutationContextKey;
    mutationRequestVersionRef.current += 1;
    setRevokingId(null);
  }, [mutationContextKey]);
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase("ko-KR");
  const matchingEntries = normalizedSearchQuery
    ? entries.filter((entry) => `${entry.name} ${entry.category ?? ""} ${entry.currentPartName ?? ""} ${entry.currentPartSummary ?? ""} ${entry.currentPartPrice ?? ""} ${entry.id}`.toLocaleLowerCase("ko-KR").includes(normalizedSearchQuery))
    : entries;
  const showingAll = showAll || Boolean(normalizedSearchQuery);
  const visibleEntries = showingAll ? matchingEntries : matchingEntries.slice(0, 5);

  useEffect(() => {
    const sequence = ++refreshSequenceRef.current;
    let cancelled = false;
    if (visibleEntries.length === 0) {
      setServerHealthById({});
      return () => { cancelled = true; };
    }
    setServerHealthById((current) => Object.fromEntries(visibleEntries.map((entry) => [entry.id, { status: "checking" as const, ...(current[entry.id]?.checkedAt ? { checkedAt: current[entry.id].checkedAt } : {}) }])));
    void Promise.all(visibleEntries.map(async (entry) => {
      try {
        await api<AlternativeComparisonSnapshot>(`/api/comparisons/${encodeURIComponent(entry.id)}`, { retry: 1 });
        return [entry.id, { status: "active" as const, checkedAt: new Date().toISOString() }] as const;
      } catch (error: unknown) {
        return [entry.id, { status: healthFromError(error, alternativeComparisonLocalShareExpired(entry)), checkedAt: new Date().toISOString() }] as const;
      }
    })).then((rows) => {
      if (cancelled || refreshSequenceRef.current !== sequence) return;
      setServerHealthById(Object.fromEntries(rows));
    });
    return () => { cancelled = true; };
  }, [entries, refreshNonce, searchQuery, showAll]);

  if (entries.length === 0) return null;
  const refreshing = visibleEntries.some((entry) => serverHealthById[entry.id]?.status === "checking");

  async function revoke(entry: AlternativeComparisonLocalShareEntry) {
    if (!entry.ownerToken || revokingId) {
      if (!entry.ownerToken) onToast("이 링크는 취소용 owner token이 없어 서버에서 취소할 수 없어요. 브라우저 이력에서만 지울 수 있어요.");
      return;
    }
    if (!window.confirm("이 부품 비교 공유 링크를 취소할까요? 이미 전달된 링크도 더 이상 열리지 않아요.")) return;
    const requestVersion = ++mutationRequestVersionRef.current;
    const requestContextKey = mutationContextKey;
    const isCurrent = () => mountedRef.current && mutationRequestVersionRef.current === requestVersion && mutationContextKeyRef.current === requestContextKey;
    setRevokingId(entry.id);
    try {
      await onRevoke(entry);
      if (!isCurrent()) return;
    } finally {
      if (isCurrent()) setRevokingId(null);
    }
  }

  return <section className="home-alternative-comparison-shares" aria-label="최근 부품 비교 공유본" data-testid="home-alternative-comparison-shares">
    <div className="home-alternative-comparison-shares-heading"><div><p className="eyebrow">RECENT SHARES</p><h2><FiShare2 /> 최근 부품 비교 공유본</h2><p>이 브라우저에서 만든 부품 비교 공유본을 다시 열거나 링크를 복사할 수 있어요.</p></div><div className="home-alternative-comparison-shares-heading-actions"><span>{entries.length}개 저장해둠</span><button className="text-button home-alternative-comparison-share-refresh" type="button" onClick={() => setRefreshNonce((current) => current + 1)} disabled={refreshing || visibleEntries.length === 0}><FiRefreshCw className={refreshing ? "spin" : undefined} /> {refreshing ? "상태를 확인하는 중" : "서버 상태를 확인해요"}</button></div></div>
    {(entries.length > 5 || normalizedSearchQuery) && <div className="home-alternative-comparison-share-tools"><label><FiSearch /><span>공유 이력 검색</span><input type="search" aria-label="부품 비교 공유 이력 검색" placeholder="공유 이름·범주·현재 부품·사양·가격·ID 검색" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} /></label>{entries.length > 5 && <button className="text-button home-alternative-comparison-share-history-toggle" type="button" onClick={() => setShowAll((current) => !current)}>{showAll ? "최근 5개만 보기" : `전체 이력 보기 (${entries.length})`}</button>}<small>{normalizedSearchQuery ? `검색 결과 ${matchingEntries.length}개` : showingAll ? `전체 ${matchingEntries.length}개 표시` : `최근 ${Math.min(5, matchingEntries.length)}개 표시`}</small></div>}
    {visibleEntries.length === 0 ? <div className="home-alternative-comparison-share-empty"><FiSearch /><span>검색 조건에 맞는 공유 이력이 없어요.</span></div> : <div className="home-alternative-comparison-share-list">{visibleEntries.map((entry) => {
      const localExpired = alternativeComparisonLocalShareExpired(entry);
      const serverStatus = serverHealthById[entry.id]?.status ?? "checking";
      const status = localExpired ? "expired" : serverStatus;
      const statusTone = shareHealthTone(status);
      const checkedAt = serverHealthById[entry.id]?.checkedAt;
      const canRevoke = Boolean(entry.ownerToken) && status !== "expired" && status !== "revoked";
      return <article className={`home-alternative-comparison-share ${statusTone}`} key={entry.id}>
        <div className="home-alternative-comparison-share-main"><div><strong>{entry.name}</strong>{entry.category && <span>{entry.category}</span>}</div><small>{entry.currentPartName ? `현재 기준 ${entry.currentPartName} · ` : ""}만든 날 {new Date(entry.createdAt).toLocaleString("ko-KR")} · {entry.expiresAt ? `만료 ${new Date(entry.expiresAt).toLocaleString("ko-KR")}` : "기간 제한 없음"}{checkedAt ? ` · 확인한 시각 ${new Date(checkedAt).toLocaleTimeString("ko-KR")}` : ""}</small>{(entry.currentPartSummary || entry.currentPartPrice) && <div className="home-alternative-comparison-share-baseline" data-testid={`home-alternative-comparison-baseline-${entry.id}`}><span>현재 기준</span>{entry.currentPartSummary && <small>{entry.currentPartSummary}</small>}{entry.currentPartPrice && <strong>{entry.currentPartPrice}</strong>}</div>}</div>
        <span className={`home-alternative-comparison-share-status ${statusTone}`}><span className="status-dot" /> {shareHealthLabel(status)}</span>
        <div className="home-alternative-comparison-share-actions"><a className="button button-light" href={entry.url}>열어보기 <FiExternalLink /></a><button className="button button-light" type="button" onClick={() => onCopy(entry)} disabled={refreshing || revokingId !== null}><FiCopy /> 링크를 복사해요</button>{canRevoke && <button className="text-button danger-text-button" type="button" onClick={() => void revoke(entry)} disabled={refreshing || revokingId !== null}><FiXCircle /> {revokingId === entry.id ? "취소하는 중..." : "공유를 취소해요"}</button>}<button className="text-button danger-text-button" type="button" onClick={() => onRemove(entry.id)} disabled={refreshing || revokingId !== null}><FiTrash2 /> 이력에서 지워요</button></div>
      </article>;
    })}</div>}
    <p className="home-alternative-comparison-shares-note"><FiInfo /> <strong>서버 상태를 확인해요</strong>는 현재 표시되는 링크를 다시 조회해요. <strong>이력에서 지워요</strong>는 이 브라우저 목록만 정리하고, 링크 자체를 막으려면 <strong>공유를 취소해요</strong>를 사용하세요. 서버 취소는 링크를 만든 브라우저에 owner token이 있을 때만 가능해요.{entries.length > visibleEntries.length && !showingAll ? " 최근 5개만 보여드려요. 전체 이력 보기로 나머지를 확인할 수 있어요." : ""}</p>
  </section>;
}
