import { dismissAndroidKeyboard } from "../../lib/android-back";
import { useCallback, useEffectEvent } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { BackHandler, Platform } from "react-native";

import { resolveAdaptiveWorkspaceBackAction } from "../../lib/fold-workspace-navigation";
import { useAdaptiveWorkspaceLayout, useWorkspacePaneState } from "./AdaptiveWorkspaceLayout";

/**
 * Unwinds Fold workspace chrome before Android Back leaves the screen. Call it
 * once from every route screen that can show the workspace inspector.
 */
export function useFoldWorkspaceAndroidBack() {
  const { layout, setAuxiliaryPaneMaximized, hideAuxiliaryPane, togglePrimarySidebar } =
    useAdaptiveWorkspaceLayout();
  const { panes } = useWorkspacePaneState();
  const usesSplitView = layout.usesSplitView;
  // Reads pane state at press time so the listener stays registered across pane changes.
  const onBack = useEffectEvent(() => {
    if (dismissAndroidKeyboard()) return true;
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

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android" || !usesSplitView) return;

      const subscription = BackHandler.addEventListener("hardwareBackPress", onBack);
      return () => subscription.remove();
    }, [usesSplitView]),
  );
}
