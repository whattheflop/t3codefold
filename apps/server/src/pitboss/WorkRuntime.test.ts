import { expect, it } from "@effect/vitest";
import {
  CheckpointId,
  CheckpointRef,
  CheckpointScopeId,
  CommandId,
  PitbossAction,
  EventId,
  EnvironmentId,
  MessageId,
  NodeId,
  ProjectId,
  ProviderInstanceId,
  ProviderSessionId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  type OrchestrationV2Checkpoint,
  type OrchestrationV2RuntimeRequest,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ThreadLaunchInput,
  type OrchestrationV2Run,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import {
  emptyProjection,
  threadShellFromProjection,
  ProjectionStoreThreadNotFoundError,
} from "../orchestration-v2/ProjectionStore.ts";
import { OrchestratorProjectionError } from "../orchestration-v2/Orchestrator.ts";
import {
  ThreadManagementService,
  ThreadManagementThreadArchivedError,
  ThreadManagementProjectionLoadError,
} from "../orchestration-v2/ThreadManagementService.ts";
import { ThreadLaunchService, ThreadLaunchError } from "../orchestration-v2/ThreadLaunchService.ts";
import { PeerService } from "./PeerService.ts";
import { WorkStore, layer as storeLayer } from "./WorkStore.ts";
import { layer as runtime } from "./WorkRuntime.ts";
import { readyTasks, workContext } from "./Work.ts";

const decodeAction = Schema.decodeUnknownSync(Schema.fromJsonString(PitbossAction));
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const time = DateTime.makeUnsafe("2026-09-11T00:00:00Z");
const model = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6-luna" };
const a = ProjectId.make("A"),
  b = ProjectId.make("B"),
  boss = ThreadId.make("boss");
function projection(threadId: ThreadId, projectId: ProjectId) {
  return emptyProjection({
    id: EventId.make(`created-${threadId}`),
    type: "thread.created",
    threadId,
    occurredAt: time,
    payload: {
      id: threadId,
      projectId,
      title: "Runtime fixture",
      createdBy: "user",
      creationSource: "web",
      providerInstanceId: model.instanceId,
      modelSelection: model,
      runtimeMode: "approval-required",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      activeProviderThreadId: null,
      lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
      forkedFrom: null,
      createdAt: time,
      updatedAt: time,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: null,
      deletedAt: null,
    },
  });
}
function running(threadId: ThreadId): OrchestrationV2Run {
  return {
    id: RunId.make(`run-${threadId}`),
    threadId,
    ordinal: 1,
    providerInstanceId: model.instanceId,
    modelSelection: model,
    providerThreadId: null,
    userMessageId: MessageId.make(`message-${threadId}`),
    rootNodeId: NodeId.make(`node-${threadId}`),
    activeAttemptId: null,
    status: "running",
    queuePosition: null,
    requestedAt: time,
    startedAt: time,
    completedAt: null,
    checkpointId: null,
    contextHandoffId: null,
  };
}
/** One captured turn, with the numstat file summaries a real capture records. */
function captured(
  threadId: ThreadId,
  ordinal: number,
  paths: ReadonlyArray<string>,
): OrchestrationV2Checkpoint {
  return {
    id: CheckpointId.make(`checkpoint-${threadId}-${ordinal}`),
    threadId,
    scopeId: CheckpointScopeId.make(`scope-${threadId}`),
    runId: RunId.make(`run-${threadId}`),
    nodeId: NodeId.make(`node-${threadId}`),
    parentCheckpointId: null,
    ordinalWithinScope: ordinal,
    appRunOrdinal: ordinal,
    ref: CheckpointRef.make(`ref-${threadId}-${ordinal}`),
    status: "ready",
    files: paths.map((path) => ({ path, kind: "M", additions: 1, deletions: 0 })),
    capturedAt: time,
  };
}
/** A runtime request on an otherwise running worker; a permission prompt unless told otherwise. */
function approvalRequest(
  threadId: ThreadId,
  status: OrchestrationV2RuntimeRequest["status"] = "pending",
  kind: OrchestrationV2RuntimeRequest["kind"] = "command",
): OrchestrationV2RuntimeRequest {
  return {
    id: RuntimeRequestId.make(`request-${threadId}`),
    nodeId: NodeId.make(`node-${threadId}`),
    providerTurnId: null,
    nativeRequestRef: null,
    kind,
    status,
    responseCapability: {
      type: "live",
      providerSessionId: ProviderSessionId.make(`session-${threadId}`),
    },
    createdAt: time,
    resolvedAt: status === "pending" ? null : time,
  };
}
const harness = Effect.gen(function* () {
  const store = yield* WorkStore;
  const projections = new Map<ThreadId, OrchestrationV2ThreadProjection>([
    [boss, projection(boss, a)],
  ]);
  const launched: ThreadId[] = [];
  const launches: OrchestrationV2ThreadLaunchInput[] = [];
  const launchModes: string[] = [];
  const permissionModes: string[] = [];
  let failPermissions = false;
  const sent: ThreadId[] = [];
  const sentMessages: Array<{
    readonly threadId: ThreadId;
    readonly text: string;
    readonly createdBy: string;
    readonly creationSource: string;
  }> = [];
  const sendAttempts: string[] = [];
  let failNextSend = false;
  let failAllSends = false;
  let archivedSends = false;
  const interrupted: ThreadId[] = [];
  const dispatched: Array<{ readonly type: string; readonly threadId?: ThreadId }> = [];
  let failSettlement = false;
  let forbidHistoryReads = false;
  let deferInterrupt = false;
  let interruptTimesOut = false;
  const failLaunch = new Set<ThreadId>();
  const loadProjection = (input: {
    readonly projectId: ProjectId;
    readonly threadId: ThreadId;
  }) => {
    const p = projections.get(input.threadId);
    return p
      ? Effect.succeed(p)
      : Effect.fail(
          new ThreadManagementProjectionLoadError({
            projectId: input.projectId,
            threadId: input.threadId,
            cause: new OrchestratorProjectionError({
              threadId: input.threadId,
              cause: new ProjectionStoreThreadNotFoundError({ threadId: input.threadId }),
            }),
          }),
        );
  };
  const command = (action: PitbossAction) =>
    Effect.gen(function* () {
      const state = yield* store.read();
      return yield* store.command(
        {
          commandId: CommandId.make(`command-${state.revision}`),
          expectedRevision: state.revision,
          action,
        },
        { type: "user" },
      );
    });
  yield* command({
    type: "elect",
    threadId: boss,
    projectId: a,
    brief: {
      priorities: "Fixture",
      quality: "Run checks",
      projectIds: [a, b],
      maxWorkers: 2,
      maxAttempts: 2,
      workerModel: model,
    },
  });
  for (const effect of yield* store.effects()) yield* store.finishEffect(effect.operation_id);
  const services = Layer.mergeAll(
    Layer.succeed(WorkStore, store),
    Layer.mock(PeerService)({}),
    Layer.mock(ThreadLaunchService)({
      launch: (input) =>
        Effect.gen(function* () {
          const id = input.threadId!;
          launched.push(id);
          launches.push(input);
          launchModes.push(input.runtimeMode);
          if (failLaunch.has(id))
            return yield* new ThreadLaunchError({
              operation: "provision-worktree",
              commandId: input.commandId,
              projectId: input.projectId,
              threadId: id,
              cause: "fixture failure",
            });
          const result = { ...projection(id, input.projectId), runs: [running(id)] };
          projections.set(id, result);
          return { threadId: id, projection: result, resumed: false };
        }),
    }),
    Layer.mock(ThreadManagementService)({
      dispatch: (command) =>
        Effect.gen(function* () {
          dispatched.push(command);
          if (command.type === "thread.runtime-mode.set") {
            if (failPermissions) {
              failPermissions = false;
              return yield* new OrchestratorProjectionError({
                threadId: command.threadId,
                cause: "fixture permission failure",
              });
            }
            permissionModes.push(command.runtimeMode);
            const p = projections.get(command.threadId)!;
            projections.set(command.threadId, {
              ...p,
              thread: { ...p.thread, runtimeMode: command.runtimeMode },
            });
          }
          if (command.type === "thread.auto-settle") {
            if (failSettlement)
              return yield* new OrchestratorProjectionError({
                threadId: command.threadId,
                cause: "Concurrent user activity invalidated snapshot",
              });
            const p = projections.get(command.threadId)!;
            projections.set(command.threadId, {
              ...p,
              thread: { ...p.thread, settledOverride: "settled", settledAt: time },
            });
          }
          return { sequence: 1, storedEvents: [] };
        }),
      streamDomainEvents: Stream.never,
      subscribeDomainEvents: Effect.succeed(Stream.never),
      getThreadProjection: (id) =>
        forbidHistoryReads
          ? Effect.die("Runtime monitoring loaded full history")
          : Effect.succeed(projections.get(id)!),
      getCheckpointContext: (id) => {
        const p = projections.get(id);
        // The real query returns per-turn counts, not the file summaries this fixture spreads in.
        return p
          ? Effect.succeed({
              runs: p.runs,
              checkpointScopes: p.checkpointScopes,
              checkpoints: p.checkpoints.map((c) => ({ ...c, fileCount: c.files.length })),
            })
          : Effect.fail(
              new OrchestratorProjectionError({
                threadId: id,
                cause: new ProjectionStoreThreadNotFoundError({ threadId: id }),
              }),
            );
      },
      getThreadShell: (id) =>
        Effect.sync(() => {
          const p = projections.get(id);
          return p && !p.thread.deletedAt ? threadShellFromProjection(p) : null;
        }),
      interruptThread: (input) =>
        Effect.sync(() => {
          interrupted.push(input.threadId);
          if (interruptTimesOut)
            return {
              type: "interrupt_requested" as const,
              run: running(input.threadId),
              dispatch: { sequence: 1, storedEvents: [] },
            };
          if (!deferInterrupt) {
            const p = projections.get(input.threadId)!;
            projections.set(input.threadId, { ...p, runs: [] });
          }
          return { type: "no_active_run" as const };
        }),
      waitForThread: (input) =>
        Effect.succeed({
          threadId: input.threadId,
          run: running(input.threadId),
          timedOut: interruptTimesOut,
        }),
      getProjectThread: (input) => {
        if (forbidHistoryReads) return Effect.die("Runtime monitoring loaded full history");
        return loadProjection(input);
      },
      // Record reads skip the transcript, so they stay allowed under forbidHistoryReads.
      getProjectThreadRecords: (input) => loadProjection(input),
      sendToThread: (input) =>
        Effect.gen(function* () {
          sendAttempts.push(input.commandId);
          if (archivedSends)
            return yield* new ThreadManagementThreadArchivedError({ threadId: input.threadId });
          if (failAllSends || failNextSend) {
            failNextSend = false;
            return yield* new OrchestratorProjectionError({
              threadId: input.threadId,
              cause: "fixture wake delivery failure",
            });
          }
          sent.push(input.threadId);
          sentMessages.push({
            threadId: input.threadId,
            text: input.text,
            createdBy: input.createdBy,
            creationSource: input.creationSource,
          });
          const run = running(input.threadId);
          const p = { ...projections.get(input.threadId)!, runs: [run] };
          projections.set(input.threadId, p);
          return {
            dispatch: { sequence: 1, storedEvents: [] },
            projection: p,
            run,
            turnItem: null,
            delivery: "started" as const,
            message: {
              id: input.messageId!,
              threadId: input.threadId,
              runId: run.id,
              nodeId: null,
              role: "user" as const,
              text: input.text,
              attachments: [],
              streaming: false,
              createdBy: "agent" as const,
              creationSource: "mcp" as const,
              createdAt: time,
              updatedAt: time,
            },
          };
        }),
    }),
  );
  const drain = () => runtime.pipe(Layer.provide(services), Layer.build, Effect.scoped);
  const lead = (id: string, projectId: ProjectId) =>
    command({
      type: "create-lead",
      leadId: id,
      projectId,
      charter: "Own this project",
      model,
      maxWorkers: 1,
    }).pipe(Effect.map((s) => s.leads!.find((x) => x.id === id)!));
  return {
    store,
    projections,
    launched,
    launches,
    launchModes,
    permissionModes,
    failPermissions: () => {
      failPermissions = true;
    },
    sent,
    sentMessages,
    sendAttempts,
    failNextSend: () => {
      failNextSend = true;
    },
    failAllSends: () => {
      failAllSends = true;
    },
    archiveSendTargets: () => {
      archivedSends = true;
    },
    interrupted,
    dispatched,
    forbidHistoryReads: () => {
      forbidHistoryReads = true;
    },
    failSettlement: () => {
      failSettlement = true;
    },
    deferInterrupt: () => {
      deferInterrupt = true;
    },
    timeoutInterrupt: () => {
      interruptTimesOut = true;
    },
    allowInterrupt: () => {
      interruptTimesOut = false;
    },
    failLaunch,
    command,
    drain,
    lead,
  };
});
const services = storeLayer.pipe(Layer.provideMerge(SqlitePersistence.layerMemory));
it.effect("drains active writers before removing tasks and stale messages from the board", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    yield* h.command({
      type: "create",
      taskId: "active-clear",
      projectId: a,
      title: "Active clear",
      outcome: "Stop safely",
      criteria: "Writer drains",
      verifyCommand: "",
      priority: 1,
      dependencies: [],
      workspaceStrategy: { type: "root" },
    });
    yield* h.command({ type: "assign", taskId: "active-clear" });
    const worker = (yield* h.store.read()).tasks[0]!.attempts[0]!.threadId;
    h.projections.set(worker, { ...projection(worker, a), runs: [running(worker)] });

    yield* h.command({ type: "clear-board" });
    yield* h.drain();
    const archived = yield* h.store.read();
    expect(h.interrupted).toContain(worker);
    expect(archived.tasks).toEqual([]);
    expect(archived.messages).toEqual([]);
    expect(archived.role?.threadId).toBe(boss);
  }).pipe(Effect.provide(services)),
);

