import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type FactoryAgent,
  type FactoryCard,
  type FactorySpawn,
  type FactoryWake,
  type FactoryLaneJob,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Store from "./FactoryStore.ts";
import * as Control from "./FactoryControl.ts";
import * as Sqlite from "../persistence/Sqlite.ts";

const persistence = Store.layer.pipe(Layer.provideMerge(Sqlite.layerMemory));
const TestLayer = Control.layer.pipe(Layer.provideMerge(persistence));
const record = { version: 0, createdAt: 0, updatedAt: 0 };
const agent: FactoryAgent = {
  ...record,
  id: "worker",
  threadId: ThreadId.make("worker-thread"),
  environmentId: EnvironmentId.make("env"),
  projectId: ProjectId.make("project"),
  role: "worker",
  parentId: null,
  generation: 1,
  lifecycle: "active",
  capsule: "Work",
  capsuleRevision: 1,
  needs: null,
  next: "Work",
};
const spawn: FactorySpawn = {
  ...record,
  id: "spawn",
  parentId: "worker",
  agentId: "child",
  threadId: ThreadId.make("child-thread"),
  projectId: agent.projectId,
  role: "worker",
  generation: 1,
  title: "Child",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
  prompt: "Work",
  capsule: "Work",
  workspace: "root",
  baseRef: "HEAD",
  state: "reserved",
  retryAt: 0,
  reservedAt: 0,
};
const wake: FactoryWake = {
  ...record,
  id: "wake",
  targetId: agent.id,
  routingEpoch: 1,
  refKind: "card",
  refId: "card",
  text: "Continue",
  sourceId: "source",
  sourceEpoch: 1,
  state: "queued",
  holdReason: null,
  attempts: 0,
  nextAttemptAt: 0,
  deferUntil: null,
  deliveryId: "delivery",
};
const job: FactoryLaneJob = {
  ...record,
  id: "job",
  ownerId: agent.id,
  cwd: "/test",
  gitRoot: "/test/.git",
  argv: ["test"],
  lane: "heavy",
  priority: 0,
  timeoutMs: 1000,
  frozenHead: null,
  startedAt: null,
  state: "queued",
  status: null,
  rc: null,
  outputPath: "",
  supervisor: null,
};

