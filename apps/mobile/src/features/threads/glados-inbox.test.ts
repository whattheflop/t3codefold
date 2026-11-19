import { describe, expect, it } from "vite-plus/test";
import {
  PITBOSS_DEFAULT_QUALITY,
  ProjectId,
  ThreadId,
  ProviderInstanceId,
  type PitbossTask,
  type PitbossSnapshot,
  type PitbossMessage,
} from "@t3tools/contracts";
import {
  gladosAutonomy,
  gladosInboxLayout,
  gladosInboxRows,
  gladosNewTask,
  gladosReceiptStatus,
  gladosSetup,
  gladosStatus,
  gladosToggleProject,
} from "./glados-inbox";
const projectId = ProjectId.make("project");
const model = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "worker",
  options: [{ id: "reasoningEffort", value: "high" }],
};
const brief = {
  priorities: "House before exploration",
  quality: "Preserve taste and show proof",
  projectIds: [projectId, ProjectId.make("music")],
  maxWorkers: 4,
  maxAttempts: 2,
  workerModel: model,
  alternateWorkerModel: { ...model, model: "alternate" },
  workerRuntimeMode: "approval-required" as const,
  modelGuidance: "Use the cheaper worker first",
  managedPeerIds: ["home"],
};
const task = (id: string, status: PitbossTask["status"]): PitbossTask => ({
  id,
  projectId,
  title: id,
  outcome: "Outcome",
  criteria: "Evidence",
  criteriaVersion: 1,
  verifyCommand: "",
  priority: 50,
  dependencies: [],
  workspaceStrategy: { type: "root" },
  status,
  attempts: [],
  evidence: [],
  source: null,
  note: "",
  acceptedEvidenceId: null,
  revision: 1,
  createdAt: "2026-09-14",
  updatedAt: "2026-09-14",
});
const message = (
  id: string,
  taskId: string | null,
  kind: PitbossMessage["kind"],
): PitbossMessage => ({
  id,
  taskId,
  kind,
  text: "Please inspect",
  threadId: null,
  createdAt: "2026-09-14",
  acknowledged: false,
});
const snapshot = (tasks: PitbossTask[], messages: PitbossMessage[] = []): PitbossSnapshot => ({
  revision: 1,
  role: null,
  tasks,
  messages,
});