it.effect("keeps a timed-out board clear pending and completes it on retry", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    yield* h.command({
      type: "create",
      taskId: "retry-clear",
      projectId: a,
      title: "Retry clear",
      outcome: "Drain before archive",
      criteria: "The archive retries after timeout",
      verifyCommand: "",
      priority: 1,
      dependencies: [],
      workspaceStrategy: { type: "root" },
    });
    yield* h.command({ type: "assign", taskId: "retry-clear" });
    const worker = (yield* h.store.read()).tasks[0]!.attempts[0]!.threadId;
    h.projections.set(worker, { ...projection(worker, a), runs: [running(worker)] });
    h.timeoutInterrupt();

    yield* h.command({ type: "clear-board" });
    yield* h.drain();
    expect((yield* h.store.read()).boardClear).toBeDefined();
    expect((yield* h.store.effects()).some((effect) => effect.kind === "clear-board")).toBe(true);

    h.allowInterrupt();
    yield* h.drain();
    expect((yield* h.store.read()).tasks).toEqual([]);
    expect((yield* h.store.effects()).some((effect) => effect.kind === "clear-board")).toBe(false);
  }).pipe(Effect.provide(services)),
);

it.effect("does not drain or archive local work outside the coordinator's visible brief", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    for (const [taskId, projectId] of [
      ["visible-local", a],
      ["hidden-local", b],
    ] as const) {
      yield* h.command({
        type: "create",
        taskId,
        projectId,
        title: taskId,
        outcome: "Respect visible authority",
        criteria: "Only visible writers stop",
        verifyCommand: "",
        priority: 1,
        dependencies: [],
        workspaceStrategy: { type: "root" },
      });
      yield* h.command({ type: "assign", taskId });
      const task = (yield* h.store.read()).tasks.find((entry) => entry.id === taskId)!;
      const worker = task.attempts[0]!.threadId;
      h.projections.set(worker, { ...projection(worker, projectId), runs: [running(worker)] });
    }
    const before = yield* h.store.read();
    yield* h.command({
      type: "brief",
      brief: { ...before.role!.brief, projectIds: [a] },
    });
    const scoped = yield* h.store.read();
    yield* h.store.command(
      {
        commandId: CommandId.make("scoped-board-clear"),
        expectedRevision: scoped.revision,
        authorityGeneration: scoped.role!.generation,
        action: { type: "clear-board" },
      },
      { type: "agent", threadId: boss },
    );

    yield* h.drain();
    const hidden = (yield* h.store.read()).tasks;
    expect(hidden.map((task) => task.id)).toEqual(["hidden-local"]);
    expect(hidden[0]?.attempts[0]?.state).toBe("running");
    expect(h.interrupted).toEqual([
      before.tasks.find((task) => task.id === "visible-local")!.attempts[0]!.threadId,
    ]);
  }).pipe(Effect.provide(services)),
);

it.effect("archives a remote projection without interrupting its home writer", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    const home = EnvironmentId.make("remote-home");
    const self = EnvironmentId.make("local-coordinator");
    yield* h.store.importSources(
      {
        id: "remote-source",
        kind: "linear",
        baseUrl: "https://tracker.invalid",
        tenantId: "team",
        remoteProjectId: "project",
        projectId: a,
        enabled: true,
      },
      [
        {
          title: "Remote writer",
          outcome: "Keep remote ownership",
          source: {
            kind: "linear",
            ownership: { viewerId: "glados", assigneeId: null, delegateId: null },
            tenantId: "team",
            itemId: "remote-writer",
            scope: "remote-scope",
            key: "REMOTE-2",
            url: "https://tracker.invalid/REMOTE-2",
            status: "Open",
            priority: "1",
            observedAt: "2026-09-11T00:00:00.000Z",
          },
        },
      ],
    );
    const imported = (yield* h.store.read()).tasks[0]!;
    yield* h.store.setSourceAuthority({
      scope: imported.source!.scope!,
      self,
      coordinator: self,
      homeEnvironmentId: home,
      peerId: "remote-peer",
      proposalId: "approved-remote-scope",
    });
    const remoteThread = ThreadId.make("remote-writer-thread");
    yield* h.store.mirrorTask(home, {
      ...imported,
      revision: imported.revision + 1,
      status: "active",
      attempts: [
        {
          id: "remote-attempt",
          threadId: remoteThread,
          generation: 1,
          state: "running",
          model,
          createdAt: "2026-09-11T00:00:00.000Z",
          detail: "Running at task home",
        },
      ],
    });
    h.projections.set(remoteThread, {
      ...projection(remoteThread, a),
      runs: [running(remoteThread)],
    });

    yield* h.command({ type: "clear-board" });
    yield* h.drain();
    expect(h.interrupted).not.toContain(remoteThread);
    expect((yield* h.store.read()).tasks).toEqual([]);
  }).pipe(Effect.provide(services)),
);

