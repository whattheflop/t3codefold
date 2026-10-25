import { ProviderInstanceId } from "@t3tools/contracts";
import type { ThreadRuntimeSummary } from "@t3tools/client-runtime/state/models";
import { describe, expect, it } from "vite-plus/test";
import { summarizeGamingHudThreads } from "./gamingHud.logic";

const idle = {
  archivedAt: null,
  deletedAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  runtime: null,
  latestRun: null,
  lastVisitedAt: "2026-10-10T00:00:00Z",
  lineage: { relationshipToParent: null },
};

// Fixtures use the summary function's domain input, independent of provider state.
describe("gaming HUD", () => {
  it("prioritizes blockers over active work and separates background waiting", () => {
    const runtime: ThreadRuntimeSummary = {
      status: "running",
      activeRunId: null,
      providerInstanceId: ProviderInstanceId.make("codex"),
      providerName: "Codex",
      lastError: null,
      updatedAt: "2026-10-11T00:00:00Z",
    };
    const result = summarizeGamingHudThreads([
      { ...idle, hasPendingApprovals: true, runtime },
      { ...idle, hasPendingUserInput: true, runtime },
      { ...idle, runtime },
      { ...idle, runtime: { ...runtime, status: "idle" } },
    ]);
    expect(result.running).toBe(1);
    expect(result.waiting).toBe(1);
    expect(result.attentionCount).toBe(2);
  });
  it("ignores archived and deleted work", () => {
    expect(
      summarizeGamingHudThreads([
        { ...idle, archivedAt: "2026-10-10", hasPendingApprovals: true },
        { ...idle, deletedAt: "2026-10-10", hasPendingUserInput: true },
      ]).attentionCount,
    ).toBe(0);
  });
  it("reports unread completions without lighting up unvisited history or completed subagents", () => {
    const finished: Parameters<typeof summarizeGamingHudThreads>[0][number] = {
      ...idle,
      latestRun: { status: "completed", completedAt: "2026-10-11T00:00:00Z" },
    };
    expect(
      summarizeGamingHudThreads([
        finished,
        { ...finished, lastVisitedAt: null },
        { ...finished, lastVisitedAt: "2026-10-12T00:00:00Z" },
        { ...finished, lineage: { relationshipToParent: "subagent" } },
      ]).attentionCount,
    ).toBe(1);
  });
  it("counts all threads needing attention", () => {
    const result = summarizeGamingHudThreads([
      ...Array.from({ length: 5 }, (): Parameters<typeof summarizeGamingHudThreads>[0][number] => ({
        ...idle,
        latestRun: { status: "completed", completedAt: "2026-10-11T00:00:00Z" },
      })),
      { ...idle, hasPendingUserInput: true },
    ]);
    expect(result.attentionCount).toBe(6);
  });
});
