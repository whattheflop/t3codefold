import { actionableInboxFor, activeLeads, taskLead } from "./Leads.ts";
import { OrchestratorProjectionError } from "../orchestration-v2/Orchestrator.ts";
import {
  ProjectionStoreThreadNotFoundError,
  type ProjectionCheckpointContext,
} from "../orchestration-v2/ProjectionStore.ts";
import { PeerService } from "./PeerService.ts";
import {
  CommandId,
  MessageId,
  PitbossAction,
  PitbossForwardIntent,
  PitbossError,
  ProjectId,
  ThreadId,
  isPendingApprovalRequest,
  pitbossTaskNextAction,
  verificationRecipeForTask,
  type PitbossSnapshot,
  type PitbossTaskNextAction,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Stable operation ids need synchronous SHA-256.
import * as NodeCrypto from "node:crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Semaphore from "effect/Semaphore";
import { WorkStore, type WorkEffect } from "./WorkStore.ts";
import {
  sourceEligible,
  attemptsExhausted,
  readyTasks,
  workContext,
  type WorkActor,
} from "./Work.ts";
import { ThreadLaunchService } from "../orchestration-v2/ThreadLaunchService.ts";
import {
  ThreadManagementProjectionLoadError,
  ThreadManagementThreadArchivedError,
  ThreadManagementThreadNotFoundError,
  ThreadManagementService,
  latestActiveRun,
} from "../orchestration-v2/ThreadManagementService.ts";

const encodeWake = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeForward = Schema.decodeUnknownEffect(Schema.fromJsonString(PitbossForwardIntent));
const decodeAction = Schema.decodeUnknownEffect(Schema.fromJsonString(PitbossAction));
const WakeIntent = Schema.Struct({
  recipientId: Schema.String,
  leadId: Schema.optional(Schema.String),
  projectId: ProjectId,
  threadId: ThreadId,
  generation: Schema.Number,
  keys: Schema.Array(Schema.String),
});
const decodeWake = Schema.decodeUnknownEffect(Schema.fromJsonString(WakeIntent));
const isProjectionMissing = Schema.is(ProjectionStoreThreadNotFoundError);
const isManagementMissing = Schema.is(ThreadManagementThreadNotFoundError);
const isProjectionError = Schema.is(OrchestratorProjectionError);
const isManagementError = Schema.is(ThreadManagementProjectionLoadError);
const isArchivedThread = Schema.is(ThreadManagementThreadArchivedError);
function isMissingThread(error: unknown): boolean {
  if (isProjectionMissing(error) || isManagementMissing(error)) return true;
  return (isProjectionError(error) || isManagementError(error)) && isMissingThread(error.cause);
}
function workerAttemptHandled(
  state: PitbossSnapshot,
  task: PitbossSnapshot["tasks"][number],
  attemptIndex: number,
): boolean {
  const attempt = task.attempts[attemptIndex];
  if (!attempt) return false;
  const acceptedAttemptId = task.evidence.find(
    (evidence) => evidence.id === task.acceptedEvidenceId,
  )?.attemptId;
  const accepted =
    task.status === "done" && attempt.state === "submitted" && acceptedAttemptId === attempt.id;
  if (!accepted && !["stopped", "failed"].includes(attempt.state)) return false;
  if (
    state.messages.some(
      (message) =>
        !message.acknowledged &&
        message.threadId === attempt.threadId &&
        (message.kind === "question" || message.kind === "decision"),
    )
  )
    return false;
  return ["done", "cancelled"].includes(task.status) || attemptIndex < task.attempts.length - 1;
}
/**
 * What the worker itself last said about an attempt. Worker reports and submissions are already
 * durable pitboss messages on that worker's own thread, so an escalation can quote real
 * information without loading any transcript history.
 */
function workerLastWords(
  state: PitbossSnapshot,
  task: PitbossSnapshot["tasks"][number],
  attempt: PitbossSnapshot["tasks"][number]["attempts"][number] | undefined,
) {
  if (!attempt) return undefined;
  const spoken = state.messages.findLast(
    (message) =>
      message.threadId === attempt.threadId &&
      message.taskId === task.id &&
      ["question", "progress", "result"].includes(message.kind),
  );
  return spoken?.text.replace(/\s+/g, " ").trim().slice(0, 600) || undefined;
}
/**
 * What a worker left behind, read from its checkpoints. The runtime never loads transcript
 * history, so the per-turn capture counts are the only cheap evidence that separates "did the work
 * and forgot to submit" from "did nothing".
 */
function emptyResultDetail(context: ProjectionCheckpointContext | null) {
  const base = "Worker finished without submitting evidence.";
  const ready = (context?.checkpoints ?? []).filter(
    (checkpoint) => checkpoint.status === "ready" && checkpoint.appRunOrdinal !== null,
  );
  const files = ready.reduce((total, checkpoint) => total + checkpoint.fileCount, 0);
  const turns = ready.filter((checkpoint) => checkpoint.fileCount > 0).length;
  if (files > 0)
    return `${base} It left ${files} file change${files === 1 ? "" : "s"} across ${turns} turn${turns === 1 ? "" : "s"} in its retained workspace, so the work may already be done. Inspect that workspace before settling.`;
  // Capture runs after a turn ends, so a turn without a ready checkpoint left changes no later
  // diff can see: its successor's baseline ref is missing and that capture records no files. Only
  // a thread whose every started run was captured can claim an empty workspace, and run status
  // alone cannot say that — one stopped run earlier in the thread says nothing about the rest. An
  // unreadable projection is just a thread with no captures we can see.
  const captured = new Set(ready.map((checkpoint) => checkpoint.appRunOrdinal));
  const complete =
    ready.length > 0 &&
    (context?.runs ?? []).every(
      // A run that never started changed nothing, so it needs no checkpoint to be accounted for.
      (run) => ["preparing", "queued"].includes(run.status) || captured.has(run.ordinal),
    );
  return complete
    ? `${base} It left no file changes in its workspace.`
    : `${base} No checkpoint recorded its workspace, so what it changed is unknown. Inspect its thread before settling.`;
}
function hasActiveShellRun(shell: OrchestrationV2ThreadShell): boolean {
  return shell.activeRunId !== null || shell.activityRunStatus != null;
}
/**
 * One obligation, two readers. The coordinator needs the exact next command; the user needs a line
 * naming the work. Both are derived here from the same typed action so they cannot drift apart.
 */
const OBLIGATIONS = {
  "await-writer": {
    label: "Result submitted",
    changed: "candidate evidence was recorded without accepting it.",
    next: "wait for the worker to stop, then run the required verification.",
    headline: "Worker submitted a result",
  },
  verify: {
    label: "Verification needed",
    changed: "a stopped candidate has current evidence and an approved profile.",
    next: "run the approved verification, then review its receipt. Do not assign duplicate implementation work.",
    headline: "Ready to verify",
  },
  review: {
    label: "Result ready for review",
    changed: "the worker stopped and retained candidate evidence.",
    next: "inspect the reported evidence and record review. Do not accept the stopped turn itself or assign duplicate implementation work.",
    headline: "Ready to review",
  },
  accept: {
    label: "Acceptance needed",
    changed: "the latest coordinator review passed for the current candidate and proof contract.",
    next: "explicitly accept it or record why more work is required.",
    headline: "Review passed — ready to accept",
  },
  recover: {
    label: "Recovery needed",
    changed: "the latest retained result is not acceptable evidence.",
    next: "inspect the retained thread, then rework or cancel with an honest superseded reason. Never invent evidence for historical work.",
    headline: "Needs recovery",
  },
  "recover-empty": {
    label: "Recovery needed",
    changed: "the worker stopped without submitting any evidence.",
    next: "settle this outcome yourself — close it with an honest reason if it is complete or superseded, or use revise-result with the information the worker was missing to continue it in the retained workspace.",
    headline: "Worker finished with nothing",
  },
  "recover-exhausted": {
    label: "Recovery needed",
    changed:
      "this task used its whole saved attempt allowance, so no further attempt can be started.",
    next: "close it with an honest reason, or cancel it as superseded. revise-result, rework and assign are refused until the user raises the saved attempt limit, so do not try them.",
    headline: "Out of attempts — close it out",
  },
  assign: {
    label: "Ready to assign",
    changed: "prerequisites are satisfied and no retained result needs review.",
    next: "assign a managed worker or record the condition that blocks assignment.",
    headline: "Ready to start",
  },
  rework: {
    label: "Rework ready",
    changed: "an explicit rework request reopened the retained candidate.",
    next: "assign a managed worker with resumeAttemptId {attemptId}. The prior evidence stays historical and is not accepted.",
    headline: "Reopened for rework",
  },
  question: {
    label: "Question",
    changed: "a worker asked for help.",
    next: "answer within the charter or record a user decision.",
    headline: "Worker asked a question",
  },
  decision: {
    label: "Decision needed",
    changed: "a recorded decision is unresolved.",
    next: "resolve the recorded decision before resuming this task.",
    headline: "Waiting on your decision",
  },
  progress: {
    label: "Progress",
    changed: "a worker recorded an update.",
    next: "inspect the update and act only if its recorded state requires it.",
    headline: "Progress update",
  },
  "progress-retained": {
    label: "Task updated",
    changed: "the recorded update preserved the retained result.",
    next: "review the retained candidate against the current criteria before verification.",
    headline: "Updated — retained result still stands",
  },
} as const;
type ObligationKind = keyof typeof OBLIGATIONS;

/** A submitted result reads differently depending on what the task now owes. */
function resultObligation(action: PitbossTaskNextAction | null): ObligationKind {
  return action === "await-writer" ||
    action === "verify" ||
    action === "accept" ||
    action === "recover"
    ? action
    : "review";
}

function obligationText(
  kind: ObligationKind,
  subject: string,
  options: { detail?: string; attemptId?: string | undefined; reminders?: number },
) {
  const { label, changed, next } = OBLIGATIONS[kind];
  const detail = options.detail ? `: ${options.detail}` : ".";
  const reminder = options.reminders
    ? ` (delivery ${options.reminders + 1} of ${SETTLEMENT_REMINDERS} you have not answered; settle it, or record what you found about this task, or the user is asked to settle this outcome)`
    : "";
  return `${label} · ${subject}${detail} Changed: ${changed} Next: ${next.replace("{attemptId}", options.attemptId ?? "none")}${reminder}`;
}

/** The board and the chat show the obligation and the work's name, never its identifiers. */
function obligationHeadline(kind: ObligationKind, title: string | undefined) {
  const { headline } = OBLIGATIONS[kind];
  return title ? `${headline} — ${title}` : headline;
}

interface WakeRecipient {
  readonly id: string;
  readonly projectId: typeof ProjectId.Type;
  readonly threadId: typeof ThreadId.Type;
  readonly generation: number;
  readonly leadId?: string | undefined;
}
/**
 * An obligation the owner is expected to settle itself: keep the worker going with more
 * information, or close the outcome out. These repeat until settled, unlike assignment (capacity
 * decides it) and user decisions (only the user can answer them).
 */
const SETTLEABLE = new Set(["verify", "review", "recover", "accept"]);
/**
 * How many times one unchanged obligation is delivered to its owner before the server asks the
 * user instead. Each delivery costs the owner a turn, so most stalls settle without the user and
 * only a persistently unsettled outcome reaches the decision inbox.
 */
const SETTLEMENT_REMINDERS = 3;
/**
 * Marks the delivery record that carries how many notes the owner had written about a task when an
 * obligation was delivered. Persisted with the wake, so the credit cannot be recomputed from a
 * clock or from history the runtime never loads.
 */
const NOTES_MARK = ":notes:";
function wakeEvents(
  state: PitbossSnapshot,
  recipient: WakeRecipient,
  // How many wakes already carried each obligation key, so an unsettled one can repeat.
  delivered: ReadonlyMap<string, number> = new Map(),
) {
  const messages = actionableInboxFor(state, recipient.threadId, recipient.leadId);
  const available =
    state.tasks.filter((task) =>
      task.attempts.some((attempt) =>
        ["pending", "running", "submitted", "stop_requested"].includes(attempt.state),
      ),
    ).length < (state.role?.brief.maxWorkers ?? 0);
  const owned = state.tasks.filter((task) => taskLead(state, task)?.id === recipient.leadId);
  const assignable = new Set(
    readyTasks(state)
      .filter((task) => owned.includes(task))
      .map((task) => task.id),
  );
  const owner = recipient.leadId ? `project lead ${recipient.leadId}` : "GLaDOS";
  const subjectOf = (task: { id: string } | undefined, attemptId: string | undefined) =>
    task
      ? `task ${task.id} · attempt ${attemptId ?? "none"} · owner ${owner}`
      : `portfolio · owner ${owner}`;
  const events: Array<{
    readonly key: string;
    readonly obligationKey: string;
    readonly text: string;
    readonly headline: string;
    readonly deliverable: boolean;
    readonly notesKey?: string | undefined;
    /** Set when the owner has ignored this obligation for its whole reminder budget. */
    readonly unsettled?: {
      readonly taskId: string;
      readonly action: string;
      readonly deliveries: number;
    };
  }> = [];
  // The owner's own note about a task is its deliberation record: it engaged with the obligation
  // and could not settle it yet, so that delivery does not spend the reminder budget. Decision
  // gates are excluded — the server writes one from this thread when it escalates, and a parked
  // task is not waiting on the owner.
  const gates = new Set(
    state.tasks.flatMap((task) => task.decisions?.map((decision) => decision.id) ?? []),
  );
  const deliberations = new Map<string, number>();
  for (const message of state.messages) {
    if (message.threadId !== recipient.threadId || !message.taskId || gates.has(message.id))
      continue;
    deliberations.set(message.taskId, (deliberations.get(message.taskId) ?? 0) + 1);
  }
  // Notes the owner had already recorded when an obligation was first delivered. They were written
  // about something else, so they cannot pay for reminders about the obligation in front of it
  // now. Each delivery records the count it saw, and the earliest one is this obligation's floor.
  const baselines = new Map<string, number>();
  for (const recorded of delivered.keys()) {
    const at = recorded.lastIndexOf(NOTES_MARK);
    if (at < 0) continue;
    const noted = Number(recorded.slice(at + NOTES_MARK.length));
    if (!Number.isFinite(noted)) continue;
    const obligation = recorded.slice(0, at);
    baselines.set(obligation, Math.min(baselines.get(obligation) ?? noted, noted));
  }
  // An obligation the owner never settled is re-sent under a new key, once per owner turn, rather
  // than being recorded as handled the first time it is delivered. `deliveries` keeps every
  // delivery key unique; `reminders` is the budget the owner left unanswered, and credit is capped
  // so an owner that only ever writes notes still reaches the user.
  const budget = (taskId: string, key: string, action: PitbossTaskNextAction | null) => {
    if (!action || !SETTLEABLE.has(action))
      return { deliveries: 0, reminders: 0, notesKey: undefined };
    const deliveries = delivered.get(key) ?? 0;
    const noted = deliberations.get(taskId) ?? 0;
    const since = noted - (baselines.get(key) ?? noted);
    const credit = Math.min(Math.max(0, since), SETTLEMENT_REMINDERS);
    return {
      deliveries,
      reminders: Math.max(0, deliveries - credit),
      notesKey: `${key}${NOTES_MARK}${noted}`,
    };
  };
  // At the attempt cap a recovery reminder must name the settlement the decider still accepts, or
  // the owner spends its whole budget on a refused action.
  const settlementFor = (
    task: (typeof state.tasks)[number] | undefined,
    kind: ObligationKind,
  ): ObligationKind =>
    (kind === "recover" || kind === "recover-empty") && task && attemptsExhausted(state, task)
      ? "recover-exhausted"
      : kind;
  const obligationKey = (task: (typeof state.tasks)[number], action: string) => {
    const attempt = task.attempts.at(-1);
    const evidence = task.evidence.at(-1);
    const recipe = verificationRecipeForTask(state, task);
    const subject = encodeWake([
      task.criteriaVersion,
      evidence?.id ?? null,
      evidence?.candidate ?? null,
      evidence?.criteriaVersion ?? null,
      evidence?.verdict ?? null,
      evidence?.provenance ?? null,
      task.reworkRequestedAt ?? null,
      task.verificationProfileId ?? null,
      recipe?.profileId ?? null,
      recipe?.version ?? null,
      task.verification?.id ?? null,
      task.verification?.candidate ?? null,
      task.verification?.criteriaVersion ?? null,
      task.verification?.recipe.profileId ?? null,
      task.verification?.recipe.version ?? null,
    ]);
    const identity = NodeCrypto.createHash("sha256").update(subject).digest("hex");
    return `task:${task.id}:owner:${task.ownershipRevision ?? 0}:attempt:${attempt?.id ?? "none"}:action:${action}:subject:${identity}`;
  };
  // Prefer the newest changed context when several durable messages describe one obligation.
  for (const message of messages.toReversed()) {
    const task = state.tasks.find((entry) => entry.id === message.taskId);
    if (task && ["done", "cancelled"].includes(task.status)) continue;
    // Source observations never confer authority. Keep actual worker obligations intact.
    if (
      task &&
      !sourceEligible(task) &&
      (message.id.startsWith("source:") || task.attempts.length === 0)
    )
      continue;
    const attempt = task?.attempts.find((entry) => entry.threadId === message.threadId);
    const action = task ? pitbossTaskNextAction(state, task) : null;
    const eventKind = task?.decisions?.some(
      (decision) => decision.id === message.id && decision.answer === undefined,
    )
      ? "decision"
      : message.kind;
    const obligationOf = settlementFor(
      task,
      eventKind === "question" || eventKind === "decision"
        ? eventKind
        : message.kind === "result"
          ? resultObligation(action)
          : task && task.evidence.length > 0 && action === "review"
            ? "progress-retained"
            : "progress",
    );
    // Questions and decisions are independent obligations even when they concern the same task.
    // Results and progress still coalesce around the task's current next action, so repeated status
    // reports cannot keep waking a coordinator whose obligation did not change.
    const obligation =
      eventKind === "question" || eventKind === "decision"
        ? `message:${message.id}`
        : task
          ? obligationKey(task, action ?? eventKind)
          : `message:${message.id}`;
    const settleable = !!task && eventKind !== "question" && eventKind !== "decision";
    const { deliveries, reminders, notesKey } =
      settleable && task
        ? budget(task.id, obligation, action)
        : { deliveries: 0, reminders: 0, notesKey: undefined };
    events.push({
      key: task
        ? `message:${message.id}:owner:${task.ownershipRevision ?? 0}:action:${action ?? eventKind}:delivery:${deliveries}`
        : `message:${message.id}`,
      obligationKey: obligation,
      text: obligationText(obligationOf, subjectOf(task, attempt?.id), {
        detail: message.text.slice(0, 600),
        attemptId: attempt?.id,
        reminders,
      }),
      headline: obligationHeadline(obligationOf, task?.title),
      deliverable: reminders < SETTLEMENT_REMINDERS,
      ...(notesKey ? { notesKey } : {}),
      ...(reminders >= SETTLEMENT_REMINDERS && task
        ? { unsettled: { taskId: task.id, action: action ?? eventKind, deliveries } }
        : {}),
    });
  }
  for (const task of owned) {
    if (!sourceEligible(task) && task.attempts.length === 0) continue;
    const action = pitbossTaskNextAction(state, task);
    const attempt = task.attempts.at(-1);
    if (!action || !["assign", "verify", "review", "recover", "accept"].includes(action)) continue;
    if (action === "assign" && !assignable.has(task.id)) continue;
    const key = obligationKey(task, action);
    const obligationOf = settlementFor(
      task,
      action === "assign" && task.reworkRequestedAt
        ? "rework"
        : action === "recover" && task.evidence.length === 0
          ? "recover-empty"
          : (action as ObligationKind),
    );
    const { deliveries, reminders, notesKey } = budget(task.id, key, action);
    // Only a recovery needs the worker's recorded workspace fact; every other obligation already
    // names its own evidence.
    const detail = obligationOf.startsWith("recover-") ? attempt?.detail.slice(0, 600) : undefined;
    events.push({
      // The delivery key always differs from the obligation key, so a wake that is queued but not
      // yet delivered cannot be counted as a delivery of its own obligation.
      key: `${key}:delivery:${deliveries}`,
      obligationKey: key,
      text: obligationText(obligationOf, subjectOf(task, attempt?.id), {
        ...(detail ? { detail } : {}),
        attemptId: attempt?.id,
        reminders,
      }),
      headline: obligationHeadline(obligationOf, task.title),
      deliverable: (action !== "assign" || available) && reminders < SETTLEMENT_REMINDERS,
      ...(notesKey ? { notesKey } : {}),
      ...(reminders >= SETTLEMENT_REMINDERS
        ? { unsettled: { taskId: task.id, action, deliveries } }
        : {}),
    });
  }
  return events;
}
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const store = yield* WorkStore;
    const peers = yield* PeerService;
    const threads = yield* ThreadManagementService;
    const launch = yield* ThreadLaunchService;
    const drainLock = yield* Semaphore.make(1);
    const settledAttempts = new Set<string>();
    // Run state and archive flags only; avoids loading the full transcript.
    const runRecords = (target: { readonly projectId: ProjectId; readonly threadId: ThreadId }) =>
      threads.getProjectThreadRecords({ projectId: target.projectId, threadId: target.threadId }, [
        "runs",
      ]);
    const readShell = Effect.fn("WorkRuntime.readShell")(function* (
      threadId: ThreadId,
      projectId?: ProjectId,
    ) {
      const shell = yield* threads.getThreadShell(threadId);
      if (!shell || (projectId !== undefined && shell.projectId !== projectId)) {
        return yield* new OrchestratorProjectionError({
          threadId,
          cause: new ProjectionStoreThreadNotFoundError({ threadId }),
        });
      }
      return shell;
    });
    /**
     * The owner ignored one obligation for its whole reminder budget, so the server stops nudging
     * and parks the task on a user decision. Everything else about the task is preserved: the
     * retained workspace, its evidence and its audit trail all survive whichever way the user
     * settles it.
     */
    const escalate = Effect.fn("WorkRuntime.escalate")(function* (
      recipient: WakeRecipient,
      obligationKey: string,
      unsettled: {
        readonly taskId: string;
        readonly action: string;
        readonly deliveries: number;
      },
    ) {
      const state = yield* store.read();
      const task = state.tasks.find((entry) => entry.id === unsettled.taskId);
      const lead = recipient.leadId
        ? activeLeads(state).find((entry) => entry.id === recipient.leadId)
        : undefined;
      if (
        !task ||
        task.homeEnvironmentId ||
        (recipient.leadId && !lead) ||
        ["done", "cancelled"].includes(task.status) ||
        task.decisions?.some((decision) => decision.answer === undefined) ||
        (task.decisions?.length ?? 0) >= 20
      )
        return false;
      const attempt = task.attempts.at(-1);
      const owner = lead ? `Project lead ${lead.id}` : "GLaDOS";
      // The answer is handed back to this task's manager, so do not offer a continuation the
      // decider will refuse; at the cap, continuing first requires the user to raise the limit.
      const exhausted = attemptsExhausted(state, task);
      // Quote the worker when it said anything; otherwise be explicit that the line below is the
      // server's own observation of the retained workspace, not the worker's.
      const quoted = workerLastWords(state, task, attempt);
      const detail = quoted
        ? `Its last words: "${quoted}"`
        : `It reported nothing; the server recorded: ${(attempt?.detail || task.note || "No detail was recorded.").slice(0, 600)}`;
      // Capped so a long title plus a long quote can never exceed the question's schema bound and
      // silently abort the escalation.
      const question =
        `${task.title}: ${owner} was asked ${unsettled.deliveries} times to settle this outcome (${unsettled.action}) and did not. Its last worker, attempt ${attempt?.id ?? "none"}, left ${task.evidence.length ? "evidence that was never accepted" : "no submitted evidence"}. ${detail} How should this work be settled?`
          .slice(0, 4000)
          .trim();
      const raised = yield* Effect.result(
        store.command(
          {
            commandId: CommandId.make(
              `pitboss:unsettled:${NodeCrypto.createHash("sha256")
                .update(obligationKey)
                .digest("hex")}`,
            ),
            expectedRevision: state.revision,
            authorityGeneration: recipient.generation,
            action: {
              type: "request-decision",
              taskId: task.id,
              question,
              options: [
                exhausted
                  ? "Keep going — raise the saved attempt limit so another attempt can start"
                  : "Keep going — give the worker what it was missing",
                "It is already complete — settle it as delivered",
                "Drop it — stop spending attempts on this task",
              ],
              recommendation: `Answer in your own words; the answer is handed to this task's manager. ${exhausted ? "It has used every attempt you allowed, so it cannot start another until you raise maxAttempts in the brief." : "Keep going if the outcome still matters and the worker only lacked information."} Settle or close it if the work landed elsewhere, is no longer worth an attempt, or the task was never well posed.`,
            },
          },
          { type: "agent", threadId: recipient.threadId },
        ),
      );
      if (raised._tag === "Success") return true;
      yield* Effect.logWarning(
        `Unsettled work could not be escalated for task ${task.id}: ${raised.failure.message}`,
      );
      return false;
    });
    let lastLeadId: string | undefined;
    const processWake = Effect.fn("WorkRuntime.processWake")(function* (effect: WorkEffect) {
      const intent = yield* decodeWake(effect.payload_json);
      const finish = (keys: ReadonlyArray<string>) =>
        store.finishWake(effect.operation_id, encodeWake({ ...intent, keys }));
      const state = yield* store.read();
      if (!state.role) {
        yield* finish([]);
        return;
      }
      if (state.role.paused) return;
      const recipient: WakeRecipient | undefined = intent.leadId
        ? activeLeads(state)
            .filter((lead) => lead.id === intent.leadId)
            .map((lead) => ({
              id: lead.id,
              projectId: lead.projectId,
              threadId: lead.threadId,
              generation: lead.generation,
              leadId: lead.id,
            }))[0]
        : {
            id: "glados",
            projectId: state.role.projectId,
            threadId: state.role.threadId,
            generation: state.role.generation,
          };
      const current = recipient
        ? wakeEvents(
            state,
            recipient,
            yield* store.wakeDeliveries(recipient.id, recipient.generation),
          )
        : [];
      const currentByKey = new Map(current.map((event) => [event.key, event]));
      const matched = intent.keys.flatMap((key) => {
        const event = currentByKey.get(key);
        return event ? [event] : [];
      });
      if (
        !recipient ||
        recipient.id !== intent.recipientId ||
        recipient.generation !== intent.generation ||
        matched.length === 0
      ) {
        yield* finish([]);
        return;
      }
      const deliverable = matched.filter((event) => event.deliverable);
      if (deliverable.length === 0) return;
      const thread = yield* Effect.result(readShell(recipient.threadId, recipient.projectId));
      if (thread._tag === "Success" && hasActiveShellRun(thread.success)) return;
      if (thread._tag === "Failure") {
        yield* store.retryEffect(effect.operation_id, String(thread.failure));
        return;
      }
      const delivered = yield* Effect.result(
        threads.sendToThread({
          projectId: recipient.projectId,
          threadId: recipient.threadId,
          commandId: CommandId.make(effect.operation_id),
          messageId: MessageId.make(effect.operation_id),
          // This lands in the coordinator's chat, which the user also reads. Headlines go on top
          // so a person can scan it; the exact obligations follow for the agent.
          text: [
            "Managed work changed:",
            ...deliverable.map((event) => `- ${event.headline}`),
            "",
            "<t3-managed-work>",
            ...deliverable.map((event) => event.text),
            "</t3-managed-work>",
          ].join("\n"),
          attachments: [],
          mode: "queue",
          createdBy: "system",
          creationSource: "server",
        }),
      );
      // A retry can land after the recipient was archived; UP refuses archived targets even for a
      // command id that already delivered, so treat it as finished instead of retrying forever.
      if (delivered._tag === "Failure" && !isArchivedThread(delivered.failure)) {
        yield* store.retryEffect(effect.operation_id, String(delivered.failure));
        return;
      }
      yield* finish(
        deliverable.flatMap((event) => [
          ...(event.key === event.obligationKey ? [event.key] : [event.key, event.obligationKey]),
          ...(event.notesKey ? [event.notesKey] : []),
        ]),
      );
    });
    const drain = Effect.fn("WorkRuntime.drain")(function* () {
      const pending = yield* store.effects();
      for (const effect of pending) {
        if (effect.kind === "wake") {
          yield* processWake(effect);
          continue;
        }
        const current = yield* store.read();
        const leadStatusAction =
          effect.kind === "lead-status" ? yield* decodeAction(effect.payload_json) : undefined;
        if (
          current.role?.paused &&
          (effect.kind === "create-lead" ||
            effect.kind === "assign" ||
            (leadStatusAction?.type === "lead-status" && leadStatusAction.status === "active"))
        )
          continue;
        if (
          effect.kind === "create-lead" ||
          (leadStatusAction?.type === "lead-status" && leadStatusAction.status === "active")
        ) {
          const action = leadStatusAction ?? (yield* decodeAction(effect.payload_json));
          const target =
            action.type === "create-lead" || action.type === "lead-status"
              ? action.leadId
              : undefined;
          const busy = yield* Effect.forEach(
            activeLeads(current).filter((lead) => lead.id !== target),
            (lead) =>
              runRecords(lead).pipe(
                Effect.map((thread) => !!latestActiveRun(thread)),
                Effect.catch((error) =>
                  isMissingThread(error) ? Effect.succeed(false) : Effect.fail(error),
                ),
              ),
          );
          if (busy.some(Boolean)) continue;
        }
        if (leadStatusAction?.type === "lead-status" && leadStatusAction.status === "active") {
          const lead = activeLeads(current).find((entry) => entry.id === leadStatusAction.leadId);
          if (lead) {
            const thread = yield* runRecords(lead).pipe(
              Effect.catch((error) =>
                isMissingThread(error) ? Effect.succeed(undefined) : Effect.fail(error),
              ),
            );
            if (thread && latestActiveRun(thread)) continue;
          }
        }
        const result = yield* Effect.result(
          Effect.gen(function* () {
            if (effect.kind === "forward") {
              const forward = yield* decodeForward(effect.payload_json);
              yield* peers.send(forward.peerId, forward.message);
              return;
            }
            const action = yield* decodeAction(effect.payload_json);
            const state = yield* store.read();
            if (action.type === "clear-board") {
              if (state.boardClear?.operationId !== effect.operation_id) return;
              const taskIds = new Set(state.boardClear.taskIds);
              const leadIds = new Set(state.boardClear.leadIds);
              for (const task of state.tasks.filter((task) => taskIds.has(task.id))) {
                const authority = state.sourceAuthorities?.find(
                  (entry) => entry.scope === task.source?.scope,
                );
                // A mirrored writer belongs to its recorded home. Archiving this projection must
                // never become an implicit remote cancellation.
                if (task.homeEnvironmentId && authority?.self !== task.homeEnvironmentId) continue;
                for (const attempt of task.attempts) {
                  if (attempt.state !== "stop_requested") continue;
                  const interrupted = yield* Effect.result(
                    threads.interruptThread({
                      projectId: task.projectId,
                      threadId: attempt.threadId,
                      commandId: CommandId.make(`${effect.operation_id}:stop:${attempt.id}`),
                      reason: "GLaDOS archived the work board at the user's direction",
                    }),
                  );
                  if (interrupted._tag === "Failure" && !isMissingThread(interrupted.failure))
                    return yield* Effect.fail(interrupted.failure);
                  if (
                    interrupted._tag === "Success" &&
                    interrupted.success.type === "interrupt_requested"
                  ) {
                    const drained = yield* threads.waitForThread({
                      projectId: task.projectId,
                      threadId: attempt.threadId,
                      runId: interrupted.success.run.id,
                      timeoutMs: 30_000,
                    });
                    if (drained.timedOut)
                      return yield* new PitbossError({
                        code: "unavailable",
                        message: `Worker ${attempt.id} did not stop before the board archive timed out.`,
                      });
                  }
                  yield* store.updateAttempt(
                    task.id,
                    attempt.id,
                    "stopped",
                    "Board archived; evidence and workspace retained",
                  );
                }
              }
              for (const lead of (state.leads ?? []).filter((lead) => leadIds.has(lead.id))) {
                const existing = yield* Effect.result(runRecords(lead));
                if (existing._tag === "Failure") {
                  if (!isMissingThread(existing.failure))
                    return yield* Effect.fail(existing.failure);
                  continue;
                }
                const run = latestActiveRun(existing.success);
                if (!run) continue;
                const interrupted = yield* threads.interruptThread({
                  projectId: lead.projectId,
                  threadId: lead.threadId,
                  runId: run.id,
                  commandId: CommandId.make(`${effect.operation_id}:stop-lead:${lead.id}`),
                  reason: "GLaDOS archived the work board at the user's direction",
                });
                if (interrupted.type === "interrupt_requested") {
                  const drained = yield* threads.waitForThread({
                    projectId: lead.projectId,
                    threadId: lead.threadId,
                    runId: interrupted.run.id,
                    timeoutMs: 30_000,
                  });
                  if (drained.timedOut)
                    return yield* new PitbossError({
                      code: "unavailable",
                      message: `Project lead ${lead.id} did not stop before the board archive timed out.`,
                    });
                }
              }
              yield* store.finishBoardClear(effect.operation_id);
              return;
            }
            if (action.type === "send-peer") {
              const message = state.messages.find((entry) => entry.id === effect.operation_id);
              if (!message?.threadId)
                return yield* new PitbossError({
                  code: "invalid",
                  message: "The originating thread is unavailable.",
                });
              yield* peers.send(action.peerId, {
                id: effect.operation_id,
                text: action.text,
                replyTo: action.replyTo,
                originThreadId: message.threadId,
                createdAt: message.createdAt,
              });
            }
            if (action.type === "propose-coordination") {
              const known = yield* peers.list();
              const peer = known.peers.find((entry) => entry.config.id === action.peerId);
              if (!peer)
                return yield* new PitbossError({
                  code: "invalid",
                  message:
                    "The proposed peer is no longer configured. Configure it before proposing again.",
                });
              yield* peers.execute({
                type: "propose",
                peerId: action.peerId,
                proposal: {
                  id: effect.operation_id,
                  scope: peer.config.scope,
                  coordinator: action.coordinator,
                  participants: [known.environmentId, peer.config.environmentId],
                },
              });
            }
            if (
              (action.type === "elect" ||
                (action.type === "brief" && action.applyCoordinatorPermissions)) &&
              state.role
            ) {
              if (action.type === "elect" && state.role.threadId !== action.threadId) return;
              const mode = state.role.brief.coordinatorRuntimeMode;
              if (mode !== undefined) {
                yield* threads.dispatch({
                  type: "thread.runtime-mode.set",
                  commandId: CommandId.make(`${effect.operation_id}:permissions`),
                  threadId: state.role.threadId,
                  runtimeMode: mode,
                });
              }
            }
            if (action.type === "elect") {
              if (state.role?.threadId !== action.threadId) return;
              const electedThread = yield* runRecords(action);
              if (electedThread.thread.archivedAt !== null)
                yield* threads.dispatch({
                  type: "thread.unarchive",
                  commandId: CommandId.make(`${effect.operation_id}:restore`),
                  threadId: action.threadId,
                });
              yield* threads.dispatch({
                type: "thread.pin",
                commandId: CommandId.make(`${effect.operation_id}:pin`),
                threadId: action.threadId,
              });
            }
            if (
              ((action.type === "elect" && action.startCoordinator) ||
                (action.type === "brief" && action.applyCoordinatorPermissions)) &&
              state.role &&
              !state.role.paused &&
              state.role.brief.coordinatorRuntimeMode === "full-access" &&
              state.role.brief.workerRuntimeMode === "full-access" &&
              state.role.brief.projectIds.length > 0
            ) {
              const coordinator = yield* runRecords(state.role);
              if (!latestActiveRun(coordinator))
                yield* threads.sendToThread({
                  projectId: state.role.projectId,
                  threadId: state.role.threadId,
                  commandId: CommandId.make(`${effect.operation_id}:start`),
                  messageId: MessageId.make(`${effect.operation_id}:start`),
                  text: "Full auto is enabled for GLaDOS and new workers within the saved brief. Read work_read, inspect the approved projects, and create and assign bounded useful work from the saved priorities. Preserve existing tasks and decisions. Use the saved verificationMode: in automatic mode inspect capabilities and configure checks for unattempted work with propose-verification yourself; otherwise prepare one recipe proposal for user review. Never waive verification. End your turn when no independent work is actionable.",
                  mode: "auto",
                  attachments: [],
                  createdBy: "system",
                  creationSource: "server",
                });
            }
            if (action.type === "create-lead" || action.type === "lead-status") {
              const lead = state.leads?.find((entry) => entry.id === action.leadId);
              if (!lead) return;
              const existing =
                action.type === "lead-status"
                  ? yield* runRecords(lead).pipe(
                      Effect.catch((error) =>
                        isMissingThread(error) ? Effect.succeed(undefined) : Effect.fail(error),
                      ),
                    )
                  : undefined;
              if (action.type === "lead-status" && action.status === "dormant") {
                const run = existing && latestActiveRun(existing);
                if (run)
                  yield* threads.interruptThread({
                    projectId: lead.projectId,
                    threadId: lead.threadId,
                    runId: run.id,
                    commandId: CommandId.make(`${effect.operation_id}:stop`),
                    reason: "Project lead was made dormant",
                  });
                return;
              }
              if (!activeLeads(state).some((entry) => entry.id === lead.id)) return;
              if (existing) {
                if (action.type === "lead-status" && action.runtimeMode !== undefined)
                  yield* threads.dispatch({
                    type: "thread.runtime-mode.set",
                    commandId: CommandId.make(`${effect.operation_id}:permissions`),
                    threadId: lead.threadId,
                    runtimeMode: action.runtimeMode,
                  });
                return;
              }
              yield* launch.launch({
                commandId: CommandId.make(effect.operation_id),
                threadId: lead.threadId,
                projectId: lead.projectId,
                title: `Project lead · ${lead.id}`,
                initialMessage: {
                  text: workContext(state, lead.threadId) ?? lead.charter,
                  attachments: [],
                },
                modelSelection: lead.model,
                runtimeMode:
                  lead.runtimeMode ?? state.role?.brief.workerRuntimeMode ?? "approval-required",
                interactionMode: "default",
                workspaceStrategy: { type: "worktree", baseRef: "HEAD" },
                createdBy: "agent",
                creationSource: "mcp",
              });
            }
            if (action.type === "assign") {
              const task = state.tasks.find((task) => task.id === action.taskId);
              const attempt = task?.attempts.find((attempt) => attempt.id === effect.operation_id);
              if (!task || !attempt || attempt.state !== "pending") return;
              yield* launch.launch({
                commandId: CommandId.make(attempt.id),
                threadId: attempt.threadId,
                projectId: task.projectId,
                title: task.title,
                modelSelection: attempt.model,
                runtimeMode:
                  attempt.runtimeMode ?? state.role?.brief.workerRuntimeMode ?? "approval-required",
                interactionMode: "default",
                workspaceStrategy: task.workspaceStrategy,
                initialMessage: {
                  text: workContext(state, attempt.threadId) ?? task.outcome,
                  attachments: [],
                },
                createdBy: "agent",
                creationSource: "mcp",
              });
              yield* store.updateAttempt(task.id, attempt.id, "running", "Worker launched");
            }
            if (
              action.type === "cancel" ||
              action.type === "close" ||
              action.type === "rework" ||
              action.type === "revise-result" ||
              action.type === "request-decision"
            ) {
              const task = state.tasks.find((task) => task.id === action.taskId);
              for (const attempt of task?.attempts ?? []) {
                if (attempt.state !== "stop_requested" || !task) continue;
                const stopped = yield* threads.interruptThread({
                  projectId: task.projectId,
                  threadId: attempt.threadId,
                  commandId: CommandId.make(`${effect.operation_id}:stop:${attempt.id}`),
                  reason:
                    action.type === "request-decision"
                      ? action.question
                      : action.type === "close"
                        ? action.reason
                        : action.note,
                });
                if (stopped.type !== "interrupt_requested")
                  yield* store.updateAttempt(
                    task.id,
                    attempt.id,
                    "stopped",
                    "Previous writer stopped; artifacts remain in its thread/workspace",
                  );
              }
            }
          }),
        );
        if (result._tag === "Failure") {
          const detail = `${effect.kind} (${effect.operation_id}): ${String(result.failure)}`;
          // A board archive must remain retryable until every writer drains. Replaying the same
          // command republishes a store change, and thread terminal events also wake this drain.
          if (effect.kind === "clear-board") {
            yield* store.retryEffect(effect.operation_id, detail);
            continue;
          }
          const state = yield* store.read();
          for (const task of state.tasks) {
            const attempt = task.attempts.find((attempt) => attempt.id === effect.operation_id);
            // A failed launch may already have created a process. Keep ownership until inspection resolves it.
            if (attempt)
              yield* store.updateAttempt(
                task.id,
                attempt.id,
                "stop_requested",
                `Dispatch needs inspection: ${detail}`,
              );
          }
          yield* store.finishEffect(effect.operation_id, detail);
        } else yield* store.finishEffect(effect.operation_id);
      }
      let state: PitbossSnapshot = yield* store.read();
      // A worker awaiting a runtime permission answer is indistinguishable from a busy one by run
      // state alone. Only the user can answer it, so it is surfaced to the user and never wakes the
      // owner; it clears itself on the drain that follows the answer.
      const awaitingApproval: string[] = [];
      for (const task of state.tasks) {
        const authority = state.sourceAuthorities?.find(
          (entry) => entry.scope === task.source?.scope,
        );
        if (task.homeEnvironmentId && authority && task.homeEnvironmentId !== authority.self)
          continue;
        const attempt = task.attempts.at(-1);
        if (!attempt || !["running", "submitted", "stop_requested"].includes(attempt.state))
          continue;
        const observed = yield* Effect.result(readShell(attempt.threadId, task.projectId));
        if (observed._tag === "Failure" && isMissingThread(observed.failure)) {
          yield* store.updateAttempt(
            task.id,
            attempt.id,
            "stopped",
            "No thread was created. Dispatch failed before a writer existed; review and reopen to retry.",
          );
        }
        if (
          observed._tag === "Success" &&
          observed.success.worktreePath &&
          attempt.workspacePath !== observed.success.worktreePath
        ) {
          yield* store.updateAttempt(
            task.id,
            attempt.id,
            attempt.state,
            attempt.detail,
            observed.success.worktreePath,
          );
        }
        const stopping =
          observed._tag === "Success" &&
          observed.success.latestRunId !== null &&
          !hasActiveShellRun(observed.success);
        if (
          !stopping &&
          observed._tag === "Success" &&
          isPendingApprovalRequest(observed.success.pendingRuntimeRequest)
        )
          awaitingApproval.push(attempt.id);
        if (stopping) {
          // The final checkpoint is already committed here: a finished run parks at "waiting",
          // which still reads as an active shell run, until capture writes run.completed in the
          // same commit. The evidence read is advisory and must never strand a live worker.
          const detail =
            task.status === "active"
              ? emptyResultDetail(
                  yield* threads
                    .getCheckpointContext(attempt.threadId)
                    .pipe(Effect.catchCause(() => Effect.succeed(null))),
                )
              : "Worker stopped; evidence and workspace retained";
          yield* store.updateAttempt(task.id, attempt.id, "stopped", detail);
        }
      }
      yield* store.observeAwaitingApproval(awaitingApproval);
      state = yield* store.read();
      // A single revise-result command owns the whole recovery transition. It first drains the
      // old writer above, then this durable request becomes an ordinary checked assignment. Using
      // WorkStore.command keeps attempt, capacity, ownership, model and runtime-mode fences in the
      // same decider as every other launch.
      for (const task of state.tasks) {
        const request = task.revisionRequest;
        if (!request || state.role?.paused) continue;
        const authority = state.sourceAuthorities?.find(
          (entry) => entry.scope === task.source?.scope,
        );
        const lead = task.leadId
          ? activeLeads(state).find((entry) => entry.id === task.leadId)
          : undefined;
        const actor: WorkActor | undefined =
          authority?.proposalId &&
          authority.coordinator &&
          authority.homeEnvironmentId === authority.self &&
          authority.coordinator !== authority.self
            ? {
                type: "peer",
                environmentId: authority.coordinator,
                scope: authority.scope,
                proposalId: authority.proposalId,
              }
            : lead
              ? { type: "agent", threadId: lead.threadId }
              : !task.leadId && state.role
                ? { type: "agent", threadId: state.role.threadId }
                : undefined;
        const ready = readyTasks(state, actor?.type === "peer" ? actor.scope : undefined).some(
          (entry) => entry.id === task.id,
        );
        if (!actor || !ready) continue;
        const attempt = task.attempts.at(-1);
        const assigned = yield* Effect.result(
          store.command(
            {
              commandId: CommandId.make(`${request.id}:assign`),
              expectedRevision: state.revision,
              ...(actor.type === "agent"
                ? {
                    authorityGeneration:
                      lead?.generation ??
                      (state.role?.threadId === actor.threadId ? state.role.generation : undefined),
                  }
                : {}),
              action: {
                type: "assign",
                taskId: task.id,
                ...(request.model ? { model: request.model } : {}),
                ...(request.runtimeMode ? { runtimeMode: request.runtimeMode } : {}),
                ...(attempt?.state === "stopped" && attempt.workspacePath
                  ? { resumeAttemptId: attempt.id }
                  : {}),
              },
            },
            actor,
            actor.type === "agent"
              ? {
                  runtimeMode:
                    request.runtimeMode ??
                    lead?.runtimeMode ??
                    state.role?.brief.workerRuntimeMode ??
                    "approval-required",
                }
              : undefined,
          ),
        );
        if (assigned._tag === "Success") {
          state = yield* store.read();
          break;
        }
        const detail = `Managed revision could not start: ${assigned.failure.message}`;
        const parked = yield* Effect.result(
          store.command(
            {
              commandId: CommandId.make(`${request.id}:blocked`),
              expectedRevision: state.revision,
              ...(actor.type === "agent"
                ? {
                    authorityGeneration:
                      lead?.generation ??
                      (state.role?.threadId === actor.threadId ? state.role.generation : undefined),
                  }
                : {}),
              action: { type: "rework", taskId: task.id, note: detail },
            },
            actor,
          ),
        );
        if (parked._tag === "Failure") continue;
        yield* store.receiveMessage({
          id: `${request.id}:blocked-message`,
          taskId: task.id,
          threadId: null,
          kind: "question",
          text: `${detail}. Correct the saved model, permissions, workspace, or ownership before retrying.`,
          createdAt: DateTime.formatIso(yield* DateTime.now),
          acknowledged: false,
        });
        state = yield* store.read();
        break;
      }
      state = yield* store.read();
      // A handled worker remains part of the task audit trail, but no longer belongs in the active
      // thread list. Automatic settlement is race-safe: live work, pending requests and every
      // explicit user settle/unsettle override win over this reconciliation pass.
      for (const task of state.tasks) {
        const authority = state.sourceAuthorities?.find(
          (entry) => entry.scope === task.source?.scope,
        );
        if (task.homeEnvironmentId && authority && task.homeEnvironmentId !== authority.self)
          continue;
        for (const [attemptIndex, attempt] of task.attempts.entries()) {
          if (settledAttempts.has(attempt.id) || attempt.threadId === state.role?.threadId)
            continue;
          if (!workerAttemptHandled(state, task, attemptIndex)) continue;
          const observed = yield* Effect.result(readShell(attempt.threadId, task.projectId));
          if (observed._tag === "Failure") {
            if (isMissingThread(observed.failure)) continue;
            return yield* Effect.fail(observed.failure);
          }
          const projection = observed.success;
          if (projection.settledOverride !== null) {
            settledAttempts.add(attempt.id);
            continue;
          }
          if (
            hasActiveShellRun(projection) ||
            projection.status === "queued" ||
            projection.pendingRuntimeRequest !== null
          )
            continue;
          yield* threads
            .dispatch({
              type: "thread.auto-settle",
              commandId: CommandId.make(
                `pitboss:settle:${attempt.id}:${DateTime.toEpochMillis(projection.updatedAt)}`,
              ),
              threadId: attempt.threadId,
              snapshotAt: projection.updatedAt,
            })
            .pipe(
              Effect.tap(() => Effect.sync(() => settledAttempts.add(attempt.id))),
              // A concurrent user action can invalidate the snapshot. Settlement must not prevent
              // other workers from being recovered or their manager from receiving a wake.
              Effect.catchCause(Effect.logWarning),
            );
        }
      }
      const role = state.role;
      if (!role || role.paused) return;
      const leads = activeLeads(state);
      const leadRuns = yield* Effect.forEach(leads, (lead) =>
        readShell(lead.threadId, lead.projectId).pipe(
          Effect.map((thread) => ({ lead, active: hasActiveShellRun(thread), available: true })),
          Effect.catch((error) =>
            isMissingThread(error)
              ? Effect.succeed({ lead, active: false, available: false })
              : Effect.fail(error),
          ),
        ),
      );
      const recipients = [
        {
          id: "glados",
          projectId: role.projectId,
          threadId: role.threadId,
          generation: role.generation,
          leadId: undefined as string | undefined,
        },
        ...(!leadRuns.some((entry) => entry.active)
          ? leadRuns
              .filter((entry) => entry.available)
              .map((entry) => entry.lead)
              .toSorted((a, b) => Number(a.id === lastLeadId) - Number(b.id === lastLeadId))
              .map((lead) => ({
                id: lead.id,
                projectId: lead.projectId,
                threadId: lead.threadId,
                generation: lead.generation,
                leadId: lead.id,
              }))
          : []),
      ];
      let wokeLead = false;
      for (const recipient of recipients) {
        if (recipient.leadId && wokeLead) continue;
        const delivered = yield* store.wakeDeliveries(recipient.id, recipient.generation);
        const candidates = wakeEvents(state, recipient, delivered);
        // The owner had its reminders and never settled these outcomes. Ask the user instead of
        // repeating, then re-read: raising a decision parks the task and changes its obligation.
        let escalated = false;
        for (const event of candidates) {
          if (!event.unsettled) continue;
          if (yield* escalate(recipient, event.obligationKey, event.unsettled)) escalated = true;
        }
        if (escalated) state = yield* store.read();
        const obligations = new Set<string>();
        const events = (escalated ? wakeEvents(state, recipient, delivered) : candidates)
          .filter((event) => event.deliverable && !delivered.has(event.key))
          .filter((event) => {
            if (obligations.has(event.obligationKey)) return false;
            obligations.add(event.obligationKey);
            return true;
          })
          .slice(0, 8);
        if (!events.length) continue;
        const thread = yield* readShell(recipient.threadId, recipient.projectId);
        if (hasActiveShellRun(thread)) continue;
        const operationId = `pitboss:wake:${NodeCrypto.createHash("sha256")
          .update(
            encodeWake([recipient.id, recipient.generation, events.map((event) => event.key)]),
          )
          .digest("hex")}`;
        const intent = {
          recipientId: recipient.id,
          ...(recipient.leadId ? { leadId: recipient.leadId } : {}),
          projectId: recipient.projectId,
          threadId: recipient.threadId,
          generation: recipient.generation,
          keys: events.map((event) => event.key),
        };
        const queued = yield* store.queueWake(operationId, encodeWake(intent));
        if (queued)
          yield* processWake({
            operation_id: operationId,
            kind: "wake",
            payload_json: encodeWake(intent),
            attempts: 0,
            error: null,
          });
        if (recipient.leadId) {
          wokeLead = true;
          lastLeadId = recipient.leadId;
        }
      }
    }, drainLock.withPermits(1));
    // Subscribe first, then perform recovery. Event receipts, not model polling, drive subsequent work.
    // Both subscriptions are taken here, before the initial drain reads, so a change during
    // startup is not lost to a wake fiber that has not started yet.
    const storeChanges = yield* store.subscribeChanges;
    const domainEvents = yield* threads.subscribeDomainEvents.pipe(Effect.orDie);
    const wakes = Stream.merge(
      storeChanges,
      domainEvents.pipe(
        // A pending permission prompt changes no run, so the request events are the only signal
        // that a worker just became blocked, or just became unblocked.
        Stream.filter(
          (event) => event.type === "run.updated" || event.type === "runtime-request.updated",
        ),
        Stream.map(() => undefined),
      ),
    );
    yield* wakes.pipe(
      Stream.buffer({ capacity: 1, strategy: "sliding" }),
      Stream.runForEach(() => drain().pipe(Effect.catchCause(Effect.logWarning))),
      Effect.forkScoped,
    );
    yield* drain().pipe(Effect.catchCause(Effect.logWarning));
  }),
);