it.effect("settles handled worker attempts once without touching live or unresolved workers", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    yield* h.command({
      type: "create",
      taskId: "worker-lifecycle",
      projectId: a,
      title: "Worker lifecycle",
      outcome: "Retain the result and clear handled attempts",
      criteria: "Handled attempts settle",
      verifyCommand: "",
      priority: 1,
      dependencies: [],
      workspaceStrategy: { type: "existing_worktree", worktreePath: "/tmp/worker-lifecycle" },
    });
    yield* h.command({ type: "assign", taskId: "worker-lifecycle" });
    yield* h.drain();
    const first = (yield* h.store.read()).tasks[0]!.attempts[0]!;
    const firstProjection = h.projections.get(first.threadId)!;
    h.projections.set(first.threadId, {
      ...firstProjection,
      runs: firstProjection.runs.map((run) => ({
        ...run,
        status: "completed",
        completedAt: time,
      })),
    });
    yield* h.store.updateAttempt(
      "worker-lifecycle",
      first.id,
      "stopped",
      "Interrupted; recover",
      "/tmp/worker-lifecycle",
    );
    yield* h.command({ type: "rework", taskId: "worker-lifecycle", note: "Transfer recovery" });
    yield* h.command({ type: "reopen", taskId: "worker-lifecycle" });
    yield* h.command({
      type: "assign",
      taskId: "worker-lifecycle",
      resumeAttemptId: first.id,
    });
    yield* h.drain();
    const second = (yield* h.store.read()).tasks[0]!.attempts[1]!;

    expect(h.dispatched.filter((command) => command.type === "thread.auto-settle")).toEqual([
      expect.objectContaining({ threadId: first.threadId }),
    ]);
    expect(h.dispatched).not.toContainEqual(
      expect.objectContaining({ type: "thread.auto-settle", threadId: second.threadId }),
    );

    yield* h.command({
      type: "create",
      taskId: "unhandled-worker",
      projectId: a,
      title: "Unhandled worker",
      outcome: "Keep an unhandled result visible",
      criteria: "Latest stopped attempt stays active",
      verifyCommand: "",
      priority: 2,
      dependencies: [],
      workspaceStrategy: { type: "root" },
    });
    yield* h.command({ type: "assign", taskId: "unhandled-worker" });
    yield* h.drain();
    const unhandled = (yield* h.store.read()).tasks.find((task) => task.id === "unhandled-worker")!
      .attempts[0]!;
    const unhandledProjection = h.projections.get(unhandled.threadId)!;
    h.projections.set(unhandled.threadId, {
      ...unhandledProjection,
      runs: unhandledProjection.runs.map((run) => ({
        ...run,
        status: "completed",
        completedAt: time,
      })),
    });
    yield* h.store.updateAttempt(
      "unhandled-worker",
      unhandled.id,
      "stopped",
      "Result still needs recovery",
    );
    yield* h.drain();
    expect(h.dispatched).not.toContainEqual(
      expect.objectContaining({ type: "thread.auto-settle", threadId: unhandled.threadId }),
    );

    const settledProjection = h.projections.get(first.threadId)!;
    h.projections.set(first.threadId, {
      ...settledProjection,
      thread: { ...settledProjection.thread, settledOverride: "active", settledAt: null },
    });

    yield* h.store.rebuild();
    yield* h.drain();
    expect(h.dispatched.filter((command) => command.type === "thread.auto-settle")).toHaveLength(1);
    expect(
      h.dispatched.filter((command) => command.type === "thread.auto-settle")[0],
    ).toMatchObject({
      commandId: `pitboss:settle:${first.id}:${DateTime.toEpochMillis(time)}`,
      threadId: first.threadId,
    });
    expect(
      (yield* h.store.read()).tasks.find((task) => task.id === "worker-lifecycle")!.attempts,
    ).toHaveLength(2);
  }).pipe(Effect.provide(services)),
);
it.effect("continues manager wakes when a settlement snapshot is invalidated", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    yield* h.command({
      type: "create",
      taskId: "settlement-race",
      projectId: a,
      title: "Settlement race",
      outcome: "Preserve manager recovery",
      criteria: "Settlement failure cannot block the manager",
      verifyCommand: "",
      priority: 1,
      dependencies: [],
      workspaceStrategy: { type: "root" },
    });
    yield* h.command({ type: "assign", taskId: "settlement-race" });
    yield* h.drain();
    const attempt = (yield* h.store.read()).tasks[0]!.attempts[0]!;
    h.projections.set(attempt.threadId, projection(attempt.threadId, a));
    yield* h.store.updateAttempt("settlement-race", attempt.id, "stopped", "Stopped");
    yield* h.command({ type: "close", taskId: "settlement-race", reason: "Superseded" });
    h.failSettlement();
    yield* h.command({
      type: "create",
      taskId: "next-work",
      projectId: a,
      title: "Next work",
      outcome: "Wake the manager",
      criteria: "Ready",
      verifyCommand: "",
      priority: 1,
      dependencies: [],
      workspaceStrategy: { type: "root" },
    });
    h.projections.set(boss, projection(boss, a));
    yield* h.drain();
    expect(h.dispatched).toContainEqual(
      expect.objectContaining({
        type: "thread.auto-settle",
        threadId: attempt.threadId,
      }),
    );
    expect(h.sent).toContain(boss);
  }).pipe(Effect.provide(services)),
);
it.effect("monitors workers and wakes the coordinator without loading transcript history", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    yield* h.command({
      type: "create",
      taskId: "bounded-monitor",
      projectId: a,
      title: "Bounded monitor",
      outcome: "No transcript loads",
      criteria: "Bounded reads",
      verifyCommand: "",
      priority: 1,
      dependencies: [],
      workspaceStrategy: { type: "root" },
    });
    yield* h.command({ type: "assign", taskId: "bounded-monitor" });
    yield* h.drain();
    const attempt = (yield* h.store.read()).tasks[0]!.attempts[0]!;
    const p = h.projections.get(attempt.threadId)!;
    h.projections.set(attempt.threadId, {
      ...p,
      runs: [{ ...running(attempt.threadId), status: "completed", completedAt: time }],
    });
    h.forbidHistoryReads();
    h.projections.set(attempt.threadId, {
      ...p,
      runs: [{ ...running(attempt.threadId), status: "waiting" }],
    });
    yield* h.drain();
    expect((yield* h.store.read()).tasks[0]!.attempts[0]!.state).toBe("running");
    h.projections.set(attempt.threadId, {
      ...p,
      runs: [{ ...running(attempt.threadId), status: "completed", completedAt: time }],
      checkpoints: [captured(attempt.threadId, 1, ["src/one.ts"])],
    });
    yield* h.drain();
    const stopped = (yield* h.store.read()).tasks[0]!.attempts[0]!;
    expect(stopped.state).toBe("stopped");
    // The evidence read is the bounded checkpoint context, never the transcript.
    expect(stopped.detail).toContain("1 file change across 1 turn");
    expect(h.sent).toContain(boss);
  }).pipe(Effect.provide(services)),
);
it.effect("does not couple coordinator interruption to independent workers", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    yield* h.command({
      type: "create",
      taskId: "independent-worker",
      projectId: a,
      title: "Independent worker",
      outcome: "Keep working when the coordinator turn ends",
      criteria: "Worker remains live",
      verifyCommand: "",
      priority: 1,
      dependencies: [],
      workspaceStrategy: { type: "root" },
    });
    yield* h.command({ type: "assign", taskId: "independent-worker" });
    yield* h.drain();
    const worker = (yield* h.store.read()).tasks[0]!.attempts[0]!.threadId;

    h.projections.set(boss, projection(boss, a));
    yield* h.drain();

    expect(h.interrupted).not.toContain(worker);
    expect((yield* h.store.read()).tasks[0]!.attempts[0]!.state).toBe("running");
  }).pipe(Effect.provide(services)),
);
it.effect(
  "does not wake GLaDOS again when its no-op turn leaves the same task ready across restart",
  () =>
    Effect.gen(function* () {
      const h = yield* harness;
      yield* h.command({
        type: "create",
        taskId: "ready-once",
        projectId: a,
        title: "Ready once",
        outcome: "Assign this managed task",
        criteria: "Worker reports once",
        verifyCommand: "",
        priority: 1,
        dependencies: [],
        workspaceStrategy: { type: "worktree", baseRef: "HEAD" },
      });
      yield* h.drain();
      expect(h.sent).toEqual([boss]);
      const unchangedRevision = (yield* h.store.read()).revision;
      h.projections.set(boss, projection(boss, a));
      const unrelated = ThreadId.make("unrelated-worker");
      h.projections.set(unrelated, { ...projection(unrelated, b), runs: [running(unrelated)] });
      yield* h.drain();
      expect((yield* h.store.read()).revision).toBe(unchangedRevision);
      expect(h.sent).toEqual([boss]);
    }).pipe(Effect.provide(services)),
);
it.effect("does not echo a coordinator's own task report back as a wake", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    yield* h.command({
      type: "create",
      taskId: "self-report",
      projectId: a,
      title: "Self report",
      outcome: "Keep the coordinator informed",
      criteria: "No echo wake",
      verifyCommand: "",
      priority: 1,
      dependencies: [],
      workspaceStrategy: { type: "worktree", baseRef: "HEAD" },
    });
    yield* h.drain();
    expect(h.sent).toEqual([boss]);
    h.projections.set(boss, projection(boss, a));
    const state = yield* h.store.read();
    yield* h.store.command(
      {
        commandId: CommandId.make("self-report-message"),
        expectedRevision: state.revision,
        authorityGeneration: state.role!.generation,
        action: {
          type: "report",
          taskId: "self-report",
          kind: "progress",
          text: "I recorded this update myself.",
        },
      },
      { type: "agent", threadId: boss },
    );
    yield* h.drain();
    expect(h.sent).toEqual([boss]);
    const recorded = yield* h.store.read();
    expect(recorded.messages.some((message) => message.text.includes("recorded this update"))).toBe(
      true,
    );
    expect(workContext(recorded, boss)).not.toContain("recorded this update");
  }).pipe(Effect.provide(services)),
);
it.effect("does not echo GLaDOS's own decision request but delivers the user's answer", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    yield* h.command({
      type: "create",
      taskId: "self-decision",
      projectId: a,
      title: "Self decision",
      outcome: "Wait for a user choice without waking itself",
      criteria: "Only the answer returns to GLaDOS",
      verifyCommand: "",
      priority: 1,
      dependencies: [],
      workspaceStrategy: { type: "worktree", baseRef: "HEAD" },
    });
    yield* h.command({ type: "assign", taskId: "self-decision" });
    yield* h.drain();
    const assigned = (yield* h.store.read()).tasks[0]!;
    yield* h.store.command(
      {
        commandId: CommandId.make("self-decision-request"),
        expectedRevision: (yield* h.store.read()).revision,
        authorityGeneration: (yield* h.store.read()).role!.generation,
        action: {
          type: "request-decision",
          taskId: assigned.id,
          question: "Choose the retained format?",
          options: ["A", "B"],
          recommendation: "A",
        },
      },
      { type: "agent", threadId: boss },
    );
    yield* h.drain();
    expect(h.sentMessages).toEqual([]);
    const parked = yield* h.store.read();
    expect(parked.messages.at(-1)).toMatchObject({
      id: "self-decision-request",
      threadId: boss,
      kind: "decision",
      acknowledged: false,
    });
    expect(workContext(parked, boss)).not.toContain("Choose the retained format?");
    h.projections.set(boss, projection(boss, a));
    yield* h.command({
      type: "resolve-decision",
      taskId: assigned.id,
      decisionId: "self-decision-request",
      answer: "B",
    });
    yield* h.drain();
    expect(h.sentMessages).toHaveLength(1);
    expect(h.sentMessages[0]?.text).toContain("Answered");
  }).pipe(Effect.provide(services)),
);
it.effect("delivers distinct worker questions once and preserves them across restart", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    yield* h.command({
      type: "create",
      taskId: "distinct-questions",
      projectId: a,
      title: "Distinct questions",
      outcome: "Ask independent questions",
      criteria: "Both questions are delivered",
      verifyCommand: "",
      priority: 1,
      dependencies: [],
      workspaceStrategy: { type: "worktree", baseRef: "HEAD" },
    });
    yield* h.command({ type: "assign", taskId: "distinct-questions" });
    yield* h.drain();
    const task = (yield* h.store.read()).tasks[0]!;
    const worker = task.attempts[0]!.threadId;
    for (const [id, text] of [
      ["question-one", "Should the first edge case retain history?"],
      ["question-two", "Should the second edge case restore history?"],
    ] as const) {
      const state = yield* h.store.read();
      yield* h.store.command(
        {
          commandId: CommandId.make(id),
          expectedRevision: state.revision,
          action: { type: "report", taskId: task.id, kind: "question", text },
        },
        { type: "agent", threadId: worker },
      );
    }
    yield* h.drain();
    expect(h.sentMessages).toHaveLength(1);
    expect(h.sentMessages[0]?.text).toContain("first edge case");
    expect(h.sentMessages[0]?.text).toContain("second edge case");
    h.projections.set(boss, projection(boss, a));
    yield* h.store.rebuild();
    yield* h.drain();
    expect(h.sentMessages).toHaveLength(1);
  }).pipe(Effect.provide(services)),
);
it.effect("wakes for a new question after an acknowledged progress report", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    yield* h.command({
      type: "create",
      taskId: "question-after-progress",
      projectId: a,
      title: "Question after progress",
      outcome: "Report then ask",
      criteria: "The new question remains visible",
      verifyCommand: "",
      priority: 1,
      dependencies: [],
      workspaceStrategy: { type: "worktree", baseRef: "HEAD" },
    });
    yield* h.command({ type: "assign", taskId: "question-after-progress" });
    yield* h.drain();
    const task = (yield* h.store.read()).tasks[0]!;
    const worker = task.attempts[0]!.threadId;
    yield* h.store.command(
      {
        commandId: CommandId.make("acknowledged-progress"),
        expectedRevision: (yield* h.store.read()).revision,
        action: {
          type: "report",
          taskId: task.id,
          kind: "progress",
          text: "The baseline is complete.",
        },
      },
      { type: "agent", threadId: worker },
    );
    yield* h.drain();
    expect(h.sentMessages.at(-1)?.text).toContain("baseline is complete");
    h.projections.set(boss, projection(boss, a));
    yield* h.command({ type: "acknowledge", messageId: "acknowledged-progress" });
    yield* h.store.command(
      {
        commandId: CommandId.make("new-question"),
        expectedRevision: (yield* h.store.read()).revision,
        action: {
          type: "report",
          taskId: task.id,
          kind: "question",
          text: "Which retained proof should I use?",
        },
      },
      { type: "agent", threadId: worker },
    );
    yield* h.store.rebuild();
    yield* h.drain();
    expect(h.sentMessages).toHaveLength(2);
    expect(h.sentMessages.at(-1)?.text).toContain("Which retained proof should I use?");
  }).pipe(Effect.provide(services)),
);
it.effect("does not re-wake the same assign obligation for an unrelated task revision", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    yield* h.command({
      type: "create",
      taskId: "stable-assign-obligation",
      projectId: a,
      title: "Stable assign obligation",
      outcome: "Assign once",
      criteria: "Worker returns evidence",
      verifyCommand: "",
      priority: 10,
      dependencies: [],
      workspaceStrategy: { type: "worktree", baseRef: "HEAD" },
    });
    yield* h.drain();
    expect(h.sent).toEqual([boss]);
    h.projections.set(boss, projection(boss, a));
    yield* h.command({
      type: "edit",
      taskId: "stable-assign-obligation",
      projectId: a,
      title: "Stable assign obligation",
      outcome: "Assign once",
      criteria: "Worker returns evidence",
      verifyCommand: "",
      priority: 11,
      dependencies: [],
      workspaceStrategy: { type: "worktree", baseRef: "HEAD" },
    });
    yield* h.drain();
    expect(h.sent).toEqual([boss]);
  }).pipe(Effect.provide(services)),
);
it.effect(
  "reminds the coordinator about a failed managed attempt and leaves recovery explicit",
  () =>
    Effect.gen(function* () {
      const h = yield* harness;
      yield* h.command({
        type: "create",
        taskId: "failed-attempt",
        projectId: a,
        title: "Failed attempt",
        outcome: "Recover the managed failure",
        criteria: "A later attempt returns evidence",
        verifyCommand: "",
        priority: 1,
        dependencies: [],
        workspaceStrategy: { type: "worktree", baseRef: "HEAD" },
      });
      yield* h.command({ type: "assign", taskId: "failed-attempt" });
      yield* h.drain();
      const attempt = (yield* h.store.read()).tasks[0]!.attempts[0]!;
      yield* h.store.updateAttempt(
        "failed-attempt",
        attempt.id,
        "failed",
        "Provider exited before producing evidence",
      );
      yield* h.drain();
      expect((yield* h.store.read()).tasks[0]?.status).toBe("blocked");
      expect(h.sentMessages[0]?.text).toContain(
        `Recovery needed · task failed-attempt · attempt ${attempt.id} · owner GLaDOS`,
      );
      h.projections.set(boss, projection(boss, a));
      yield* h.drain();
      // The obligation did not change, so it repeats as an explicit reminder instead of stranding
      // the task on a single delivery the coordinator ignored.
      expect(h.sent).toEqual([boss, boss]);
      expect(h.sentMessages.at(-1)?.text).toContain("Recovery needed");
      expect(h.sentMessages.at(-1)?.text).toContain("delivery 2 of 3");
      expect((yield* h.store.read()).tasks[0]?.status).toBe("blocked");
    }).pipe(Effect.provide(services)),
);
it.effect("wakes once for each changed failed review and reminds about an unchanged one", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    yield* h.command({
      type: "create",
      taskId: "stable-review",
      projectId: a,
      title: "Stable review",
      outcome: "Review the failed attempt once",
      criteria: "One review wake",
      verifyCommand: "",
      priority: 1,
      dependencies: [],
      workspaceStrategy: { type: "worktree", baseRef: "HEAD" },
    });
    yield* h.command({ type: "assign", taskId: "stable-review" });
    yield* h.drain();
    const attempt = (yield* h.store.read()).tasks[0]!.attempts[0]!;
    yield* h.store.updateAttempt("stable-review", attempt.id, "failed", "Provider failed");
    yield* h.drain();
    expect(h.sent).toEqual([boss]);
    h.projections.set(boss, projection(boss, a));
    yield* h.command({
      type: "review",
      taskId: "stable-review",
      attemptId: attempt.id,
      criteriaVersion: 1,
      candidate: `commit:${"a".repeat(40)}`,
      verdict: "fail",
      summary: "Diagnostics confirm the same failed attempt.",
      command: "vp test run focused.test.ts",
      artifactUrls: [],
    });
    yield* h.drain();
    expect(h.sent).toEqual([boss, boss]);
    expect(h.sentMessages.at(-1)?.text).toContain("Recovery needed");
    h.projections.set(boss, projection(boss, a));
    yield* h.command({
      type: "review",
      taskId: "stable-review",
      attemptId: attempt.id,
      criteriaVersion: 1,
      candidate: `commit:${"b".repeat(40)}`,
      verdict: "inconclusive",
      summary: "A different retained candidate is still inconclusive.",
      command: "vp test run focused.test.ts",
      artifactUrls: [],
    });
    yield* h.drain();
    expect(h.sent).toEqual([boss, boss, boss]);
    h.projections.set(boss, projection(boss, a));
    yield* h.drain();
    expect(h.sent).toEqual([boss, boss, boss, boss]);
    expect(h.sentMessages.at(-1)?.text).toContain("delivery 2 of 3");
  }).pipe(Effect.provide(services)),
);
it.effect("resumes a retained candidate after explicit rework and reopen", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    yield* h.command({
      type: "create",
      taskId: "retained-rework",
      projectId: a,
      title: "Retained rework",
      outcome: "Repair the retained candidate",
      criteria: "Replacement evidence passes",
      verifyCommand: "vp test run focused.test.ts",
      priority: 1,
      dependencies: [],
      workspaceStrategy: {
        type: "existing_worktree",
        worktreePath: "/tmp/retained-rework",
      },
    });
    yield* h.command({ type: "assign", taskId: "retained-rework" });
    yield* h.drain();
    const first = (yield* h.store.read()).tasks[0]!.attempts[0]!;
    yield* h.store.updateAttempt(
      "retained-rework",
      first.id,
      "stopped",
      "Candidate retained for review",
      "/tmp/retained-rework",
    );
    yield* h.command({
      type: "review",
      taskId: "retained-rework",
      attemptId: first.id,
      criteriaVersion: 1,
      candidate: `commit:${"a".repeat(40)}`,
      verdict: "inconclusive",
      summary: "The retained candidate needs another implementation pass.",
      command: "vp test run focused.test.ts",
      artifactUrls: [],
    });
    yield* h.command({
      type: "rework",
      taskId: "retained-rework",
      note: "Repair the inconclusive candidate in its retained workspace.",
    });
    yield* h.command({ type: "reopen", taskId: "retained-rework" });
    expect(readyTasks(yield* h.store.read()).map((task) => task.id)).toEqual(["retained-rework"]);
    h.projections.set(boss, projection(boss, a));
    yield* h.drain();
    expect(h.sentMessages.at(-1)?.text).toContain(
      `Rework ready · task retained-rework · attempt ${first.id} · owner GLaDOS`,
    );
    expect(h.sentMessages.at(-1)?.text).toContain(`resumeAttemptId ${first.id}`);
    yield* h.command({
      type: "assign",
      taskId: "retained-rework",
      resumeAttemptId: first.id,
    });
    yield* h.drain();
    const resumed = (yield* h.store.read()).tasks[0]!;
    const second = resumed.attempts.at(-1)!;
    expect(second.id).not.toBe(first.id);
    expect(second.workspacePath).toBe("/tmp/retained-rework");
    expect(resumed.evidence).toHaveLength(1);
    yield* h.store.command(
      {
        commandId: CommandId.make("retained-rework-submit"),
        expectedRevision: (yield* h.store.read()).revision,
        action: {
          type: "submit",
          taskId: resumed.id,
          attemptId: second.id,
          criteriaVersion: resumed.criteriaVersion,
          candidate: `commit:${"b".repeat(40)}`,
          verdict: "pass",
          summary: "Replacement candidate is ready for verification.",
          command: "vp test run focused.test.ts",
          artifactUrls: [],
        },
      },
      { type: "agent", threadId: second.threadId },
    );
    const submitted = (yield* h.store.read()).tasks[0]!;
    expect(submitted.attempts.map((attempt) => attempt.state)).toEqual(["stopped", "submitted"]);
    expect(submitted.evidence.map((evidence) => evidence.verdict)).toEqual([
      "inconclusive",
      "pass",
    ]);
    expect(submitted.acceptedEvidenceId).toBeNull();
  }).pipe(Effect.provide(services)),
);
it.effect("changes a submitted result from await-writer to review after the worker drains", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    yield* h.command({
      type: "create",
      taskId: "submitted-result",
      projectId: a,
      title: "Submitted result",
      outcome: "Return a candidate",
      criteria: "Review the candidate",
      verifyCommand: "vp test run focused.test.ts",
      priority: 1,
      dependencies: [],
      workspaceStrategy: { type: "worktree", baseRef: "HEAD" },
    });
    yield* h.command({ type: "assign", taskId: "submitted-result" });
    yield* h.drain();
    const assigned = (yield* h.store.read()).tasks[0]!;
    const attempt = assigned.attempts[0]!;
    yield* h.store.command(
      {
        commandId: CommandId.make("submit-result"),
        expectedRevision: (yield* h.store.read()).revision,
        action: {
          type: "submit",
          taskId: assigned.id,
          attemptId: attempt.id,
          criteriaVersion: assigned.criteriaVersion,
          candidate: "commit:abc123",
          verdict: "pass",
          summary: "Focused test passed",
          command: "vp test run focused.test.ts",
          artifactUrls: [],
        },
      },
      { type: "agent", threadId: attempt.threadId },
    );
    yield* h.drain();
    expect(h.sentMessages[0]?.text).toContain(
      `Result submitted · task submitted-result · attempt ${attempt.id} · owner GLaDOS`,
    );
    expect(h.sentMessages[0]?.text).toContain(
      "Next: wait for the worker to stop, then run the required verification.",
    );
    h.projections.set(boss, projection(boss, a));
    const worker = h.projections.get(attempt.threadId)!;
    h.projections.set(attempt.threadId, {
      ...worker,
      runs: [{ ...running(attempt.threadId), status: "completed", completedAt: time }],
    });
    yield* h.drain();
    const submitted = (yield* h.store.read()).tasks[0]!;
    expect(submitted.status).toBe("verifying");
    expect(submitted.acceptedEvidenceId).toBeNull();
    expect(h.sentMessages[1]?.text).toContain(
      `Result ready for review · task submitted-result · attempt ${attempt.id} · owner GLaDOS`,
    );
    expect(h.sentMessages[1]?.text).toContain(
      "Next: inspect the reported evidence and record review. Do not accept the stopped turn itself",
    );
    h.projections.set(boss, projection(boss, a));
    yield* h.drain();
    // An unchanged review obligation repeats as a reminder rather than going quiet.
    expect(h.sent).toEqual([boss, boss, boss]);
    expect(h.sentMessages.at(-1)?.text).toContain("Result ready for review");
    expect(h.sentMessages.at(-1)?.text).toContain("delivery 2 of 3");
    h.projections.set(boss, projection(boss, a));
    yield* h.command({
      type: "review",
      taskId: submitted.id,
      attemptId: attempt.id,
      criteriaVersion: submitted.criteriaVersion,
      candidate: `commit:${"a".repeat(40)}`,
      verdict: "pass",
      summary: "Coordinator inspected the retained candidate",
      command: "vp test run focused.test.ts",
      artifactUrls: [],
    });
    yield* h.drain();
    // Recording the review settles that obligation, so acceptance arrives as a first delivery.
    expect(h.sent).toHaveLength(4);
    expect(h.sentMessages.at(-1)?.text).toContain("Acceptance needed");
    expect(h.sentMessages.at(-1)?.text).not.toContain("delivery 2 of 3");
    const reviewed = (yield* h.store.read()).tasks[0]!;
    yield* h.command({
      type: "accept",
      taskId: reviewed.id,
      evidenceId: reviewed.evidence.at(-1)!.id,
      note: "Accepted after explicit coordinator review",
    });
    yield* h.drain();
    expect((yield* h.store.read()).tasks[0]!.status).toBe("done");
    expect(h.dispatched).toContainEqual(
      expect.objectContaining({
        type: "thread.auto-settle",
        commandId: `pitboss:settle:${attempt.id}:${DateTime.toEpochMillis(time)}`,
        threadId: attempt.threadId,
      }),
    );
    // Acceptance leaves no obligation, so nothing is delivered or reminded about again.
    expect(h.sent).toHaveLength(4);
  }).pipe(Effect.provide(services)),
);

