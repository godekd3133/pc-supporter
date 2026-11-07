import { INSTANCE_ID } from "../instance-events";
import { persistenceDiagnostics } from "../repository";
import { adminSecurityStatus } from "../auth";
import { ENGINE_VERSION } from "../../shared/domain/engine";
import { clientUsageEventsFromRequest, recordClientUsageEvents } from "../usage-events";
import { type Express } from "express";
import { createRateLimitMiddleware } from "./route-support";

const usageEventRateLimit = createRateLimitMiddleware("usage-event", { limit: 60, windowMs: 60_000 });

export function registerSystemRoutes(app: Express) {
// LB 헬스 체크용 가벼운 liveness — DB/보안 진단 없이 프로세스 생존만 답한다.
// 준비 상태(readiness)는 아래 /api/health가 담당한다.
app.get("/api/health/live", (_request, response) => {
  response.json({ ok: true, service: "pc-supporter", instanceId: INSTANCE_ID });
});

app.get("/api/health", async (_request, response) => {
  const persistence = await persistenceDiagnostics();
  const adminSecurity = adminSecurityStatus();
  const ok = persistence.ready && adminSecurity.productionReady;
  response.status(ok ? 200 : 503).json({ ok, service: "pc-supporter", engineVersion: ENGINE_VERSION, instanceId: INSTANCE_ID, persistence, adminSecurity });
});

// 클라이언트는 퍼널 이벤트 화이트리스트만 전송할 수 있다 — check/save/share/
// recommend는 서버 route handler에서 직접 계수해 이중 계수를 막는다.
// 단일 {name} 형태와 {visitorId, sessionId, events:[...]} 배치를 모두 받는다.
app.post("/api/events", usageEventRateLimit, async (request, response) => {
  const batch = clientUsageEventsFromRequest(request.body);
  if (!batch) {
    response.status(400).json({ error: "지원하지 않는 이벤트입니다.", code: "USAGE_EVENT_INVALID" });
    return;
  }
  try {
    await recordClientUsageEvents(batch);
  } catch (eventError) {
    console.warn(JSON.stringify({ event: "usage-event.persist-failed", error: eventError instanceof Error ? eventError.message : String(eventError) }));
  }
  response.status(204).end();
});
}
