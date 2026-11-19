import {
  isUserWorkMessage,
  taskAwaitingApproval,
  workNeedsYou,
  type PitbossMessage,
  type PitbossSnapshot,
  type PitbossAttempt,
  type PitbossTask,
} from "@t3tools/contracts";
import { mFallback, msg } from "gt-i18n";

// Like t3code-custom's agent board, lanes follow live state rather than manual moves.
const GLADOS_BOARD_LANES = [
  { id: "needs-you", label: msg("Chat input"), tone: "attention" },
  { id: "queued", label: msg("Up next"), tone: "muted" },
  { id: "working", label: msg("Working"), tone: "working" },
  { id: "review", label: msg("Verifying"), tone: "review" },
  { id: "waiting", label: msg("Waiting"), tone: "muted" },
  { id: "done", label: msg("Delivered"), tone: "done" },
  { id: "closed", label: msg("Closed"), tone: "muted" },
] as const;
export type GladosBoardLaneId = (typeof GLADOS_BOARD_LANES)[number]["id"];
export type GladosBoardItem =
  | { key: string; task: PitbossTask; message?: never }
  | { key: string; task?: never; message: PitbossMessage };

export interface ManagedWorkerRow {
  readonly attemptId: string;
  readonly current: boolean;
  readonly generation: number;
  readonly model: string;
  /** Display text: what the user owes this worker, or the run state when it owes nothing. */
  readonly state: string;
  readonly threadId: PitbossAttempt["threadId"];
}

const WORKER_STATE_LABELS: Record<PitbossAttempt["state"], string> = {
  pending: msg("pending"),
  running: msg("running"),
  submitted: msg("submitted"),
  stop_requested: msg("stop requested"),
  stopped: msg("stopped"),
  failed: msg("failed"),
};

/** The label says what the user must do, not what the run status happens to be. */
export function managedWorkerStateLabel(
  task: Pick<PitbossTask, "attempts">,
  attempt: Pick<PitbossAttempt, "id" | "state">,
  awaitingApproval?: PitbossSnapshot["awaitingApproval"],
  resolve: (text: string) => string = mFallback,
) {
  return task.attempts.at(-1)?.id === attempt.id && taskAwaitingApproval(task, awaitingApproval)
    ? resolve(msg("waiting for your approval"))
    : resolve(WORKER_STATE_LABELS[attempt.state]);
}

/** Current worker first, while retaining prior attempts as navigable history. */
export function managedWorkerRows(
  task: PitbossTask,
  awaitingApproval?: PitbossSnapshot["awaitingApproval"],
  resolve: (text: string) => string = mFallback,
): ManagedWorkerRow[] {
  const current = task.attempts.at(-1)?.id;
  return [...task.attempts].reverse().map((attempt) => ({
    attemptId: attempt.id,
    current: attempt.id === current,
    generation: attempt.generation,
    model: attempt.model.model,
    state: managedWorkerStateLabel(task, attempt, awaitingApproval, resolve),
    threadId: attempt.threadId,
  }));
}

function isManagedWorkerLive(attempt: PitbossAttempt | undefined): boolean {
  return !!attempt && ["pending", "running", "submitted", "stop_requested"].includes(attempt.state);
}

export function gladosTaskLane(
  task: PitbossTask,
  hasQuestion = false,
  awaitingApproval?: PitbossSnapshot["awaitingApproval"],
): GladosBoardLaneId {
  if (task.status === "done") return "done";
  if (task.status === "cancelled") return "closed";
  if (hasQuestion || workNeedsYou(task, awaitingApproval)) return "needs-you";
  switch (task.status) {
    case "queued":
      return "queued";
    case "active":
      return isManagedWorkerLive(task.attempts.at(-1)) ? "working" : "waiting";
    case "verifying":
      return "review";
    case "blocked":
      return "waiting";
  }
}

/** One card per outcome; task questions stay with their outcome and evidence. */
export function buildGladosBoard(
  state: Pick<PitbossSnapshot, "tasks" | "messages" | "awaitingApproval">,
  filter: { query?: string; projectId?: string } = {},
  resolve: (text: string) => string = mFallback,
) {
  const query = filter.query?.trim().toLocaleLowerCase() ?? "";
  const questions = new Set(
    state.messages.filter(isUserWorkMessage).map((message) => message.taskId),
  );
  const ids = new Set(state.tasks.map((task) => task.id));
  const lanes = GLADOS_BOARD_LANES.map((lane) => ({
    ...lane,
    label: resolve(lane.label),
    items: [] as GladosBoardItem[],
  }));
  const add = (laneId: GladosBoardLaneId, item: GladosBoardItem) => {
    lanes.find((lane) => lane.id === laneId)!.items.push(item);
  };
  for (const task of [...state.tasks].sort(
    (a, b) => a.priority - b.priority || b.updatedAt.localeCompare(a.updatedAt),
  )) {
    if (filter.projectId && task.projectId !== filter.projectId) continue;
    if (query && !`${task.title} ${task.outcome} ${task.note}`.toLocaleLowerCase().includes(query))
      continue;
    add(gladosTaskLane(task, questions.has(task.id), state.awaitingApproval), {
      key: `task:${task.id}`,
      task,
    });
  }
  for (const message of state.messages) {
    if (message.acknowledged || (message.taskId && ids.has(message.taskId)) || filter.projectId)
      continue;
    if (query && !message.text.toLocaleLowerCase().includes(query)) continue;
    add(isUserWorkMessage(message) ? "needs-you" : "working", {
      key: `message:${message.id}`,
      message,
    });
  }
  return lanes;
}

/** Measure the modal itself so folding, rotation, and split-screen keep cards usable. */
export function gladosBoardColumnWidth(width: number) {
  return Math.max(200, Math.min(300, width - 40));
}