it.effect("Factory is off by default and blocked work is never invoked", () =>
  Effect.gen(function* () {
    const control = yield* Control.FactoryControl;
    const calls = yield* Ref.make(0);
    assert.deepEqual(yield* control.status, { enabled: false, forcedOff: false, stopping: false });
    assert.isTrue(
      Exit.isFailure(yield* control.run(Ref.update(calls, (n) => n + 1)).pipe(Effect.exit)),
    );
    assert.equal(yield* Ref.get(calls), 0);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("explicit enable survives rebuilding the service and disable remains off", () =>
  Effect.gen(function* () {
    const control = yield* Control.FactoryControl;
    yield* control.setEnabled(true);
    assert.isTrue(
      (yield* Effect.gen(function* () {
        return yield* (yield* Control.FactoryControl).status;
      }).pipe(Effect.provide(Layer.fresh(Control.layer)))).enabled,
    );
    yield* control.setEnabled(false);
    assert.isFalse(
      (yield* Effect.gen(function* () {
        return yield* (yield* Control.FactoryControl).status;
      }).pipe(Effect.provide(Layer.fresh(Control.layer)))).enabled,
    );
  }).pipe(Effect.provide(TestLayer)),
);

it.effect(
  "disabling atomically cancels queues and retains cancellation custody for live work",
  () =>
    Effect.gen(function* () {
      const control = yield* Control.FactoryControl;
      const store = yield* Store.FactoryStore;
      yield* control.setEnabled(true);
      yield* store.transaction(
        Effect.gen(function* () {
          yield* store.put("agents", agent);
          yield* store.put("spawns", spawn);
          yield* store.put("wakes", wake);
          yield* store.put("deliveries", {
            ...record,
            id: "delivery",
            targetId: agent.id,
            threadId: agent.threadId,
            routingEpoch: 1,
            sourceId: "source",
            sourceEpoch: 1,
            wakeIds: [wake.id],
            attempt: 1,
            text: wake.text,
            commandId: "command",
            messageId: "message",
            state: "claimed",
          });
          yield* store.put("jobs", job);
          yield* store.put("jobs", { ...job, id: "running", state: "running", startedAt: 0 });
        }),
      );
      assert.deepEqual(yield* control.setEnabled(false), {
        enabled: false,
        forcedOff: false,
        stopping: true,
      });
      assert.equal((yield* store.get("spawns", spawn.id))?.state, "cancelled");
      assert.equal((yield* store.get("wakes", wake.id))?.state, "cancelled");
      assert.equal((yield* store.get("deliveries", "delivery"))?.state, "cancelled");
      assert.equal((yield* store.get("jobs", job.id))?.state, "terminal");
      assert.isTrue((yield* store.get("jobs", "running"))?.cancelRequested);
      assert.deepEqual((yield* store.get("control", "factory"))?.pendingThreadStops, [
        agent.threadId,
      ]);
      assert.isTrue(Exit.isFailure(yield* control.setEnabled(true).pipe(Effect.exit)));
      assert.lengthOf(yield* store.list("agents"), 1);
    }).pipe(Effect.provide(TestLayer)),
);

it.effect("work paused before disable cannot be admitted after re-enable", () =>
  Effect.gen(function* () {
    const control = yield* Control.FactoryControl;
    yield* control.setEnabled(true);
    const ready = yield* Deferred.make<void>();
    const resume = yield* Deferred.make<void>();
    const calls = yield* Ref.make(0);
    const pending = yield* control
      .run(
        Effect.gen(function* () {
          yield* Deferred.succeed(ready, undefined);
          yield* Deferred.await(resume);
          yield* control.admit(Ref.update(calls, (n) => n + 1));
        }),
      )
      .pipe(Effect.exit, Effect.forkChild);
    yield* Deferred.await(ready);
    yield* control.setEnabled(false);
    yield* control.setEnabled(true);
    yield* Deferred.succeed(resume, undefined);
    assert.isTrue(Exit.isFailure(yield* Fiber.join(pending)));
    assert.equal(yield* Ref.get(calls), 0);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("server kill switch refuses enable and does not alter persisted opt-in", () =>
  Effect.gen(function* () {
    const control = yield* Control.FactoryControl;
    yield* control.setEnabled(true);
    yield* Effect.gen(function* () {
      const forced = yield* Control.FactoryControl;
      assert.isFalse((yield* forced.status).enabled);
      assert.isTrue((yield* forced.status).forcedOff);
      assert.isTrue(Exit.isFailure(yield* forced.setEnabled(true).pipe(Effect.exit)));
    }).pipe(
      Effect.provide(Layer.fresh(Control.layer)),
      Effect.provideService(HostProcess.Environment, { T3CODE_FACTORY_DISABLED: "1" }),
    );
    assert.isTrue((yield* control.status).enabled);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("disable withdraws unexecuted action consent while retaining decision history", () =>
  Effect.gen(function* () {
    const store = yield* Store.FactoryStore;
    const control = yield* Control.FactoryControl;
    yield* control.setEnabled(true);
    const card: FactoryCard = {
      ...record,
      id: "approval",
      authorId: "worker",
      ownerId: "worker",
      revision: 1,
      state: "answered",
      outcome: "CHOSE",
      optionId: "A",
      note: "Approved",
      answeredAt: 1,
      body: {
        title: "Post update",
        kind: "decision",
        blocking: true,
        urgency: "now",
        context: { doing: "Work", whyNotMe: "Consent", costOfWaiting: "Wait" },
        options: [
          {
            id: "A",
            label: "Post",
            recommended: true,
            nextStep: "Post",
            cost: "None",
            reversibility: "irreversible",
            consequences: "External post",
          },
        ],
        rationale: "Work",
        caveats: [],
        links: [],
        action: { optionId: "A", payloadSha256: "hash" },
      },
    };
    yield* store.transaction(
      Effect.gen(function* () {
        yield* store.put("cards", card);
        yield* store.put("executions", {
          ...record,
          id: "execution",
          cardId: card.id,
          cardRevision: 1,
          optionId: "A",
          payloadSha256: "hash",
          state: "claimed",
          result: "",
        });
      }),
    );
    yield* control.setEnabled(false);
    const retained = yield* store.get("cards", card.id);
    assert.equal(retained?.state, "withdrawn");
    assert.equal(retained?.note, "Approved");
    assert.equal((yield* store.get("executions", "execution"))?.state, "failed");
    yield* control.setEnabled(true);
    assert.equal((yield* store.get("cards", card.id))?.state, "withdrawn");
  }).pipe(Effect.provide(TestLayer)),
);
