import { useWorkspacePaneState } from "../AdaptiveWorkspaceLayout";
import { MOBILE_APP_NAME } from "../../../lib/mobileBranding";
import { useNavigation } from "@react-navigation/native";
import { useEffect, useEffectEvent } from "react";
import { BackHandler, Keyboard } from "react-native";
import { AppBar } from "../../../components/ui/AppBar";
import { appBarMenuItemsFromActions } from "../../../components/ui/menuActionItems";
import { useHardwareKeyboardCommand } from "../../keyboard/hardwareKeyboardCommands";
import { WorkspaceBrandTitle } from "./WorkspaceBrandTitle";
import { useWorkspaceTabs } from "./WorkspaceTabsContext";
import type { PullRequestFilterMenu } from "../../pull-requests/PullRequestListFilters";
import { openSettings } from "../../settings/settings-navigation";

/** PR search shares the thread list's Android header. */
export function PullRequestToolbar(props: {
  readonly filters: PullRequestFilterMenu | null;
  readonly onRequestVisibility?: () => void;
}) {
  const navigation = useNavigation();
  const { panes } = useWorkspacePaneState();
  const { filters } = props;
  const workspace = useWorkspaceTabs()!;
  const { dispatch, getScrollOffset, recordScrollOffset, isTabActive } = workspace;
  const { onRequestVisibility } = props;
  const tab = workspace.state.tabs.pullRequests;
  const searching = tab.searchMode !== "resting";
  const openSearch = () => {
    onRequestVisibility?.();
    dispatch({
      type: "scroll",
      tab: "pullRequests",
      offset: getScrollOffset("pullRequests"),
    });
    dispatch({ type: "search", tab: "pullRequests" });
    return true;
  };
  useHardwareKeyboardCommand("focusSearch", openSearch);
  const closeSearch = () => {
    Keyboard.dismiss();
    recordScrollOffset("pullRequests", tab.searchEntryOffset);
    dispatch({ type: "cancel", tab: "pullRequests" });
  };
  const onBack = useEffectEvent(() => {
    const state = navigation.getState();
    if (
      (!panes.primarySidebarVisible && state?.routes[state.index]?.name !== "Home") ||
      !isTabActive("pullRequests")
    )
      return false;
    if (Keyboard.isVisible()) Keyboard.dismiss();
    else closeSearch();
    return true;
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns visible sidebar search Back while searching
  useEffect(() => {
    if (!searching) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", onBack);
    return () => subscription.remove();
  }, [searching]);
  return (
    <AppBar
      title={MOBILE_APP_NAME}
      titleContent={
        <WorkspaceBrandTitle
          accessibilityLabel={`${MOBILE_APP_NAME}, Pull requests`}
          onOpenEnvironments={() => openSettings(navigation, "SettingsEnvironments")}
        />
      }
      search={{
        value: tab.query,
        onChangeText: (query) => dispatch({ type: "query", tab: "pullRequests", query }),
        placeholder: "Search pull requests",
        active: searching,
        onOpen: openSearch,
        onClose: closeSearch,
      }}
      menus={
        filters
          ? [
              {
                title: "Filter pull requests",
                icon: filters.customized
                  ? "line.3.horizontal.decrease.circle.fill"
                  : "line.3.horizontal.decrease.circle",
                items: appBarMenuItemsFromActions(filters.actions, filters.onSelect),
              },
            ]
          : undefined
      }
    />
  );
}
