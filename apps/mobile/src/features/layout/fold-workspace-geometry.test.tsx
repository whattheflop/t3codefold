import type { WindowHinge } from "../../native/T3WindowPosture";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const posture = vi.hoisted(() => ({ hinges: new Array<WindowHinge>() }));
const window = vi.hoisted(() => ({ width: 800, height: 900 }));
const insets = vi.hoisted(() => ({ top: 24, bottom: 24, left: 0, right: 0 }));
vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  useWindowDimensions: () => window,
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => insets }));
vi.mock("../../native/native-layout-metrics", () => ({ useNativeLayoutMetrics: () => null }));
vi.mock("../../native/T3WindowPosture", () => ({ useWindowPosture: () => posture }));
vi.mock("./workspace/AndroidWorkspaceNavigation", () => ({ ANDROID_WORKSPACE_RAIL_WIDTH: 72 }));

import { useFoldWorkspaceGeometry } from "./fold-workspace-geometry";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  posture.hinges = [];
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

it("keeps menu containment for a flat separating physical hinge", () => {
  posture.hinges = [
    {
      left: 390,
      right: 410,
      top: 0,
      bottom: 900,
      orientation: "vertical",
      state: "flat",
      separating: true,
    },
  ];
  let result: ReturnType<typeof useFoldWorkspaceGeometry> | undefined;
  function Probe() {
    const geometry = useFoldWorkspaceGeometry();
    useEffect(() => {
      result = geometry;
    }, [geometry]);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    act(() => root.render(<Probe />));
    expect(result?.windowHinge).toEqual({ x: 390, width: 20 });
    expect(result?.foldRegions.vertical).toEqual({
      leadingWidth: 390,
      gap: 20,
      trailingWidth: 390,
    });
  } finally {
    act(() => root.unmount());
  }
});
