import { useCallback } from "react";

import { nativePullRequestDestination } from "../../lib/pullRequestNavigation";
import { useOpenPullRequest } from "../../native/useOpenPullRequest";
import { useThreadSelection } from "../../state/use-thread-selection";

/**
 * Opens the selected thread's pull request in the app's review screens, read through the
 * thread's environment. A URL the app cannot address still opens in the browser.
 * `beforeNavigate` runs only when the app is about to navigate in-app.
 */
export function useOpenThreadPullRequest() {
  const { selectedThread } = useThreadSelection();
  const environmentId = selectedThread ? String(selectedThread.environmentId) : null;
  const projectId = selectedThread ? String(selectedThread.projectId) : null;
  const openPullRequest = useOpenPullRequest(
    environmentId && projectId ? { context: { environmentId, projectId } } : undefined,
  );
  return useCallback(
    async (url: string, options?: { readonly beforeNavigate?: () => void }) => {
      const inApp =
        environmentId && projectId
          ? nativePullRequestDestination(url, { environmentId, projectId })
          : null;
      if (inApp) options?.beforeNavigate?.();
      return openPullRequest(url);
    },
    [environmentId, openPullRequest, projectId],
  );
}
