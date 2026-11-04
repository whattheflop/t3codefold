import { recordVerification } from "./Verification.ts";
import type { PitbossVerification } from "@t3tools/contracts";
import { leadView } from "./Leads.ts";
import { replayJournal } from "./WorkJournal.ts";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Stable row ids are derived with synchronous SHA-256 inside SQL transactions.
import * as NodeCrypto from "node:crypto";
import type { PitbossSourceAuthority, PitbossSourceConfig } from "@t3tools/contracts";
import type { SourceObservation } from "./TaskSources.ts";
import {
  PitbossTask,
  type EnvironmentId,
  type PitbossPeerMessage,
  PitbossMessage,
  PitbossCommand,
  PitbossError,
  PitbossSnapshot,
  isRuntimeModeBroaderThan,
  type PitbossAttempt,
  type RuntimeMode,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import {
  sourceEligible,
  decide,
  finishBoardClear,
  remoteTaskAuthority,
  managerView,
  importedCriteria,
  observeAttempt,
  workContext,
  type WorkActor,
} from "./Work.ts";

export interface WorkEffect {
  readonly operation_id: string;
  readonly kind: string;
  readonly payload_json: string;
  readonly attempts: number;
  readonly error: string | null;
}
export interface WorkCommandAuthority {
  readonly runtimeMode: RuntimeMode;
}
const isPitbossError = Schema.is(PitbossError);
const decodeCommand = Schema.decodeUnknownEffect(PitbossCommand);
const decodeSnapshot = Schema.decodeUnknownEffect(Schema.fromJsonString(PitbossSnapshot));
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const encodeSnapshot = Schema.encodeEffect(Schema.fromJsonString(PitbossSnapshot));
const unavailable = (cause: unknown) =>
  isPitbossError(cause)
    ? cause
    : new PitbossError({
        code: "unavailable",
        message: cause instanceof Error ? cause.message : "Work storage unavailable.",
      });

export class WorkStore extends Context.Service<
  WorkStore,
  {
    resolveRemoteReceipt: (
      operationId: string,
      applied: boolean,
      detail: string,
    ) => Effect.Effect<void, PitbossError>;
    mirrorTask: (sender: EnvironmentId, task: PitbossTask) => Effect.Effect<void, PitbossError>;
    receiveMessage: (message: typeof PitbossMessage.Type) => Effect.Effect<void, PitbossError>;
    recordVerification: (
      taskId: string,
      run: PitbossVerification,
    ) => Effect.Effect<void, PitbossError>;
    rebuild: () => Effect.Effect<PitbossSnapshot, PitbossError>;
    read: (actor?: WorkActor) => Effect.Effect<PitbossSnapshot, PitbossError>;
    command: (
      input: PitbossCommand,
      actor: WorkActor,
      authority?: WorkCommandAuthority,
    ) => Effect.Effect<PitbossSnapshot, PitbossError>;
    finishBoardClear: (operationId: string) => Effect.Effect<void, PitbossError>;
    subscribe: () => Stream.Stream<PitbossSnapshot, PitbossError>;
    /** Subscribes now and returns the change signals; subscribe before an initial read so no change is lost. */
    subscribeChanges: Effect.Effect<Stream.Stream<void>, never, Scope.Scope>;
    effects: () => Effect.Effect<ReadonlyArray<WorkEffect>, PitbossError>;
    /** How many wakes already carried each key, so a repeated obligation can be re-delivered. */
    wakeDeliveries: (
      recipientId: string,
      generation: number,
    ) => Effect.Effect<Map<string, number>, PitbossError>;
    queueWake: (id: string, payloadJson: string) => Effect.Effect<boolean, PitbossError>;
    retryEffect: (id: string, error: string) => Effect.Effect<void, PitbossError>;
    finishWake: (id: string, payloadJson: string) => Effect.Effect<void, PitbossError>;
    finishEffect: (id: string, error?: string) => Effect.Effect<void, PitbossError>;
    updateAttempt: (
      taskId: string,
      attemptId: string,
      state: PitbossAttempt["state"],
      detail: string,
      workspacePath?: string,
    ) => Effect.Effect<void, PitbossError>;
    /** Live workers parked on a user permission prompt. Observed, not journaled: no revision bump. */
    observeAwaitingApproval: (
      attemptIds: ReadonlyArray<string>,
    ) => Effect.Effect<void, PitbossError>;
    setSourceAuthority: (authority: PitbossSourceAuthority) => Effect.Effect<void, PitbossError>;
    importSources: (
      config: PitbossSourceConfig,
      observations: ReadonlyArray<SourceObservation>,
    ) => Effect.Effect<void, PitbossError>;
    context: (threadId: ThreadId, packetId: string) => Effect.Effect<string | null, PitbossError>;
  }
>()("t3/pitboss/WorkStore") {}

export const layer = Layer.effect(
  WorkStore,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const notifications = yield* PubSub.sliding<void>(1);
    const persist = Effect.fn("WorkStore.persist")(function* (state: PitbossSnapshot) {
      const json = yield* encodeSnapshot(state);
      yield* sql`INSERT INTO pitboss_state (id, payload_json) VALUES (1, ${json}) ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json`;
    });
    const rebuild = Effect.fn("WorkStore.rebuild")(
      function* () {
        const rows = yield* sql<{
          payload_json: string;
        }>`SELECT payload_json FROM pitboss_events ORDER BY sequence`;
        const state = yield* Effect.try({
          try: () => replayJournal(rows.map((row) => row.payload_json)),
          catch: unavailable,
        });
        yield* persist(state);
        return state;
      },
      sql.withTransaction,
      Effect.mapError(unavailable),
    );
    const readAll = Effect.fn("WorkStore.read")(
      function* () {
        const rows = yield* sql<{
          payload_json: string;
        }>`SELECT payload_json FROM pitboss_state WHERE id = 1`;
        // Missing projections are recoverable; replay never re-enqueues provider effects.
        return rows[0] ? yield* decodeSnapshot(rows[0].payload_json) : yield* rebuild();
      },
      sql.withTransaction,
      Effect.mapError(unavailable),
    );
    const read = Effect.fn("WorkStore.readScoped")(function* (actor?: WorkActor) {
      const state = yield* readAll();
      if (!actor || actor.type === "user") return state;
      if (actor.type === "agent" && state.role?.threadId === actor.threadId)
        return managerView(state);
      if (actor.type === "agent") {
        const view = leadView(state, actor.threadId);
        if (view) return view;
      }
      if (actor.type === "peer")
        return {
          ...state,
          role: null,
          leads: [],
          verificationRecipes: [],
          tasks: state.tasks.filter((task) => task.source?.scope === actor.scope),
          messages: [],
          sourceAuthorities: state.sourceAuthorities?.filter(
            (authority) => authority.scope === actor.scope,
          ),
        };
      const tasks = state.tasks.filter((task) => task.attempts.at(-1)?.threadId === actor.threadId);
      if (!tasks.length)
        return yield* new PitbossError({
          code: "forbidden",
          message: "This thread has no pitboss assignment.",
        });
      return {
        ...state,
        role: null,
        leads: [],
        sourceAuthorities: [],
        verificationRecipes: (state.verificationRecipes ?? []).filter((recipe) =>
          tasks.some((task) => task.projectId === recipe.projectId),
        ),
        tasks,
        messages: state.messages.filter((message) =>
          tasks.some((task) => task.id === message.taskId),
        ),
      };
    });
    const command = Effect.fn("WorkStore.command")(function* (
      raw: PitbossCommand,
      actor: WorkActor,
      authority?: WorkCommandAuthority,
    ) {
      const input = yield* decodeCommand(raw);
      const requestJson = encodeJson({ input, actor });
      const now = DateTime.formatIso(yield* DateTime.now);
      const result = yield* sql.withTransaction(
        Effect.gen(function* () {
          const previous = yield* sql<{
            request_json: string;
          }>`SELECT request_json FROM pitboss_events WHERE operation_id = ${input.commandId}`;
          if (previous[0]) {
            if (previous[0].request_json !== requestJson)
              return yield* new PitbossError({
                code: "conflict",
                message: "This command ID was already used with another payload or actor.",
              });
            return yield* readAll();
          }
          const before = yield* readAll();
          if (actor.type === "agent") {
            const action = input.action;
            const requestedMode =
              action.type === "create-lead" ||
              action.type === "assign" ||
              action.type === "revise-result"
                ? (action.runtimeMode ??
                  before.role?.brief.workerRuntimeMode ??
                  "approval-required")
                : action.type === "lead-status" && action.status === "active"
                  ? (action.runtimeMode ??
                    before.leads?.find((lead) => lead.id === action.leadId)?.runtimeMode ??
                    before.role?.brief.workerRuntimeMode ??
                    "approval-required")
                  : undefined;
            if (
              requestedMode !== undefined &&
              (!authority || isRuntimeModeBroaderThan(requestedMode, authority.runtimeMode))
            )
              return yield* new PitbossError({
                code: "forbidden",
                message: `Launch runtime mode ${requestedMode} is broader than caller mode ${authority?.runtimeMode ?? "unknown"}.`,
              });
          }
          const after = yield* Effect.try({
            try: () => decide(before, input, actor, now),
            catch: unavailable,
          });
          yield* sql`INSERT INTO pitboss_events (operation_id, request_json, payload_json, created_at) VALUES (${input.commandId}, ${requestJson}, ${encodeJson({ type: "command", version: 2, input, actor, now })}, ${now})`;
          yield* persist(after);
          const action = input.action;
          const remote = remoteTaskAuthority(before, action);
          if (remote && remote.peerId && remote.proposalId && before.role && "taskId" in action) {
            const task = before.tasks.find((entry) => entry.id === action.taskId)!;
            const message: PitbossPeerMessage = {
              id: input.commandId,
              text: `${action.type} task ${task.id}`,
              originThreadId: before.role.threadId,
              createdAt: now,
              operation: {
                type: "command",
                proposalId: remote.proposalId,
                taskRevision: task.revision,
                action,
              },
            };
            yield* sql`INSERT INTO pitboss_effects (operation_id, kind, payload_json) VALUES (${input.commandId}, 'forward', ${encodeJson({ peerId: remote.peerId, message })})`;
            return after;
          }
          if (
            [
              "create-lead",
              "elect",
              "assign",
              "rework",
              "revise-result",
              "close",
              "request-decision",
              "cancel",
              "propose-coordination",
              "send-peer",
              "clear-board",
            ].includes(action.type) ||
            (action.type === "brief" && action.applyCoordinatorPermissions)
          ) {
            yield* sql`INSERT INTO pitboss_effects (operation_id, kind, payload_json) VALUES (${input.commandId}, ${action.type}, ${encodeJson(action)})`;
          }
          if (action.type === "lead-status") {
            yield* sql`INSERT INTO pitboss_effects (operation_id, kind, payload_json) VALUES (${input.commandId}, 'lead-status', ${encodeJson(action)})`;
          }
          return after;
        }),
      );
      yield* PubSub.publish(notifications, undefined);
      return actor.type === "user" ? result : yield* read(actor);
    }, Effect.mapError(unavailable));
    return WorkStore.of({
      read,
      command,
      finishBoardClear: (operationId) =>
        sql
          .withTransaction(
            Effect.gen(function* () {
              const before = yield* readAll();
              const after = finishBoardClear(before, operationId);
              if (after === before) return;
              const now = DateTime.formatIso(yield* DateTime.now);
              const eventId = `${operationId}:completed`;
              yield* sql`INSERT INTO pitboss_events (operation_id, request_json, payload_json, created_at) VALUES (${eventId}, ${eventId}, ${encodeJson({ type: "board-cleared", operationId })}, ${now})`;
              yield* persist(after);
            }),
          )
          .pipe(
            Effect.tap(() => PubSub.publish(notifications, undefined)),
            Effect.mapError(unavailable),
          ),
      rebuild,
      resolveRemoteReceipt: (operationId, applied, detail) =>
        sql
          .withTransaction(
            Effect.gen(function* () {
              const state = yield* readAll();
              const task = state.tasks.find((entry) => entry.pendingOperationId === operationId);
              if (!task) return;
              const updated = {
                ...task,
                pendingOperationId: undefined,
                status: applied ? task.status : ("blocked" as const),
                note: applied ? task.note : detail,
              };
              const id = `remote-receipt:${NodeCrypto.createHash("sha256").update(operationId).digest("hex")}`;
              const now = DateTime.formatIso(yield* DateTime.now);
              yield* sql`INSERT INTO pitboss_events (operation_id, request_json, payload_json, created_at) VALUES (${id}, ${id}, ${encodeJson({ type: "source", task: updated })}, ${now})`;
              yield* persist({
                ...state,
                revision: state.revision + 1,
                tasks: state.tasks.map((entry) => (entry.id === task.id ? updated : entry)),
              });
            }),
          )
          .pipe(
            Effect.tap(() => PubSub.publish(notifications, undefined)),
            Effect.mapError(unavailable),
          ),
      mirrorTask: (sender, task) =>
        sql
          .withTransaction(
            Effect.gen(function* () {
              const state = yield* readAll();
              const authority = state.sourceAuthorities?.find(
                (entry) => entry.scope === task.source?.scope,
              );
              if (!authority || authority.homeEnvironmentId !== sender || authority.self === sender)
                return yield* new PitbossError({
                  code: "forbidden",
                  message: "Only the recorded remote task home can publish task state.",
                });
              const local = state.tasks.find(
                (entry) => entry.id === task.id && entry.source?.scope === task.source?.scope,
              );
              if (!local)
                return yield* new PitbossError({
                  code: "invalid",
                  message: "Import the shared source item locally before reconciling its work.",
                });
              if ((local.homeRevision ?? -1) >= task.revision) return;
              if (
                !local.homeEnvironmentId &&
                local.attempts.some((attempt) =>
                  ["pending", "running", "submitted", "stop_requested"].includes(attempt.state),
                )
              )
                return yield* new PitbossError({
                  code: "conflict",
                  message: "Resolve the existing local writer before accepting remote task state.",
                });
              const mirrored = {
                ...task,
                projectId: local.projectId,
                // Project-lead ownership is local to this coordinator. The task home owns the
                // execution contract and revision, but cannot appoint a lead in another environment.
                leadId: local.leadId,
                ownershipRevision: local.ownershipRevision,
                homeEnvironmentId: sender,
                homeRevision: task.revision,
                pendingOperationId: local.pendingOperationId,
              };
              const id = `peer-state:${NodeCrypto.createHash("sha256")
                .update(encodeJson([sender, task.id, task.revision]))
                .digest("hex")}`;
              const message = {
                id,
                taskId: task.id,
                threadId: null,
                kind: "progress" as const,
                text: `Task home ${sender}: ${task.title} is ${task.status}. ${task.note}`.slice(
                  0,
                  16000,
                ),
                createdAt: DateTime.formatIso(yield* DateTime.now),
                acknowledged: false,
              };
              yield* sql`INSERT INTO pitboss_events (operation_id, request_json, payload_json, created_at) VALUES (${id}, ${id}, ${encodeJson({ type: "source", task: mirrored, message })}, ${message.createdAt})`;
              yield* persist({
                ...state,
                revision: state.revision + 1,
                tasks: state.tasks.map((entry) => (entry.id === task.id ? mirrored : entry)),
                messages: [...state.messages, message],
              });
            }),
          )
          .pipe(
            Effect.tap(() => PubSub.publish(notifications, undefined)),
            Effect.mapError(unavailable),
          ),
      receiveMessage: (message) =>
        sql
          .withTransaction(
            Effect.gen(function* () {
              const state = yield* readAll();
              const recorded = yield* sql<{
                readonly operation_id: string;
              }>`SELECT operation_id FROM pitboss_events WHERE operation_id = ${message.id}`;
              if (recorded[0]) return;
              const previous = state.messages.find((entry) => entry.id === message.id);
              if (previous) return;
              if (message.taskId && state.archivedTaskIds?.includes(message.taskId)) return;
              yield* sql`INSERT INTO pitboss_events (operation_id, request_json, payload_json, created_at) VALUES (${message.id}, ${message.id}, ${encodeJson({ type: "message", message })}, ${message.createdAt})`;
              yield* persist({
                ...state,
                revision: state.revision + 1,
                messages: [...state.messages, message],
              });
            }),
          )
          .pipe(
            Effect.tap(() => PubSub.publish(notifications, undefined)),
            Effect.mapError(unavailable),
          ),
      subscribeChanges: PubSub.subscribe(notifications).pipe(Effect.map(Stream.fromSubscription)),
      subscribe: () =>
        Stream.unwrap(
          Effect.gen(function* () {
            const subscription = yield* PubSub.subscribe(notifications);
            return Stream.concat(
              Stream.fromEffect(readAll()),
              Stream.fromSubscription(subscription).pipe(Stream.mapEffect(readAll)),
            );
          }),
        ),
      effects: () =>
        Effect.all({
          operations: sql<WorkEffect>`SELECT operation_id, kind, payload_json, attempts, error FROM pitboss_effects WHERE state = 'pending' AND kind <> 'wake' ORDER BY rowid LIMIT 20`,
          wakes: sql<WorkEffect>`SELECT operation_id, kind, payload_json, attempts, error FROM pitboss_effects WHERE state = 'pending' AND kind = 'wake' ORDER BY rowid LIMIT 20`,
        }).pipe(
          Effect.map(({ operations, wakes }) => [...operations, ...wakes]),
          Effect.mapError(unavailable),
        ),
      wakeDeliveries: (recipientId, generation) =>
        sql<{
          readonly key: string;
          readonly deliveries: number;
        }>`SELECT json_each.value AS key, COUNT(*) AS deliveries
          FROM pitboss_effects, json_each(json_extract(pitboss_effects.payload_json, '$.keys'))
          WHERE pitboss_effects.kind = 'wake'
            AND json_extract(pitboss_effects.payload_json, '$.recipientId') = ${recipientId}
            AND json_extract(pitboss_effects.payload_json, '$.generation') = ${generation}
          GROUP BY json_each.value`.pipe(
          Effect.map((rows) => new Map(rows.map((row) => [row.key, row.deliveries]))),
          Effect.mapError(unavailable),
        ),
      queueWake: (id, payloadJson) =>
        sql
          .withTransaction(
            Effect.gen(function* () {
              const existing = yield* sql<{
                readonly state: string;
              }>`SELECT state FROM pitboss_effects WHERE operation_id = ${id}`;
              if (existing[0]) return false;
              yield* sql`INSERT INTO pitboss_effects (operation_id, kind, payload_json) VALUES (${id}, 'wake', ${payloadJson})`;
              return true;
            }),
          )
          .pipe(Effect.mapError(unavailable)),
      retryEffect: (id, error) =>
        sql`UPDATE pitboss_effects SET attempts = attempts + 1, error = ${error} WHERE operation_id = ${id} AND state = 'pending'`.pipe(
          Effect.asVoid,
          Effect.mapError(unavailable),
        ),
      finishWake: (id, payloadJson) =>
        sql`UPDATE pitboss_effects SET state = 'done', payload_json = ${payloadJson}, attempts = attempts + 1, error = NULL WHERE operation_id = ${id} AND kind = 'wake'`.pipe(
          Effect.tap(() => PubSub.publish(notifications, undefined)),
          Effect.asVoid,
          Effect.mapError(unavailable),
        ),
      finishEffect: (id, error) =>
        sql
          .withTransaction(
            Effect.gen(function* () {
              yield* sql`UPDATE pitboss_effects SET state = ${error ? "failed" : "done"}, attempts = attempts + 1, error = ${error ?? null} WHERE operation_id = ${id}`;
              if (!error) return;
              const state = yield* readAll();
              const messageId = `effect-failed:${NodeCrypto.createHash("sha256").update(id).digest("hex")}`;
              if (state.messages.some((message) => message.id === messageId)) return;
              const message = {
                id: messageId,
                taskId:
                  state.tasks.find((task) => task.attempts.some((attempt) => attempt.id === id))
                    ?.id ??
                  state.messages.find((entry) => entry.id === id)?.taskId ??
                  null,
                threadId: null,
                kind: "question" as const,
                text: `Work delivery needs attention: ${error}`.slice(0, 16000),
                createdAt: DateTime.formatIso(yield* DateTime.now),
                acknowledged: false,
              };
              yield* sql`INSERT INTO pitboss_events (operation_id, request_json, payload_json, created_at) VALUES (${messageId}, ${messageId}, ${encodeJson({ type: "message", message })}, ${message.createdAt})`;
              yield* persist({
                ...state,
                revision: state.revision + 1,
                messages: [...state.messages, message],
              });
            }),
          )
          .pipe(
            Effect.tap(() => PubSub.publish(notifications, undefined)),
            Effect.mapError(unavailable),
          ),
      recordVerification: (taskId, run) =>
        sql
          .withTransaction(
            Effect.gen(function* () {
              const before = yield* readAll();
              const next = recordVerification(before, taskId, run);
              if (next === before) return;
              const id = `verification:${run.id}:${run.state}`;
              const now = DateTime.formatIso(yield* DateTime.now);
              yield* sql`INSERT INTO pitboss_events (operation_id, request_json, payload_json, created_at) VALUES (${id}, ${id}, ${encodeJson({ type: "verification", taskId, run })}, ${now})`;
              yield* persist(next);
            }),
          )
          .pipe(
            Effect.tap(() => PubSub.publish(notifications, undefined)),
            Effect.mapError(unavailable),
          ),
      updateAttempt: (taskId, attemptId, status, detail, workspacePath) =>
        sql
          .withTransaction(
            Effect.gen(function* () {
              const before = yield* readAll();
              const next = observeAttempt(before, taskId, attemptId, status, detail, workspacePath);
              if (next === before) return;
              const now = DateTime.formatIso(yield* DateTime.now);
              const eventId = `attempt:${attemptId}:${next.revision}`;
              yield* sql`INSERT INTO pitboss_events (operation_id, request_json, payload_json, created_at) VALUES (${eventId}, ${eventId}, ${encodeJson({ type: "attempt", taskId, attemptId, status, detail, workspacePath })}, ${now})`;
              yield* persist(next);
            }),
          )
          .pipe(
            Effect.tap(() => PubSub.publish(notifications, undefined)),
            Effect.mapError(unavailable),
          ),
      observeAwaitingApproval: (attemptIds) =>
        sql
          .withTransaction(
            Effect.gen(function* () {
              const state = yield* readAll();
              const next = [...new Set(attemptIds)].toSorted();
              const current = state.awaitingApproval ?? [];
              // An unchanged observation must not publish: the runtime drains on every change, so
              // notifying here would make the drain re-trigger itself forever.
              if (
                current.length === next.length &&
                current.every((id, index) => id === next[index])
              )
                return false;
              yield* persist({ ...state, awaitingApproval: next });
              return true;
            }),
          )
          .pipe(
            Effect.tap((changed) =>
              changed ? PubSub.publish(notifications, undefined) : Effect.void,
            ),
            Effect.asVoid,
            Effect.mapError(unavailable),
          ),
      setSourceAuthority: (authority) =>
        sql
          .withTransaction(
            Effect.gen(function* () {
              const state = yield* readAll();
              const previous = state.sourceAuthorities?.find(
                (entry) => entry.scope === authority.scope,
              );
              if (previous && encodeJson(previous) === encodeJson(authority)) return;
              const next = {
                ...state,
                revision: state.revision + 1,
                sourceAuthorities: [
                  ...(state.sourceAuthorities ?? []).filter(
                    (entry) => entry.scope !== authority.scope,
                  ),
                  authority,
                ],
              };
              const eventId = `authority:${next.revision}`;
              const now = DateTime.formatIso(yield* DateTime.now);
              yield* sql`INSERT INTO pitboss_events (operation_id, request_json, payload_json, created_at) VALUES (${eventId}, ${eventId}, ${encodeJson({ type: "authority", authority })}, ${now})`;
              yield* persist(next);
            }),
          )
          .pipe(
            Effect.tap(() => PubSub.publish(notifications, undefined)),
            Effect.mapError(unavailable),
          ),
      importSources: (config, observations) =>
        sql
          .withTransaction(
            Effect.gen(function* () {
              const state = yield* readAll();
              const tasks = [...state.tasks];
              const messages = [...state.messages];
              let revision = state.revision;
              for (const item of observations) {
                const observation = {
                  ...item,
                  source: {
                    ...item.source,
                    scope: encodeJson([config.kind, config.tenantId, config.remoteProjectId]),
                    contentDigest: NodeCrypto.createHash("sha256")
                      .update(encodeJson([item.title, item.outcome]))
                      .digest("hex"),
                  },
                };
                const identity = encodeJson([
                  observation.source.kind,
                  observation.source.tenantId,
                  observation.source.itemId,
                ]);
                const id = `source-${NodeCrypto.createHash("sha256").update(identity).digest("hex")}`;
                const old = tasks.find((task) => task.id === id);
                if (old && old.projectId !== config.projectId)
                  return yield* new PitbossError({
                    code: "conflict",
                    message: "This source item already belongs to another T3 project.",
                  });
                if (!old && !sourceEligible(observation)) continue;
                if (!old && tasks.length >= 500)
                  return yield* new PitbossError({
                    code: "invalid",
                    message: "The pilot backlog limit is 500. Narrow the source scope.",
                  });
                const outcome = observation.outcome.slice(0, 16000);
                if (
                  old &&
                  old.source?.contentDigest === observation.source.contentDigest &&
                  old.source &&
                  old.source.scope === observation.source.scope &&
                  old.source.status === observation.source.status &&
                  old.source.priority === observation.source.priority &&
                  old.source.url === observation.source.url &&
                  old.source.key === observation.source.key &&
                  encodeJson(old.source.ownership ?? null) ===
                    encodeJson(observation.source.ownership ?? null)
                )
                  continue;
                const changed =
                  old && old.source?.contentDigest !== observation.source.contentDigest;
                const task = old
                  ? {
                      ...old,
                      title: changed ? observation.title : old.title,
                      source: observation.source,
                      revision: old.revision + 1,
                      ownershipRevision:
                        encodeJson(old.source?.ownership ?? null) !==
                        encodeJson(observation.source.ownership ?? null)
                          ? (old.ownershipRevision ?? 0) + 1
                          : old.ownershipRevision,
                      note: changed
                        ? "Source requirements changed. Review criteria before continuing."
                        : old.note,
                      status: changed ? ("blocked" as const) : old.status,
                      acceptedEvidenceId: changed ? null : old.acceptedEvidenceId,
                      criteriaVersion: changed ? old.criteriaVersion + 1 : old.criteriaVersion,
                      outcome: changed ? outcome : old.outcome,
                      updatedAt: observation.source.observedAt,
                    }
                  : {
                      id,
                      revision: 1,
                      projectId: config.projectId,
                      title: observation.title,
                      outcome: observation.outcome.slice(0, 16000),
                      criteria: importedCriteria,
                      criteriaVersion: 1,
                      verifyCommand: "",
                      priority: 50,
                      dependencies: [],
                      workspaceStrategy: { type: "worktree" as const, baseRef: "HEAD" },
                      status: "blocked" as const,
                      attempts: [],
                      evidence: [],
                      source: observation.source,
                      note: "Imported candidate. Review scope and acceptance before reopening.",
                      acceptedEvidenceId: null,
                      createdAt: observation.source.observedAt,
                      updatedAt: observation.source.observedAt,
                    };
                const index = tasks.findIndex((entry) => entry.id === id);
                if (index === -1) tasks.push(task);
                else tasks[index] = task;
                revision += 1;
                const eventId = `source:${id}:${revision}`;
                const message = {
                  id: eventId,
                  taskId: id,
                  threadId: null,
                  kind: "progress" as const,
                  text: old
                    ? "Source observation changed. Review requirements and source status without treating them as acceptance."
                    : "New imported candidate. Review scope, acceptance criteria, and verification before activation.",
                  createdAt: observation.source.observedAt,
                  acknowledged: false,
                };
                messages.push(message);
                yield* sql`INSERT INTO pitboss_events (operation_id, request_json, payload_json, created_at) VALUES (${eventId}, ${identity}, ${encodeJson({ type: "source", task, message })}, ${observation.source.observedAt})`;
              }
              if (revision !== state.revision)
                yield* persist({ ...state, revision, tasks, messages });
            }),
          )
          .pipe(
            Effect.tap(() => PubSub.publish(notifications, undefined)),
            Effect.mapError(unavailable),
          ),
      context: (threadId, packetId) =>
        Effect.gen(function* () {
          const previous = yield* sql<{
            thread_id: string;
            content: string;
          }>`SELECT thread_id, content FROM pitboss_context_packets WHERE packet_id = ${packetId}`;
          if (previous[0]) {
            if (previous[0].thread_id !== threadId)
              return yield* new PitbossError({
                code: "conflict",
                message: "Context packet belongs to a different thread.",
              });
            return previous[0].content;
          }
          // Every turn in the environment asks for its packet, but only coordinator, lead and
          // worker threads have one, and the snapshot runs to hundreds of kilobytes. A thread the
          // stored snapshot never mentions cannot be managed, so rule it out before decoding.
          // A missing row still falls through, because the journal may not have been projected yet.
          const probe = yield* sql<{
            found: number;
          }>`SELECT instr(payload_json, ${threadId}) AS found FROM pitboss_state WHERE id = 1`;
          if (probe[0] && probe[0].found === 0) return null;
          const state = yield* readAll();
          const content = workContext(state, threadId);
          if (content === null) return null;
          const now = DateTime.formatIso(yield* DateTime.now);
          yield* sql`INSERT INTO pitboss_context_packets (packet_id, thread_id, revision, content, created_at) VALUES (${packetId}, ${threadId}, ${state.revision}, ${content}, ${now}) ON CONFLICT(packet_id) DO NOTHING`;
          return content;
        }).pipe(Effect.mapError(unavailable)),
    });
  }),
);
