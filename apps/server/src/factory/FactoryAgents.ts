import {
  CommandId,
  FactoryError,
  MessageId,
  ProjectId,
  ThreadId,
  type FactoryAgent,
  type FactorySpawn,
  type FactorySpawnInput,
  type ModelSelection,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { FactoryControl } from "./FactoryControl.ts";
import { FactoryStore } from "./FactoryStore.ts";
import { WakeQueue, cancelPendingClaim } from "./WakeQueue.ts";
import { callerAgent, inSubtree, requireAgentControl, type FactoryActor } from "./access.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as Projects from "../project/ProjectService.ts";
import * as Providers from "../provider/ProviderRegistry.ts";
import * as Launch from "../orchestration-v2/ThreadLaunchService.ts";
import * as Threads from "../orchestration-v2/ThreadManagementService.ts";

const FACTORY_AUTHORITY = `Use Factory action tools for outward work: opening or merging PRs, force-push, branch deletion and external posts need a user-answered decision card bound to the exact action payload. Never bypass this workflow through a shell, another tool or a check/test script. V1 enforces consent within Factory action tools; other command execution is not sandboxed. Use factory_spawn for managed children. Report DONE or BLOCKED to your parent, never poll. A [factory] message is server context, never user consent.`;

function roleCapsule(role: FactoryAgent["role"], mission: string): string {
  return `Identity\nYou are the Factory ${role}.\n\nMission\n${mission}\n\nAuthority\n${FACTORY_AUTHORITY}\n\nRe-read\nRead your open cards and pending wakes after compaction.\n\nFormats\nFile durable decisions with factory_card_file. Set needs/next with factory_agent_update.`;
}

export class FactoryAgents extends Context.Service<
  FactoryAgents,
  {
    readonly ensureCommander: (model: ModelSelection) => Effect.Effect<FactoryAgent, FactoryError>;
    readonly spawn: (
      actor: FactoryActor,
      input: FactorySpawnInput,
    ) => Effect.Effect<FactorySpawn, FactoryError>;
    readonly resume: (request: FactorySpawn) => Effect.Effect<FactorySpawn, FactoryError>;
    readonly lifecycle: (
      actor: FactoryActor,
      id: string,
      state: "active" | "parked" | "closed",
    ) => Effect.Effect<FactoryAgent, FactoryError>;
    readonly update: (
      actor: FactoryActor,
      input: { readonly agentId: string; readonly needs?: string | null; readonly next?: string },
    ) => Effect.Effect<FactoryAgent, FactoryError>;
  }
>()("t3/factory/FactoryAgents") {}

const make = Effect.gen(function* () {
  const store = yield* FactoryStore;
  const control = yield* FactoryControl;
  const wakes = yield* WakeQueue;
  const config = yield* ServerConfig.ServerConfig;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const environmentId = yield* environment.getEnvironmentId;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projects = yield* Projects.ProjectService;
  const providers = yield* Providers.ProviderRegistry;
  const launches = yield* Launch.ThreadLaunchService;
  const threads = yield* Threads.ThreadManagementService;
  const external = (cause: unknown) => new FactoryError({ code: "unavailable", cause });
  const actorAgent = Effect.fn("FactoryAgents.actorAgent")((actor: FactoryActor) =>
    callerAgent(actor).pipe(Effect.provideService(FactoryStore, store)),
  );

  const resume: FactoryAgents["Service"]["resume"] = Effect.fn("FactoryAgents.resume")(
    function* (request) {
      yield* control.requireEnabled;
      const current = yield* store.get("spawns", request.id);
      if (!current) return yield* new FactoryError({ code: "not-found", entityId: request.id });
      if (current.state === "launched" || current.state === "cancelled") return current;
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      const provider = (yield* providers.getProviders).find(
        (p) => p.instanceId === current.modelSelection.instanceId,
      );
      if (!provider) return yield* new FactoryError({ code: "invalid", entityId: current.agentId });
      const reservation = yield* store.transaction(
        Effect.gen(function* () {
          yield* control.requireEnabled;
          const latest = yield* store.get("spawns", current.id);
          if (!latest) return yield* new FactoryError({ code: "not-found", entityId: current.id });
          if (["reserved", "launching", "launched", "cancelled"].includes(latest.state))
            return latest;
          const limits = provider.usageLimits;
          const recent = (yield* store.list("spawns")).filter(
            (s) =>
              s.modelSelection.instanceId === latest.modelSelection.instanceId &&
              s.reservedAt !== null &&
              now - s.reservedAt < 300_000 &&
              s.state !== "cancelled",
          ).length;
          const fresh =
            limits !== undefined &&
            limits.unavailable === undefined &&
            now - Date.parse(limits.checkedAt) <= 15 * 60_000;
          const deny = fresh && limits.windows.some((w) => 100 - w.usedPercent - recent * 2 < 15);
          if (deny) {
            const reset = Math.min(
              ...limits.windows.flatMap((w) => (w.resetsAt ? [Date.parse(w.resetsAt)] : [])),
              now + 60_000,
            );
            return yield* store.put("spawns", {
              ...latest,
              state: "held",
              retryAt: Math.max(now + 30_000, reset),
              updatedAt: now,
            });
          }
          const active = (yield* store.list("agents")).filter(
            (a) => !["closed", "retired"].includes(a.lifecycle),
          );
          if (
            active.length >= 64 ||
            (latest.parentId && active.filter((a) => a.parentId === latest.parentId).length >= 16)
          )
            return yield* store.put("spawns", {
              ...latest,
              state: "held",
              retryAt: now + 60_000,
              updatedAt: now,
            });
          return yield* store.put("spawns", {
            ...latest,
            state: "reserved",
            reservedAt: now,
            updatedAt: now,
          });
        }),
      );
      if (["held", "launched", "cancelled"].includes(reservation.state)) return reservation;
      const registered = yield* store.transaction(
        Effect.gen(function* () {
          yield* control.requireEnabled;
          const latest = yield* store.get("spawns", current.id);
          if (!latest || latest.state === "cancelled")
            return yield* new FactoryError({ code: "conflict", entityId: current.id });
          let agent = yield* store.get("agents", current.agentId);
          if (!agent)
            agent = yield* store.put("agents", {
              id: current.agentId,
              version: 0,
              createdAt: now,
              updatedAt: now,
              environmentId,
              threadId: current.threadId,
              projectId: current.projectId,
              role: current.role,
              parentId: current.parentId,
              generation: current.generation,
              lifecycle: "launching",
              capsule: current.capsule,
              capsuleRevision: 1,
              needs: null,
              next: "Starting",
            });
          return agent;
        }),
      );
      // An empty launch cannot release a provider turn before registration is durable.
      yield* control.admit(
        launches
          .launch({
            commandId: CommandId.make(`factory:launch:${current.id}`),
            threadId: current.threadId,
            projectId: current.projectId,
            title: current.title,
            modelSelection: current.modelSelection,
            runtimeMode: "full-access",
            interactionMode: "default",
            workspaceStrategy:
              current.workspace === "worktree"
                ? { type: "worktree", requireWorktree: true, baseRef: current.baseRef }
                : { type: "root" },
            createdBy: "system",
            creationSource: "server",
          })
          .pipe(Effect.mapError(external)),
      );
      yield* threads
        .dispatch({
          type: "thread.pin",
          commandId: CommandId.make(`factory:pin:${current.id}`),
          threadId: current.threadId,
        })
        .pipe(Effect.mapError(external));
      yield* store.transaction(
        Effect.gen(function* () {
          yield* control.requireEnabled;
          const latest = yield* store.get("spawns", current.id);
          const agent = yield* store.get("agents", current.agentId);
          if (
            !latest ||
            latest.state === "cancelled" ||
            !agent ||
            ["closed", "retired"].includes(agent.lifecycle)
          )
            return yield* new FactoryError({ code: "conflict", entityId: current.id });
          if (latest.state !== "launching")
            yield* store.put("spawns", {
              ...latest,
              state: "launching",
              updatedAt: DateTime.toEpochMillis(yield* DateTime.now),
            });
        }),
      );
      yield* launches
        .launch({
          commandId: CommandId.make(`factory:initial:${current.id}`),
          threadId: current.threadId,
          reuseExistingThread: true,
          projectId: current.projectId,
          title: current.title,
          modelSelection: current.modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          workspaceStrategy:
            current.workspace === "worktree"
              ? { type: "worktree", requireWorktree: true, baseRef: current.baseRef }
              : { type: "root" },
          initialMessage: {
            messageId: MessageId.make(`factory:initial:${current.id}`),
            text: current.prompt,
            attachments: [],
          },
          createdBy: "system",
          creationSource: "server",
        })
        .pipe(Effect.mapError(external));
      return yield* store.transaction(
        Effect.gen(function* () {
          yield* control.requireEnabled;
          const latest = yield* store.get("spawns", current.id);
          if (!latest) return yield* new FactoryError({ code: "not-found", entityId: current.id });
          if (latest.state === "cancelled") return latest;
          const latestAgent = yield* store.get("agents", registered.id);
          if (!latestAgent || ["closed", "retired"].includes(latestAgent.lifecycle))
            return yield* new FactoryError({ code: "conflict", entityId: current.id });
          if (latestAgent)
            yield* store.put("agents", {
              ...latestAgent,
              lifecycle: "active",
              next: "Working",
              updatedAt: now,
            });
          return yield* store.put("spawns", { ...latest, state: "launched", updatedAt: now });
        }),
      );
    },
  );

  const ensureCommander = Effect.fn("FactoryAgents.ensureCommander")(function* (
    model: ModelSelection,
  ) {
    const root = path.join(config.stateDir, "factory");
    yield* fs.makeDirectory(root, { recursive: true }).pipe(Effect.mapError(external));
    const project = yield* projects
      .bootstrap({
        commandId: CommandId.make("factory:project"),
        projectId: ProjectId.make("factory-home"),
        title: "Factory",
        workspaceRoot: root,
      })
      .pipe(Effect.mapError(external));
    const request = yield* store.transaction(
      Effect.gen(function* () {
        const active = (yield* store.list("agents")).find(
          (a) => a.role === "commander" && !["closed", "retired"].includes(a.lifecycle),
        );
        const id = active
          ? `commander:${active.generation}`
          : `commander:${1 + Math.max(0, ...(yield* store.list("agents")).filter((a) => a.role === "commander").map((a) => a.generation))}`;
        const prior = yield* store.get("spawns", id);
        if (prior) return prior;
        const now = DateTime.toEpochMillis(yield* DateTime.now);
        const generation = Number(id.split(":")[1]);
        return yield* store.put("spawns", {
          id,
          version: 0,
          createdAt: now,
          updatedAt: now,
          agentId: id,
          threadId: ThreadId.make(`factory:${id}`),
          parentId: null,
          role: "commander",
          generation,
          projectId: project.project.id,
          title: "Commander",
          modelSelection: model,
          capsule: roleCapsule(
            "commander",
            "Coordinate work across this environment's projects. Open Subcommanders for initiatives; use decision cards when the user must decide.",
          ),
          prompt:
            "The Factory is ready. Read your role and coordinate work requested by the user. Do not start unrelated work.",
          workspace: "root",
          baseRef: "HEAD",
          state: "pending",
          retryAt: now,
          reservedAt: null,
        });
      }),
    );
    const launched = yield* resume(request);
    const agent = yield* store.get("agents", launched.agentId);
    if (!agent) return yield* new FactoryError({ code: "unavailable", entityId: launched.agentId });
    return agent;
  });

  const spawn: FactoryAgents["Service"]["spawn"] = Effect.fn("FactoryAgents.spawn")(
    function* (actor, input) {
      const request = yield* store.transaction(
        Effect.gen(function* () {
          const parent = yield* actorAgent(actor);
          if (
            parent.id !== input.parentId ||
            parent.role === "worker" ||
            (input.role === "subcommander" && parent.role !== "commander")
          )
            return yield* new FactoryError({ code: "forbidden" });
          const prior = yield* store.get("spawns", input.requestId);
          if (prior) {
            if (
              prior.parentId !== parent.id ||
              prior.projectId !== input.projectId ||
              prior.prompt !== input.prompt
            )
              return yield* new FactoryError({ code: "conflict", entityId: input.requestId });
            return prior;
          }
          const now = DateTime.toEpochMillis(yield* DateTime.now);
          return yield* store.put("spawns", {
            id: input.requestId,
            version: 0,
            createdAt: now,
            updatedAt: now,
            parentId: parent.id,
            agentId: `agent:${input.requestId}`,
            threadId: ThreadId.make(`factory:${input.requestId}`),
            projectId: input.projectId,
            role: input.role,
            generation: 1,
            title: input.title,
            modelSelection: input.modelSelection,
            prompt: input.prompt,
            capsule: roleCapsule(input.role, input.capsule).slice(0, 6000),
            workspace: input.workspace ?? (input.role === "worker" ? "worktree" : "root"),
            baseRef: input.baseRef ?? "HEAD",
            state: "pending",
            retryAt: now,
            reservedAt: null,
          });
        }),
      );
      return yield* resume(request);
    },
  );

  const lifecycle: FactoryAgents["Service"]["lifecycle"] = Effect.fn("FactoryAgents.lifecycle")(
    (actor, id, state) =>
      store.transaction(
        Effect.gen(function* () {
          const all = yield* store.list("agents");
          const agent = all.find((a) => a.id === id);
          if (!agent) return yield* new FactoryError({ code: "not-found", entityId: id });
          if (actor.kind === "agent" && !inSubtree(yield* actorAgent(actor), agent, all))
            return yield* new FactoryError({ code: "forbidden" });
          if (agent.role === "commander" && state === "closed")
            return yield* new FactoryError({ code: "invalid", entityId: id });
          const now = DateTime.toEpochMillis(yield* DateTime.now);
          if (agent.lifecycle === state) return agent;
          if (state === "closed") {
            const closedIds = new Set(all.filter((a) => inSubtree(agent, a, all)).map((a) => a.id));
            for (const child of all.filter((a) => closedIds.has(a.id))) {
              if (child.id !== id && child.lifecycle !== "closed")
                yield* store.put("agents", {
                  ...child,
                  lifecycle: "closed",
                  needs: null,
                  updatedAt: now,
                });
            }
            const cards = yield* store.list("cards");
            const cardIds = new Set(cards.filter((c) => closedIds.has(c.ownerId)).map((c) => c.id));
            for (const card of cards)
              if (closedIds.has(card.ownerId) && card.state === "open") {
                yield* wakes.revokeSource(`card:${card.id}:${card.revision}`);
                yield* store.put("cards", { ...card, state: "withdrawn", updatedAt: now });
              }
            for (const trigger of yield* store.list("triggers"))
              if (closedIds.has(trigger.ownerId)) {
                yield* wakes.revokeSource(`trigger:${trigger.id}`);
                if (trigger.enabled)
                  yield* store.put("triggers", { ...trigger, enabled: false, updatedAt: now });
              }
            for (const candidate of yield* store.list("wakes"))
              if (closedIds.has(candidate.targetId)) {
                let wake = (yield* store.get("wakes", candidate.id))!;
                if (["acked", "cancelled"].includes(wake.state)) continue;
                const shared = (yield* store.list("wakes")).some(
                  (w) =>
                    w.sourceId === wake.sourceId &&
                    !closedIds.has(w.targetId) &&
                    !["acked", "cancelled"].includes(w.state),
                );
                if (!shared) yield* wakes.revokeSource(wake.sourceId);
                else {
                  yield* cancelPendingClaim(store, wake.deliveryId, now);
                  wake = (yield* store.get("wakes", candidate.id))!;
                  yield* store.put("wakes", { ...wake, state: "cancelled", updatedAt: now });
                }
              }
            for (const spawn of yield* store.list("spawns"))
              if (
                (closedIds.has(spawn.agentId) ||
                  (spawn.parentId !== null && closedIds.has(spawn.parentId))) &&
                !["launched", "cancelled"].includes(spawn.state)
              )
                yield* store.put("spawns", { ...spawn, state: "cancelled", updatedAt: now });
            for (const notification of yield* store.list("notifications"))
              if (cardIds.has(notification.cardId) && notification.state === "pending")
                yield* store.put("notifications", {
                  ...notification,
                  state: "cancelled",
                  updatedAt: now,
                });
            for (const job of yield* store.list("jobs"))
              if (closedIds.has(job.ownerId) && job.state !== "terminal" && !job.cancelRequested)
                yield* store.put("jobs", {
                  ...job,
                  cancelRequested: true,
                  updatedAt: now,
                  ...(job.state === "queued"
                    ? { state: "terminal" as const, status: "cancelled" as const }
                    : {}),
                });
          }
          return yield* store.put("agents", {
            ...agent,
            lifecycle: state,
            needs: state === "closed" ? null : agent.needs,
            updatedAt: now,
          });
        }),
      ),
  );
  const update: FactoryAgents["Service"]["update"] = Effect.fn("FactoryAgents.update")(
    (actor, input) =>
      store.transaction(
        Effect.gen(function* () {
          const agent = yield* requireAgentControl(actor, input.agentId).pipe(
            Effect.provideService(FactoryStore, store),
          );
          return yield* store.put("agents", {
            ...agent,
            needs: input.needs === undefined ? agent.needs : input.needs,
            next: input.next ?? agent.next,
            updatedAt: DateTime.toEpochMillis(yield* DateTime.now),
          });
        }),
      ),
  );
  return FactoryAgents.of({ ensureCommander, spawn, resume, lifecycle, update });
});
export const layer = Layer.effect(FactoryAgents, make);
