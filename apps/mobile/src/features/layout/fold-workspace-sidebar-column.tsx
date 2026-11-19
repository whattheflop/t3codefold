import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import type { Layout } from "../../lib/layout";
import { VimPaneFocusMarker } from "../keyboard/useWorkspaceVimNavigation";
import { WORKSPACE_PANE_REVEAL_TIMING } from "./fold-workspace-inspector-pane";

/**
 * The thread sidebar column. Once the window has been wide enough for it, it
 * stays mounted — hidden in compact layouts — so folding and unfolding keeps
 * its scroll position and search instead of rebuilding the list.
 */
export function WorkspaceSidebarColumn(props: {
  readonly layout: Layout;
  readonly visible: boolean;
  readonly children: (listPaneWidth: number) => ReactNode;
}) {
  const [lastListPaneWidth, setLastListPaneWidth] = useState(props.layout.listPaneWidth);
  if (props.layout.listPaneWidth !== null && props.layout.listPaneWidth !== lastListPaneWidth) {
    setLastListPaneWidth(props.layout.listPaneWidth);
  }
  const listPaneWidth = props.layout.listPaneWidth ?? lastListPaneWidth;
  const shown = props.visible && props.layout.usesSplitView;

  // Only a toggle reveals; unfolding into a visible sidebar shows it at once.
  const reveal = useSharedValue(1);
  const wasShown = useRef(shown);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- animates the Reanimated sidebar reveal when it is shown again
  useEffect(() => {
    if (shown && !wasShown.current) {
      reveal.set(0);
      reveal.set(withTiming(1, WORKSPACE_PANE_REVEAL_TIMING));
    }
    wasShown.current = shown;
  }, [reveal, shown]);
  const revealStyle = useAnimatedStyle(() => ({
    // Fading a UIKit glass ancestor can leave remounted header effects missing.
    opacity: Platform.OS === "ios" ? 1 : reveal.value,
    transform: [{ translateX: (reveal.value - 1) * 16 }],
  }));

  if (listPaneWidth === null) return null;

  return (
    <View
      className="self-stretch overflow-hidden"
      accessibilityElementsHidden={!shown}
      collapsable={false}
      importantForAccessibility={shown ? "auto" : "no-hide-descendants"}
      pointerEvents={shown ? "auto" : "none"}
      style={
        props.layout.usesSplitView ? { width: shown ? listPaneWidth : 0 } : { display: "none" }
      }
    >
      <Animated.View
        nativeID="t3-controller-pane:sidebar"
        className="flex-1"
        style={[{ width: listPaneWidth }, revealStyle]}
      >
        {props.children(listPaneWidth)}
      </Animated.View>
      <VimPaneFocusMarker region="sidebar" />
    </View>
  );
}
