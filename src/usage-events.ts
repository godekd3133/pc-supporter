import { apiRequestUrl } from "./api";

// Phase 0 최소 이벤트 비컨: 익명 카운터 전용, 실패해도 앱 동작에 영향 없음.
// 재시도/로딩 상태를 만들지 않기 위해 api() 대신 raw fetch를 사용한다.
export function trackUsageEvent(name: "app_open") {
  try {
    if (name === "app_open") {
      // StrictMode 이중 마운트·라우트 전환 재실행을 세션당 1회로 흡수한다.
      if (sessionStorage.getItem("pc-supporter-app-opened")) return;
      sessionStorage.setItem("pc-supporter-app-opened", "1");
    }
    void fetch(apiRequestUrl("/api/events"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    }).catch(() => undefined);
  } catch {
    // telemetry는 절대 앱을 깨지 않는다
  }
}
