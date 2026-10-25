import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { resolveSidebarThreadStatus } from "../Sidebar.logic";

type HudThread = Pick<
  EnvironmentThreadShell,
  | "archivedAt"
  | "deletedAt"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "runtime"
  | "lastVisitedAt"
> & {
  latestRun: Pick<
    NonNullable<EnvironmentThreadShell["latestRun"]>,
    "status" | "completedAt"
  > | null;
  lineage: Pick<EnvironmentThreadShell["lineage"], "relationshipToParent">;
};

export function summarizeGamingHudThreads(threads: readonly HudThread[]) {
  let running = 0;
  let waiting = 0;
  let attentionCount = 0;
  for (const thread of threads) {
    if (thread.archivedAt || thread.deletedAt) continue;
    const status = resolveSidebarThreadStatus(thread);
    if (status === "working") running++;
    if (status === "waiting") waiting++;
    const hasUnseenCompletion =
      status === "ready" &&
      thread.lineage.relationshipToParent !== "subagent" &&
      thread.latestRun?.completedAt &&
      thread.lastVisitedAt &&
      Date.parse(thread.latestRun.completedAt) > Date.parse(thread.lastVisitedAt);
    if (
      status === "approval" ||
      status === "input" ||
      status === "failed" ||
      status === "limited" ||
      (status === "ready" && thread.latestRun?.status === "failed") ||
      hasUnseenCompletion
    )
      attentionCount++;
  }
  return { running, waiting, attentionCount };
}
