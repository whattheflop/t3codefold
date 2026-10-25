import { requireNativeView } from "expo";
import { CommonActions, useNavigation } from "@react-navigation/native";
import { androidWorkspaceNavigationState } from "../../lib/android-workspace-navigation";
import {
  Keyboard,
  processColor,
  View,
  type NativeSyntheticEvent,
  type ViewProps,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useKeyboardState } from "react-native-keyboard-controller";

import { useAndroidControlSizing } from "../../components/ui/useAndroidControlSizing";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { androidWorkspaceNavigationColors } from "./android-workspace-navigation-colors";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { useWorkspaceTabs } from "./WorkspaceTabsContext";
import type { WorkspaceTab } from "./workspace-tabs-state";

interface NativeNavigationProps extends ViewProps {
  readonly selectedTab: WorkspaceTab;
  readonly dark: boolean;
  readonly textScale: number;
  readonly containerColor: number;
  readonly selectedColor: number;
  readonly indicatorColor: number;
  readonly unselectedColor: number;
  readonly onTabSelected: (event: NativeSyntheticEvent<{ readonly tab: WorkspaceTab }>) => void;
}

const NativeNavigation = requireNativeView<NativeNavigationProps>("T3WorkspaceNavigation");

function nativeColor(value: string) {
  const color = processColor(value);
  return typeof color === "number" ? color : 0;
}

/** Switches the workspace tab and returns to its list, keeping the selection in one place. */
function useSelectWorkspaceTab(workspace: ReturnType<typeof useWorkspaceTabs>) {
  const navigation = useNavigation();
  return (tab: WorkspaceTab) => {
    Keyboard.dismiss();
    if (!workspace || tab === workspace.state.selectedTab) return;
    workspace.dispatch({ type: "select", tab });
    navigation.dispatch((state) => CommonActions.reset(androidWorkspaceNavigationState(state)));
  };
}

/** Bottom navigation for the compact workspace; split layouts use the sidebar switcher. */
export function AndroidWorkspaceNavigation() {
  const workspace = useWorkspaceTabs()!;
  const selectTab = useSelectWorkspaceTab(workspace);
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  const { themeAppearance, themeVariables: colors } = useAppearancePreferences();
  const { scale } = useAndroidControlSizing();
  const { containerColor, indicatorColor, selectedColor, unselectedColor } =
    androidWorkspaceNavigationColors(colors);
  if (keyboardVisible) return null;

  return (
    <View style={{ backgroundColor: containerColor, paddingBottom: insets.bottom }}>
      <NativeNavigation
        selectedTab={workspace.state.selectedTab}
        dark={themeAppearance === "dark"}
        textScale={scale}
        containerColor={nativeColor(containerColor)}
        selectedColor={nativeColor(selectedColor)}
        indicatorColor={nativeColor(indicatorColor)}
        unselectedColor={nativeColor(unselectedColor)}
        onTabSelected={(event) => selectTab(event.nativeEvent.tab)}
        style={{ height: 80 * Math.max(1, scale) }}
      />
    </View>
  );
}

const WORKSPACE_TAB_OPTIONS = [
  { value: "threads", label: "Chats" },
  { value: "pullRequests", label: "PRs", accessibilityLabel: "Pull requests" },
] as const;

/** Chats/PRs switcher at the top of the split-view sidebar. */
export function WorkspaceTabSwitcher(props: { readonly className?: string }) {
  const workspace = useWorkspaceTabs();
  const selectTab = useSelectWorkspaceTab(workspace);
  if (!workspace) return null;
  return (
    <SegmentedControl
      role="tab"
      options={WORKSPACE_TAB_OPTIONS}
      selected={workspace.state.selectedTab}
      onSelect={selectTab}
      className={props.className}
    />
  );
}
