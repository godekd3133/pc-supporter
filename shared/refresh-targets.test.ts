import { describe, expect, it } from "vitest";
import { uniqueRefreshTargets } from "./refresh-targets";

describe("refresh target selection", () => {
  it("deduplicates by catalog type and id", () => {
    expect(uniqueRefreshTargets([
      { kind: "part", id: "cpu-1" },
      { kind: "part", id: "cpu-1" },
      { kind: "accessory", id: "cpu-1" }
    ])).toEqual([
      { kind: "part", id: "cpu-1" },
      { kind: "accessory", id: "cpu-1" }
    ]);
  });

  it("keeps the first targets up to the bounded batch size", () => {
    const targets = Array.from({ length: 14 }, (_value, index) => ({ kind: "part" as const, id: `part-${index}` }));

    expect(uniqueRefreshTargets(targets, 12)).toHaveLength(12);
    expect(uniqueRefreshTargets(targets, 12).at(-1)?.id).toBe("part-11");
  });

  it("does not mutate the input array", () => {
    const targets = [{ kind: "part" as const, id: "part-1" }, { kind: "part" as const, id: "part-2" }];
    const copy = [...targets];

    uniqueRefreshTargets(targets, 1);

    expect(targets).toEqual(copy);
  });
});
