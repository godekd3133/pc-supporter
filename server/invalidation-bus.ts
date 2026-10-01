// 인스턴스 간 인메모리 캐시 무효화 버스 — Postgres LISTEN/NOTIFY를 쓴다.
//
// 다중 인스턴스에서 한 인스턴스가 카탈로그/주변 부품 데이터를 갱신하면 다른
// 인스턴스의 in-process 캐시(호환 평가·부품 평가 캐시)가 TTL이 끝날 때까지
// 오래된 결과를 돌려줄 수 있다. 쓰기 트랜잭션 안에서 pg_notify로 발행하면
// 커밋과 함께만 발행되고, 모든 리스너(발행 인스턴스 자신 포함)가 즉시
// 캐시를 무효화한다.
//
// LISTEN은 연결 수명 동안 유지돼야 해서 전용 Client를 둔다 — 일반 풀을 쓰면
// 커넥션이 반납될 때 구독이 끊긴다. 풀과 별개의 연결이라 순환 import도 없다.
import { Client } from "pg";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

// 인스턴스 식별자 — 헬스/메트릭에도 실어두면 어느 노드가 요청을 처리했는지
// 확인할 수 있다.
export const INSTANCE_ID = `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;

const INVALIDATION_CHANNEL = "pc_supporter_cache_invalidate";
const RECONNECT_DELAY_MS = 5_000;

export type CacheInvalidationKind = "catalog" | "accessories";

export type InvalidationHandlers = Record<CacheInvalidationKind, () => void>;

type BusClient = Pick<Client, "connect" | "query" | "end"> & {
  on: (event: "notification", listener: (message: { channel: string; payload?: string }) => void) => void;
  once?: (event: "error" | "end", listener: () => void) => void;
};

let listenerClient: Client | null = null;
let listenerReady = false;
let reconnectTimer: NodeJS.Timeout | null = null;
let stopped = false;

// 쓰기 트랜잭션 안에서 호출 — 커밋될 때만 발행되고 롤백되면 사라진다.
// 발행은 로컬 LISTEN에도 되돌아오므로 자기 캐시도 같은 경로로 무효화된다.
export function cacheInvalidationNotifySql() {
  return { channel: INVALIDATION_CHANNEL };
}

export function invalidationPayloadFor(kind: CacheInvalidationKind) {
  return JSON.stringify({ kind, source: INSTANCE_ID, at: Date.now() });
}

export function startInvalidationBus(handlers: InvalidationHandlers) {
  if (!process.env.DATABASE_URL?.trim()) return;
  stopped = false;
  const connect = async () => {
    if (stopped) return;
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    try {
      await client.connect();
      await client.query(`LISTEN ${INVALIDATION_CHANNEL}`);
    } catch {
      await client.end().catch(() => undefined);
      scheduleReconnect(handlers);
      return;
    }
    listenerClient = client;
    listenerReady = true;
    client.on("notification", (message) => {
      if (message.channel !== INVALIDATION_CHANNEL || !message.payload) return;
      try {
        const payload = JSON.parse(message.payload) as { kind?: CacheInvalidationKind };
        if (payload.kind === "catalog" || payload.kind === "accessories") handlers[payload.kind]();
      } catch {
        // 다른 발행자의 이상한 페이로드는 무시한다.
      }
    });
    const onLost = () => {
      if (listenerClient !== client) return;
      listenerReady = false;
      listenerClient = null;
      scheduleReconnect(handlers);
    };
    client.once?.("error", onLost);
    client.once?.("end", onLost);
  };
  const scheduleReconnect = (handlersArg: InvalidationHandlers) => {
    if (reconnectTimer || stopped) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, RECONNECT_DELAY_MS);
    reconnectTimer.unref();
  };
  void connect();
}

export async function stopInvalidationBus() {
  stopped = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const client = listenerClient;
  listenerClient = null;
  listenerReady = false;
  if (client) await client.end().catch(() => undefined);
}

export function invalidationBusReady() {
  return listenerReady;
}
