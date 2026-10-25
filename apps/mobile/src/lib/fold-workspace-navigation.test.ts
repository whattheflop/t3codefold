import { describe, expect, it } from "vite-plus/test";

import {
  resolveAdaptiveWorkspaceBackAction,
  shouldRestorePrimarySidebar,
} from "./fold-workspace-navigation";

describe("resolveAdaptiveWorkspaceBackAction", () => {
  it("unwinds the Fold workspace before leaving the thread", () => {
    expect(
      resolveAdaptiveWorkspaceBackAction({
        auxiliaryPaneMaximized: true,
        auxiliaryPaneVisible: true,
        primarySidebarVisible: false,
      }),
    ).toBe("restore-inspector");
    expect(
      resolveAdaptiveWorkspaceBackAction({
        auxiliaryPaneVisible: true,
        primarySidebarVisible: false,
      }),
    ).toBe("close-inspector");
    expect(
      resolveAdaptiveWorkspaceBackAction({
        auxiliaryPaneVisible: false,
        primarySidebarVisible: false,
      }),
    ).toBe("show-sidebar");
    expect(
      resolveAdaptiveWorkspaceBackAction({
        auxiliaryPaneVisible: false,
        primarySidebarVisible: true,
      }),
    ).toBe("navigate");
  });
});

describe("shouldRestorePrimarySidebar", () => {
  it("restores navigation after a maximized thread is closed", () => {
    expect(shouldRestorePrimarySidebar({ usesSplitView: true, pathname: "/" })).toBe(true);
  });

  it("does not override the user's maximized preference inside a thread", () => {
    expect(
      shouldRestorePrimarySidebar({
        usesSplitView: true,
        pathname: "/threads/environment/thread",
      }),
    ).toBe(false);
  });
});
