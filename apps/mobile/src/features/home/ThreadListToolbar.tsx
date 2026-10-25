import { androidKeyboardFirst, dismissAndroidKeyboard } from "../../lib/android-back";
import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import { useNavigation, useNavigationState } from "@react-navigation/native";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";
import { WorkspaceTabSwitcher } from "../workspace/AndroidWorkspaceNavigation";
import {
  BackHandler,
  Keyboard,
  type TextInputInstance,
  View,
  type LayoutChangeEvent,
} from "react-native";
import type { MenuAction } from "@react-native-menu/menu";

import { AndroidHeaderIconButton } from "../../components/ui/AndroidScreenHeader";
import { CompactBrandTitle } from "../../components/CompactBrandTitle";
import { ThreadListOptionsMenu } from "./ThreadListOptionsMenu";
import { Menu } from "../../components/ui/Menu";
import { SearchField } from "../../components/ui/SearchField";
import { useHardwareKeyboardCommand } from "../keyboard/hardwareKeyboardCommands";
import { WorkspaceConnectionTitle } from "./WorkspaceConnectionTitle";
import { useWorkspaceState } from "../../state/workspace";
import { useToolbarLayout } from "../../components/ui/useToolbarLayout";

/** One toolbar height for the compact list and expanded sidebar, including search. */
export function ThreadListToolbar(props: {
  readonly searchQuery: string;
  readonly onSearchQueryChange: (query: string) => void;
  readonly filterActions: MenuAction[];
  readonly filterCustomized: boolean;
  readonly onFilterAction: NonNullable<ComponentProps<typeof Menu>["onPressAction"]>;
  readonly onOpenSettings: () => void;
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
  const { height: toolbarHeight, ...headerPadding } = useToolbarLayout();
  const { state } = useWorkspaceState();
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

  return (
    <>
      <View
        onLayout={props.onLayout}
        className={
          props.sidebar ? "absolute inset-x-0 top-0 z-[4] bg-header px-2" : "bg-header px-2"
        }
        // The sidebar's tab switcher sits below the header padding, matching the PR header.
        style={props.sidebar ? { paddingTop: headerPadding.paddingTop } : headerPadding}
      >
        <View className="flex-row items-center gap-1" style={{ minHeight: toolbarHeight }}>
          {searching ? (
            <>
              <AndroidHeaderIconButton
                accessibilityLabel="Close search"
                icon="arrow.left"
                onPress={androidKeyboardFirst(closeSearch)}
              />
              {searchField}
            </>
          ) : (
            <>
              {/* Match the visible inset of the trailing 48dp icon button. */}
              <View className="min-w-0 flex-1 overflow-hidden pl-4">
                <WorkspaceConnectionTitle
                  grow
                  onPress={props.onOpenEnvironments}
                  brand={<CompactBrandTitle allowFontScaling={false} />}
                />
              </View>
              <AndroidHeaderIconButton
                accessibilityLabel="Search threads"
                icon="magnifyingglass"
                onPress={openSearch}
              />
              <ThreadListOptionsMenu
                hasConnections={state.hasConnections}
                filterActions={props.filterActions}
                filterCustomized={props.filterCustomized}
                onFilterAction={props.onFilterAction}
                onOpenSettings={props.onOpenSettings}
              />
            </>
          )}
        </View>
        {props.sidebar ? (
          <View style={{ paddingTop: headerPadding.paddingBottom }}>
            <WorkspaceTabSwitcher className="px-2 pb-2" />
          </View>
        ) : null}
      </View>
    </>
  );
}