it.effect(
  "does not offer a retained result for duplicate assignment after setup approval resolves its decision",
  () =>
    Effect.gen(function* () {
      const h = yield* harness;
      yield* h.command({
        type: "create",
        taskId: "approved-retained-result",
        projectId: a,
        title: "Approved retained result",
        outcome: "Verify the retained candidate",
        criteria: "Captured verification and review",
        verifyCommand: "vp test run focused.test.ts",
        priority: 1,
        dependencies: [],
        workspaceStrategy: { type: "worktree", baseRef: "HEAD" },
      });
      yield* h.command({ type: "assign", taskId: "approved-retained-result" });
      yield* h.drain();
      const assigned = (yield* h.store.read()).tasks[0]!;
      const attempt = assigned.attempts[0]!;
      yield* h.store.command(
        {
          commandId: CommandId.make("retained-submit"),
          expectedRevision: (yield* h.store.read()).revision,
          action: {
            type: "submit",
            taskId: assigned.id,
            attemptId: attempt.id,
            criteriaVersion: assigned.criteriaVersion,
            candidate: `commit:${"a".repeat(40)}`,
            verdict: "pass",
            summary: "Candidate retained while setup is approved",
            command: "vp test run focused.test.ts",
            artifactUrls: [],
          },
        },
        { type: "agent", threadId: attempt.threadId },
      );
      yield* h.command({
        type: "request-decision",
        taskId: assigned.id,
        question: "Approve the proposed verification setup?",
        options: ["Approve", "Revise"],
        recommendation: "Approve",
      });
      yield* h.command({
        type: "propose-verification",
        taskId: assigned.id,
        recipe: {
          profileId: "focused",
          mode: "commit",
          environmentId: EnvironmentId.make("verification-host"),
          effects: "observe",
          enabled: true,
          projectId: a,
          version: 1,
          name: "Focused code checks",
          doctor: "command -v vp",
          verify: "vp test run focused.test.ts",
          cleanup: "",
          timeoutSeconds: 60,
          artifacts: [],
        },
      });
      yield* h.drain();
      const parked = (yield* h.store.read()).tasks[0]!;
      expect(parked.attempts[0]?.state).toBe("stopped");
      h.projections.set(boss, projection(boss, a));
      yield* h.command({
        type: "verification-recipe",
        selectForTaskId: assigned.id,
        recipe: parked.proposedVerificationRecipe!,
      });
      const configured = (yield* h.store.read()).tasks[0]!;
      yield* h.command({
        type: "resolve-decision",
        taskId: configured.id,
        decisionId: configured.decisions![0]!.id,
        answer: "Approve",
      });
      yield* h.drain();
      const approved = (yield* h.store.read()).tasks[0]!;
      expect(approved.status).toBe("queued");
      expect(approved.proposedVerificationRecipe).toBeUndefined();
      expect(readyTasks(yield* h.store.read())).toEqual([]);
      expect(h.sentMessages.at(-1)?.text).toContain(
        "Changed: the recorded update preserved the retained result.",
      );
      expect(h.sentMessages.at(-1)?.text).toContain(
        "Next: review the retained candidate against the current criteria before verification.",
      );
      expect(h.sentMessages.at(-1)?.text).not.toContain("Newly ready");
      expect(h.sentMessages.at(-1)?.text).not.toContain("assign a managed worker");
    }).pipe(Effect.provide(services)),
);

