import { describe, expect, it } from "vite-plus/test";

import {
  constrainFoldablePaneWidth,
  deriveFoldWorkspacePaneLayout,
  deriveHingeSnapWidths,
  deriveWorkspaceFoldRegions,
  resolvePaneDividerRelease,
} from "./foldable-pane-layout";
import { deriveLayout } from "./layout";

describe("constrainFoldablePaneWidth", () => {
  it("lets either pane become compact in an unfolded workspace", () => {
    expect(constrainFoldablePaneWidth({ preferredWidth: 0, availableWidth: 800 })).toBe(72);
    expect(constrainFoldablePaneWidth({ preferredWidth: 800, availableWidth: 800 })).toBe(728);
  });
});

describe("resolvePaneDividerRelease", () => {
  const range = { min: 72, max: 728 };

  it("rests the pane where the divider was released, within its range", () => {
    expect(resolvePaneDividerRelease({ startWidth: 300, translationX: -100, range })).toEqual({
      kind: "resize",
      width: 400,
    });
    expect(resolvePaneDividerRelease({ startWidth: 300, translationX: 260, range })).toEqual({
      kind: "resize",
      width: 72,
    });
  });

  it("maximizes or closes only when dragged clearly past either end", () => {
    expect(resolvePaneDividerRelease({ startWidth: 700, translationX: -60, range })).toEqual({
      kind: "resize",
      width: 728,
    });
    expect(resolvePaneDividerRelease({ startWidth: 700, translationX: -120, range })).toEqual({
      kind: "maximize",
    });
    expect(resolvePaneDividerRelease({ startWidth: 300, translationX: 300, range })).toEqual({
      kind: "close",
    });
  });

  it("restores a maximized pane when dragged back into range", () => {
    expect(resolvePaneDividerRelease({ startWidth: 800, translationX: 400, range })).toEqual({
      kind: "resize",
      width: 400,
    });
    expect(resolvePaneDividerRelease({ startWidth: 800, translationX: 10, range })).toEqual({
      kind: "maximize",
    });
  });

  it("snaps to a nearby snap width such as the hinge", () => {
    expect(
      resolvePaneDividerRelease({ startWidth: 300, translationX: -110, range, snapWidths: [400] }),
    ).toEqual({ kind: "resize", width: 400 });
    expect(
      resolvePaneDividerRelease({ startWidth: 300, translationX: -10, range, snapWidths: [400] }),
    ).toEqual({ kind: "resize", width: 310 });
  });
});

describe("deriveHingeSnapWidths", () => {
  it("places the divider on a vertical fold", () => {
    expect(
      deriveHingeSnapWidths({
        hinges: [{ left: 420, right: 420, orientation: "vertical" }],
        windowWidth: 840,
        trailingInset: 0,
      }),
    ).toEqual([420]);
    expect(
      deriveHingeSnapWidths({
        hinges: [{ left: 400, right: 440, orientation: "vertical" }],
        windowWidth: 900,
        trailingInset: 24,
      }),
    ).toEqual([456]);
  });

  it("ignores horizontal (tabletop) folds", () => {
    expect(
      deriveHingeSnapWidths({
        hinges: [{ left: 0, right: 840, orientation: "horizontal" }],
        windowWidth: 840,
        trailingInset: 0,
      }),
    ).toEqual([]);
  });
});

describe("fold workspace regions", () => {
  const input = { width: 900, height: 1000, leadingInset: 20, trailingInset: 24 };
  it("excludes an occluded vertical hinge from both usable regions", () => {
    const regions = deriveWorkspaceFoldRegions({
      ...input,
      hinges: [
        {
          left: 400,
          right: 440,
          top: 0,
          bottom: 1000,
          orientation: "vertical",
          state: "flat",
          separating: true,
        },
      ],
    });
    expect(regions.vertical).toEqual({ leadingWidth: 380, gap: 40, trailingWidth: 436 });
    expect(regions.presetKey).toBe("separating:portrait:medium");
  });
  it("adopts horizontal half-open posture and restores flat layout", () => {
    const hinge = {
      left: 0,
      right: 900,
      top: 490,
      bottom: 510,
      orientation: "horizontal" as const,
      state: "halfOpened" as const,
      separating: true,
    };
    expect(deriveWorkspaceFoldRegions({ ...input, hinges: [hinge] }).tabletop).toEqual({
      top: 490,
      gap: 20,
    });
    expect(
      deriveWorkspaceFoldRegions({ ...input, hinges: [{ ...hinge, state: "flat" }] }).tabletop,
    ).toBeNull();
    expect(
      deriveWorkspaceFoldRegions({ ...input, hinges: [{ ...hinge, top: 80 }] }).tabletop,
    ).toBeNull();
  });
  it("keeps the pane preset as a window resizes within its posture class", () => {
    expect(deriveWorkspaceFoldRegions({ ...input, hinges: [] }).presetKey).toBe(
      deriveWorkspaceFoldRegions({ ...input, width: 800, hinges: [] }).presetKey,
    );
    expect(deriveWorkspaceFoldRegions({ ...input, width: 1400, hinges: [] }).presetKey).not.toBe(
      deriveWorkspaceFoldRegions({ ...input, hinges: [] }).presetKey,
    );
  });
});