describe("GLaDOS mobile decisions", () => {
  it("creates non-Git work by default and isolates code only when selected", () => {
    const fields = {
      id: "research",
      projectId,
      title: " Compare options ",
      criteria: " Dated sources ",
    };
    const research = gladosNewTask({ ...fields, isolatedCode: false });
    const code = gladosNewTask({ ...fields, isolatedCode: true });
    if (research.type !== "create" || code.type !== "create") throw new Error("Expected creation");
    expect(research.workspaceStrategy).toEqual({ type: "root" });
    expect(code.workspaceStrategy).toEqual({ type: "worktree", baseRef: "HEAD" });
    expect(research.title).toBe("Compare options");
  });
  it("surfaces questions with their task once, leaves progress in working and clears acknowledged decisions", () => {
    const state = snapshot(
      [task("research", "active"), task("game", "verifying"), task("done", "done")],
      [
        message("question", "research", "question"),
        message("global", null, "decision"),
        message("update", null, "progress"),
      ],
    );
    expect(gladosInboxRows(state, "needs-you").map((r) => r.key)).toEqual([
      "message:global",
      "task:research",
    ]);
    expect(gladosInboxRows(state, "working").map((r) => r.key)).toEqual([
      "message:update",
      "task:game",
    ]);
    expect(gladosInboxRows(state, "delivered").map((r) => r.key)).toEqual(["task:done"]);
    const acknowledged = {
      ...state,
      messages: state.messages.map((m) => ({ ...m, acknowledged: true })),
    };
    expect(gladosInboxRows(acknowledged, "needs-you").map((r) => r.key)).toEqual([]);
    expect(gladosInboxRows(acknowledged, "working").map((r) => r.key)).toEqual([
      "task:research",
      "task:game",
    ]);
  });
  it("keeps answered tasks in working and cancelled outcomes in All", () => {
    const state = snapshot(
      [task("answered", "queued"), task("cancelled", "cancelled")],
      [message("answer", "answered", "progress"), message("old-question", "cancelled", "question")],
    );
    expect(gladosInboxRows(state, "needs-you")).toEqual([]);
    expect(gladosInboxRows(state, "working").map((row) => row.key)).toEqual(["task:answered"]);
    expect(gladosInboxRows(state, "delivered")).toEqual([]);
    expect(gladosInboxRows(state, "all").map((row) => row.key)).toEqual([
      "task:answered",
      "task:cancelled",
    ]);
  });
  it("keeps orphaned decisions visible and does not truncate a busy backlog", () => {
    const state = snapshot(
      Array.from({ length: 150 }, (_, i) => task(`task-${i}`, "blocked")),
      [message("orphan", "removed", "question")],
    );
    expect(gladosInboxRows(state, "needs-you")).toHaveLength(1);
    expect(gladosInboxRows(state, "working")).toHaveLength(150);
  });
  it("keeps worker questions and submitted results with GLaDOS, not the user", () => {
    const state = snapshot(
      [task("repair", "blocked"), task("review", "verifying")],
      [
        { ...message("worker-help", "repair", "question"), threadId: ThreadId.make("worker") },
        message("result", "review", "result"),
        { ...message("peer-help", null, "question"), sourcePeerId: "peer" },
      ],
    );
    expect(gladosInboxRows(state, "needs-you")).toEqual([]);
    expect(gladosInboxRows(state, "working").map((row) => row.key)).toEqual([
      "message:peer-help",
      "task:repair",
      "task:review",
    ]);
    const choice = {
      ...state,
      tasks: [
        {
          ...state.tasks[0]!,
          decisions: [
            {
              id: "target",
              question: "Which target?",
              options: ["A", "B"],
              recommendation: "A",
              requestedAt: "2026-09-15",
            },
          ],
        },
      ],
    };
    expect(gladosInboxRows(choice, "needs-you").map((row) => row.key)).toEqual(["task:repair"]);
    expect(gladosInboxRows(choice, "working").some((row) => row.key === "task:repair")).toBe(false);
  });
  it("marks expired observations as stale even when the captured command passed", () => {
    let t = task("health", "verifying");
    const recipe = {
      projectId,
      version: 1,
      name: "Health",
      doctor: "ready",
      verify: "check",
      cleanup: "",
      timeoutSeconds: 5,
      artifacts: [],
    };
    t = {
      ...t,
      verification: {
        id: "run",
        state: "completed",
        candidate: "observation:service",
        attemptId: "attempt",
        criteriaVersion: 1,
        recipe,
        requestedAt: "2026-09-14T00:00:00Z",
        receipt: {
          verdict: "pass",
          summary: "healthy",
          checks: [],
          artifacts: [],
          finishedAt: "2026-09-14T00:00:01Z",
          expiresAt: "2026-09-14T00:05:00Z",
        },
      },
    };
    expect(gladosReceiptStatus(t, snapshot([t]), Date.parse("2026-09-14T00:05:00Z"))).toMatch(
      /expired/,
    );
  });
  it.each([
    { width: 384, height: 832, split: false },
    { width: 390, height: 844, split: false },
    { width: 768, height: 900, split: true },
    { width: 900, height: 768, split: true },
    { width: 600, height: 900, split: false },
    { width: 900, height: 450, split: false },
  ])("keeps usable review space at $width × $height", ({ width, height, split }) => {
    const layout = gladosInboxLayout(width, height);
    expect(layout.split).toBe(split);
    if (split) expect(width - layout.listWidth).toBeGreaterThanOrEqual(428);
  });
});