it.effect("re-wakes review once when the retained result proof contract changes", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    yield* h.command({
      type: "create",
      taskId: "changed-proof-contract",
      projectId: a,
      title: "Changed proof contract",
      outcome: "Review the retained result under current proof",
      criteria: "Current profile and criteria are reviewed",
      verifyCommand: "vp test run focused.test.ts",
      priority: 1,
      dependencies: [],
      workspaceStrategy: { type: "worktree", baseRef: "HEAD" },
    });
    yield* h.command({ type: "assign", taskId: "changed-proof-contract" });
    yield* h.drain();
    const task = (yield* h.store.read()).tasks[0]!;
    const attempt = task.attempts[0]!;
    yield* h.store.command(
      {
        commandId: CommandId.make("proof-identity-submit"),
        expectedRevision: (yield* h.store.read()).revision,
        action: {
          type: "submit",
          taskId: task.id,
          attemptId: attempt.id,
          criteriaVersion: task.criteriaVersion,
          candidate: `commit:${"a".repeat(40)}`,
          verdict: "pass",
          summary: "Retained candidate",
          command: "vp test run focused.test.ts",
          artifactUrls: [],
        },
      },
      { type: "agent", threadId: attempt.threadId },
    );
    const worker = h.projections.get(attempt.threadId)!;
    h.projections.set(attempt.threadId, {
      ...worker,
      runs: [{ ...running(attempt.threadId), status: "completed", completedAt: time }],
    });
    yield* h.drain();
    expect(h.sent).toEqual([boss]);
    h.projections.set(boss, projection(boss, a));
    yield* h.command({ type: "acknowledge", messageId: "proof-identity-submit" });
    yield* h.command({
      type: "verification-recipe",
      selectForTaskId: task.id,
      recipe: {
        profileId: "focused",
        mode: "commit",
        projectId: a,
        version: 1,
        name: "Focused checks",
        doctor: "command -v vp",
        verify: "vp test run focused.test.ts",
        cleanup: "",
        timeoutSeconds: 60,
        artifacts: [],
      },
    });
    yield* h.drain();
    expect(h.sent).toEqual([boss, boss]);
    expect(h.sentMessages.at(-1)?.text).toContain("Result ready for review");
    h.projections.set(boss, projection(boss, a));
    yield* h.drain();
    expect(h.sent).toEqual([boss, boss, boss]);
    expect(h.sentMessages.at(-1)?.text).toContain("delivery 2 of 3");
  }).pipe(Effect.provide(services)),
);
it.effect("does not offer managed work again while its persisted writer is running", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    yield* h.command({
      type: "create",
      taskId: "linked-writer",
      projectId: a,
      title: "Linked writer",
      outcome: "Run in its managed thread",
      criteria: "Return evidence",
      verifyCommand: "",
      priority: 1,
      dependencies: [],
      workspaceStrategy: { type: "worktree", baseRef: "HEAD" },
    });
    yield* h.command({ type: "assign", taskId: "linked-writer" });
    yield* h.drain();
    const task = (yield* h.store.read()).tasks[0]!;
    expect(task.status).toBe("active");
    expect(task.attempts[0]?.state).toBe("running");
    expect(h.sent).toEqual([]);
    yield* h.drain();
    expect(h.sent).toEqual([]);
  }).pipe(Effect.provide(services)),
);
it.effect("wakes once with an honest review action when a worker finishes without a result", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    yield* h.command({
      type: "create",
      taskId: "unfinished-result",
      projectId: a,
      title: "Unfinished result",
      outcome: "Return verified evidence",
      criteria: "Evidence is reviewed",
      verifyCommand: "",
      priority: 1,
      dependencies: [],
      workspaceStrategy: { type: "worktree", baseRef: "HEAD" },
    });
    yield* h.command({ type: "assign", taskId: "unfinished-result" });
    yield* h.drain();
    const before = (yield* h.store.read()).tasks[0]!;
    const attempt = before.attempts[0]!;
    const worker = h.projections.get(attempt.threadId)!;
    h.projections.set(attempt.threadId, {
      ...worker,
      runs: [{ ...running(attempt.threadId), status: "completed", completedAt: time }],
    });
    yield* h.drain();
    const after = (yield* h.store.read()).tasks[0]!;
    expect(after.status).toBe("blocked");
    expect(after.acceptedEvidenceId).toBeNull();
    expect(after.attempts[0]?.state).toBe("stopped");
    expect(h.sent).toEqual([boss]);
    expect(h.sentMessages[0]).toMatchObject({
      threadId: boss,
      createdBy: "system",
      creationSource: "server",
    });
    expect(h.sentMessages[0]?.text).toContain(
      `Recovery needed · task unfinished-result · attempt ${attempt.id} · owner GLaDOS`,
    );
    expect(h.sentMessages[0]?.text).toContain(
      "Changed: the worker stopped without submitting any evidence.",
    );
    expect(h.sentMessages[0]?.text).toContain(
      "Next: settle this outcome yourself — close it with an honest reason if it is complete or superseded, or use revise-result with the information the worker was missing",
    );
    expect(h.sentMessages[0]?.text).not.toContain("work_read");
    expect(h.sentMessages[0]?.text).not.toContain("Pending user decisions");
    expect(h.sentMessages[0]?.text).not.toContain("delivery 1 of");
  }).pipe(Effect.provide(services)),
);
it.effect("reminds the owner about one unsettled outcome, then asks the user to settle it", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    yield* h.command({
      type: "create",
      taskId: "unsettled-outcome",
      projectId: a,
      title: "Unsettled outcome",
      outcome: "Return verified evidence",
      criteria: "Evidence is reviewed",
      verifyCommand: "",
      priority: 1,
      dependencies: [],
      workspaceStrategy: { type: "worktree", baseRef: "HEAD" },
    });
    yield* h.command({ type: "assign", taskId: "unsettled-outcome" });
    yield* h.drain();
    const attempt = (yield* h.store.read()).tasks[0]!.attempts[0]!;
    const worker = h.projections.get(attempt.threadId)!;
    h.projections.set(attempt.threadId, {
      ...worker,
      runs: [{ ...running(attempt.threadId), status: "completed", completedAt: time }],
    });
    // Each drain after GLaDOS ends its turn without settling the outcome is one more delivery.
    for (let turn = 0; turn < 4; turn++) {
      h.projections.set(boss, projection(boss, a));
      yield* h.drain();
    }
    expect(h.sent).toEqual([boss, boss, boss]);
    expect(h.sentMessages[1]?.text).toContain("delivery 2 of 3");
    expect(h.sentMessages[2]?.text).toContain("delivery 3 of 3");

    const task = (yield* h.store.read()).tasks[0]!;
    const decision = task.decisions?.at(-1);
    expect(decision?.answer).toBeUndefined();
    expect(decision?.question).toContain("was asked 3 times to settle this outcome");
    expect(decision?.question).toContain("left no submitted evidence");
    expect(decision?.question).toContain("It reported nothing; the server recorded");
    expect(decision?.options).toHaveLength(3);
    expect(task.status).toBe("blocked");

    // The escalation replaces further reminders instead of adding to them.
    h.projections.set(boss, projection(boss, a));
    yield* h.drain();
    expect(h.sent).toEqual([boss, boss, boss]);
    expect((yield* h.store.read()).tasks[0]!.decisions).toHaveLength(1);

    // Answering it returns the task to its manager with the user's direction.
    const revision = (yield* h.store.read()).revision;
    yield* h.store.command(
      {
        commandId: CommandId.make("settle-answer"),
        expectedRevision: revision,
        action: {
          type: "resolve-decision",
          taskId: "unsettled-outcome",
          decisionId: decision!.id,
          answer: "Keep going; the worker was missing the staging credentials.",
        },
      },
      { type: "user" },
    );
    h.projections.set(boss, projection(boss, a));
    yield* h.drain();
    expect(h.sent).toEqual([boss, boss, boss, boss]);
    expect(h.sentMessages.at(-1)?.text).toContain("staging credentials");
  }).pipe(Effect.provide(services)),
);
it.effect(
  "retries a durable wake after restart without changing work or duplicating delivery",
  () =>
    Effect.gen(function* () {
      const h = yield* harness;
      yield* h.command({
        type: "create",
        taskId: "retry-wake",
        projectId: a,
        title: "Retry wake",
        outcome: "Deliver one actionable wake",
        criteria: "One delivery",
        verifyCommand: "",
        priority: 1,
        dependencies: [],
        workspaceStrategy: { type: "worktree", baseRef: "HEAD" },
      });
      const revision = (yield* h.store.read()).revision;
      h.failNextSend();
      yield* h.drain();
      expect(h.sent).toEqual([]);
      const pending = (yield* h.store.effects()).filter((effect) => effect.kind === "wake");
      expect(pending).toHaveLength(1);
      expect(pending[0]?.attempts).toBe(1);
      expect((yield* h.store.read()).revision).toBe(revision);
      yield* h.drain();
      expect(h.sent).toEqual([boss]);
      expect(h.sendAttempts).toHaveLength(2);
      expect(new Set(h.sendAttempts).size).toBe(1);
      expect((yield* h.store.effects()).filter((effect) => effect.kind === "wake")).toEqual([]);
      expect((yield* h.store.read()).revision).toBe(revision);
    }).pipe(Effect.provide(services)),
);
it.effect("finishes a wake whose recipient thread was archived instead of retrying it", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    yield* h.command({
      type: "create",
      taskId: "archived-wake",
      projectId: a,
      title: "Archived wake",
      outcome: "Deliver one actionable wake",
      criteria: "One delivery",
      verifyCommand: "",
      priority: 1,
      dependencies: [],
      workspaceStrategy: { type: "worktree", baseRef: "HEAD" },
    });
    h.archiveSendTargets();
    yield* h.drain();
    expect(h.sendAttempts).toHaveLength(1);
    expect((yield* h.store.effects()).filter((effect) => effect.kind === "wake")).toEqual([]);
    yield* h.drain();
    expect(h.sendAttempts).toHaveLength(1);
  }).pipe(Effect.provide(services)),
);
it.effect("delivers a ready obligation after capacity is temporarily unavailable", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    const create = (taskId: string) =>
      h.command({
        type: "create",
        taskId,
        projectId: a,
        title: taskId,
        outcome: "Complete managed work",
        criteria: "Report evidence",
        verifyCommand: "",
        priority: 1,
        dependencies: [],
        workspaceStrategy: { type: "worktree" as const, baseRef: "HEAD" },
      });
    yield* create("deferred-ready");
    h.failNextSend();
    yield* h.drain();
    expect(h.sent).toEqual([]);
    for (const taskId of ["capacity-one", "capacity-two"]) {
      yield* create(taskId);
      yield* h.command({ type: "assign", taskId });
    }
    yield* h.drain();
    expect(h.sent).toEqual([]);
    const occupied = yield* h.store.read();
    for (const task of occupied.tasks.filter((entry) => entry.id.startsWith("capacity-")))
      yield* h.store.updateAttempt(task.id, task.attempts[0]!.id, "stopped", "Capacity freed");
    yield* h.drain();
    expect(h.sentMessages.some((message) => message.text.includes("task deferred-ready"))).toBe(
      true,
    );
  }).pipe(Effect.provide(services)),
);

it.effect("runs later assignment effects behind a full page of deferred wakes", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    yield* h.command({
      type: "create",
      taskId: "wake-source",
      projectId: a,
      title: "Wake source",
      outcome: "Remain ready",
      criteria: "Wake eventually delivers",
      verifyCommand: "",
      priority: 1,
      dependencies: [],
      workspaceStrategy: { type: "worktree", baseRef: "HEAD" },
    });
    const readyTask = (yield* h.store.read()).tasks[0]!;
    const key = `ready:${readyTask.id}:owner:0:${readyTask.revision}`;
    h.failAllSends();
    for (let index = 0; index < 20; index++)
      yield* h.store.queueWake(
        `deferred-wake-${index}`,
        encodeJson({
          recipientId: "glados",
          projectId: a,
          threadId: boss,
          generation: 1,
          keys: [key],
        }),
      );
    yield* h.command({
      type: "create",
      taskId: "later-launch",
      projectId: a,
      title: "Later launch",
      outcome: "Launch despite deferred wakes",
      criteria: "Managed thread starts",
      verifyCommand: "",
      priority: 2,
      dependencies: [],
      workspaceStrategy: { type: "worktree", baseRef: "HEAD" },
    });
    yield* h.command({ type: "assign", taskId: "later-launch" });
    yield* h.drain();
    const later = (yield* h.store.read()).tasks.find((task) => task.id === "later-launch")!;
    expect(h.launched).toContain(later.attempts[0]!.threadId);
  }).pipe(Effect.provide(services)),
);
it.effect("leaves decision requests to the user and delivers answers with new readiness", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    yield* h.command({
      type: "create",
      taskId: "decision-task",
      projectId: a,
      title: "Decision task",
      outcome: "Follow the recorded choice",
      criteria: "Choice is resolved",
      verifyCommand: "",
      priority: 1,
      dependencies: [],
      workspaceStrategy: { type: "worktree", baseRef: "HEAD" },
    });
    yield* h.command({ type: "assign", taskId: "decision-task" });
    yield* h.drain();
    yield* h.command({
      type: "request-decision",
      taskId: "decision-task",
      question: "Choose the retained format?",
      options: ["A", "B"],
      recommendation: "A",
    });
    yield* h.drain();
    expect(h.sent).toEqual([]);
    yield* h.store.rebuild();
    yield* h.drain();
    expect(h.sent).toEqual([]);
    const decision = (yield* h.store.read()).tasks[0]!.decisions![0]!;
    yield* h.command({
      type: "resolve-decision",
      taskId: "decision-task",
      decisionId: decision.id,
      answer: "A",
    });
    yield* h.command({
      type: "create",
      taskId: "newly-ready",
      projectId: a,
      title: "Newly ready",
      outcome: "Start after the decision",
      criteria: "Managed worker starts",
      verifyCommand: "",
      priority: 2,
      dependencies: [],
      workspaceStrategy: { type: "worktree", baseRef: "HEAD" },
    });
    yield* h.drain();
    expect(h.sent).toEqual([boss]);
    expect(h.sentMessages[0]?.text).toContain("Answered");
    expect(h.sentMessages[0]?.text).toContain(
      "Ready to assign · task newly-ready · attempt none · owner GLaDOS",
    );
    expect(h.sentMessages[0]?.text).not.toContain("Decision needed · task decision-task");
  }).pipe(Effect.provide(services)),
);
it.effect("escalates a project lead's unsettled outcome to the user, not to GLaDOS", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    const owner = yield* h.lead("owner-lead", a);
    yield* h.drain();
    yield* h.command({
      type: "create",
      taskId: "lead-unsettled",
      projectId: a,
      title: "Lead unsettled outcome",
      outcome: "Return verified evidence",
      criteria: "Evidence is reviewed",
      verifyCommand: "",
      priority: 1,
      dependencies: [],
      workspaceStrategy: { type: "worktree", baseRef: "HEAD" },
    });
    yield* h.command({ type: "manage-task", taskId: "lead-unsettled", leadId: owner.id });
    yield* h.command({ type: "assign", taskId: "lead-unsettled" });
    yield* h.drain();
    const attempt = (yield* h.store.read()).tasks[0]!.attempts[0]!;
    const worker = h.projections.get(attempt.threadId)!;
    h.projections.set(attempt.threadId, {
      ...worker,
      runs: [{ ...running(attempt.threadId), status: "completed", completedAt: time }],
    });
    for (let turn = 0; turn < 4; turn++) {
      h.projections.set(owner.threadId, projection(owner.threadId, a));
      h.projections.set(boss, projection(boss, a));
      yield* h.drain();
    }
    const task = (yield* h.store.read()).tasks[0]!;
    const decision = task.decisions?.at(-1);
    expect(decision?.answer).toBeUndefined();
    expect(decision?.question).toContain(`Project lead ${owner.id} was asked 3 times`);
    // The lead, not GLaDOS, held the obligation, so GLaDOS was never woken about it.
    expect(h.sent.filter((threadId) => threadId === owner.threadId)).toHaveLength(3);
    expect(h.sent).not.toContain(boss);
  }).pipe(Effect.provide(services)),
);
it.effect("redelivers a mirrored task obligation when ownership returns to a prior manager", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    const home = EnvironmentId.make("remote-home");
    const coordinator = EnvironmentId.make("coordinator");
    yield* h.store.importSources(
      {
        id: "remote-source",
        kind: "linear",
        baseUrl: "https://tracker.invalid",
        tenantId: "team",
        remoteProjectId: "project",
        projectId: a,
        enabled: true,
      },
      [
        {
          title: "Mirrored task",
          outcome: "Remain ready across ownership changes",
          source: {
            kind: "linear",
            ownership: { viewerId: "glados", assigneeId: null, delegateId: null },
            tenantId: "team",
            itemId: "remote-one",
            scope: "remote-scope",
            key: "REMOTE-1",
            url: "https://tracker.invalid/REMOTE-1",
            status: "Open",
            priority: "1",
            observedAt: "2026-09-11T00:00:00.000Z",
          },
        },
      ],
    );
    const imported = (yield* h.store.read()).tasks[0]!;
    const remoteScope = imported.source!.scope!;
    yield* h.store.setSourceAuthority({
      scope: remoteScope,
      self: coordinator,
      coordinator,
      homeEnvironmentId: home,
      peerId: "remote-peer",
      proposalId: "approved-remote-scope",
    });
    yield* h.store.mirrorTask(home, {
      ...imported,
      revision: imported.revision + 1,
      status: "queued",
      note: "Ready at its fixed home",
    });
    for (const message of (yield* h.store.read()).messages.filter((entry) => !entry.acknowledged))
      yield* h.command({ type: "acknowledge", messageId: message.id });
    const leadA = yield* h.lead("lead-a", a);
    for (const effect of yield* h.store.effects())
      if (effect.kind === "create-lead") yield* h.store.finishEffect(effect.operation_id);
    h.projections.set(leadA.threadId, projection(leadA.threadId, a));
    const homeRevision = (yield* h.store.read()).tasks[0]!.revision;
    for (const lead of [leadA, null, leadA]) {
      h.projections.set(leadA.threadId, projection(leadA.threadId, a));
      h.projections.set(boss, projection(boss, a));
      yield* h.command({ type: "manage-task", taskId: imported.id, leadId: lead?.id ?? null });
      yield* h.drain();
    }
    expect(h.sent).toEqual([leadA.threadId, boss, leadA.threadId]);
    const returned = (yield* h.store.read()).tasks[0]!;
    expect(returned.revision).toBe(homeRevision);
    expect(returned.ownershipRevision).toBe(3);
  }).pipe(Effect.provide(services)),
);
it.effect("launches leads and workers as ordinary managed threads in independent worktrees", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    const lead = yield* h.lead("managed", a);
    yield* h.drain();
    expect(h.launches[0]).toMatchObject({
      threadId: lead.threadId,
      projectId: a,
      workspaceStrategy: { type: "worktree", baseRef: "HEAD" },
      createdBy: "agent",
      creationSource: "mcp",
    });
    yield* h.command({
      type: "create",
      taskId: "managed-worker",
      projectId: a,
      title: "Managed worker",
      outcome: "Implement the bounded change",
      criteria: "Focused proof passes",
      verifyCommand: "vp test run focused.test.ts",
      priority: 1,
      dependencies: [],
      workspaceStrategy: { type: "worktree", baseRef: "HEAD" },
    });
    yield* h.command({ type: "manage-task", taskId: "managed-worker", leadId: lead.id });
    yield* h.command({ type: "assign", taskId: "managed-worker" });
    yield* h.drain();
    const state = yield* h.store.read();
    const attempt = state.tasks.find((task) => task.id === "managed-worker")!.attempts[0]!;
    expect(h.launches[1]).toMatchObject({
      threadId: attempt.threadId,
      projectId: a,
      workspaceStrategy: { type: "worktree", baseRef: "HEAD" },
      createdBy: "agent",
      creationSource: "mcp",
    });
    expect(attempt.threadId).not.toBe(lead.threadId);
  }).pipe(Effect.provide(services)),
);
it.effect(
  "a missing failed lead does not occupy the coordinator slot, and can be retried after restart",
  () =>
    Effect.gen(function* () {
      const h = yield* harness;
      const broken = yield* h.lead("broken", a);
      const healthy = yield* h.lead("healthy", b);
      for (const effect of yield* h.store.effects()) {
        const action = decodeAction(effect.payload_json);
        if (action.type === "create-lead" && action.leadId === healthy.id)
          yield* h.store.finishEffect(effect.operation_id);
      }
      h.failLaunch.add(broken.threadId);
      h.projections.set(healthy.threadId, projection(healthy.threadId, b));
      yield* h.drain();
      expect(h.sent).toContain(healthy.threadId);
      expect(
        (yield* h.store.read()).messages.some((m) =>
          m.text.includes("Work delivery needs attention"),
        ),
      ).toBe(true);
      yield* h.store.rebuild();
      h.failLaunch.clear();
      h.projections.set(healthy.threadId, projection(healthy.threadId, b));
      yield* h.command({ type: "lead-status", leadId: broken.id, status: "active" });
      yield* h.drain();
      expect(h.projections.has(broken.threadId)).toBe(true);
      expect(h.launched.filter((id) => id === broken.threadId)).toHaveLength(2);
    }).pipe(Effect.provide(services)),
);
it.effect("queued lead dispatch stays durable while paused and starts once on resume", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    const first = yield* h.lead("first", a);
    h.projections.set(first.threadId, {
      ...projection(first.threadId, a),
      runs: [running(first.threadId)],
    });
    for (const effect of yield* h.store.effects()) yield* h.store.finishEffect(effect.operation_id);
    const second = yield* h.lead("second", b);
    yield* h.drain();
    expect(h.launched).toEqual([]);
    yield* h.command({ type: "pause", paused: true });
    h.projections.set(first.threadId, projection(first.threadId, a));
    yield* h.drain();
    expect(h.launched).toEqual([]);
    expect((yield* h.store.effects()).some((e) => e.kind === "create-lead")).toBe(true);
    yield* h.command({ type: "pause", paused: false });
    yield* h.drain();
    expect(h.launched).toEqual([second.threadId]);
    yield* h.drain();
    expect(h.launched).toEqual([second.threadId]);
  }).pipe(Effect.provide(services)),
);

