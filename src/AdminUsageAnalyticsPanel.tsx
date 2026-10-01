import { useCallback, useEffect, useState } from "react";
import { FiActivity, FiAlertTriangle, FiBarChart2, FiLoader, FiRefreshCw, FiRepeat, FiTrendingDown, FiUsers } from "react-icons/fi";
import { api } from "./api";

type UsageAnalyticsDailyRow = { day: string; events: number; visitors: number; sessions: number; appOpens: number };
type UsageAnalyticsFunnelRow = { key: string; label: string; visitors: number; conversionFromStart: number; conversionFromPrev: number; dropFromPrev: number; exitedHere: number };
type UsageAnalyticsOnboardingRow = { step: string; label: string; visitors: number };
type UsageAnalyticsViewRow = { view: string; label: string; events: number; visitors: number };
type UsageAnalyticsEventRow = { event: string; count: number; visitors: number };
type UsageAnalyticsCohortRow = { day: string; size: number; day1: number; day7: number; day30: number };

export type UsageAnalyticsResponse = {
  generatedAt: string;
  rangeDays: number;
  totals: {
    events: number;
    visitors: number;
    sessions: number;
    appOpens: number;
    recommendRequests: number;
    recommendSuccesses: number;
    recommendSuccessRate: number;
    checkSuccesses: number;
    saves: number;
    shares: number;
  };
  daily: UsageAnalyticsDailyRow[];
  funnel: UsageAnalyticsFunnelRow[];
  onboarding: UsageAnalyticsOnboardingRow[];
  views: UsageAnalyticsViewRow[];
  events: UsageAnalyticsEventRow[];
  retention: { cohorts: UsageAnalyticsCohortRow[] };
  sessions: { count: number; avgEventsPerSession: number; avgSessionMinutes: number; bounceRate: number };
};

const RANGE_OPTIONS = [7, 30, 90] as const;

function percentText(value: number) {
  return `${(value * 100).toFixed(value > 0 && value < 0.1 ? 1 : 0)}%`;
}

function shortDay(day: string) {
  return day.slice(5);
}

