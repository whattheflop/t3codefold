import { useNavigation } from "@react-navigation/native";
import { useCallback } from "react";

import { ScreenContent } from "../../components/ui/ScreenContent";
import { AppBar } from "../../components/ui/AppBar";
import { WorkspaceTabsProvider } from "../workspace/WorkspaceTabsContext";
import { PullRequestsScreen } from "./PullRequestsScreen";

/**
 * The pull request list as its own route, for entry points outside the workspace tabs: the
 * Android split sidebar, the command palette, and the Home header where no tab bar is shown.
 */
export function PullRequestsRouteScreen() {
  const navigation = useNavigation();
  const handleBack = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("Home");
  }, [navigation]);

  return (
    <>
      <AppBar title="Pull requests" onBack={handleBack} />
      <ScreenContent>
        <WorkspaceTabsProvider>
          <PullRequestsScreen />
        </WorkspaceTabsProvider>
      </ScreenContent>
    </>
  );
}