it.effect.each([false, true])(
  "replays an unfinished original lead launch with existing thread (preparing=%s)",
  (hasPreparingRun) =>
    Effect.gen(function* () {
      const h = yield* harness;
      const lead = yield* h.lead("partial", a);
      h.projections.set(lead.threadId, {
        ...projection(lead.threadId, a),
        runs: hasPreparingRun ? [{ ...running(lead.threadId), status: "preparing" }] : [],
      });
      yield* h.drain();
      expect(h.launched).toEqual([lead.threadId]);
      expect(h.sent).not.toContain(lead.threadId);
      expect((yield* h.store.effects()).filter((e) => e.kind === "create-lead")).toEqual([]);
    }).pipe(Effect.provide(services)),
);

it.effect(
  "a user decision stops only its writer while the runtime launches unrelated work and survives replay",
  () =>
    Effect.gen(function* () {
      const h = yield* harness;
      for (const id of ["waiting", "independent"])
        yield* h.command({
          type: "create",
          taskId: id,
          projectId: a,
          title: id,
          outcome: id,
          criteria: "Evidence",
          verifyCommand: "",
          priority: 1,
          dependencies: [],
          workspaceStrategy: { type: "root" },
        });
      yield* h.command({ type: "assign", taskId: "waiting" });
      yield* h.drain();
      const first = (yield* h.store.read()).tasks[0]!.attempts[0]!;
      yield* h.command({
        type: "request-decision",
        taskId: "waiting",
        question: "Which direction?",
        options: ["A", "B"],
        recommendation: "A",
      });
      yield* h.command({ type: "assign", taskId: "independent" });
      yield* h.drain();
      const parked = yield* h.store.read();
      expect(h.interrupted).toEqual([first.threadId]);
      expect(parked.role?.paused).toBe(false);
      expect(parked.tasks[0]!.status).toBe("blocked");
      expect(parked.tasks[0]!.attempts[0]!.state).toBe("stopped");
      expect(parked.tasks[1]!.attempts[0]!.state).toBe("running");
      expect(h.launched).toHaveLength(2);
      expect(yield* h.store.rebuild()).toEqual(parked);
      yield* h.drain();
      expect(h.interrupted).toHaveLength(1);
      yield* h.command({
        type: "resolve-decision",
        taskId: "waiting",
        decisionId: parked.tasks[0]!.decisions![0]!.id,
        answer: "B",
      });
      const answered = yield* h.store.read();
      expect(answered.tasks[0]!.status).toBe("queued");
      expect(answered.tasks[1]!.attempts[0]!.state).toBe("running");
      expect(yield* h.store.rebuild()).toEqual(answered);
    }).pipe(Effect.provide(services)),
);

it.effect(
  "keeps explicitly requested lead permissions through failed launch, rebuild and reactivation",
  () =>
    Effect.gen(function* () {
      const h = yield* harness;
      const created = yield* h.command({
        type: "create-lead",
        leadId: "full-access-lead",
        projectId: a,
        charter: "Own this project",
        model,
        maxWorkers: 1,
        runtimeMode: "full-access",
      });
      const lead = created.leads!.find((entry) => entry.id === "full-access-lead")!;
      expect(lead.runtimeMode).toBe("full-access");
      h.failLaunch.add(lead.threadId);
      yield* h.drain();
      expect(h.launchModes).toEqual(["full-access"]);
      yield* h.store.rebuild();
      h.failLaunch.clear();
      yield* h.command({
        type: "lead-status",
        leadId: lead.id,
        status: "active",
        runtimeMode: "full-access",
      });
      yield* h.drain();
      expect(h.launchModes).toEqual(["full-access", "full-access"]);
    }).pipe(Effect.provide(services)),
);

it.effect("an explicit lead downgrade overrides a full-access worker default", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    const original = (yield* h.store.read()).role!.brief;
    yield* h.command({
      type: "brief",
      brief: { ...original, workerRuntimeMode: "full-access" },
    });
    yield* h.command({
      type: "create-lead",
      leadId: "approval-lead",
      projectId: a,
      charter: "Own this project",
      model,
      maxWorkers: 1,
      runtimeMode: "approval-required",
    });
    yield* h.drain();
    expect(h.launchModes).toEqual(["approval-required"]);
  }).pipe(Effect.provide(services)),
);

it.effect("an explicit mode is applied when an existing lead is reactivated", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    const lead = yield* h.lead("existing", a);
    yield* h.drain();
    yield* h.command({ type: "lead-status", leadId: lead.id, status: "dormant" });
    yield* h.drain();
    expect(h.interrupted).toEqual([lead.threadId]);
    yield* h.command({
      type: "lead-status",
      leadId: lead.id,
      status: "active",
      runtimeMode: "approval-required",
    });
    yield* h.drain();
    expect(h.permissionModes).toEqual(["approval-required"]);
    expect(h.launched).toEqual([lead.threadId]);
  }).pipe(Effect.provide(services)),
);

it.effect(
  "reactivation waits for the dormant lead writer to stop before changing permissions",
  () =>
    Effect.gen(function* () {
      const h = yield* harness;
      const lead = yield* h.lead("stopping", a);
      yield* h.drain();
      h.deferInterrupt();
      yield* h.command({ type: "lead-status", leadId: lead.id, status: "dormant" });
      yield* h.drain();
      expect(h.interrupted).toEqual([lead.threadId]);
      yield* h.command({
        type: "lead-status",
        leadId: lead.id,
        status: "active",
        runtimeMode: "full-access",
      });
      yield* h.drain();
      expect(h.permissionModes).toEqual([]);
      expect((yield* h.store.effects()).some((effect) => effect.kind === "lead-status")).toBe(true);
      h.projections.set(lead.threadId, projection(lead.threadId, a));
      yield* h.drain();
      expect(h.permissionModes).toEqual(["full-access"]);
      expect((yield* h.store.effects()).filter((effect) => effect.kind === "lead-status")).toEqual(
        [],
      );
    }).pipe(Effect.provide(services)),
);

it.effect(
  "starts workers with the permissions approved at assignment, even if the brief changes before delivery",
  () =>
    Effect.gen(function* () {
      const h = yield* harness;
      const original = (yield* h.store.read()).role!.brief;
      yield* h.command({ type: "brief", brief: { ...original, workerRuntimeMode: "full-access" } });
      yield* h.command({
        type: "create",
        taskId: "permissions",
        projectId: a,
        title: "Scoped work",
        outcome: "Result",
        criteria: "Evidence",
        verifyCommand: "",
        priority: 1,
        dependencies: [],
        workspaceStrategy: { type: "root" },
      });
      yield* h.command({ type: "assign", taskId: "permissions" });
      yield* h.command({
        type: "brief",
        brief: { ...original, workerRuntimeMode: "approval-required" },
      });
      yield* h.drain();
      expect(h.launchModes).toEqual(["full-access"]);
      expect((yield* h.store.read()).tasks[0]!.attempts[0]!.runtimeMode).toBe("full-access");
    }).pipe(Effect.provide(services)),
);

it.effect(
  "applies explicitly saved coordinator permissions durably and recovers delivery failure without lying about runtime",
  () =>
    Effect.gen(function* () {
      const h = yield* harness;
      const brief = {
        ...(yield* h.store.read()).role!.brief,
        coordinatorRuntimeMode: "full-access" as const,
      };
      h.failPermissions();
      yield* h.command({ type: "brief", brief, applyCoordinatorPermissions: true });
      yield* h.drain();
      expect(h.projections.get(boss)!.thread.runtimeMode).toBe("approval-required");
      expect(
        (yield* h.store.read()).messages.some((message) =>
          message.text.includes("Work delivery needs attention"),
        ),
      ).toBe(true);
      yield* h.command({ type: "brief", brief, applyCoordinatorPermissions: true });
      yield* h.drain();
      expect(h.projections.get(boss)!.thread.runtimeMode).toBe("full-access");
      expect(h.permissionModes).toEqual(["full-access"]);
    }).pipe(Effect.provide(services)),
);
it.effect(
  "priority-only saves retain a manual permission downgrade; explicit same-value full auto reapplies it",
  () =>
    Effect.gen(function* () {
      const h = yield* harness;
      const savedBrief = {
        ...(yield* h.store.read()).role!.brief,
        coordinatorRuntimeMode: "full-access" as const,
        workerRuntimeMode: "full-access" as const,
      };
      yield* h.command({ type: "brief", brief: savedBrief, applyCoordinatorPermissions: true });
      yield* h.drain();
      expect(h.permissionModes).toEqual(["full-access"]);
      expect(h.sent).toEqual([boss]);
      // The completed turn and composer downgrade arrive independently of the saved brief.
      const previous = h.projections.get(boss)!;
      h.projections.set(boss, {
        ...previous,
        thread: { ...previous.thread, runtimeMode: "approval-required" },
        runs: [],
      });
      const editedBrief = { ...savedBrief, priorities: "Updated priorities" };
      yield* h.command({ type: "brief", brief: editedBrief, applyCoordinatorPermissions: false });
      yield* h.drain();
      expect((yield* h.store.read()).role!.brief).toEqual(editedBrief);
      expect(h.projections.get(boss)!.thread.runtimeMode).toBe("approval-required");
      expect(h.permissionModes).toEqual(["full-access"]);
      expect(h.sent).toEqual([boss]);
      yield* h.command({ type: "brief", brief: editedBrief, applyCoordinatorPermissions: true });
      yield* h.drain();
      expect(h.projections.get(boss)!.thread.runtimeMode).toBe("full-access");
      expect(h.permissionModes).toEqual(["full-access", "full-access"]);
      expect(h.sent).toEqual([boss, boss]);
    }).pipe(Effect.provide(services)),
);

