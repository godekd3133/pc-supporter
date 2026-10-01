import { beforeEach, describe, expect, it } from "vitest";
import { safeLocalStorage } from "./safe-storage";
import {
  ENGAGEMENT_FLAGS_STORAGE_KEY,
  journeyStepsFor,
  markEngagementFlag,
  nextJourneyAction,
  readEngagementFlags,
  resultNextActionsFor,
  type JourneyInput
} from "./user-journey";

const baseInput: JourneyInput = {
  hasDraft: false,
  hasResult: false,
  savedBuildCount: 0,
  watchlistCount: 0,
  trendViewed: false
};

describe("journeyStepsFor", () => {
  it("비어있는 상태에서는 세 단계 모두 미완료다", () => {
    const steps = journeyStepsFor(baseInput);
    expect(steps.map((step) => step.id)).toEqual(["first_build", "watching", "trend"]);
    expect(steps.map((step) => step.done)).toEqual([false, false, false]);
  });

  it("저장 견적이 있으면 첫 단계가 완료된다", () => {
    const steps = journeyStepsFor({ ...baseInput, savedBuildCount: 1 });
    expect(steps[0].done).toBe(true);
    expect(steps[1].done).toBe(false);
  });

  it("초안만 있으면 첫 단계는 아직 미완료다", () => {
    const steps = journeyStepsFor({ ...baseInput, hasDraft: true });
    expect(steps[0].done).toBe(false);
  });

  it("가격 추적 등록 수와 추이 조회 플래그로 후반 단계를 판정한다", () => {
    const steps = journeyStepsFor({ ...baseInput, hasResult: true, watchlistCount: 2, trendViewed: true });
    expect(steps.map((step) => step.done)).toEqual([true, true, true]);
  });
});

describe("nextJourneyAction", () => {
  it("신규 유저는 새 견적 시작을 안내받는다", () => {
    const action = nextJourneyAction(baseInput);
    expect(action?.step).toBe("first_build");
    expect(action?.action).toBe("start");
  });

  it("작성 중 초안이 있으면 이어서 만들기를 안내한다", () => {
    const action = nextJourneyAction({ ...baseInput, hasDraft: true });
    expect(action?.action).toBe("resume");
  });

  it("견적을 만들었으면 가격 추적을 제안한다", () => {
    const action = nextJourneyAction({ ...baseInput, hasResult: true });
    expect(action?.step).toBe("watching");
    expect(action?.action).toBe("watchlist");
  });

  it("추적 중이고 추이를 안 봤으면 추이 확인을 제안한다", () => {
    const action = nextJourneyAction({ ...baseInput, hasResult: true, watchlistCount: 2 });
    expect(action?.step).toBe("trend");
    expect(action?.action).toBe("result-trend");
  });

  it("결과 없이 추적만 하면 추이는 추적 화면으로 보낸다", () => {
    const action = nextJourneyAction({ ...baseInput, hasResult: false, savedBuildCount: 1, watchlistCount: 1 });
    expect(action?.step).toBe("trend");
    expect(action?.action).toBe("watchlist");
  });

  it("모든 단계 완료 시 루프 재시작을 제안한다", () => {
    const action = nextJourneyAction({ hasDraft: false, hasResult: true, savedBuildCount: 1, watchlistCount: 2, trendViewed: true });
    expect(action?.step).toBe("loop");
    expect(action?.action).toBe("start");
  });
});

describe("resultNextActionsFor", () => {
  it("미저장·미추적 결과에서는 저장과 가격 추적이 먼저다", () => {
    const actions = resultNextActionsFor({ ...baseInput, hasResult: true }, { saved: false, comparable: false });
    expect(actions.map((action) => action.action)).toEqual(["save", "watchlist", "start"]);
  });

  it("저장·추적 완료 결과에서는 추이 확인과 새 견적을 제안한다", () => {
    const actions = resultNextActionsFor({ ...baseInput, hasResult: true, watchlistCount: 1 }, { saved: true, comparable: true });
    expect(actions.map((action) => action.action)).toEqual(["result-trend", "start", "history"]);
  });

  it("루프를 다 돈 결과에서는 새 견적과 비교를 제안한다", () => {
    const actions = resultNextActionsFor(
      { hasDraft: true, hasResult: true, savedBuildCount: 2, watchlistCount: 1, trendViewed: true },
      { saved: true, comparable: true }
    );
    expect(actions.map((action) => action.action)).toEqual(["start", "history"]);
  });
});

describe("engagement flags", () => {
  beforeEach(() => {
    safeLocalStorage.removeItem(ENGAGEMENT_FLAGS_STORAGE_KEY);
  });

  it("플래그가 없으면 빈 객체를 반환한다", () => {
    expect(readEngagementFlags()).toEqual({});
  });

  it("플래그를 기록하고 다시 읽는다", () => {
    markEngagementFlag("comparedAt");
    markEngagementFlag("trendViewedAt");
    const flags = readEngagementFlags();
    expect(typeof flags.comparedAt).toBe("string");
    expect(typeof flags.trendViewedAt).toBe("string");
  });

  it("깨진 JSON은 빈 객체로 처리한다", () => {
    safeLocalStorage.setItem(ENGAGEMENT_FLAGS_STORAGE_KEY, "{oops");
    expect(readEngagementFlags()).toEqual({});
  });
});