describe("Fold-class deriveLayout", () => {
  it.each([
    { posture: "folded portrait", width: 384, height: 832, expected: "compact" },
    { posture: "unfolded portrait", width: 768, height: 900, expected: "split" },
    { posture: "unfolded landscape", width: 900, height: 768, expected: "split" },
    { posture: "half-width multi-window", width: 600, height: 900, expected: "compact" },
    { posture: "short landscape or tabletop", width: 900, height: 450, expected: "compact" },
  ])(
    "uses the $expected workspace for a Fold-class $posture window",
    ({ width, height, expected }) => {
      expect(deriveLayout({ width, height }).variant).toBe(expected);
    },
  );
});

describe("Android adaptive windows", () => {
  it("supports a wide short Android window without changing iPhone landscape", () => {
    expect(deriveLayout({ width: 840, height: 360, platform: "android" }).usesSplitView).toBe(true);
    expect(deriveLayout({ width: 840, height: 360, platform: "ios" }).usesSplitView).toBe(false);
    expect(deriveLayout({ width: 600, height: 900, platform: "android" }).usesSplitView).toBe(
      false,
    );
    expect(deriveLayout({ width: 840, height: 280, platform: "android" }).usesSplitView).toBe(
      false,
    );
  });
});

describe("deriveFoldWorkspacePaneLayout", () => {
  // Galaxy Z Fold-class inner display, landscape.
  const foldLayout = deriveLayout({ width: 900, height: 700 });
  const tabletLayout = deriveLayout({ width: 1_366, height: 1_024 });
  const base = {
    primarySidebarPreferredVisible: true,
    auxiliaryPanePreferredVisible: true,
    auxiliaryPaneRegistered: true,
  } as const;

  it.each([true, false])("remembers sidebar expansion while compact: %s", (visible) => {
    expect(
      deriveFoldWorkspacePaneLayout({
        ...base,
        layout: deriveLayout({ width: 384, height: 832 }),
        viewportWidth: 384,
        primarySidebarPreferredVisible: visible,
      }),
    ).toMatchObject({ primarySidebarVisible: false, primarySidebarWhenExpanded: visible });
  });

  it("shows sidebar, chat and inspector together when the chat stays readable", () => {
    expect(
      deriveFoldWorkspacePaneLayout({ ...base, layout: tabletLayout, viewportWidth: 1_366 }),
    ).toMatchObject({
      primarySidebarVisible: true,
      primarySidebarSuppressedByAuxiliary: false,
      auxiliaryPaneVisible: true,
      auxiliaryPaneWidth: 276,
      contentPaneWidth: 1_366 - 380 - 276,
    });
  });

  it("lets the sidebar yield when the inspector would squeeze the chat", () => {
    expect(
      deriveFoldWorkspacePaneLayout({ ...base, layout: foldLayout, viewportWidth: 900 }),
    ).toMatchObject({
      primarySidebarVisible: false,
      primarySidebarSuppressedByAuxiliary: true,
      auxiliaryPaneWidth: 260,
      contentPaneWidth: 900 - 260,
    });
  });

  it("takes no space until a route registers inspector content", () => {
    expect(
      deriveFoldWorkspacePaneLayout({
        ...base,
        layout: foldLayout,
        viewportWidth: 900,
        auxiliaryPaneRegistered: false,
      }),
    ).toMatchObject({
      primarySidebarVisible: true,
      auxiliaryPaneVisible: false,
      contentPaneWidth: 900 - (foldLayout.listPaneWidth ?? 0),
    });
  });

  it("gives a maximized inspector the whole workspace and remembers the sidebar", () => {
    expect(
      deriveFoldWorkspacePaneLayout({
        ...base,
        layout: tabletLayout,
        viewportWidth: 1_366,
        auxiliaryPaneMaximized: true,
      }),
    ).toMatchObject({
      primarySidebarVisible: false,
      primarySidebarSuppressedByAuxiliary: true,
      auxiliaryPaneMaximized: true,
      auxiliaryPaneWidth: 1_366,
      contentPaneWidth: 0,
    });
  });

  it("ignores maximize while the inspector is hidden", () => {
    expect(
      deriveFoldWorkspacePaneLayout({
        ...base,
        layout: tabletLayout,
        viewportWidth: 1_366,
        auxiliaryPanePreferredVisible: false,
        auxiliaryPaneMaximized: true,
      }),
    ).toMatchObject({ auxiliaryPaneMaximized: false, primarySidebarVisible: true });
  });

  it("lets either side of the divider become a compact sliver", () => {
    const wide = deriveFoldWorkspacePaneLayout({
      ...base,
      layout: foldLayout,
      viewportWidth: 900,
      auxiliaryPanePreferredWidth: 2_000,
    });
    expect(wide).toMatchObject({ auxiliaryPaneWidth: 828, contentPaneWidth: 72 });
    expect(wide.auxiliaryPaneWidthRange).toEqual({ min: 72, max: 828 });
    expect(
      deriveFoldWorkspacePaneLayout({
        ...base,
        layout: foldLayout,
        viewportWidth: 900,
        auxiliaryPanePreferredWidth: 0,
      }).auxiliaryPaneWidth,
    ).toBe(72);
  });

  it("never exposes workspace panes in compact layouts", () => {
    expect(
      deriveFoldWorkspacePaneLayout({
        ...base,
        layout: deriveLayout({ width: 390, height: 844 }),
        viewportWidth: 390,
      }),
    ).toMatchObject({
      primarySidebarVisible: false,
      supportsAuxiliaryPane: false,
      auxiliaryPaneVisible: false,
      contentPaneWidth: 390,
    });
  });
});
