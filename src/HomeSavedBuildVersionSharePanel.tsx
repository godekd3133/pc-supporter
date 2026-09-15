import { useEffect, useRef, useState } from "react";
import { FiCopy, FiExternalLink, FiGitBranch, FiInfo, FiRefreshCw, FiSearch, FiShare2, FiTrash2, FiXCircle } from "react-icons/fi";
import type { SavedBuildVersionComparisonShareSnapshot } from "../shared/saved-build-version-share";
import { savedBuildVersionLocalShareExpired } from "../shared/saved-build-version-local-history";
import type { SavedBuildVersionLocalShareEntry } from "../shared/saved-build-version-local-history";
import { ApiError, api } from "./api";

type ShareHealthStatus = "checking" | "active" | "expired" | "revoked" | "error";
type ShareHealthFilter = "all" | "active" | "closed" | "review";

function healthLabel(status: ShareHealthStatus) {
  return status === "checking" ? "상태 확인 중" : status === "active" ? "사용 가능" : status === "expired" ? "만료됨" : status === "revoked" ? "취소되었거나 없음" : "상태 확인 실패";
}

function healthTone(status: ShareHealthStatus) {
  return status === "active" ? "active" : status === "checking" ? "checking" : status === "expired" || status === "revoked" ? "expired" : "error";
}

function healthFromError(error: unknown, localExpired: boolean): ShareHealthStatus {
  if (localExpired) return "expired";
  return error instanceof ApiError && error.status === 404 ? "revoked" : "error";
}

type ShareHealthMap = Record<string, { status: ShareHealthStatus; checkedAt?: string; beforeCatalogSnapshotAt?: string; afterCatalogSnapshotAt?: string; engineVersion?: string }>;

function shareEntryMatchesFilter(filter: ShareHealthFilter, entry: SavedBuildVersionLocalShareEntry, healthById: ShareHealthMap) {
  if (filter === "all") return true;
  const status = healthById[entry.id]?.status ?? "checking";
  if (filter === "active") return status === "active" && !savedBuildVersionLocalShareExpired(entry);
  if (filter === "closed") return savedBuildVersionLocalShareExpired(entry) || status === "expired" || status === "revoked";
  return status === "checking" || status === "error";
}

function filteredCountFor(filter: ShareHealthFilter, entries: SavedBuildVersionLocalShareEntry[], healthById: ShareHealthMap) {
  return entries.filter((entry) => shareEntryMatchesFilter(filter, entry, healthById)).length;
}

