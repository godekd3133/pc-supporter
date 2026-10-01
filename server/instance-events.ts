// 인스턴스 간 이벤트 버스 — Postgres LISTEN/NOTIFY 기반.
//
// 대규모 배포에서 여러 API/워커 인스턴스가 같은 DB를 공유할 때, in-process
// 상태(인메모리 캐시·실패 로그)가 인스턴스마다 따로 놀지 않게 한다.
//
// 발행 경로는 두 가지다.
//  - 트랜잭션 내부 발행: 쓰기 트랜잭션 안의 `SELECT pg_notify(...)` — 커밋될
//    때만 이벤트가 나가고 롤백되면 사라진다(데이터 쓰기에 사용).
//  - 독립 발행: 버스 커넥션의 `SELECT pg_notify(...)` — 트랜잭션 밖의 관측성
//    이벤트(견적 실패 기록 등)에 사용.
//
// LISTEN은 연결 수명 동안 유지돼야 하므로 전용 Client를 둔다 — 일반 풀을 쓰면
// 커넥션 반납 시 구독이 끊긴다. 풀과 별개의 연결이라 순환 import도 없다.
import { Client } from "pg";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

// 인스턴스 식별자 — 헬스/메트릭/이벤트 페이로드에 실어 어떤 노드가
// 응답·발행했는지 운영 화면에서 구분한다.
export const INSTANCE_ID = `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;

export const INSTANCE_EVENTS_CHANNEL = "pc_supporter_instance_events";

export type InstanceEventKind = "cache-invalidate:catalog" | "cache-invalidate:accessories" | "generation-failure";

export type InstanceEvent = {
  kind: InstanceEventKind;
  source: string;
  at: number;
  data?: unknown;
};

export type InstanceEventHandler = (event: InstanceEvent) => void;

type QueryCapableClient = Pick<Client, "query">;

const RECONNECT_DELAY_MS = 5_000;

let listenerClient: Client | null = null;
let listenerReady = false;
let reconnectTimer: NodeJS.Timeout | null = null;
let stopped = false;

// 트랜잭션 내부 발행 — 커밋과 원자적으로 묶인다.
export async function publishInstanceEventTransactional(client: QueryCapableClient, kind: InstanceEventKind, data?: unknown) {
  await client.query("SELECT pg_notify($1::text, $2::text)", [
    INSTANCE_EVENTS_CHANNEL,
    JSON.stringify({ kind, source: INSTANCE_ID, at: Date.now(), data } satisfies InstanceEvent)
  ]);
}

// 트랜잭션 밖 독립 발행 — 버스 커넥션이 없으면 조용히 생략한다(테스트·
// 스크립트 등 구독자가 없는 환경에서 쓰기를 깨지 않기 위해).
export async function publishInstanceEvent(kind: InstanceEventKind, data?: unknown) {
  const client = listenerClient;
  if (!client || !listenerReady) return;
  try {
    await publishInstanceEventTransactional(client, kind, data);
  } catch {
    listenerReady = false;
  }
}

export function startInstanceEventBus(handler: InstanceEventHandler) {
  if (!process.env.DATABASE_URL?.trim()) return;
  stopped = false;
  const connect = async () => {
    if (stopped) return;
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    try {
      await client.connect();
      await client.query(`LISTEN ${INSTANCE_EVENTS_CHANNEL}`);
    } catch {
      await client.end().catch(() => undefined);
      scheduleReconnect();
      return;
    }
    listenerClient = client;
    listenerReady = true;
    client.on("notification", (message) => {
      if (message.channel !== INSTANCE_EVENTS_CHANNEL || !message.payload) return;
      try {
        const event = JSON.parse(message.payload) as InstanceEvent;
        if (event.kind === "cache-invalidate:catalog" || event.kind === "cache-invalidate:accessories" || event.kind === "generation-failure") {
          handler(event);
        }
      } catch {
        // 다른 발행자의 이상한 페이로드는 무시한다.
      }
    });
    const onLost = () => {
      if (listenerClient !== client) return;
      listenerReady = false;
      listenerClient = null;
      scheduleReconnect();
    };
    client.once("error", onLost);
    client.once("end", onLost);
  };
  const scheduleReconnect = () => {
    if (reconnectTimer || stopped) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, RECONNECT_DELAY_MS);
    reconnectTimer.unref();
  };
  void connect();
}

export async function stopInstanceEventBus() {
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

export function instanceEventBusReady() {
  return listenerReady;
}
