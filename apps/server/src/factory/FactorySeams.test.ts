import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  CommandId,
  RunAttemptId,
  EventId,
  ProviderInstanceId,
  type FactoryAgent,
  type FactoryCard,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as Projection from "../orchestration-v2/ProjectionStore.ts";
import { ThreadActivityGuard } from "../orchestration-v2/ThreadActivityGuard.ts";
import { ThreadRetentionGuard } from "../orchestration-v2/ThreadRetentionGuard.ts";
import { TurnPreamble } from "../orchestration-v2/TurnPreamble.ts";
import * as Store from "./FactoryStore.ts";
import * as Control from "./FactoryControl.ts";
import * as Seams from "./FactorySeams.ts";

const TestLayer = Seams.layer.pipe(
  Layer.provide(
    Layer.mock(Projection.ProjectionStoreV2)({
      getThreadRecords: (threadId) => {
        const now = DateTime.makeUnsafe(0);
        const instanceId = ProviderInstanceId.make("test");
        return Effect.succeed(
          Projection.emptyProjection({
            type: "thread.created",
            id: EventId.make("created"),
            threadId,
            occurredAt: now,
            payload: {
              id: threadId,
              projectId: ProjectId.make("factory-project"),
              title: "Factory",
              providerInstanceId: instanceId,
              modelSelection: { instanceId, model: "test" },
              runtimeMode: "full-access",
              interactionMode: "default",
              branch: null,
              worktreePath: null,
              activeProviderThreadId: null,
              lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
              forkedFrom: null,
              createdBy: "user",
              creationSource: "web",
              createdAt: now,
              updatedAt: now,
              archivedAt: null,
              settledOverride: null,
              settledAt: null,
              lastVisitedAt: null,
              deletedAt: null,
            },
          }),
        );
      },
    }),
  ),
  Layer.provideMerge(Control.layer),
  Layer.provideMerge(Store.layer),
  Layer.provideMerge(Sqlite.layerMemory),
);
const agent: FactoryAgent = {
  id: "commander",
  version: 0,
  createdAt: 0,
  updatedAt: 0,
  threadId: ThreadId.make("factory-thread"),
  projectId: ProjectId.make("factory-project"),
  environmentId: EnvironmentId.make("env"),
  role: "commander",
  parentId: null,
  generation: 1,
  lifecycle: "active",
  capsule: "Lead",
  capsuleRevision: 1,
  needs: null,
  next: "Work",
};

