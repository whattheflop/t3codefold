import { describe, expect, it } from "vite-plus/test";

import { derivePendingUserInputFullScreenLayout } from "./pendingUserInputFullScreenLayout";

describe("derivePendingUserInputFullScreenLayout", () => {
  it("fills a folded phone width", () => {
    expect(derivePendingUserInputFullScreenLayout({ windowWidth: 393 })).toEqual({
      horizontalPadding: 16,
      contentMaxWidth: 361,
    });
  });

  it("caps the measure on an unfolded foldable", () => {
    expect(derivePendingUserInputFullScreenLayout({ windowWidth: 1024 })).toEqual({
      horizontalPadding: 32,
      contentMaxWidth: 720,
    });
  });

  it("spends medium widths on padding before line length", () => {
    expect(derivePendingUserInputFullScreenLayout({ windowWidth: 673 })).toEqual({
      horizontalPadding: 24,
      contentMaxWidth: 625,
    });
  });
});
