import {
  verificationRecipeForTask,
  workNeedsYou,
  isUserWorkMessage,
  hasCurrentVerification,
  pitbossTaskNextAction,
  pitbossTaskNextActionLabel,
  defaultPitbossBrief,
  withPitbossAutonomy,
  type PitbossAction,
  type PitbossAutonomy,
  type PitbossBrief,
  type PitbossMessage,
  type PitbossSnapshot,
  type PitbossTask,
  type ProjectId,
  type ModelSelection,
} from "@t3tools/contracts";
import { deriveLayout } from "../../lib/layout";

export type GladosInboxTab = "all" | "needs-you" | "working" | "delivered";
export type GladosInboxRow =
  | { key: string; task: PitbossTask; message?: never }
  | { key: string; task?: never; message: PitbossMessage };
const needsDecision = (message: PitbossMessage) => isUserWorkMessage(message);

/** Each task appears once; attached questions travel with its evidence, not as duplicate conversations. */
export function gladosInboxRows(
  state: PitbossSnapshot,
  tab: GladosInboxTab,
  filter: { query?: string; projectId?: ProjectId } = {},
): GladosInboxRow[] {
  const query = filter.query?.trim().toLocaleLowerCase() ?? "";
  const questions = new Set(state.messages.filter(needsDecision).map((message) => message.taskId));
  const tasks = state.tasks
    .filter((task) => {
      const bucket =
        task.status === "done"
          ? "delivered"
          : task.status === "cancelled"
            ? "all"
            : workNeedsYou(task, state.awaitingApproval) || questions.has(task.id)
              ? "needs-you"
              : "working";
      return (
        (tab === "all" || bucket === tab) &&
        (!filter.projectId || task.projectId === filter.projectId) &&
        (!query || `${task.title} ${task.outcome} ${task.note}`.toLocaleLowerCase().includes(query))
      );
    })
    .sort((a, b) => a.priority - b.priority || b.updatedAt.localeCompare(a.updatedAt));
  const ids = new Set(state.tasks.map((task) => task.id));
  const messages = state.messages.filter(
    (message) =>
      !message.acknowledged &&
      (!message.taskId || !ids.has(message.taskId)) &&
      !filter.projectId &&
      (!query || message.text.toLocaleLowerCase().includes(query)) &&
      (tab === "all" || (needsDecision(message) ? tab === "needs-you" : tab === "working")),
  );
  return [
    ...messages.map((message) => ({ key: `message:${message.id}`, message })),
    ...tasks.map((task) => ({ key: `task:${task.id}`, task })),
  ];
}

export function gladosReceiptStatus(task: PitbossTask, state: PitbossSnapshot, now: number) {
  const run = task.verification;
  if (!run) return task.evidence.length ? "Reported evidence" : "Evidence not ready yet";
  if (run.state !== "completed") return `Verification ${run.state}`;
  if (run.receipt?.expiresAt && Date.parse(run.receipt.expiresAt) <= now)
    return "Evidence expired. Check again";
  if (run.receipt?.verdict !== "pass")
    return run.receipt?.verdict === "fail" ? "Checks failed" : "Verification inconclusive";
  return hasCurrentVerification(
    task,
    verificationRecipeForTask(state, task),
    task.evidence.at(-1)?.candidate ?? "",
    now,
  )
    ? "Captured checks passed"
    : "Evidence changed. Check again";
}

/** A modal measures its own surface: a folded cover screen must never inherit a wide parent pane. */
export function gladosInboxLayout(width: number, height: number) {
  const listWidth = Math.min(340, Math.max(280, width * 0.38));
  const split = deriveLayout({ width, height }).usesSplitView && width - listWidth >= 428;
  return { split, listWidth: split ? listWidth : width };
}

/** Setting up asks the server for an environment home with the brief every client starts from. */
export function gladosSetup(input: {
  modelSelection: ModelSelection;
  projectIds: ReadonlyArray<ProjectId>;
  priorities?: string;
}): PitbossAction {
  return {
    type: "activate-home",
    brief: defaultPitbossBrief({
      workerModel: input.modelSelection,
      projectIds: input.projectIds,
      ...(input.priorities === undefined ? {} : { priorities: input.priorities }),
    }),
  };
}

export function gladosNewTask(input: {
  id: string;
  projectId: ProjectId;
  title: string;
  criteria: string;
  isolatedCode: boolean;
}): PitbossAction {
  return {
    type: "create",
    taskId: input.id,
    projectId: input.projectId,
    title: input.title.trim(),
    outcome: input.title.trim(),
    criteria: input.criteria.trim(),
    verifyCommand: "",
    priority: 50,
    dependencies: [],
    workspaceStrategy: input.isolatedCode
      ? { type: "worktree", baseRef: "HEAD" }
      : { type: "root" },
  };
}

/** Explicit user choice preserves scope and asks the server to apply coordinator permissions. */
export function gladosAutonomy(brief: PitbossBrief, autonomy: PitbossAutonomy): PitbossAction {
  return {
    type: "brief",
    brief: withPitbossAutonomy(brief, autonomy),
    applyCoordinatorPermissions: true,
  };
}

/** Adds or removes one project from GLaDOS's scope, keeping the user's order. */
export function gladosToggleProject(brief: PitbossBrief, projectId: ProjectId): PitbossBrief {
  return {
    ...brief,
    projectIds: brief.projectIds.includes(projectId)
      ? brief.projectIds.filter((id) => id !== projectId)
      : [...brief.projectIds, projectId],
  };
}

/** One-line status for the settings header; counts match the work board's buckets. */
export function gladosStatus(state: PitbossSnapshot | undefined) {
  const role = state?.role;
  if (!state || !role) return { title: "GLaDOS is not set up", detail: null };
  const working = state.tasks.filter((task) => task.status === "active").length;
  const needsYou = gladosInboxRows(state, "needs-you").length;
  return {
    title: role.paused ? "GLaDOS is paused" : "GLaDOS is running",
    detail: [
      `${working} ${working === 1 ? "task" : "tasks"} working`,
      ...(needsYou ? [`${needsYou} ${needsYou === 1 ? "needs" : "need"} you`] : []),
    ].join(" · "),
  };
}

export function gladosWorkKind(task: PitbossTask, state: PitbossSnapshot) {
  const recipe = verificationRecipeForTask(state, task);
  if (!recipe) return "Outcome";
  return recipe.mode === "artifact"
    ? "Files & research"
    : recipe.mode === "observation"
      ? "Host observation"
      : "Code";
}

export function gladosWorkStatus(task: PitbossTask, state?: PitbossSnapshot) {
  const next = state && pitbossTaskNextActionLabel(pitbossTaskNextAction(state, task));
  if (next) return next;
  switch (task.status) {
    case "done":
      return "Delivered";
    case "active":
      return "Working";
    case "verifying":
      return "In review";
    case "blocked":
      return "Waiting";
    case "cancelled":
      return "Closed";
    default:
      return "Planned";
  }
}
