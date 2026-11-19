import {
  FactoryError,
  type FactoryBoard,
  type FactoryStatus,
  type FactoryPayload,
  type FactoryTrigger,
  type FactoryTriggerRun,
  type ModelSelection,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { FactoryControl } from "./FactoryControl.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import { stopFactoryThreads } from "./FactoryQuiescence.ts";
import { FactoryStore } from "./FactoryStore.ts";
import { FactoryAgents } from "./FactoryAgents.ts";
import { FactoryDecisions } from "./FactoryDecisions.ts";
import { FactoryActions } from "./FactoryActions.ts";
import { FactoryTriggers } from "./FactoryTriggers.ts";
import { WakeDelivery } from "./WakeDelivery.ts";
import { CommandLanes } from "./CommandLanes.ts";
import { callerAgent, inSubtree, type FactoryActor } from "./access.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";

export class Factory extends Context.Service<
  Factory,
  {
    readonly setEnabled: (enabled: boolean) => Effect.Effect<FactoryStatus, FactoryError>;
    readonly board: (actor: FactoryActor) => Effect.Effect<FactoryBoard, FactoryError>;
    readonly subscribe: (actor: FactoryActor) => Stream.Stream<FactoryBoard, FactoryError>;
    readonly ensureCommander: (
      model: ModelSelection,
    ) => ReturnType<FactoryAgents["Service"]["ensureCommander"]>;
    readonly payload: (
      actor: FactoryActor,
      hash: string,
    ) => Effect.Effect<FactoryPayload, FactoryError>;
    readonly runTrigger: (
      actor: FactoryActor,
      id: string,
    ) => Effect.Effect<FactoryTriggerRun, FactoryError>;
    readonly shadowTrigger: (
      actor: FactoryActor,
      id: string,
      shadow: boolean,
    ) => Effect.Effect<FactoryTrigger, FactoryError>;
    readonly agents: FactoryAgents["Service"];
    readonly decisions: FactoryDecisions["Service"];
    readonly actions: FactoryActions["Service"];
    readonly triggers: FactoryTriggers["Service"];
    readonly wakes: WakeDelivery["Service"];
    readonly lanes: CommandLanes["Service"];
  }
>()("t3/factory/Factory") {}

const make = Effect.gen(function* () {
  const store = yield* FactoryStore;
  const control = yield* FactoryControl;
  const threads = yield* ThreadManagementService;
  const stopThreads = stopFactoryThreads.pipe(
    Effect.provideService(FactoryStore, store),
    Effect.provideService(ThreadManagementService, threads),
  );
  const agents = yield* FactoryAgents;
  const decisions = yield* FactoryDecisions;
  const actions = yield* FactoryActions;
  const triggers = yield* FactoryTriggers;
  const wakes = yield* WakeDelivery;
  const lanes = yield* CommandLanes;
  const environmentId = yield* (yield* ServerEnvironment.ServerEnvironment).getEnvironmentId;
  const board = Effect.fn("Factory.board")(function* (actor: FactoryActor) {
    const all = yield* store.list("agents");
    const caller =
      actor.kind === "agent"
        ? yield* callerAgent(actor).pipe(Effect.provideService(FactoryStore, store))
        : null;
    const visible = all.filter((a) => caller === null || inSubtree(caller, a, all));
    const ids = new Set(visible.map((a) => a.id));
    const cards = (yield* store.list("cards")).filter((c) => ids.has(c.ownerId));
    const cardIds = new Set(cards.map((c) => c.id));
    const visibleTriggers = (yield* store.list("triggers")).filter(
      (t) => ids.has(t.ownerId) || ids.has(t.targetId),
    );
    const triggerIds = new Set(visibleTriggers.map((t) => t.id));
    return {
      environmentId,
      status: yield* control.status,
      sequence: yield* store.sequence,
      agents: visible,
      cards,
      wakes: (yield* store.list("wakes")).filter((w) => ids.has(w.targetId)),
      triggers: visibleTriggers,
      runs: (yield* store.list("runs")).filter((run) => triggerIds.has(run.triggerId)).slice(-200),
      jobs: (yield* store.list("jobs")).filter((j) => ids.has(j.ownerId)),
      spawns: (yield* store.list("spawns")).filter(
        (s) => caller === null || (s.parentId !== null && ids.has(s.parentId)),
      ),
      executions: (yield* store.list("executions")).filter((e) => cardIds.has(e.cardId)),
    } satisfies FactoryBoard;
  });
  const subscribe = (actor: FactoryActor) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const changes = yield* store.subscribe;
        const initial = yield* board(actor);
        return Stream.concat(
          Stream.make(initial),
          changes.pipe(Stream.mapEffect(() => board(actor))),
        );
      }),
    );
  const ensureCommander = Effect.fn("Factory.ensureCommander")(function* (model: ModelSelection) {
    const commander = yield* agents.ensureCommander(model);
    for (const [name, intervalMs] of [
      ["stall-watch", 900_000],
      ["health-watch", 300_000],
      ["decisions-stale", 900_000],
      ["usage-quota", 300_000],
    ] as const) {
      if (!(yield* store.get("triggers", `builtin:${name}`)))
        yield* triggers.upsert(
          { kind: "user" },
          {
            id: `builtin:${name}`,
            targetId: commander.id,
            intervalMs,
            check: { type: "builtin", name },
            prompt: "Factory check found new items:\n{{items}}",
            rearm: { type: "never" },
            enabled: true,
            shadow: true,
          },
        );
    }
    return commander;
  });
  const payload = Effect.fn("Factory.payload")(function* (actor: FactoryActor, hash: string) {
    const value = yield* store.get("payloads", hash);
    if (!value) return yield* new FactoryError({ code: "not-found", entityId: hash });
    if (
      actor.kind === "agent" &&
      (yield* callerAgent(actor).pipe(Effect.provideService(FactoryStore, store))).id !==
        value.ownerId
    )
      return yield* new FactoryError({ code: "forbidden" });
    return value;
  });
  const authorizeTriggers = Effect.fn("Factory.authorizeTriggers")(function* (actor: FactoryActor) {
    if (
      actor.kind === "agent" &&
      (yield* callerAgent(actor).pipe(Effect.provideService(FactoryStore, store))).role !==
        "commander"
    )
      return yield* new FactoryError({ code: "forbidden" });
  });
  const runTrigger = Effect.fn("Factory.runTrigger")(function* (actor: FactoryActor, id: string) {
    yield* authorizeTriggers(actor);
    return yield* triggers.run(id);
  });
  const shadowTrigger = Effect.fn("Factory.shadowTrigger")(function* (
    actor: FactoryActor,
    id: string,
    shadow: boolean,
  ) {
    yield* authorizeTriggers(actor);
    const value = yield* store.get("triggers", id);
    if (!value) return yield* new FactoryError({ code: "not-found", entityId: id });
    return yield* triggers.upsert(actor, { ...value, shadow });
  });
  const guarded =
    <Args extends unknown[], A>(operation: (...args: Args) => Effect.Effect<A, FactoryError>) =>
    (...args: Args) =>
      control.run(operation(...args));
  const setEnabled = Effect.fn("Factory.setEnabled")(function* (enabled: boolean) {
    yield* control.setEnabled(enabled);
    if (!enabled)
      yield* stopThreads.pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Factory shutdown remains pending", { category: cause.code }),
        ),
      );
    return yield* control.status;
  });
  return Factory.of({
    board,
    subscribe,
    setEnabled,
    ensureCommander: guarded(ensureCommander),
    payload,
    runTrigger: guarded(runTrigger),
    shadowTrigger: guarded(shadowTrigger),
    agents: {
      ...agents,
      ensureCommander: guarded(agents.ensureCommander),
      spawn: guarded(agents.spawn),
      resume: guarded(agents.resume),
      update: guarded(agents.update),
      lifecycle: guarded(agents.lifecycle),
    },
    decisions: {
      ...decisions,
      file: guarded(decisions.file),
      answer: guarded(decisions.answer),
      withdraw: guarded(decisions.withdraw),
      payload: guarded(decisions.payload),
    },
    actions: { ...actions, execute: guarded(actions.execute) },
    triggers: {
      ...triggers,
      run: guarded(triggers.run),
      upsert: guarded(triggers.upsert),
      runDue: control.run(triggers.runDue),
    },
    wakes: {
      ...wakes,
      drain: control.run(wakes.drain),
      retry: guarded(wakes.retry),
      defer: guarded(wakes.defer),
      acknowledge: guarded(wakes.acknowledge),
    },
    lanes: { ...lanes, enqueue: guarded(lanes.enqueue) },
  });
});
export const layer = Layer.effect(Factory, make);
