import { describe, expect, it } from "vitest";
import { browserNotificationEnabledFromStorage, browserNotificationIdsFromJson, browserNotificationIdsToJson, browserNotificationPermissionFromUnknown, browserNotificationPermissionLabel, mergeBrowserNotificationIds } from "./browser-notification";

describe("browser notification preferences", () => {
  it("normalizes permission and enabled state without granting permission", () => {
    expect(browserNotificationPermissionFromUnknown("granted")).toBe("granted");
    expect(browserNotificationPermissionFromUnknown("prompt")).toBe("unsupported");
    expect(browserNotificationPermissionLabel("denied")).toBe("차단됨");
    expect(browserNotificationEnabledFromStorage("true")).toBe(true);
    expect(browserNotificationEnabledFromStorage(null)).toBe(false);
  });

  it("keeps a bounded, deduplicated notification delivery ledger", () => {
    const parsed = browserNotificationIdsFromJson(JSON.stringify(["a", "a", "", { bad: true }]));
    expect(parsed).toEqual(["a"]);
    expect(browserNotificationIdsFromJson(browserNotificationIdsToJson(["a", "b", "a"]))).toEqual(["a", "b"]);
    expect(mergeBrowserNotificationIds(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
    expect(JSON.parse(browserNotificationIdsToJson(Array.from({ length: 110 }, (_, index) => String(index))))).toHaveLength(100);
  });
});