it.effect(
  "deliberately enabling scoped full auto starts one coordinator turn, after permissions are applied",
  () =>
    Effect.gen(function* () {
      const h = yield* harness;
      const brief = {
        ...(yield* h.store.read()).role!.brief,
        coordinatorRuntimeMode: "full-access" as const,
        workerRuntimeMode: "full-access" as const,
      };
      yield* h.command({ type: "brief", brief, applyCoordinatorPermissions: true });
      yield* h.drain();
      expect(h.projections.get(boss)!.thread.runtimeMode).toBe("full-access");
      expect(h.sent).toEqual([boss]);
      yield* h.drain();
      expect(h.sent).toEqual([boss]);
    }).pipe(Effect.provide(services)),
);
it.effect(
  "empty scope and paused work do not start a coordinator just because permissions were saved",
  () =>
    Effect.gen(function* () {
      const h = yield* harness;
      const brief = {
        ...(yield* h.store.read()).role!.brief,
        coordinatorRuntimeMode: "full-access" as const,
        workerRuntimeMode: "full-access" as const,
      };
      yield* h.command({
        type: "brief",
        brief: { ...brief, projectIds: [] },
        applyCoordinatorPermissions: true,
      });
      yield* h.drain();
      expect(h.sent).toEqual([]);
      yield* h.command({ type: "pause", paused: true });
      yield* h.command({ type: "brief", brief, applyCoordinatorPermissions: true });
      yield* h.drain();
      expect(h.sent).toEqual([]);
    }).pipe(Effect.provide(services)),
);

it.effect("drains a writer and launches one retained revision from one managed command", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    yield* h.command({
      type: "create",
      taskId: "managed-revision",
      projectId: a,
      title: "Revise retained candidate",
      outcome: "Keep useful work and address review",
      criteria: "Focused proof passes",
      verifyCommand: "vp test run focused.test.ts",
      priority: 1,
      dependencies: [],
      workspaceStrategy: { type: "worktree", baseRef: "HEAD" },
    });
    yield* h.command({ type: "assign", taskId: "managed-revision" });
    yield* h.drain();
    const first = (yield* h.store.read()).tasks[0]!.attempts[0]!;
    const firstProjection = h.projections.get(first.threadId)!;
    h.projections.set(first.threadId, {
      ...firstProjection,
      thread: { ...firstProjection.thread, worktreePath: "/tmp/managed-revision" },
    });
    yield* h.drain();
    yield* h.command({
      type: "submit",
      taskId: "managed-revision",
      attemptId: first.id,
      candidate: `commit:${"a".repeat(40)}`,
      criteriaVersion: 1,
      verdict: "fail",
      summary: "Useful candidate needs one focused repair",
      command: "vp test run focused.test.ts",
      artifactUrls: [],
    });
    yield* h.command({
      type: "revise-result",
      taskId: "managed-revision",
      note: "Repair the focused failure",
    });
    yield* h.drain();
    let task = (yield* h.store.read()).tasks[0]!;
    expect(h.interrupted).toContain(first.threadId);
    expect(task.evidence).toHaveLength(1);
    expect(task.evidence[0]!.candidate).toBe(`commit:${"a".repeat(40)}`);
    expect(task.workspaceStrategy).toEqual({
      type: "existing_worktree",
      worktreePath: "/tmp/managed-revision",
    });
    expect(task.attempts.map((attempt) => attempt.state)).toEqual(["stopped", "pending"]);
    expect(task.revisionRequest).toBeUndefined();
    yield* h.drain();
    task = (yield* h.store.read()).tasks[0]!;
    expect(task.attempts.map((attempt) => attempt.state)).toEqual(["stopped", "running"]);
    expect(h.launched).toHaveLength(2);
  }).pipe(Effect.provide(services)),
);
it.effect(
  "parks a managed revision with one actionable failure when its workspace is occupied",
  () =>
    Effect.gen(function* () {
      const h = yield* harness;
      yield* h.command({
        type: "create",
        taskId: "blocked-revision",
        projectId: a,
        title: "Blocked revision",
        outcome: "Retain the candidate",
        criteria: "Surface the workspace conflict",
        verifyCommand: "",
        priority: 1,
        dependencies: [],
        workspaceStrategy: { type: "existing_worktree", worktreePath: "/tmp/shared-revision" },
      });
      yield* h.command({ type: "assign", taskId: "blocked-revision" });
      yield* h.drain();
      const retained = (yield* h.store.read()).tasks.find(
        (task) => task.id === "blocked-revision",
      )!;
      h.projections.set(retained.attempts[0]!.threadId, {
        ...h.projections.get(retained.attempts[0]!.threadId)!,
        runs: [
          {
            ...running(retained.attempts[0]!.threadId),
            status: "completed",
            completedAt: time,
          },
        ],
      });
      yield* h.drain();
      yield* h.command({
        type: "create",
        taskId: "workspace-owner",
        projectId: a,
        title: "Workspace owner",
        outcome: "Own the shared workspace",
        criteria: "Remain the sole writer",
        verifyCommand: "",
        priority: 2,
        dependencies: [],
        workspaceStrategy: { type: "existing_worktree", worktreePath: "/tmp/shared-revision" },
      });
      yield* h.command({ type: "assign", taskId: "workspace-owner" });
      yield* h.command({
        type: "revise-result",
        taskId: "blocked-revision",
        note: "Repair the retained candidate",
      });
      yield* h.drain();
      let state = yield* h.store.read();
      const blocked = state.tasks.find((task) => task.id === "blocked-revision")!;
      expect(blocked.status).toBe("blocked");
      expect(blocked.revisionRequest).toBeUndefined();
      expect(blocked.note).toContain("Another task owns that workspace");
      expect(
        state.messages.filter((message) => message.id.endsWith(":blocked-message")),
      ).toHaveLength(1);
      h.projections.set(boss, projection(boss, a));
      yield* h.store.rebuild();
      yield* h.drain();
      state = yield* h.store.read();
      expect(
        state.messages.filter((message) => message.id.endsWith(":blocked-message")),
      ).toHaveLength(1);
    }).pipe(Effect.provide(services)),
);

it.effect("reports a worker parked on a permission prompt and clears it when it is answered", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    yield* h.command({
      type: "create",
      taskId: "awaiting-approval",
      projectId: a,
      title: "Awaiting approval",
      outcome: "Ask before touching the host",
      criteria: "Only approved commands run",
      verifyCommand: "",
      priority: 1,
      dependencies: [],
      workspaceStrategy: { type: "worktree", baseRef: "HEAD" },
    });
    yield* h.command({ type: "assign", taskId: "awaiting-approval" });
    yield* h.drain();
    const attempt = (yield* h.store.read()).tasks[0]!.attempts[0]!;
    const worker = h.projections.get(attempt.threadId)!;
    h.projections.set(attempt.threadId, {
      ...worker,
      runs: [running(attempt.threadId)],
      runtimeRequests: [approvalRequest(attempt.threadId)],
    });
    const sent = h.sent.length;
    const dispatched = h.dispatched.length;
    yield* h.drain();

    const parked = yield* h.store.read();
    expect(parked.awaitingApproval).toEqual([attempt.id]);
    // The worker is blocked on the user, not finished: nothing may fake a stop or wake the owner.
    expect(parked.tasks[0]!.attempts[0]!.state).toBe("running");
    expect(parked.tasks[0]!.status).toBe("active");
    expect(h.sent).toHaveLength(sent);
    expect(h.dispatched).toHaveLength(dispatched);

    // An unchanged observation must neither bump the revision nor publish another change.
    yield* h.drain();
    yield* h.drain();
    const repeated = yield* h.store.read();
    expect(repeated.revision).toBe(parked.revision);
    expect(repeated.awaitingApproval).toEqual([attempt.id]);

    // Answering the prompt in the worker thread is the whole reverse state.
    h.projections.set(attempt.threadId, {
      ...worker,
      runs: [running(attempt.threadId)],
      runtimeRequests: [approvalRequest(attempt.threadId, "resolved")],
    });
    yield* h.drain();
    expect((yield* h.store.read()).awaitingApproval).toEqual([]);

    // A worker asking its own question, or one whose credential expired, is blocked the same way
    // but owes the user no approval; advertising it as one would be a third wrong signal.
    for (const kind of ["user_input", "auth_refresh"] as const) {
      h.projections.set(attempt.threadId, {
        ...worker,
        runs: [running(attempt.threadId)],
        runtimeRequests: [approvalRequest(attempt.threadId, "pending", kind)],
      });
      yield* h.drain();
      expect((yield* h.store.read()).awaitingApproval).toEqual([]);
    }
  }).pipe(Effect.provide(services)),
);
it.effect("tells the owner and the user what an unsubmitted worker left in its workspace", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    yield* h.command({
      type: "create",
      taskId: "retained-workspace",
      projectId: a,
      title: "Retained workspace",
      outcome: "Land the change",
      criteria: "Evidence is submitted",
      verifyCommand: "",
      priority: 1,
      dependencies: [],
      workspaceStrategy: { type: "worktree", baseRef: "HEAD" },
    });
    yield* h.command({ type: "assign", taskId: "retained-workspace" });
    yield* h.drain();
    const attempt = (yield* h.store.read()).tasks[0]!.attempts[0]!;
    const worker = h.projections.get(attempt.threadId)!;
    h.projections.set(attempt.threadId, {
      ...worker,
      runs: [{ ...running(attempt.threadId), status: "completed", completedAt: time }],
      checkpoints: [
        captured(attempt.threadId, 1, ["src/one.ts", "src/two.ts", "src/three.ts"]),
        captured(attempt.threadId, 2, ["src/four.ts"]),
      ],
    });
    yield* h.drain();

    const observed = yield* h.store.read();
    expect(observed.tasks[0]!.attempts[0]!.detail).toContain("4 file changes across 2 turns");
    expect(observed.tasks[0]!.note).toContain("4 file changes across 2 turns");
    expect(h.sentMessages.at(-1)?.text).toContain("4 file changes across 2 turns");

    // The user's question must not claim the worker left nothing when its workspace says otherwise.
    for (let turn = 0; turn < 3; turn++) {
      h.projections.set(boss, projection(boss, a));
      yield* h.drain();
    }
    const decision = (yield* h.store.read()).tasks[0]!.decisions?.at(-1);
    expect(decision?.question).toContain("left no submitted evidence");
    expect(decision?.question).toContain("4 file changes across 2 turns");
    expect(decision?.question).not.toContain("left no evidence.");
  }).pipe(Effect.provide(services)),
);
it.effect("reports an empty workspace only when every started turn was captured", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    for (const taskId of ["stopped-captured", "uncaptured-turn"]) {
      yield* h.command({
        type: "create",
        taskId,
        projectId: a,
        title: taskId,
        outcome: "Land the change",
        criteria: "Evidence is submitted",
        verifyCommand: "",
        priority: 1,
        dependencies: [],
        workspaceStrategy: { type: "worktree", baseRef: "HEAD" },
      });
      yield* h.command({ type: "assign", taskId });
    }
    yield* h.drain();
    const tasks = (yield* h.store.read()).tasks;
    const captured1 = tasks.find((task) => task.id === "stopped-captured")!.attempts[0]!;
    const gap = tasks.find((task) => task.id === "uncaptured-turn")!.attempts[0]!;
    // A turn the user stopped still captured its workspace, so its emptiness is real evidence.
    h.projections.set(captured1.threadId, {
      ...h.projections.get(captured1.threadId)!,
      runs: [{ ...running(captured1.threadId), status: "interrupted", completedAt: time }],
      checkpoints: [captured(captured1.threadId, 1, [])],
    });
    // The first turn never captured, so the second turn's empty diff proves nothing about it.
    h.projections.set(gap.threadId, {
      ...h.projections.get(gap.threadId)!,
      runs: [
        { ...running(gap.threadId), status: "interrupted", completedAt: time },
        {
          ...running(gap.threadId),
          id: RunId.make(`run-${gap.threadId}-2`),
          ordinal: 2,
          status: "completed",
          completedAt: time,
        },
      ],
      checkpoints: [captured(gap.threadId, 2, [])],
    });
    yield* h.drain();

    const observed = yield* h.store.read();
    const detailOf = (taskId: string) =>
      observed.tasks.find((task) => task.id === taskId)!.attempts[0]!.detail;
    expect(detailOf("stopped-captured")).toContain("left no file changes");
    expect(detailOf("uncaptured-turn")).toContain("No checkpoint recorded its workspace");
    expect(detailOf("uncaptured-turn")).not.toContain("left no file changes");
  }).pipe(Effect.provide(services)),
);
/** A fixture whose task has spent its whole saved attempt allowance of two. */
const cappedHarness = Effect.gen(function* () {
  const h = yield* harness;
  yield* h.command({
    type: "create",
    taskId: "out-of-attempts",
    projectId: a,
    title: "Capped outcome",
    outcome: "Land the change",
    criteria: "Evidence is submitted",
    verifyCommand: "",
    priority: 1,
    dependencies: [],
    workspaceStrategy: { type: "worktree", baseRef: "HEAD" },
  });
  yield* h.command({ type: "assign", taskId: "out-of-attempts" });
  yield* h.drain();
  const stop = (attemptIndex: number) =>
    Effect.gen(function* () {
      const attempt = (yield* h.store.read()).tasks[0]!.attempts[attemptIndex]!;
      h.projections.set(attempt.threadId, {
        ...h.projections.get(attempt.threadId)!,
        runs: [{ ...running(attempt.threadId), status: "completed", completedAt: time }],
      });
      h.projections.set(boss, projection(boss, a));
      yield* h.drain();
    });
  yield* stop(0);
  yield* h.command({
    type: "revise-result",
    taskId: "out-of-attempts",
    note: "Continue in the retained workspace",
  });
  h.projections.set(boss, projection(boss, a));
  yield* h.drain();
  yield* h.drain();
  yield* stop(1);
  return h;
});
it.effect(
  "tells an out-of-attempts owner to close the outcome instead of offering a revision",
  () =>
    Effect.gen(function* () {
      const h = yield* cappedHarness;
      const state = yield* h.store.read();
      expect(state.tasks[0]!.attempts).toHaveLength(2);
      const text = h.sentMessages.at(-1)!.text;
      expect(text).toContain("Out of attempts — close it out");
      expect(text).toContain("close it with an honest reason, or cancel it as superseded");
      expect(text).not.toContain("revise-result with the information the worker was missing");
      expect(text).toContain("Recovery needed · task out-of-attempts");

      // The wake and the decider must agree about what is still legal.
      const refused = yield* Effect.result(
        h.command({ type: "revise-result", taskId: "out-of-attempts", note: "try again" }),
      );
      expect(refused._tag).toBe("Failure");
      if (refused._tag === "Failure")
        expect(refused.failure.message).toContain("Attempt allowance exhausted");
    }).pipe(Effect.provide(services)),
);
it.effect("offers the revision again once the user raises the saved attempt limit", () =>
  Effect.gen(function* () {
    const h = yield* cappedHarness;
    expect(h.sentMessages.at(-1)?.text).toContain("Out of attempts — close it out");
    yield* h.command({
      type: "brief",
      brief: {
        priorities: "Fixture",
        quality: "Run checks",
        projectIds: [a, b],
        maxWorkers: 2,
        maxAttempts: 3,
        workerModel: model,
      },
    });
    h.projections.set(boss, projection(boss, a));
    yield* h.drain();
    const text = h.sentMessages.at(-1)!.text;
    expect(text).not.toContain("Out of attempts — close it out");
    expect(text).toContain("revise-result with the information the worker was missing");
    const revised = yield* Effect.result(
      h.command({ type: "revise-result", taskId: "out-of-attempts", note: "Continue" }),
    );
    expect(revised._tag).toBe("Success");
  }).pipe(Effect.provide(services)),
);
it.effect("escalates an out-of-attempts stall without offering an impossible continuation", () =>
  Effect.gen(function* () {
    const h = yield* cappedHarness;
    for (let turn = 0; turn < 3; turn++) {
      h.projections.set(boss, projection(boss, a));
      yield* h.drain();
    }
    const decision = (yield* h.store.read()).tasks[0]!.decisions?.at(-1);
    expect(decision?.options).toContain(
      "Keep going — raise the saved attempt limit so another attempt can start",
    );
    expect(decision?.options).not.toContain("Keep going — give the worker what it was missing");
    expect(decision?.recommendation).toContain("maxAttempts");
  }).pipe(Effect.provide(services)),
);
/** The unsettled-recovery fixture every deliberation-budget test drives owner turns against. */
const unsettledHarness = Effect.gen(function* () {
  const h = yield* harness;
  yield* h.command({
    type: "create",
    taskId: "deliberated-outcome",
    projectId: a,
    title: "Deliberated outcome",
    outcome: "Return verified evidence",
    criteria: "Evidence is reviewed",
    verifyCommand: "",
    priority: 1,
    dependencies: [],
    workspaceStrategy: { type: "worktree", baseRef: "HEAD" },
  });
  yield* h.command({ type: "assign", taskId: "deliberated-outcome" });
  yield* h.drain();
  const attempt = (yield* h.store.read()).tasks[0]!.attempts[0]!;
  return { h, attempt };
});
const ownerNote = (h: { readonly store: typeof WorkStore.Service }, text: string) =>
  Effect.gen(function* () {
    const state = yield* h.store.read();
    yield* h.store.command(
      {
        commandId: CommandId.make(`owner-note-${state.revision}`),
        expectedRevision: state.revision,
        authorityGeneration: state.role!.generation,
        action: { type: "report", taskId: "deliberated-outcome", kind: "progress", text },
      },
      { type: "agent", threadId: boss },
    );
  });