it.effect("restores decision evidence, previous answers and child blockers on every turn", () =>
  Effect.gen(function* () {
    const store = yield* Store.FactoryStore;
    const control = yield* Control.FactoryControl;
    const preamble = yield* TurnPreamble;
    const card: FactoryCard = {
      id: "release-decision",
      version: 0,
      createdAt: 0,
      updatedAt: 0,
      authorId: agent.id,
      ownerId: agent.id,
      revision: 1,
      body: {
        title: "Release readiness",
        kind: "decision",
        blocking: true,
        urgency: "today",
        context: {
          doing: "Verify approval recovery",
          whyNotMe: "User owns the release risk",
          costOfWaiting: "Release remains held",
        },
        options: ["A", "B"].map((id) => ({
          id,
          label: id === "A" ? "Fix blockers" : "Carry obligations",
          recommended: id === "A",
          nextStep: id === "A" ? "Repair and recheck" : "Record remaining defects",
          cost: "One hour",
          reversibility: "reversible",
          consequences: "Approval recovery works",
        })),
        rationale: "Recovery currently loses approval state",
        caveats: ["Activation remains disabled"],
        links: [{ kind: "code", ref: "src/approval.ts" }],
      },
      state: "open",
      outcome: null,
      optionId: null,
      note: "",
      answeredAt: null,
    };
    yield* store.transaction(
      Effect.gen(function* () {
        yield* store.put("agents", agent);
        yield* store.put("agents", {
          ...agent,
          id: "unrelated-worker",
          role: "worker",
          threadId: ThreadId.make("unrelated-thread"),
          next: "Unrelated private work",
        });
        yield* store.put("agents", {
          ...agent,
          id: "release-worker",
          threadId: ThreadId.make("worker-thread"),
          role: "worker",
          parentId: agent.id,
          needs: "release-decision",
          next: "Waiting for release direction",
        });
        yield* store.put("cards", card);
        yield* store.put("cards", {
          ...card,
          id: "previous-release",
          state: "answered",
          outcome: "CHOSE-against",
          optionId: "B",
          note: "Keep the scope narrow",
          answeredAt: 1,
        });
      }),
    );
    yield* control.setEnabled(true);
    for (const attempt of ["first", "next"]) {
      const content = yield* preamble.forAttempt(agent.threadId, RunAttemptId.make(attempt));
      assert.isNotNull(content);
      assert.include(content!, "Verify approval recovery");
      assert.include(content!, "src/approval.ts");
      assert.include(content!, "CHOSE-against");
      assert.include(content!, "Carry obligations");
      assert.include(content!, "Keep the scope narrow");
      assert.include(content!, "Waiting for release direction");
      assert.notInclude(content!, "Unrelated private work");
      assert.isAtMost(content!.length, 9000);
    }
    const current = (yield* store.get("agents", agent.id))!;
    yield* store.transaction(store.put("agents", { ...current, next: "Run recovery regression" }));
    const updated = yield* preamble.forAttempt(agent.threadId, RunAttemptId.make("updated"));
    assert.include(updated!, "Run recovery regression");
    const cached = yield* preamble.forAttempt(agent.threadId, RunAttemptId.make("first"));
    assert.notInclude(cached!, "Run recovery regression");
    yield* store.transaction(
      Effect.gen(function* () {
        const latest = (yield* store.get("agents", agent.id))!;
        yield* store.put("agents", { ...latest, capsule: "Mission ".repeat(1000) });
        for (let index = 0; index < 20; index++) {
          yield* store.put("cards", { ...card, id: `extra-${index}` });
        }
      }),
    );
    const crowded = yield* preamble.forAttempt(agent.threadId, RunAttemptId.make("crowded"));
    assert.include(crowded!, "21 total");
    assert.include(crowded!, "Keep the scope narrow");
    assert.isAtMost(crowded!.length, 9000);
    assert.isTrue(crowded!.endsWith("</factory-role>"));
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("disabled Factory blocks its provider work while ordinary threads remain usable", () =>
  Effect.gen(function* () {
    const store = yield* Store.FactoryStore;
    const control = yield* Control.FactoryControl;
    const guard = yield* ThreadActivityGuard;
    const retention = yield* ThreadRetentionGuard;
    yield* store.transaction(store.put("agents", agent));
    const calls = yield* Ref.make(0);
    const providerStart = Ref.update(calls, (n) => n + 1);
    assert.isTrue(Exit.isFailure(yield* guard.check(agent.threadId).pipe(Effect.exit)));
    assert.isTrue(
      Exit.isFailure(yield* guard.admit(agent.threadId, providerStart).pipe(Effect.exit)),
    );
    assert.equal(yield* Ref.get(calls), 0);
    yield* guard.admit(ThreadId.make("ordinary-thread"), providerStart);
    assert.equal(yield* Ref.get(calls), 1);
    yield* retention.check({
      type: "thread.unpin",
      threadId: agent.threadId,
      commandId: CommandId.make("unpin"),
    });
    yield* control.setEnabled(true);
    yield* guard.admit(agent.threadId, providerStart);
    assert.equal(yield* Ref.get(calls), 2);
    assert.isTrue(
      Exit.isFailure(
        yield* retention
          .check({
            type: "thread.unpin",
            threadId: agent.threadId,
            commandId: CommandId.make("unpin-on"),
          })
          .pipe(Effect.exit),
      ),
    );
  }).pipe(Effect.provide(TestLayer)),
);
