import { describe, expect, it } from "vitest";
import { INSTANCE_ID } from "./instance-events";

describe("instance event bus", () => {
  it("인스턴스 ID는 호스트·PID·토큰을 묶어 노드를 구분한다", () => {
    expect(INSTANCE_ID).toMatch(/-.+-\w{8}$/);
  });
});