it("new GLaDOS setup requests an environment home with the shared default brief", () => {
  const action = gladosSetup({ modelSelection: model, projectIds: [projectId] });
  if (action.type !== "activate-home") throw new Error("Expected home activation");
  expect(action).not.toHaveProperty("threadId");
  expect(action.brief).toMatchObject({
    priorities: "",
    quality: PITBOSS_DEFAULT_QUALITY,
    projectIds: [projectId],
    maxWorkers: 3,
    maxAttempts: 3,
    workerModel: model,
    coordinatorRuntimeMode: "approval-required",
    workerRuntimeMode: "approval-required",
    verificationMode: "user-approved",
  });
});
it("surfaces unsaved verification proposals in Needs you without claiming approval", () => {
  const proposed = {
    ...task("setup", "queued"),
    proposedVerificationRecipe: {
      projectId,
      version: 1,
      name: "Checks",
      doctor: "node --version",
      verify: "node --test",
      cleanup: "",
      timeoutSeconds: 60,
      artifacts: [],
    },
  };
  expect(gladosInboxRows(snapshot([proposed]), "needs-you").map((row) => row.key)).toEqual([
    "task:setup",
  ]);
  expect(
    gladosReceiptStatus(proposed, snapshot([proposed]), Date.parse("2026-09-14T00:05:00Z")),
  ).toBe("Evidence not ready yet");
});

it("combines project and text filters without losing cancelled work or waiting decisions", () => {
  const waiting = {
    ...task("music", "active"),
    projectId: ProjectId.make("studio"),
    decisions: [
      {
        id: "choice",
        question: "Which arrangement?",
        options: ["Quiet", "Bright"],
        recommendation: "Quiet",
        requestedAt: "2026-09-14",
      },
    ],
  };
  const state = snapshot([
    waiting,
    task("music archive", "cancelled"),
    task("unrelated", "queued"),
  ]);
  expect(gladosInboxRows(state, "needs-you").map((row) => row.key)).toEqual(["task:music"]);
  expect(
    gladosInboxRows(state, "all", { query: "MUSIC", projectId }).map((row) => row.key),
  ).toEqual(["task:music archive"]);
  expect(gladosInboxRows(state, "all", { query: " missing " })).toEqual([]);
});
it("autonomy is an explicit brief command that retains scope and limits in both directions", () => {
  const action = gladosAutonomy(brief, "full-auto");
  if (action.type !== "brief") throw new Error("Expected brief");
  expect(action.applyCoordinatorPermissions).toBe(true);
  expect(action.brief).toEqual({
    ...brief,
    workerRuntimeMode: "full-access",
    coordinatorRuntimeMode: "full-access",
    verificationMode: "automatic",
  });
  const back = gladosAutonomy(action.brief, "ask");
  if (back.type !== "brief") throw new Error("Expected brief");
  expect(back.brief).toEqual({
    ...brief,
    workerRuntimeMode: "approval-required",
    coordinatorRuntimeMode: "approval-required",
    verificationMode: "user-approved",
  });
});
it("toggles projects in and out of scope without reordering the rest", () => {
  const music = ProjectId.make("music");
  const studio = ProjectId.make("studio");
  expect(gladosToggleProject(brief, projectId).projectIds).toEqual([music]);
  expect(gladosToggleProject(brief, studio).projectIds).toEqual([projectId, music, studio]);
});
it("summarizes GLaDOS status from the same buckets as the work board", () => {
  expect(gladosStatus(undefined).title).toBe("GLaDOS is not set up");
  expect(gladosStatus(snapshot([])).title).toBe("GLaDOS is not set up");
  const role = {
    threadId: ThreadId.make("home"),
    projectId,
    generation: 1,
    paused: false,
    brief,
  };
  const waiting = {
    ...task("choice", "active"),
    decisions: [
      {
        id: "d",
        question: "Which?",
        options: ["A", "B"],
        recommendation: "A",
        requestedAt: "2026-09-14",
      },
    ],
  };
  const state = { ...snapshot([task("a", "active"), task("b", "active"), waiting]), role };
  expect(gladosStatus(state)).toEqual({
    title: "GLaDOS is running",
    detail: "3 tasks working · 1 needs you",
  });
  expect(
    gladosStatus({ ...snapshot([task("a", "active")]), role: { ...role, paused: true } }),
  ).toEqual({ title: "GLaDOS is paused", detail: "1 task working" });
});