export function AdminUsageAnalyticsPanel({ onToast }: { onToast: (message: string) => void }) {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<UsageAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (rangeDays: number) => {
    setLoading(true);
    try {
      const payload = await api<UsageAnalyticsResponse>(`/api/admin/usage-analytics?days=${rangeDays}`);
      setData(payload);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "사용 통계를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(days); }, [days, load]);

  const maxDailyVisitors = data ? Math.max(1, ...data.daily.map((row) => row.visitors)) : 1;
  const maxFunnelVisitors = data && data.funnel.length > 0 ? Math.max(1, data.funnel[0].visitors) : 1;
  const maxOnboardingVisitors = data ? Math.max(1, ...data.onboarding.map((row) => row.visitors)) : 1;
  const onboardingStarters = data ? Math.max(1, data.onboarding[0]?.visitors ?? 0) : 1;
  const avgRetention = data && data.retention.cohorts.length > 0
    ? {
        day1: data.retention.cohorts.reduce((sum, row) => sum + row.day1 * row.size, 0) / data.retention.cohorts.reduce((sum, row) => sum + row.size, 0),
        day7: data.retention.cohorts.reduce((sum, row) => sum + row.day7 * row.size, 0) / data.retention.cohorts.reduce((sum, row) => sum + row.size, 0),
        day30: data.retention.cohorts.reduce((sum, row) => sum + row.day30 * row.size, 0) / data.retention.cohorts.reduce((sum, row) => sum + row.size, 0)
      }
    : null;

  return <section className="admin-card usage-analytics-card" data-testid="admin-usage-analytics">
    <div className="admin-card-heading">
      <div><p className="eyebrow">데이터 드리븐</p><h3>사용자 흐름 통계</h3></div>
      <div className="usage-analytics-controls">
        <div className="usage-analytics-range" role="group" aria-label="분석 기간">
          {RANGE_OPTIONS.map((option) => <button key={option} className={`usage-analytics-range-button${days === option ? " on" : ""}`} type="button" onClick={() => setDays(option)}>{option}일</button>)}
        </div>
        <button className="button button-light button-small" type="button" onClick={() => void load(days)} disabled={loading}>{loading ? <FiLoader className="spin" /> : <FiRefreshCw />} 새로고침</button>
      </div>
    </div>
    <p className="admin-card-description">
      익명 방문자 키 기준으로 유저 여정을 집계합니다. 앱 방문 → 온보딩 → 견적 생성·검사 → 결과 → 저장·공유 단계의 전환율과 이탈, 코호트 리텐션을 확인할 수 있습니다. 이벤트는 최대 95일 보존됩니다.
    </p>
    {loading && !data
      ? <p className="generation-failure-state"><FiLoader className="spin" /> 사용 통계를 집계하는 중...</p>
      : error && !data
        ? <div className="generation-failure-state error" role="alert"><FiAlertTriangle /><span>{error}</span><button className="button button-light button-small" type="button" onClick={() => void load(days)}>다시 불러오기</button></div>
        : data === null || data.totals.events === 0
          ? <p className="generation-failure-state"><FiActivity /> 아직 수집된 사용 이벤트가 없습니다. 클라이언트 배포 후 이벤트가 쌓이면 이곳에 표시됩니다.</p>
          : <>
            <div className="usage-analytics-summary" data-testid="usage-analytics-summary">
              <div className="usage-analytics-stat"><span><FiUsers /> 방문자</span><strong>{data.totals.visitors.toLocaleString("ko-KR")}</strong></div>
              <div className="usage-analytics-stat"><span><FiRepeat /> 세션</span><strong>{data.totals.sessions.toLocaleString("ko-KR")}</strong></div>
              <div className="usage-analytics-stat"><span><FiActivity /> 이벤트</span><strong>{data.totals.events.toLocaleString("ko-KR")}</strong></div>
              <div className="usage-analytics-stat"><span>견적 생성 성공률</span><strong>{percentText(data.totals.recommendSuccessRate)}</strong><small>{data.totals.recommendSuccesses.toLocaleString("ko-KR")}/{data.totals.recommendRequests.toLocaleString("ko-KR")}건</small></div>
              <div className="usage-analytics-stat"><span>견적 저장</span><strong>{data.totals.saves.toLocaleString("ko-KR")}</strong><small>공유 {data.totals.shares.toLocaleString("ko-KR")}건</small></div>
              <div className="usage-analytics-stat"><span>세션 평균</span><strong>{data.sessions.avgEventsPerSession.toFixed(1)}건</strong><small>체류 {data.sessions.avgSessionMinutes.toFixed(1)}분 · 바운스 {percentText(data.sessions.bounceRate)}</small></div>
            </div>

            <div className="usage-analytics-block">
              <h4><FiBarChart2 /> 핵심 퍼널 <small>방문자 기준 · 이전 단계 이후 도달만 계산</small></h4>
              <div className="usage-analytics-funnel" role="table" aria-label="사용자 퍼널">
                {data.funnel.map((stage) => <div className="usage-analytics-funnel-row" key={stage.key}>
                  <span className="usage-analytics-funnel-label">{stage.label}</span>
                  <span className="usage-analytics-funnel-bar"><i style={{ width: `${Math.max(2, (stage.visitors / maxFunnelVisitors) * 100)}%` }} /></span>
                  <span className="usage-analytics-funnel-count">{stage.visitors.toLocaleString("ko-KR")}명</span>
                  <span className="usage-analytics-funnel-rate">{percentText(stage.conversionFromPrev)}</span>
                  <span className={`usage-analytics-funnel-drop${stage.dropFromPrev > 0.3 ? " warn" : ""}`} title="이전 단계 대비 이탈">{stage.key === "visit" ? "-" : <><FiTrendingDown /> {percentText(stage.dropFromPrev)}</>}</span>
                </div>)}
              </div>
            </div>

            <div className="usage-analytics-grid">
              <div className="usage-analytics-block">
                <h4>온보딩 단계별 도달 <small>각 단계를 본 고유 방문자 · 첫 단계 대비</small></h4>
                <div className="usage-analytics-steps">
                  {data.onboarding.map((step) => <div className="usage-analytics-step" key={step.step}>
                    <span className="usage-analytics-step-label">{step.label}</span>
                    <span className="usage-analytics-step-bar"><i style={{ width: `${Math.max(0, (step.visitors / maxOnboardingVisitors) * 100)}%` }} /></span>
                    <span className="usage-analytics-step-count">{step.visitors.toLocaleString("ko-KR")}</span>
                    <span className="usage-analytics-step-share">{percentText(step.visitors / onboardingStarters)}</span>
                  </div>)}
                </div>
              </div>

              <div className="usage-analytics-block">
                <h4>화면별 도달 <small>라우트 뷰 이벤트</small></h4>
                <table className="usage-analytics-table">
                  <thead><tr><th>화면</th><th>방문자</th><th>조회</th></tr></thead>
                  <tbody>
                    {data.views.slice(0, 10).map((view) => <tr key={view.view}><td>{view.label}</td><td>{view.visitors.toLocaleString("ko-KR")}</td><td>{view.events.toLocaleString("ko-KR")}</td></tr>)}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="usage-analytics-block">
              <h4>일별 방문 추이 <small>고유 방문자 · 앱 열기 이벤트</small></h4>
              <div className="usage-analytics-daily" role="img" aria-label="일별 고유 방문자 추이">
                {data.daily.map((row) => <div className="usage-analytics-daily-col" key={row.day} title={`${row.day} · 방문자 ${row.visitors}명 · 앱 열기 ${row.appOpens}건 · 세션 ${row.sessions}`}>
                  <i style={{ height: `${Math.max(2, (row.visitors / maxDailyVisitors) * 100)}%` }} />
                  <span>{shortDay(row.day)}</span>
                </div>)}
              </div>
            </div>

            <div className="usage-analytics-grid">
              <div className="usage-analytics-block">
                <h4>리텐션 코호트 <small>첫 방문일 기준 재방문율{avgRetention ? ` · 평균 D+1 ${percentText(avgRetention.day1)} / D+7 ${percentText(avgRetention.day7)} / D+30 ${percentText(avgRetention.day30)}` : ""}</small></h4>
                {data.retention.cohorts.length === 0
                  ? <p className="usage-analytics-empty">코호트 데이터가 없습니다.</p>
                  : <table className="usage-analytics-table">
                    <thead><tr><th>첫 방문일</th><th>신규 방문자</th><th>D+1</th><th>D+7</th><th>D+30</th></tr></thead>
                    <tbody>
                      {data.retention.cohorts.map((cohort) => <tr key={cohort.day}>
                        <td>{cohort.day}</td>
                        <td>{cohort.size.toLocaleString("ko-KR")}</td>
                        <td className={cohort.day1 >= 0.3 ? "good" : ""}>{percentText(cohort.day1)}</td>
                        <td className={cohort.day7 >= 0.15 ? "good" : ""}>{percentText(cohort.day7)}</td>
                        <td>{percentText(cohort.day30)}</td>
                      </tr>)}
                    </tbody>
                  </table>}
              </div>

              <div className="usage-analytics-block">
                <h4>이벤트 분포 <small>발생 횟수 · 고유 방문자</small></h4>
                <table className="usage-analytics-table">
                  <thead><tr><th>이벤트</th><th>횟수</th><th>방문자</th></tr></thead>
                  <tbody>
                    {data.events.slice(0, 16).map((event) => <tr key={event.event}><td><code>{event.event}</code></td><td>{event.count.toLocaleString("ko-KR")}</td><td>{event.visitors.toLocaleString("ko-KR")}</td></tr>)}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="usage-analytics-footnote">집계 시각 {new Date(data.generatedAt).toLocaleString("ko-KR")} · 분석 기간 최근 {data.rangeDays}일</p>
          </>}
  </section>;
}
