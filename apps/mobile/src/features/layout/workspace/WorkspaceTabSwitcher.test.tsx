import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import type { SegmentedControlProps } from "../../../components/ui/SegmentedControl.types";
import { WorkspaceTabSwitcher } from "./WorkspaceTabSwitcher";
import type { WorkspaceTab } from "./workspace-tabs-state";

const navigation = vi.hoisted(() => ({
  selected: "threads" as WorkspaceTab,
  select(tab: WorkspaceTab) {
    navigation.selected = tab;
  },
}));
vi.mock("./WorkspaceTabsContext", () => ({
  useWorkspaceTabs: () => ({ state: { selectedTab: navigation.selected } }),
}));
vi.mock("./useSelectWorkspaceTab", () => ({ useSelectWorkspaceTab: () => navigation.select }));
vi.mock("./navigation-tabs", () => ({ useHiddenNavigationTabs: () => ["pullRequests"] }));
vi.mock("gt-react-native", () => ({ useGT: () => (text: string) => text }));
vi.mock("../../../components/ui/SegmentedControl", () => ({
  SegmentedControl: (props: SegmentedControlProps<WorkspaceTab>) =>
    props.options.map(({ value, label }) => (
      <button
        key={value}
        aria-pressed={value === props.selected}
        onClick={() => props.onSelect(value)}
      >
        {label}
      </button>
    )),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("keeps PRs and Issues independently reachable after returning to Chats from Issues", () => {
  navigation.selected = "threads";
  const host = document.createElement("div");
  const root = createRoot(host);
  const render = () => act(() => root.render(<WorkspaceTabSwitcher />));
  const button = (label: string) =>
    [...host.querySelectorAll("button")].find((item) => item.textContent === label);
  try {
    render();
    act(() => button("Issues")!.click());
    render();
    expect(button("Issues")?.getAttribute("aria-pressed")).toBe("true");
    act(() => button("Chats")!.click());
    render();
    expect(button("Chats")?.getAttribute("aria-pressed")).toBe("true");
    expect([...host.querySelectorAll("button")].map((item) => item.textContent)).toEqual([
      "Chats",
      "PRs",
      "Issues",
    ]);
    act(() => button("PRs")!.click());
    render();
    expect(button("PRs")?.getAttribute("aria-pressed")).toBe("true");
    act(() => button("Issues")!.click());
    render();
    expect(button("Issues")?.getAttribute("aria-pressed")).toBe("true");
  } finally {
    act(() => root.unmount());
  }
});
