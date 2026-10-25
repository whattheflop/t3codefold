import { dismissAndroidKeyboard } from "../../lib/android-back";
import { useCallback, useRef } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { BackHandler, Platform } from "react-native";

import { resolveAdaptiveWorkspaceBackAction } from "../../lib/fold-workspace-navigation";
import { useAdaptiveWorkspaceLayout } from "./AdaptiveWorkspaceLayout";

/**
 * Unwinds Fold workspace chrome before Android Back leaves the screen. Call it
 * once from every route screen that can show the workspace inspector.
 */
export function useFoldWorkspaceAndroidBack() {
  const workspace = useAdaptiveWorkspaceLayout();
  // Read pane state at press time so the listener stays registered across pane changes.
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const usesSplitView = workspace.layout.usesSplitView;

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android" || !usesSplitView) return;

      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        if (dismissAndroidKeyboard()) return true;
        const { panes, setAuxiliaryPaneMaximized, hideAuxiliaryPane, togglePrimarySidebar } =
          workspaceRef.current;
        switch (
          resolveAdaptiveWorkspaceBackAction({
            auxiliaryPaneMaximized: panes.auxiliaryPaneMaximized,
            auxiliaryPaneVisible: panes.auxiliaryPaneVisible,
            primarySidebarVisible: panes.primarySidebarVisible,
          })
        ) {
          case "restore-inspector":
            setAuxiliaryPaneMaximized(false);
            return true;
          case "close-inspector":
            hideAuxiliaryPane();
            return true;
          case "show-sidebar":
            togglePrimarySidebar();
            return true;
          case "navigate":
            return false;
        }
      });
      return () => subscription.remove();
    }, [usesSplitView]),
  );
}