export function HomeSavedBuildVersionSharePanel({ entries, currentCatalogSnapshotAt, onCopy, onRemove, onRevoke, onToast }: { entries: SavedBuildVersionLocalShareEntry[]; currentCatalogSnapshotAt?: string; onCopy: (entry: SavedBuildVersionLocalShareEntry) => void; onRemove: (id: string) => void; onRevoke: (entry: SavedBuildVersionLocalShareEntry) => Promise<boolean>; onToast: (message: string) => void }) {
  const [showAll, setShowAll] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [healthFilter, setHealthFilter] = useState<ShareHealthFilter>("all");
  const [healthById, setHealthById] = useState<ShareHealthMap>({});
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
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase("ko-KR");
  const matchingEntries = normalizedQuery
    ? entries.filter((entry) => `${entry.name} ${entry.beforeName} ${entry.afterName} ${entry.beforeLabel} ${entry.afterLabel} ${entry.id}`.toLocaleLowerCase("ko-KR").includes(normalizedQuery))
    : entries;
  const showingAll = showAll || Boolean(normalizedQuery);
  const filteredEntries = matchingEntries.filter((entry) => shareEntryMatchesFilter(healthFilter, entry, healthById));
  const visibleEntries = showingAll ? filteredEntries : filteredEntries.slice(0, 5);

  useEffect(() => {
    const sequence = ++refreshSequenceRef.current;
    let cancelled = false;
    if (matchingEntries.length === 0) {
      setHealthById({});
      return () => { cancelled = true; };
    }
    setHealthById((current) => Object.fromEntries(matchingEntries.map((entry) => [entry.id, { status: "checking" as const, ...(current[entry.id]?.checkedAt ? { checkedAt: current[entry.id].checkedAt } : {}) }])));
    void Promise.all(matchingEntries.map(async (entry) => {
      try {
        const snapshot = await api<SavedBuildVersionComparisonShareSnapshot>(`/api/version-comparisons/${encodeURIComponent(entry.id)}`, { retry: 1 });
        return [entry.id, {
          status: "active" as const,
          checkedAt: new Date().toISOString(),
          ...(snapshot.payload.before.check?.catalogSnapshotAt ? { beforeCatalogSnapshotAt: snapshot.payload.before.check.catalogSnapshotAt } : {}),
          ...(snapshot.payload.after.check?.catalogSnapshotAt ? { afterCatalogSnapshotAt: snapshot.payload.after.check.catalogSnapshotAt } : {}),
          ...(snapshot.payload.after.check?.engineVersion ?? snapshot.payload.before.check?.engineVersion ? { engineVersion: snapshot.payload.after.check?.engineVersion ?? snapshot.payload.before.check?.engineVersion } : {})
        }] as const;
      } catch (error: unknown) {
        return [entry.id, { status: healthFromError(error, savedBuildVersionLocalShareExpired(entry)), checkedAt: new Date().toISOString() }] as const;
      }
    })).then((rows) => {
      if (cancelled || refreshSequenceRef.current !== sequence) return;
      setHealthById(Object.fromEntries(rows));
    });
    return () => { cancelled = true; };
  }, [entries, refreshNonce, searchQuery, showAll, healthFilter]);

  if (entries.length === 0) return null;
  const refreshing = visibleEntries.some((entry) => healthById[entry.id]?.status === "checking");

  async function revoke(entry: SavedBuildVersionLocalShareEntry) {
    if (!entry.ownerToken || revokingId) {
      if (!entry.ownerToken) onToast("이 링크에는 취소용 owner token이 없어 서버에서 취소할 수 없습니다. 브라우저 이력에서만 제거할 수 있습니다.");
      return;
    }
    if (!window.confirm("이 견적 버전 비교 공유 링크를 취소할까요? 이미 전달된 링크도 더 이상 열리지 않습니다.")) return;
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

  return <section className="home-alternative-comparison-shares" aria-label="최근 견적 버전 비교 공유" data-testid="home-saved-build-version-shares">
    <div className="home-alternative-comparison-shares-heading"><div><p className="eyebrow">RECENT VERSION SHARES</p><h2><FiGitBranch /> 최근 견적 버전 비교 공유</h2><p>이 브라우저에서 만든 버전 pair 저장본을 다시 열거나 링크를 복사할 수 있습니다.</p></div><div className="home-alternative-comparison-shares-heading-actions"><span>{entries.length}개 보관</span><button className="text-button" type="button" onClick={() => setRefreshNonce((current) => current + 1)} disabled={refreshing || visibleEntries.length === 0}><FiRefreshCw className={refreshing ? "spin" : undefined} /> {refreshing ? "상태 확인 중" : "서버 상태 확인"}</button></div></div>
    <div className="home-alternative-comparison-share-tools"><label><FiSearch /><span>버전 공유 이력 검색</span><input type="search" aria-label="견적 버전 비교 공유 이력 검색" placeholder="공유 이름·버전명·ID 검색" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} /></label>{entries.length > 5 && <button className="text-button" type="button" onClick={() => setShowAll((current) => !current)}>{showAll ? "최근 5개만 보기" : `전체 이력 보기 (${entries.length})`}</button>}<div className="home-saved-build-version-share-filters" role="group" aria-label="견적 버전 비교 공유 상태 필터">{([ ["all", "전체"], ["active", "사용 가능"], ["closed", "종료됨"], ["review", "확인 필요"] ] as Array<[ShareHealthFilter, string]>).map(([value, label]) => <button className={healthFilter === value ? "selected" : ""} type="button" aria-pressed={healthFilter === value} data-testid={`home-saved-build-version-filter-${value}`} onClick={() => setHealthFilter(value)} key={value}>{label}<span>{value === "all" ? matchingEntries.length : filteredCountFor(value, matchingEntries, healthById)}</span></button>)}</div><small>{normalizedQuery ? `검색 결과 ${matchingEntries.length}개` : showingAll ? `전체 ${filteredEntries.length}개 표시` : `최근 ${Math.min(5, filteredEntries.length)}개 표시`}</small></div>
    {visibleEntries.length === 0 ? <div className="home-alternative-comparison-share-empty"><FiSearch /><span>선택한 검색·상태 조건에 맞는 공유 이력이 없습니다.</span></div> : <div className="home-alternative-comparison-share-list">{visibleEntries.map((entry) => {
      const localExpired = savedBuildVersionLocalShareExpired(entry);
      const serverStatus = healthById[entry.id]?.status ?? "checking";
      const status = localExpired ? "expired" : serverStatus;
      const tone = healthTone(status);
      const health = healthById[entry.id];
      const checkedAt = health?.checkedAt;
      const catalogChangedSinceShare = Boolean(currentCatalogSnapshotAt && health?.afterCatalogSnapshotAt && Number.isFinite(Date.parse(currentCatalogSnapshotAt)) && Number.isFinite(Date.parse(health.afterCatalogSnapshotAt)) && Date.parse(currentCatalogSnapshotAt) !== Date.parse(health.afterCatalogSnapshotAt));
      const canRevoke = Boolean(entry.ownerToken) && status !== "expired" && status !== "revoked";
      return <article className={`home-alternative-comparison-share ${tone}`} key={entry.id}>
        <div className="home-alternative-comparison-share-main"><div><strong>{entry.name}</strong><span>{entry.beforeLabel} → {entry.afterLabel}</span></div><small>{entry.beforeName} → {entry.afterName} · 생성 {new Date(entry.createdAt).toLocaleString("ko-KR")} · {entry.expiresAt ? `만료 ${new Date(entry.expiresAt).toLocaleString("ko-KR")}` : "무기한"}{checkedAt ? ` · 확인 ${new Date(checkedAt).toLocaleTimeString("ko-KR")}` : ""}</small>{(health?.beforeCatalogSnapshotAt || health?.afterCatalogSnapshotAt) && <div className="home-alternative-comparison-share-baseline" data-testid={`home-saved-build-version-catalog-${entry.id}`}><span>저장 검사 기준</span>{health.beforeCatalogSnapshotAt && <small>{entry.beforeLabel} 카탈로그 {new Date(health.beforeCatalogSnapshotAt).toLocaleString("ko-KR")}</small>}{health.afterCatalogSnapshotAt && <small>{entry.afterLabel} 카탈로그 {new Date(health.afterCatalogSnapshotAt).toLocaleString("ko-KR")}</small>}{health.engineVersion && <strong>engine {health.engineVersion}</strong>}{catalogChangedSinceShare && <><em data-testid={`home-saved-build-version-catalog-changed-${entry.id}`}>현재 카탈로그 갱신 · 재검사 권장</em>{entry.afterBuildId && <a className="text-button home-saved-build-version-recheck" data-testid={`home-saved-build-version-recheck-${entry.id}`} href={`/share/${encodeURIComponent(entry.afterBuildId)}`}><FiRefreshCw /> 현재 기준 결과 열기</a>}</>}</div>}</div>
        <span className={`home-alternative-comparison-share-status ${tone}`}><span className="status-dot" /> {healthLabel(status)}</span>
        <div className="home-alternative-comparison-share-actions"><a className="button button-light" href={entry.url}>열기 <FiExternalLink /></a><button className="button button-light" type="button" onClick={() => onCopy(entry)} disabled={refreshing || revokingId !== null}><FiCopy /> 링크 복사</button>{canRevoke && <button className="text-button danger-text-button" type="button" onClick={() => void revoke(entry)} disabled={refreshing || revokingId !== null}><FiXCircle /> {revokingId === entry.id ? "취소 중..." : "공유 취소"}</button>}<button className="text-button danger-text-button" type="button" onClick={() => onRemove(entry.id)} disabled={refreshing || revokingId !== null}><FiTrash2 /> 이력에서 제거</button></div>
      </article>;
    })}</div>}
    <p className="home-alternative-comparison-shares-note"><FiInfo /> <strong>서버 상태 확인</strong>은 표시된 버전 비교 링크를 다시 조회합니다. <strong>이력에서 제거</strong>는 이 브라우저 목록만 정리하고, 링크 자체를 막으려면 <strong>공유 취소</strong>를 사용하세요.</p>
  </section>;
}
