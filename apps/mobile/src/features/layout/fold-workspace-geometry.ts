import { useCallback, useMemo, useRef, useState } from "react";
import { Platform, useWindowDimensions, type ViewInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { deriveHingeSnapWidths, deriveWorkspaceFoldRegions } from "../../lib/foldable-pane-layout";
import { deriveLayout } from "../../lib/layout";
import { useNativeLayoutMetrics } from "../../native/native-layout-metrics";
import { useWindowPosture } from "../../native/T3WindowPosture";

/**
 * Window geometry for Fold's adaptive workspace: the split/compact layout, the pane width left
 * between landscape safe-area insets, and the hinges of a foldable (a vertical fold that divides
 * the panes, or a tabletop fold the workspace keeps content above).
 */
export function useFoldWorkspaceGeometry() {
  const windowDimensions = useWindowDimensions();
  // iOS reports UIKit's window geometry (including Duo's division); elsewhere this is null.
  const nativeMetrics = useNativeLayoutMetrics();
  const window = nativeMetrics ?? windowDimensions;
  const safeAreaInsets = useSafeAreaInsets();
  const layout = useMemo(
    () =>
      deriveLayout({
        width: window.width - safeAreaInsets.left - safeAreaInsets.right,
        height: window.height,
        platform: Platform.OS,
        nativeMetrics,
      }),
    [nativeMetrics, safeAreaInsets.left, safeAreaInsets.right, window.height, window.width],
  );
  // A landscape navigation bar or display cutout sits beside the panes, not under them.
  const leadingInset = layout.usesSplitView ? safeAreaInsets.left : 0;
  const trailingInset = layout.usesSplitView ? safeAreaInsets.right : 0;
  const width = Math.max(0, window.width - leadingInset - trailingInset);
  const posture = useWindowPosture();
  const foldRegions = useMemo(
    () =>
      deriveWorkspaceFoldRegions({
        hinges: posture.hinges,
        width: window.width,
        height: window.height,
        leadingInset,
        trailingInset,
      }),
    [posture.hinges, window.width, window.height, leadingInset, trailingInset],
  );
  const workspaceView = useRef<ViewInstance>(null);
  const [workspaceTop, setWorkspaceTop] = useState(0);
  const tabletopTopHeight = foldRegions.tabletop
    ? Math.max(0, foldRegions.tabletop.top - workspaceTop)
    : null;
  const hingeSnapWidths = useMemo(
    () =>
      deriveHingeSnapWidths({
        hinges: posture.hinges,
        windowWidth: window.width,
        trailingInset,
      }),
    [posture.hinges, trailingInset, window.width],
  );
  const onWorkspaceLayout = useCallback(
    () => workspaceView.current?.measureInWindow((_x, y) => setWorkspaceTop(y)),
    [],
  );
  const windowHinge = useMemo(() => {
    const hinge = posture.hinges.find(
      (candidate) =>
        candidate.orientation === "vertical" &&
        (candidate.separating || candidate.state === "halfOpened"),
    );
    return hinge ? { x: hinge.left, width: hinge.right - hinge.left } : null;
  }, [posture.hinges]);
  return {
    windowHinge,
    layout,
    width,
    leadingInset,
    trailingInset,
    foldRegions,
    tabletopTopHeight,
    hingeSnapWidths,
    workspaceView,
    onWorkspaceLayout,
  };
}
