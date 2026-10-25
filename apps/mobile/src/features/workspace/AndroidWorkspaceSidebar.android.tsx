import { useMemo, type ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAndroidControlSizing } from "../../components/ui/useAndroidControlSizing";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { PullRequestFilterMenuProvider } from "../pull-requests/PullRequestFilterMenuContext";
import { PullRequestsScreen } from "../pull-requests/PullRequestsScreen";
import { PullRequestToolbar } from "../pull-requests/PullRequestToolbar.android";
import { WorkspaceTabsContext, useWorkspaceTabs } from "./WorkspaceTabsContext";
import { WorkspaceTabPanes } from "./WorkspaceTabPanes";

export function AndroidWorkspaceSidebar(props: {
  readonly children: ReactNode;
  readonly onRequestVisibility: () => void;
  readonly selectedPullRequestKey: string | null;
}) {
  const workspace = useWorkspaceTabs()!;
  const insets = useSafeAreaInsets();
  const { fabClearance } = useAndroidControlSizing();
  const context = useMemo(
    () => ({ ...workspace, bottomClearance: Math.max(insets.bottom, 12) + fabClearance + 16 }),
    [workspace, insets.bottom, fabClearance],
  );
  return (
    <WorkspaceTabPanes
      tabs={["threads", "pullRequests"]}
      selected={workspace.state.selectedTab}
      renderTab={(tab) =>
        tab === "threads" ? (
          props.children
        ) : (
          <WorkspaceTabsContext value={context}>
            <PullRequestFilterMenuProvider>
              <View className="flex-1 bg-header">
                <PullRequestToolbar sidebar onRequestVisibility={props.onRequestVisibility} />
                <ScreenContent insetHorizontal>
                  <PullRequestsScreen
                    sidebar
                    selectedPullRequestKey={props.selectedPullRequestKey}
                  />
                </ScreenContent>
              </View>
            </PullRequestFilterMenuProvider>
          </WorkspaceTabsContext>
        )
      }
    />
  );
}
