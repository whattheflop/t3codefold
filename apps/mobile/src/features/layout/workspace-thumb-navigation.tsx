import { useGT } from "gt-react-native";
import { useNavigation } from "@react-navigation/native";
import { useSelectWorkspaceDetail } from "./workspace/useSelectWorkspaceDetail";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Pressable, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SymbolView } from "../../components/ui/AppSymbol";

import {
  resolveWorkspaceThumbAction,
  type WorkspaceThumbAction,
} from "../../lib/workspace-thumb-navigation";
export type { WorkspaceThumbAction } from "../../lib/workspace-thumb-navigation";

function createThumbGesture(dispatch: (x: number, y: number) => void) {
  return Gesture.Pan()
    .minDistance(12)
    .onEnd((event, success) => {
      if (success) runOnJS(dispatch)(event.translationX, event.translationY);
    });
}

export function WorkspaceThumbNavigation(props: {
  readonly onAction: (action: WorkspaceThumbAction) => void;
}) {
  const gt = useGT();
  const labels = {
    previous: gt("Previous recent thread"),
    next: gt("Next recent thread"),
    sidebar: gt("Toggle sidebar"),
    inspector: gt("Toggle inspector"),
  };
  const { onAction } = props;
  const insets = useSafeAreaInsets();
  const dispatch = useCallback(
    (x: number, y: number) => {
      const action = resolveWorkspaceThumbAction(x, y);
      if (action) onAction(action);
    },
    [onAction],
  );
  const gesture = useMemo(() => createThumbGesture(dispatch), [dispatch]);
  return (
    <View
      className="border-t border-header-border bg-header"
      style={{ paddingHorizontal: 16, paddingBottom: Math.max(insets.bottom, 8), paddingTop: 4 }}
    >
      <GestureDetector gesture={gesture}>
        <View
          accessible
          accessibilityLabel={gt("Workspace navigation")}
          accessibilityHint={gt(
            "Swipe left or right for recent threads, up for sidebar, down for inspector.",
          )}
          accessibilityActions={[
            { name: "previous", label: labels.previous },
            { name: "next", label: labels.next },
            { name: "sidebar", label: labels.sidebar },
            { name: "inspector", label: labels.inspector },
          ]}
          onAccessibilityAction={(event) => {
            const action = event.nativeEvent.actionName;
            if (
              action === "previous" ||
              action === "next" ||
              action === "sidebar" ||
              action === "inspector"
            )
              props.onAction(action);
          }}
          className="flex-row items-center justify-between self-center"
          style={{ width: "100%", maxWidth: 320, minHeight: 48 }}
        >
          {(["previous", "sidebar", "inspector", "next"] as const).map((action) => (
            <Pressable
              key={action}
              accessibilityRole="button"
              accessibilityLabel={labels[action]}
              onPress={() => props.onAction(action)}
              className="size-12 items-center justify-center rounded-xl active:bg-subtle"
            >
              <SymbolView
                name={
                  action === "previous"
                    ? "chevron.left"
                    : action === "next"
                      ? "chevron.right"
                      : action === "sidebar"
                        ? "sidebar.left"
                        : "sidebar.right"
                }
                size={20}
                tintColorClassName="accent-icon-muted"
              />
            </Pressable>
          ))}
        </View>
      </GestureDetector>
    </View>
  );
}

/**
 * Actions for the Android thumb gestures: toggle the sidebar or inspector, and step back and
 * forward through the threads visited in this workspace.
 */
export function useWorkspaceThumbActions(input: {
  readonly activeThread: { readonly environmentId: string; readonly threadId: string } | null;
  readonly usesSplitView: boolean;
  readonly supportsAuxiliaryPane: boolean;
  readonly togglePrimarySidebar: () => void;
  readonly toggleAuxiliaryPane: () => void;
  readonly hideAuxiliaryPane: () => void;
}) {
  const navigation = useNavigation();
  const selectDetail = useSelectWorkspaceDetail();
  const { activeThread, togglePrimarySidebar, toggleAuxiliaryPane, hideAuxiliaryPane } = input;
  const recentThreads = useRef<{
    threads: Array<{ environmentId: string; threadId: string }>;
    index: number;
  }>({ threads: [], index: -1 });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records the active thread in the thumb-gesture back/forward history
  useEffect(() => {
    if (!activeThread) return;
    const history = recentThreads.current;
    const selected = history.threads[history.index];
    if (
      selected?.environmentId === activeThread.environmentId &&
      selected.threadId === activeThread.threadId
    )
      return;
    const threads = [...history.threads.slice(0, history.index + 1), activeThread].slice(-12);
    recentThreads.current = { threads, index: threads.length - 1 };
  }, [activeThread]);
  const handleThumbAction = useCallback(
    (action: WorkspaceThumbAction) => {
      if (action === "sidebar") {
        if (input.usesSplitView) togglePrimarySidebar();
        else navigation.navigate("Home");
        return;
      }
      if (action === "inspector") {
        if (input.supportsAuxiliaryPane) toggleAuxiliaryPane();
        else if (activeThread) navigation.navigate("ThreadFiles", activeThread);
        return;
      }
      const history = recentThreads.current;
      const index = history.index + (action === "previous" ? -1 : 1);
      const next = history.threads[index];
      if (next) {
        history.index = index;
        hideAuxiliaryPane();
        selectDetail({ name: "Thread", params: next });
      }
    },
    [
      activeThread,
      hideAuxiliaryPane,
      input.usesSplitView,
      navigation,
      selectDetail,
      input.supportsAuxiliaryPane,
      toggleAuxiliaryPane,
      togglePrimarySidebar,
    ],
  );
  return handleThumbAction;
}
