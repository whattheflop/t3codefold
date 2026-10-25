import { useCallback, useEffect, useMemo, useRef } from "react";
import { View } from "react-native";

import type { FoldWorkspacePaneLayout } from "../../lib/foldable-pane-layout";
import { dispatchHardwareKeyboardCommand } from "./hardwareKeyboardCommands";
import {
  INITIAL_VIM_STATE,
  reconcileVimRegion,
  reduceVimKey,
  type VimKey,
  type VimRegion,
} from "./vimNavigation";
import {
  dispatchVimEffect,
  getVimFocus,
  setVimFocus,
  useVimFocus,
  useVimKeyHandler,
} from "./vimNavigationRuntime";

/**
 * Interprets Vim keys against the visible workspace panes. Pane-level effects
 * (maximize, search) run here; the rest go to the component that owns them.
 */
export function useWorkspaceVimNavigation(input: {
  readonly usesSplitView: boolean;
  readonly panes: FoldWorkspacePaneLayout;
  readonly togglePrimarySidebar: () => void;
  readonly toggleAuxiliaryPaneMaximized: () => void;
}) {
  const regions = useMemo<ReadonlyArray<VimRegion>>(() => {
    if (!input.usesSplitView) return ["chat"];
    return [
      ...(input.panes.primarySidebarVisible ? (["sidebar"] as const) : []),
      ...(input.panes.auxiliaryPaneMaximized ? [] : (["chat"] as const)),
      ...(input.panes.auxiliaryPaneVisible ? (["inspector"] as const) : []),
    ];
  }, [
    input.panes.auxiliaryPaneMaximized,
    input.panes.auxiliaryPaneVisible,
    input.panes.primarySidebarVisible,
    input.usesSplitView,
  ]);
  const stateRef = useRef(INITIAL_VIM_STATE);
  const latest = useRef({ ...input, regions });
  latest.current = { ...input, regions };

  // A pane that closes hands focus back to the chat.
  useEffect(() => {
    stateRef.current = reconcileVimRegion(stateRef.current, { regions });
    if (getVimFocus().region !== null) setVimFocus({ region: stateRef.current.region });
  }, [regions]);

  const handleKey = useCallback((key: VimKey) => {
    const { regions, togglePrimarySidebar, toggleAuxiliaryPaneMaximized } = latest.current;
    const { state, effects } = reduceVimKey(stateRef.current, key, { regions });
    stateRef.current = state;
    setVimFocus({ region: state.region });
    for (const effect of effects) {
      switch (effect.type) {
        case "focusRegion":
          break;
        case "toggleMaximize":
          if (state.region === "inspector") toggleAuxiliaryPaneMaximized();
          else togglePrimarySidebar();
          break;
        case "focusSearch":
          dispatchHardwareKeyboardCommand("focusSearch");
          break;
        case "scroll":
        case "scrollToEdge":
          // Only the chat scrolls by keyboard; inspector content scrolls itself.
          if (state.region === "chat") dispatchVimEffect(effect);
          break;
        default:
          dispatchVimEffect(effect);
      }
    }
  }, []);
  useVimKeyHandler(handleKey);
}

/** A thin accent along the top of the pane Vim navigation is focused on. */
export function VimPaneFocusMarker(props: { readonly region: VimRegion }) {
  const { region } = useVimFocus();
  if (region !== props.region) return null;
  return (
    <View pointerEvents="none" className="absolute inset-x-0 top-0 z-[101] h-0.5 bg-primary" />
  );
}
