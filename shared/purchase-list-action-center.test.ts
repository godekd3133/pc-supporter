import { describe, expect, it } from "vitest";
import { purchaseListActionCenterFor } from "./purchase-list-action-center";

describe("purchase list action center", () => {
  it("prioritizes evidence checks before ordering and installation", () => {
    const actions = purchaseListActionCenterFor({ total: 10, dataReviewCount: 2, priceReviewCount: 3, statusCounts: { planned: 4, ordered: 1, received: 2, installed: 3 } });
    expect(actions.map((action) => action.kind)).toEqual(["data-review", "price-review", "order", "receive", "install"]);
    expect(actions[0]).toMatchObject({ count: 2, priority: 100 });
  });

  it("returns no next-action cards when the purchase list is fully installed and verified", () => {
    expect(purchaseListActionCenterFor({ total: 4, dataReviewCount: 0, priceReviewCount: 0, statusCounts: { planned: 0, ordered: 0, received: 0, installed: 4 } })).toEqual([]);
  });
});