it.effect("a note the owner records about the task buys back its reminder budget", () =>
  Effect.gen(function* () {
    const { h, attempt } = yield* unsettledHarness;
    h.projections.set(attempt.threadId, {
      ...h.projections.get(attempt.threadId)!,
      runs: [{ ...running(attempt.threadId), status: "completed", completedAt: time }],
    });
    for (let turn = 0; turn < 3; turn++) {
      h.projections.set(boss, projection(boss, a));
      yield* h.drain();
    }
    expect(h.sent).toHaveLength(3);
    yield* ownerNote(h, "Read the retained workspace; deciding between close and revise-result.");

    // Without the note this turn would have escalated instead of delivering.
    h.projections.set(boss, projection(boss, a));
    yield* h.drain();
    expect(h.sent).toHaveLength(4);
    expect(h.sentMessages.at(-1)?.text).toContain("delivery 3 of 3");
    expect((yield* h.store.read()).tasks[0]!.decisions ?? []).toHaveLength(0);

    // The credit buys one turn, not immunity.
    h.projections.set(boss, projection(boss, a));
    yield* h.drain();
    expect(h.sent).toHaveLength(4);
    expect((yield* h.store.read()).tasks[0]!.decisions).toHaveLength(1);
  }).pipe(Effect.provide(services)),
);
it.effect("does not let notes written before an obligation pay for its reminders", () =>
  Effect.gen(function* () {
    const { h, attempt } = yield* unsettledHarness;
    // Three notes while the worker is still running. They are about the work in flight, not about
    // the recovery obligation its stop is about to create.
    for (let note = 0; note < 3; note++) {
      yield* ownerNote(h, `Watching the worker, pass ${note}.`);
      h.projections.set(boss, projection(boss, a));
      yield* h.drain();
    }
    const before = h.sent.length;
    h.projections.set(attempt.threadId, {
      ...h.projections.get(attempt.threadId)!,
      runs: [{ ...running(attempt.threadId), status: "completed", completedAt: time }],
    });
    for (let turn = 0; turn < 4; turn++) {
      h.projections.set(boss, projection(boss, a));
      yield* h.drain();
    }

    const task = (yield* h.store.read()).tasks[0]!;
    expect(h.sent).toHaveLength(before + 3);
    expect(task.decisions).toHaveLength(1);
    // The question must state the deliveries that happened, not the constant.
    expect(task.decisions?.at(-1)?.question).toContain("was asked 3 times to settle this outcome");
  }).pipe(Effect.provide(services)),
);
it.effect("an owner that only records notes still reaches the user", () =>
  Effect.gen(function* () {
    const { h, attempt } = yield* unsettledHarness;
    h.projections.set(attempt.threadId, {
      ...h.projections.get(attempt.threadId)!,
      runs: [{ ...running(attempt.threadId), status: "completed", completedAt: time }],
    });
    for (let turn = 0; turn < 8; turn++) {
      yield* ownerNote(h, `Still weighing this one, pass ${turn}.`);
      h.projections.set(boss, projection(boss, a));
      yield* h.drain();
    }
    const task = (yield* h.store.read()).tasks[0]!;
    expect(task.decisions).toHaveLength(1);
    expect(task.decisions?.at(-1)?.question).toContain("settle this outcome");
    expect(task.status).toBe("blocked");
    // Twice the reminder budget is the hard ceiling, so escalation always terminates.
    expect(h.sent).toHaveLength(2 * 3);
  }).pipe(Effect.provide(services)),
);
it.effect("quotes a worker's report to the user without crediting the owner for it", () =>
  Effect.gen(function* () {
    const { h, attempt } = yield* unsettledHarness;
    const state = yield* h.store.read();
    yield* h.store.command(
      {
        commandId: CommandId.make("worker-words"),
        expectedRevision: state.revision,
        action: {
          type: "report",
          taskId: "deliberated-outcome",
          kind: "progress",
          text: "I could not reach staging; the deploy token is missing.",
        },
      },
      { type: "agent", threadId: attempt.threadId },
    );
    h.projections.set(attempt.threadId, {
      ...h.projections.get(attempt.threadId)!,
      runs: [{ ...running(attempt.threadId), status: "completed", completedAt: time }],
    });
    // A worker's words are not the owner's deliberation, so the ladder is unchanged.
    for (let turn = 0; turn < 3; turn++) {
      h.projections.set(boss, projection(boss, a));
      yield* h.drain();
    }
    expect(h.sent).toHaveLength(3);
    expect((yield* h.store.read()).tasks[0]!.decisions ?? []).toHaveLength(0);
    h.projections.set(boss, projection(boss, a));
    yield* h.drain();
    const decision = (yield* h.store.read()).tasks[0]!.decisions?.at(-1);
    expect(decision?.question).toContain("deploy token is missing");
    expect(decision?.question).not.toContain("It reported nothing");
  }).pipe(Effect.provide(services)),
);

it.effect(
  "discards a stale queued source wake after reassignment and restores eligibility once",
  () =>
    Effect.gen(function* () {
      const h = yield* harness;
      const config = {
        id: "linear",
        kind: "linear" as const,
        baseUrl: "https://linear.test",
        tenantId: "tenant",
        remoteProjectId: "team",
        projectId: a,
        enabled: true,
      };
      const observation = {
        title: "Same",
        outcome: "Same",
        source: {
          kind: "linear" as const,
          tenantId: "tenant",
          itemId: "issue",
          key: "DEV-1",
          url: "",
          status: "Open",
          priority: "1",
          observedAt: DateTime.formatIso(time),
          ownership: { viewerId: "glados", assigneeId: null, delegateId: null },
        },
      };
      yield* h.store.importSources(config, [observation]);
      h.failNextSend();
      yield* h.drain();
      expect((yield* h.store.effects()).filter((effect) => effect.kind === "wake")).toHaveLength(1);
      yield* h.store.importSources(config, [
        {
          ...observation,
          source: {
            ...observation.source,
            ownership: { ...observation.source.ownership, delegateId: "simulator" },
          },
        },
      ]);
      yield* h.drain();
      expect(h.sent).toEqual([]);
      expect((yield* h.store.effects()).filter((effect) => effect.kind === "wake")).toHaveLength(0);
      yield* h.store.importSources(config, [observation]);
      yield* h.drain();
      expect(h.sent).toEqual([boss]);
      yield* h.store.importSources(config, [observation]);
      yield* h.drain();
      expect(h.sent).toEqual([boss]);
    }).pipe(Effect.provide(services)),
);

it.effect("preserves tracked worker recovery after foreign reassignment", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    const config = {
      id: "linear",
      kind: "linear" as const,
      baseUrl: "https://linear.test",
      tenantId: "tenant",
      remoteProjectId: "team",
      projectId: a,
      enabled: true,
    };
    const observation = {
      title: "Same",
      outcome: "Same",
      source: {
        kind: "linear" as const,
        tenantId: "tenant",
        itemId: "issue",
        key: "DEV-1",
        url: "",
        status: "Open",
        priority: "1",
        observedAt: DateTime.formatIso(time),
        ownership: { viewerId: "glados", assigneeId: null, delegateId: null },
      },
    };
    yield* h.store.importSources(config, [observation]);

    const taskId = (yield* h.store.read()).tasks[0]!.id;
    yield* h.command({
      type: "edit",
      taskId,
      projectId: a,
      title: "Same",
      outcome: "Same",
      criteria: "Worker recovery is preserved",
      verifyCommand: "vp test",
      priority: 1,
      dependencies: [],
      workspaceStrategy: { type: "root" },
    });
    yield* h.command({ type: "reopen", taskId });
    yield* h.command({ type: "assign", taskId });
    yield* h.drain();
    const worker = (yield* h.store.read()).tasks[0]!.attempts[0]!.threadId;
    yield* h.store.importSources(config, [
      {
        ...observation,
        source: {
          ...observation.source,
          ownership: { ...observation.source.ownership, delegateId: "simulator" },
        },
      },
    ]);
    yield* h.drain();
    expect(h.interrupted).not.toContain(worker);
    expect((yield* h.store.read()).tasks[0]!.attempts[0]!.state).toBe("running");
    const p = h.projections.get(worker)!;
    h.projections.set(worker, {
      ...p,
      runs: [{ ...running(worker), status: "completed", completedAt: time }],
      checkpoints: [captured(worker, 1, ["src/fix.ts"])],
    });
    yield* h.drain();
    expect((yield* h.store.read()).tasks[0]!.attempts[0]!.state).toBe("stopped");
    expect(h.sent).toContain(boss);
  }).pipe(Effect.provide(services)),
);
