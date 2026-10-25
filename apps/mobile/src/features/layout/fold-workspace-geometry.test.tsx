import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const window = vi.hoisted(() => ({ width: 800, height: 900 }));
const insets = vi.hoisted(() => ({ top: 24, bottom: 24, left: 0, right: 0 }));
vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  useWindowDimensions: () => window,
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => insets }));
vi.mock("../../native/native-layout-metrics", () => ({ useNativeLayoutMetrics: () => null }));
vi.mock("../../native/T3WindowPosture", () => ({ useWindowPosture: () => ({ hinges: [] }) }));
vi.mock("../workspace/AndroidWorkspaceNavigation", () => ({ ANDROID_WORKSPACE_RAIL_WIDTH: 72 }));

import { useFoldWorkspaceGeometry } from "./fold-workspace-geometry";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  insets.left = 0;
  insets.right = 0;
});

describe("Fold workspace content width", () => {
  it.each([
    { left: 0, right: 0, expected: 800 },
    { left: 24, right: 0, expected: 776 },
    { left: 0, right: 24, expected: 776 },
  ])("keeps all width between safe areas for the panes: %j", ({ left, right, expected }) => {
    insets.left = left;
    insets.right = right;
    let availableWidth: number | undefined;
    function Probe() {
      const { width } = useFoldWorkspaceGeometry();
      useEffect(() => {
        availableWidth = width;
      }, [width]);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    try {
      act(() => root.render(<Probe />));
      expect(availableWidth).toBe(expected);
    } finally {
      act(() => root.unmount());
    }
  });
});
