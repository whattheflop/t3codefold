export type AdaptiveWorkspaceBackAction =
  | "restore-inspector"
  | "close-inspector"
  | "show-sidebar"
  | "navigate";

/** Returning to Home in a split view brings the thread sidebar back and closes the inspector. */
export function shouldRestorePrimarySidebar(input: {
  readonly usesSplitView: boolean;
  readonly pathname: string;
}): boolean {
  return input.usesSplitView && input.pathname === "/";
}

/** Android Back undoes workspace chrome one step at a time, newest first, before navigating. */
export function resolveAdaptiveWorkspaceBackAction(input: {
  readonly auxiliaryPaneMaximized?: boolean;
  readonly auxiliaryPaneVisible: boolean;
  readonly primarySidebarVisible: boolean;
}): AdaptiveWorkspaceBackAction {
  if (input.auxiliaryPaneMaximized === true) return "restore-inspector";
  if (input.auxiliaryPaneVisible) return "close-inspector";
  if (!input.primarySidebarVisible) return "show-sidebar";
  return "navigate";
}
