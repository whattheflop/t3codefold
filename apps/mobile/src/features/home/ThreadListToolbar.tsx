import { MOBILE_APP_NAME } from "../../lib/mobileBranding";
import { androidKeyboardFirst, dismissAndroidKeyboard } from "../../lib/android-back";
import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import { useNavigation, useNavigationState } from "@react-navigation/native";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";
import {
  BackHandler,
  Keyboard,
  type TextInputInstance,
  View,
  type LayoutChangeEvent,
} from "react-native";
import type { MenuAction } from "@react-native-menu/menu";

import { WorkspaceTabSwitcher } from "../workspace/AndroidWorkspaceNavigation";
import { ThreadListOptionsMenu } from "./ThreadListOptionsMenu";
import { Menu } from "../../components/ui/Menu";
import { SearchField } from "../../components/ui/SearchField";
import { useHardwareKeyboardCommand } from "../keyboard/hardwareKeyboardCommands";
import { WorkspaceListToolbarRow } from "../workspace/WorkspaceListToolbarRow";
import { useWorkspaceConnectionState } from "../../state/workspace";
import { useToolbarLayout } from "../../components/ui/useToolbarLayout";

/** One toolbar height for the compact list and expanded sidebar, including search. */
export function ThreadListToolbar(props: {
  readonly searchQuery: string;
  readonly onSearchQueryChange: (query: string) => void;
  readonly filterActions: MenuAction[];
  readonly filterCustomized: boolean;
  readonly onFilterAction: NonNullable<ComponentProps<typeof Menu>["onPressAction"]>;
  readonly onOpenEnvironments: () => void;
  readonly sidebar?: boolean;
  readonly onLayout?: (event: LayoutChangeEvent) => void;
  readonly onRequestVisibility?: () => void;
}) {
  const navigation = useNavigation();
  const workspace = useWorkspaceTabs();
  const isTabActive = workspace?.isTabActive;
  const homeFocused = useNavigationState((state) => state.routes[state.index]?.name === "Home");
  const listFocused =
    homeFocused && (workspace === null || workspace.state.selectedTab === "threads");
  const { paddingTop, paddingBottom } = useToolbarLayout();
  const connectionState = useWorkspaceConnectionState();
  const { onRequestVisibility, onSearchQueryChange } = props;
  const searchRef = useRef<TextInputInstance>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const searching = searchOpen || props.searchQuery.length > 0;
  const openSearch = useCallback(() => {
    onRequestVisibility?.();
    setSearchOpen(true);
    searchRef.current?.focus();
    return true;
  }, [onRequestVisibility]);
  useHardwareKeyboardCommand("focusSearch", openSearch);

  const closeSearch = useCallback(() => {
    onSearchQueryChange("");
    setSearchOpen(false);
    Keyboard.dismiss();
  }, [onSearchQueryChange]);

  useEffect(() => {
    if (!searching || !listFocused) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      // Frozen Home screens can keep effects alive after a detail route opens.
      const state = navigation.getState();
      if (
        !state ||
        state.routes[state.index]?.name !== "Home" ||
        isTabActive?.("threads") === false
      )
        return false;
      if (!dismissAndroidKeyboard()) closeSearch();
      return true;
    });
    return () => subscription.remove();
  }, [closeSearch, searching, listFocused, navigation, isTabActive]);

  const searchField = (
    <SearchField
      inputRef={searchRef}
      accessibilityLabel="Search threads"
      clearAccessibilityLabel="Clear search"
      placeholder="Search"
      value={props.searchQuery}
      onChangeText={onSearchQueryChange}
    />
  );
  const filterButton = (
    <ThreadListOptionsMenu
      hasConnections={connectionState.hasConnections}
      filterActions={props.filterActions}
      filterCustomized={props.filterCustomized}
      onFilterAction={props.onFilterAction}
      onOpenSettings={() =>
        navigation.navigate("SettingsSheet", {
          screen: "SettingsContent",
          params: { screen: "Settings" },
        })
      }
    />
  );

  return (
    <View
      onLayout={props.onLayout}
      className={props.sidebar ? "absolute inset-x-0 top-0 z-[4] bg-header px-2" : "bg-header px-2"}
      style={{ paddingTop, paddingBottom }}
    >
      <WorkspaceListToolbarRow
        searching={searching}
        searchField={searchField}
        onCloseSearch={androidKeyboardFirst(closeSearch)}
        onOpenSearch={openSearch}
        searchAccessibilityLabel="Search threads"
        titleAccessibilityLabel={`${MOBILE_APP_NAME}, Threads`}
        onOpenEnvironments={props.onOpenEnvironments}
        filter={filterButton}
      />
      {props.sidebar ? <WorkspaceTabSwitcher className="px-2 pb-2" /> : null}
    </View>
  );
}
