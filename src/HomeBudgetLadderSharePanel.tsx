import { useEffect, useRef, useState } from "react";
import { FiCopy, FiExternalLink, FiInfo, FiRefreshCw, FiSearch, FiShare2, FiTrash2, FiXCircle } from "react-icons/fi";
import { budgetLadderLocalShareExpired } from "../shared/budget-ladder-local-history";
import type { BudgetLadderLocalShareEntry } from "../shared/budget-ladder-local-history";
import type { BudgetLadderShareSnapshot } from "../shared/budget-ladder-share";
import { budgetLadderShareHealthFromHttp, budgetLadderShareHealthLabel, budgetLadderShareHealthTone, type BudgetLadderShareHealthStatus } from "../shared/budget-ladder-share-health";
import { ApiError, api } from "./api";
import { HomeBudgetLadderRevokeDialog } from "./HomeBudgetLadderRevokeDialog";

export function HomeBudgetLadderSharePanel({ entries, onCopy, onRemove, onToast }: { entries: BudgetLadderLocalShareEntry[]; onCopy: (entry: BudgetLadderLocalShareEntry) => void; onRemove: (id: string) => void; onToast: (message: string) => void }) {
  const [pendingRevoke, setPendingRevoke] = useState<BudgetLadderLocalShareEntry | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase("ko-KR");
  const matchingEntries = normalizedSearchQuery
    ? entries.filter((entry) => `${entry.name} v${entry.versionNumber ?? 1} ${entry.id}`.toLocaleLowerCase("ko-KR").includes(normalizedSearchQuery))
    : entries;
  const showingAll = showAll || Boolean(normalizedSearchQuery);
  const visibleEntries = showingAll ? matchingEntries : matchingEntries.slice(0, 5);
  const [serverHealthById, setServerHealthById] = useState<Record<string, { status: BudgetLadderShareHealthStatus; checkedAt?: string; catalogChangedSinceShare?: boolean }>>({});
  const [refreshNonce, setRefreshNonce] = useState(0);
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
    setPendingRevoke(null);
    setRevokingId(null);
  }, [mutationContextKey]);

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
        const snapshot = await api<BudgetLadderShareSnapshot>(`/api/budget-ladders/${encodeURIComponent(entry.id)}`, { retry: 1 });
        return [entry.id, { status: "active" as const, checkedAt: new Date().toISOString(), ...(snapshot.catalogChangedSinceShare === true ? { catalogChangedSinceShare: true } : {}) }] as const;
      } catch (reason: unknown) {
        const status = reason instanceof ApiError ? budgetLadderShareHealthFromHttp(reason.status, reason.message) : "error" as const;
        return [entry.id, { status, checkedAt: new Date().toISOString() }] as const;
      }
    })).then((rows) => {
      if (cancelled || refreshSequenceRef.current !== sequence) return;
      setServerHealthById(Object.fromEntries(rows));
    });
    return () => { cancelled = true; };
  }, [entries, refreshNonce, showAll, searchQuery]);

  if (entries.length === 0) return null;
  const refreshing = visibleEntries.some((entry) => serverHealthById[entry.id]?.status === "checking");

  async function confirmRevoke() {
    const entry = pendingRevoke;
    if (!entry?.ownerToken || revokingId) return;
    const requestVersion = ++mutationRequestVersionRef.current;
    const requestContextKey = mutationContextKey;
    const isCurrent = () => mountedRef.current && mutationRequestVersionRef.current === requestVersion && mutationContextKeyRef.current === requestContextKey;
    setRevokingId(entry.id);
    try {
      await api(`/api/budget-ladders/${encodeURIComponent(entry.id)}`, { method: "DELETE", headers: { "X-Share-Owner-Token": entry.ownerToken }, retry: 0 });
      if (!isCurrent()) return;
      onRemove(entry.id);
      setPendingRevoke(null);
      onToast("공유 저장본을 서버에서 취소했고, 이 브라우저 이력에서도 제거했어요.");
    } catch (error: unknown) {
      if (isCurrent()) onToast(error instanceof Error ? error.message : "공유 저장본을 서버에서 취소하지 못했어요.");
    } finally {
      if (isCurrent()) setRevokingId(null);
    }
  }

  return <>
  <section className="home-budget-ladder-shares" aria-label="최근 예산 비교 공유본" data-testid="home-budget-ladder-shares">
    <div className="home-budget-ladder-shares-heading"><div><p className="eyebrow">RECENT SHARES</p><h2><FiShare2 /> 최근 예산 비교 공유본</h2><p>이 브라우저에서 만든 공유본을 다시 열거나 링크를 복사할 수 있어요.</p></div><div className="home-budget-ladder-shares-heading-actions"><span>{entries.length}개 저장해둠</span><button className="text-button home-budget-ladder-share-refresh" type="button" onClick={() => setRefreshNonce((current) => current + 1)} disabled={refreshing || visibleEntries.length === 0}><FiRefreshCw className={refreshing ? "spin" : undefined} /> {refreshing ? "상태를 확인하는 중" : "최신 상태로 다시 확인해요"}</button></div></div>
    {entries.length > 5 && <div className="home-budget-ladder-share-tools"><label><FiSearch /><span>공유 이력 검색</span><input type="search" aria-label="공유 이력 검색" placeholder="공유 이름·버전·ID 검색" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} /></label><button className="text-button home-budget-ladder-share-history-toggle" type="button" data-testid="toggle-budget-ladder-share-history" onClick={() => setShowAll((current) => !current)}>{showAll ? "최근 5개만 보기" : `전체 이력 보기 (${entries.length})`}</button><small>{normalizedSearchQuery ? `검색 결과 ${matchingEntries.length}개` : showingAll ? `전체 ${matchingEntries.length}개 표시` : `최근 ${Math.min(5, matchingEntries.length)}개 표시`}</small></div>}
    {visibleEntries.length === 0 ? <div className="home-budget-ladder-share-empty"><FiSearch /><span>검색 조건에 맞는 공유 이력이 없어요.</span></div> : <div className="home-budget-ladder-share-list">
      {visibleEntries.map((entry) => {
        const localExpired = budgetLadderLocalShareExpired(entry);
        const serverStatus = serverHealthById[entry.id]?.status ?? "unknown";
        const statusLabel = budgetLadderShareHealthLabel(serverStatus, localExpired);
        const statusTone = budgetLadderShareHealthTone(serverStatus, localExpired);
        const canRevoke = Boolean(entry.ownerToken) && serverStatus !== "expired" && serverStatus !== "revoked";
        const checkedAt = serverHealthById[entry.id]?.checkedAt;
        const catalogChanged = serverHealthById[entry.id]?.catalogChangedSinceShare === true;
        return <article className={`home-budget-ladder-share ${statusTone === "expired" ? "expired" : catalogChanged ? "catalog-changed" : "active"}`} key={entry.id}>
          <div className="home-budget-ladder-share-main"><div><strong>{entry.name}</strong>{entry.versionNumber !== undefined && <span>v{entry.versionNumber}</span>}</div><small>만든 날 {new Date(entry.createdAt).toLocaleString("ko-KR")} · {entry.expiresAt ? `만료 ${new Date(entry.expiresAt).toLocaleString("ko-KR")}` : "기간 제한 없음"}{checkedAt ? ` · 확인한 시각 ${new Date(checkedAt).toLocaleTimeString("ko-KR")}` : ""}</small>{catalogChanged && <small className="home-budget-ladder-share-catalog-changed"><FiRefreshCw /> 공유한 뒤 부품 정보가 바뀌었어요 · 지금 기준으로 다시 만들어보세요.</small>}</div>
          <span className={`home-budget-ladder-share-status ${statusTone}`}><span className="status-dot" /> {statusLabel}</span>
          <div className="home-budget-ladder-share-actions"><a className="button button-light" href={entry.url}>열어보기 <FiExternalLink /></a><button className="button button-light" type="button" data-testid={`copy-budget-ladder-share-${entry.id}`} onClick={() => onCopy(entry)} disabled={refreshing || revokingId !== null}><FiCopy /> 링크를 복사해요</button>{canRevoke && <button className="text-button danger-text-button home-budget-ladder-share-revoke" type="button" data-testid={`revoke-budget-ladder-share-${entry.id}`} onClick={() => setPendingRevoke(entry)} disabled={refreshing || revokingId !== null}><FiXCircle /> {revokingId === entry.id ? "취소하는 중..." : "공유를 취소해요"}</button>}<button className="text-button danger-text-button home-budget-ladder-share-remove" type="button" data-testid={`remove-budget-ladder-share-${entry.id}`} onClick={() => onRemove(entry.id)} disabled={refreshing || revokingId !== null}><FiTrash2 /> 이력에서 지워요</button></div>
        </article>;
      })}
    </div>}
  <p className="home-budget-ladder-shares-note"><FiInfo /> <strong>최신 상태로 다시 확인해요</strong>는 지금 표시되는 링크를 다시 확인해요. <strong>이력에서 지워요</strong>는 이 브라우저 목록만 정리하고, 내가 만든 링크를 더 이상 열지 못하게 하려면 <strong>공유를 취소해요</strong>를 사용하세요.{entries.length > visibleEntries.length && !showingAll ? " 최근 5개만 보여드려요. 전체 이력 보기로 나머지를 확인할 수 있어요." : ""}</p>
  </section>
  {pendingRevoke && <HomeBudgetLadderRevokeDialog entry={pendingRevoke} submitting={revokingId === pendingRevoke.id} onClose={() => setPendingRevoke(null)} onConfirm={() => void confirmRevoke()} />}
  </>;
}
