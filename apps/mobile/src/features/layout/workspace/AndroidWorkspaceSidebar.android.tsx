import { useGT } from "gt-react-native";
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
import { ListSearchToolbar } from "./ListSearchToolbar.android";
import { IssuesScreen } from "../../issues/IssuesScreen";
import { selectedIssueKey } from "../../issues/issueParams";
import { selectedPullRequestKey } from "../../pull-requests/pullRequestSelection";
import { AndroidHomeFabLayout } from "../../home/AndroidHomeFab";
import { useAdaptiveWorkspaceLayout } from "../adaptive-workspace-context";
import { useAndroidWorkspaceRoot } from "./AndroidWorkspaceTabsProvider";
import { WorkspaceTabsContext, useWorkspaceTabs } from "./WorkspaceTabsContext";
import { WorkspaceTabPanes } from "./WorkspaceTabPanes";
import { WorkspaceThreadSidebar } from "./WorkspaceThreadSidebar";
import { WorkspaceAppBarScope } from "../../../components/ui/WorkspaceAppBar.android";
import { WorkspaceTabSwitcher } from "./WorkspaceTabSwitcher";

/** The Home route in the sidebar column: the selected tab's list. */
export function AndroidWorkspaceSidebar() {
  const gt = useGT();
  const workspace = useWorkspaceTabs()!;
  const navigationRegionId = useControllerRegionId("navigation");
  const enabled = useEnabledNavigationTabs();
  const insets = useSafeAreaInsets();
  const { fabClearance } = useAndroidControlSizing();
  const { openWorkspaceTab, revealPrimarySidebar, startNewTask } = useAdaptiveWorkspaceLayout();
  const selectedPullRequest = useNavigationState(selectedPullRequestKey);
  const selectedIssue = useNavigationState(selectedIssueKey);
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
      {/* Fold has no navigation rail: the sidebar switches Chats, PRs and Issues, opens Settings, and keeps
          New thread on each tab. */}
      <View
        collapsable={false}
        nativeID={navigationRegionId}
        className="flex-row items-center gap-1 bg-header pb-2 pl-2 pr-1"
      >
        <WorkspaceTabSwitcher className="flex-1" />
        <AndroidHeaderIconButton
          accessibilityLabel={gt("Open settings")}
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
            ) : tab === "usage" ? (
              <View className="flex-1 bg-screen" />
            ) : tab === "issues" ? (
              <WorkspaceTabsContext value={context}>
                <IssuesScreen
                  sidebar
                  selectedIssueKey={selectedIssue}
                  renderFrame={(filters, list) => (
                    <View className="flex-1 bg-header">
                      <ListSearchToolbar
                        tab="issues"
                        filters={filters}
                        onRequestVisibility={revealPrimarySidebar}
                      />
                      <ScreenContent insetHorizontal>{list}</ScreenContent>
                    </View>
                  )}
                />
              </WorkspaceTabsContext>
            ) : (
              <WorkspaceTabsContext value={context}>
                <PullRequestsScreen
                  sidebar
                  selectedPullRequestKey={selectedPullRequest}
                  renderFrame={(filters, list) => (
                    <View className="flex-1 bg-header">
                      <ListSearchToolbar
                        tab="pullRequests"
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
