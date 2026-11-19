import { useGT } from "gt-react-native";
import { SegmentedControl } from "../../../components/ui/SegmentedControl";
import { useSelectWorkspaceTab } from "./useSelectWorkspaceTab";
import { useWorkspaceTabs } from "./WorkspaceTabsContext";

/** The split sidebar has room for dedicated PR and issue tabs. */
export function WorkspaceTabSwitcher(props: { readonly className?: string }) {
  const workspace = useWorkspaceTabs();
  const selectTab = useSelectWorkspaceTab();
  const gt = useGT();
  const options = [
    { value: "threads", label: gt("Chats") },
    { value: "pullRequests", label: gt("PRs"), accessibilityLabel: gt("Pull requests") },
    { value: "issues", label: gt("Issues", { $context: "screen title, list of issues" }) },
  ] as const;
  if (!workspace) return null;
  return (
    <SegmentedControl
      role="tab"
      options={options}
      selected={workspace.state.selectedTab}
      onSelect={selectTab}
      className={props.className}
    />
  );
}
