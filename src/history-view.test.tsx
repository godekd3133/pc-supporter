import { describe, expect, it } from "vitest";
import { historyGridClassNameForItemCount } from "./HistoryView";

describe("saved build history grid layout", () => {
  it("centers only a single visible build while keeping the multi-item grid class unchanged", () => {
    expect(historyGridClassNameForItemCount(1)).toBe("history-grid history-grid-single-item");
    expect(historyGridClassNameForItemCount(2)).toBe("history-grid");
    expect(historyGridClassNameForItemCount(3)).toBe("history-grid");
  });
});
