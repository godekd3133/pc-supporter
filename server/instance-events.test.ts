import { describe, expect, it } from "vitest";
import { configFileReplicationPayloadFor, INSTANCE_EVENT_PAYLOAD_LIMIT_BYTES, INSTANCE_ID } from "./instance-events";

describe("instance event bus", () => {
  it("인스턴스 ID는 호스트·PID·토큰을 묶어 노드를 구분한다", () => {
    expect(INSTANCE_ID).toMatch(/-.+-\w{8}$/);
  });

  it("설정 복제는 본문이 한도 안이면 그대로 싣는다", () => {
    const payload = configFileReplicationPayloadFor("engine-generation-options", { variantPriorities: ["balanced"], budgetLadderDownMultiplier: 0.8 });
    expect(payload).toEqual({ name: "engine-generation-options", content: { variantPriorities: ["balanced"], budgetLadderDownMultiplier: 0.8 } });
  });

  it("본문이 pg_notify 한도를 넘으면 무효화 신호만 남긴다", () => {
    const huge = { blob: "x".repeat(INSTANCE_EVENT_PAYLOAD_LIMIT_BYTES) };
    expect(configFileReplicationPayloadFor("engine-target-filters", huge)).toEqual({ name: "engine-target-filters" });
    // 정확히 경계에 있는 본문은 그대로 싣는다.
    const edge = { blob: "x".repeat(INSTANCE_EVENT_PAYLOAD_LIMIT_BYTES - 40) };
    expect(configFileReplicationPayloadFor("engine-target-filters", edge).content).toEqual(edge);
  });
});
