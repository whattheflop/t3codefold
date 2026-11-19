import { useControllerRegionId } from "../../controller/ControllerRegion";
import { WorkspaceNoTabs } from "./WorkspaceNoTabs";
import { useEnabledNavigationTabs } from "./navigation-tabs";
import { NAVIGATION_TAB_ORDER } from "./navigation-tab-order";
import { useNavigationState } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAndroidControlSizing } from "../../../components/ui/useAndroidControlSizing";
import { View } from "react-native";
import { ScreenContent } from "../../../components/ui/ScreenContent";
import { AndroidHeaderIconButton } from "../../../components/ui/AndroidScreenHeader.android";
import { PullRequestsScreen } from "../../pull-requests/PullRequestsScreen";
import { PullRequestToolbar } from "./PullRequestToolbar.android";
import { selectedPullRequestKey } from "../../pull-requests/pullRequestSelection";
import { AndroidHomeFabLayout } from "../../home/AndroidHomeFab";
import { useAdaptiveWorkspaceLayout } from "../adaptive-workspace-context";
import { useAndroidWorkspaceRoot } from "./AndroidWorkspaceTabsProvider";
import { WorkspaceTabsContext, useWorkspaceTabs } from "./WorkspaceTabsContext";
import { WorkspaceTabPanes } from "./WorkspaceTabPanes";
import { WorkspaceThreadSidebar } from "./WorkspaceThreadSidebar";
import { WorkspaceAppBarScope } from "../../../components/ui/WorkspaceAppBar.android";
import { WorkspaceTabSwitcher } from "./AndroidWorkspaceNavigation";

/** The Home route in the sidebar column: the selected tab's list. */
export function AndroidWorkspaceSidebar() {
  const workspace = useWorkspaceTabs()!;
  const navigationRegionId = useControllerRegionId("navigation");
  const enabled = useEnabledNavigationTabs();
  const insets = useSafeAreaInsets();
  const { fabClearance } = useAndroidControlSizing();
  const { openWorkspaceTab, revealPrimarySidebar, startNewTask } = useAdaptiveWorkspaceLayout();
  const selectedPullRequest = useNavigationState(selectedPullRequestKey);
  // Settings and Usage cover the sidebar.
  const coveredByPage =
    (useAndroidWorkspaceRoot()?.settingsOpen ?? false) || workspace.state.selectedTab === "usage";
  // Fold's split sidebar keeps the New thread FAB instead of upstream's floating tabs.
  const context = {
    ...workspace,
    bottomClearance: Math.max(insets.bottom, 12) + fabClearance + 16,
  };
  if (enabled.length === 0) return <WorkspaceNoTabs />;
  return (
    <WorkspaceAppBarScope>
      {/* Fold has no navigation rail: the sidebar switches Chats/PRs, opens Settings, and keeps
          New thread on both tabs. */}
      <View
        collapsable={false}
        nativeID={navigationRegionId}
        className="flex-row items-center gap-1 bg-header pb-2 pl-2 pr-1"
      >
        <WorkspaceTabSwitcher className="flex-1" />
        <AndroidHeaderIconButton
          accessibilityLabel="Open settings"
          icon="gearshape"
          onPress={() => openWorkspaceTab("settings")}
        />
      </View>
      <AndroidHomeFabLayout sidebar disabled={coveredByPage} onStartNewTask={startNewTask}>
        <WorkspaceTabPanes
          tabs={NAVIGATION_TAB_ORDER}
          selected={workspace.state.selectedTab}
          renderTab={(tab) =>
            tab === "threads" ? (
              <WorkspaceThreadSidebar />
            ) : tab !== "pullRequests" ? (
              <View className="flex-1 bg-screen" />
            ) : (
              <WorkspaceTabsContext value={context}>
                <PullRequestsScreen
                  sidebar
                  selectedPullRequestKey={selectedPullRequest}
                  renderFrame={(filters, list) => (
                    <View className="flex-1 bg-header">
                      <PullRequestToolbar
                        filters={filters}
                        onRequestVisibility={revealPrimarySidebar}
                      />
                      <ScreenContent insetHorizontal>{list}</ScreenContent>
                    </View>
                  )}
                />
              </WorkspaceTabsContext>
            )
          }
        />
      </AndroidHomeFabLayout>
    </WorkspaceAppBarScope>
  );
}
