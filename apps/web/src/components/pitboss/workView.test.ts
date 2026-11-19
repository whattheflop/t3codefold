import { describe, expect, it } from "vite-plus/test";
import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  workNeedsYou,
  type PitbossSnapshot,
  type PitbossTask,
} from "@t3tools/contracts";
import { evidenceKind, filterWork, nextActionLabel } from "./workView";

function task(title: string, status: PitbossTask["status"] = "queued", priority = 50) {
  return {
    title,
    outcome: "A useful result",
    status,
    priority,
    projectId: ProjectId.make("research"),
    attempts: [] as PitbossTask["attempts"],
  };
}

describe("GLaDOS work discovery", () => {
  it("shows no stale rows after the server archives the visible board", () => {
    const before = { tasks: [task("Visible before archive")] };
    const after = { ...before, tasks: [] };
    expect(filterWork(before.tasks, "All", "", "")).toEqual(before.tasks);
    expect(filterWork(after.tasks, "All", "", "")).toEqual([]);
  });
  it("keeps every outcome reachable, including beyond the tenth item", () => {
    const tasks = Array.from({ length: 24 }, (_, i) => task(`Outcome ${i}`));
    expect(filterWork(tasks, "All", "", "")).toHaveLength(24);
    expect(filterWork(tasks, "All", "outcome 23", "")).toEqual([tasks[23]]);
  });
  it("combines project, text and status filters and orders by priority", () => {
    const first = task("Review sources", "active", 10);
    const second = task("Compare sources", "queued", 40);
    const other = { ...task("Other sources"), projectId: ProjectId.make("code") };
    expect(
      filterWork(
        [second, other, first, task("Accepted sources", "done")],
        "Working",
        " SOURCES ",
        "research",
      ),
    ).toEqual([first, second]);
  });
  it("keeps operational blockers with GLaDOS and keeps cancelled work out of delivered results", () => {
    const blocked = task("Missing hardware", "blocked");
    const done = task("Research report", "done");
    const cancelled = task("Cancelled render", "cancelled");
    expect(filterWork([blocked, done, cancelled], "Needs you", "", "")).toEqual([]);
    expect(filterWork([blocked, done, cancelled], "Working", "", "")).toEqual([blocked]);
    const decision = {
      ...blocked,
      decisions: [
        {
          id: "choice",
          question: "Which target?",
          options: ["A", "B"],
          recommendation: "A",
          requestedAt: "2026-09-15",
        },
      ],
    };
    expect(filterWork([decision], "Needs you", "", "")).toEqual([decision]);
    expect(filterWork([decision], "Working", "", "")).toEqual([]);
    expect(
      workNeedsYou({ ...decision, decisions: [{ ...decision.decisions[0]!, answer: "A" }] }),
    ).toBe(false);
    expect(filterWork([blocked, done, cancelled], "Delivered", "", "")).toEqual([done]);
    expect(workNeedsYou(cancelled)).toBe(false);
  });
  it("counts a worker parked on a permission prompt wherever it lists it", () => {
    const attempts: PitbossTask["attempts"] = [
      {
        id: "attempt-parked",
        threadId: ThreadId.make("worker"),
        generation: 1,
        state: "running",
        model: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
        createdAt: "2026-09-16T00:00:00Z",
        detail: "",
      },
    ];
    const parked = { ...task("Permission prompt", "active"), attempts };
    const awaiting = ["attempt-parked"];
    expect(filterWork([parked], "Needs you", "", "", awaiting)).toEqual([parked]);
    expect(filterWork([parked], "Working", "", "", awaiting)).toEqual([]);
    expect(filterWork([parked], "Needs you", "", "", [])).toEqual([]);
    expect(filterWork([parked], "Working", "", "", [])).toEqual([parked]);
    // The badge that opens the filter must count exactly what the filter lists.
    expect(workNeedsYou(parked, awaiting)).toBe(true);
    expect(workNeedsYou(parked)).toBe(false);
    // Only the current worker is the user's to answer; a finished attempt is history.
    const replaced = {
      ...parked,
      attempts: [...attempts, { ...attempts[0]!, id: "attempt-next", generation: 2 }],
    };
    expect(workNeedsYou(replaced, awaiting)).toBe(false);
  });
  it("does not label unconfigured or file outcomes as code", () => {
    expect(evidenceKind(undefined)).toBe("Outcome");
    expect(evidenceKind({ mode: "artifact" })).toBe("Files & research");
    expect(evidenceKind({ mode: "observation" })).toBe("Host observation");
    expect(evidenceKind({})).toBe("Code");
  });
  it("presents setup and retained-result obligations instead of the persisted status alone", () => {
    const retained = {
      ...task("Retained result"),
      id: "retained",
      revision: 4,
      criteria: "Captured verification and review",
      criteriaVersion: 2,
      verifyCommand: "vp test run focused.test.ts",
      dependencies: [],
      workspaceStrategy: { type: "worktree", baseRef: "HEAD" },
      attempts: [
        {
          id: "attempt",
          threadId: ThreadId.make("worker"),
          generation: 1,
          state: "stopped",
          model: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
          createdAt: "2026-09-16T00:00:00Z",
          detail: "Worker stopped",
        },
      ],
      evidence: [
        {
          id: "result",
          attemptId: "attempt",
          criteriaVersion: 1,
          candidate: `commit:${"a".repeat(40)}`,
          verdict: "pass",
          summary: "Focused checks passed",
          command: "vp test run focused.test.ts",
          artifactUrls: [],
          provenance: "worker_report",
          createdAt: "2026-09-16T00:00:00Z",
        },
      ],
      source: null,
      note: "",
      acceptedEvidenceId: null,
      createdAt: "2026-09-16T00:00:00Z",
      updatedAt: "2026-09-16T00:00:00Z",
    } as PitbossTask;
    const state = {
      revision: 1,
      role: null,
      tasks: [retained],
      messages: [],
    } as PitbossSnapshot;
    expect(nextActionLabel(state, retained)).toBe("Review retained result");
    expect(
      nextActionLabel(state, {
        ...retained,
        proposedVerificationRecipe: {
          profileId: "focused",
          projectId: retained.projectId,
          version: 1,
          name: "Focused checks",
          doctor: "command -v vp",
          verify: "vp test run focused.test.ts",
          cleanup: "",
          timeoutSeconds: 60,
          artifacts: [],
        },
      }),
    ).toBe("Approve verification setup");
    const reviewed = {
      ...retained,
      criteriaVersion: 1,
      status: "verifying" as const,
      evidence: [
        {
          ...retained.evidence[0]!,
          provenance: "coordinator_review" as const,
          verdict: "pass" as const,
        },
      ],
    };
    expect(nextActionLabel({ ...state, tasks: [reviewed] }, reviewed)).toBe(
      "Accept reviewed result",
    );
    // A decision or rework moved the task out of review, so its passing review no longer offers
    // an acceptance the server would refuse.
    const reopened = { ...reviewed, status: "queued" as const };
    expect(nextActionLabel({ ...state, tasks: [reopened] }, reopened)).toBe(
      "Review retained result",
    );
    const failed = {
      ...reviewed,
      evidence: [{ ...reviewed.evidence[0]!, verdict: "fail" as const }],
    };
    expect(nextActionLabel({ ...state, tasks: [failed] }, failed)).toBe("Recover or close");
  });
});
