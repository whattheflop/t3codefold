import { enabledControl } from "./testControl.ts";
import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  type FactoryAgent,
  type FactoryCardBody,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as Store from "./FactoryStore.ts";
import * as Queue from "./WakeQueue.ts";
import * as Decisions from "./FactoryDecisions.ts";

const persistence = Queue.layer.pipe(
  Layer.provideMerge(enabledControl),
  Layer.provideMerge(Store.layer),
  Layer.provideMerge(Sqlite.layerMemory),
);
const TestLayer = Decisions.layer.pipe(
  Layer.provideMerge(persistence),
  Layer.provide(NodeCrypto.layer),
);
const owner: FactoryAgent = {
  id: "owner",
  version: 0,
  createdAt: 1,
  updatedAt: 1,
  environmentId: EnvironmentId.make("test"),
  projectId: ProjectId.make("project"),
  threadId: ThreadId.make("thread"),
  role: "worker",
  parentId: null,
  generation: 1,
  lifecycle: "active",
  capsule: "Work",
  capsuleRevision: 1,
  needs: null,
  next: "",
};
const actor = { kind: "agent", threadId: owner.threadId } as const;
const body: FactoryCardBody = {
  title: "Choose next step",
  kind: "decision",
  blocking: true,
  urgency: "now",
  context: {
    doing: "Prepare a change",
    whyNotMe: "User owns the tradeoff",
    costOfWaiting: "Work is held",
  },
  options: ["A", "B"].map((id) => ({
    id,
    label: id,
    recommended: id === "A",
    nextStep: "Continue",
    cost: "None",
    reversibility: "reversible",
    consequences: "Proceed",
  })),
  rationale: "Two approaches",
  caveats: [],
  links: [{ kind: "spec", ref: "spec:test" }],
};

it.layer(TestLayer)("Factory decisions", (it) => {
  it.effect("answers atomically once, refuses agent consent and stale revisions", () =>
    Effect.gen(function* () {
      const store = yield* Store.FactoryStore;
      const decisions = yield* Decisions.FactoryDecisions;
      yield* store.transaction(store.put("agents", owner));
      const card = yield* decisions.file(actor, { id: "choice", body });
      assert.isTrue(
        Exit.isFailure(
          yield* decisions
            .answer(actor, { cardId: card.id, revision: card.revision, optionId: "A" })
            .pipe(Effect.exit),
        ),
      );
      assert.isTrue(
        Exit.isFailure(
          yield* decisions
            .answer(
              { kind: "user" },
              { cardId: card.id, revision: card.revision + 1, optionId: "A" },
            )
            .pipe(Effect.exit),
        ),
      );
      assert.lengthOf(yield* store.list("wakes"), 0);
      const answered = yield* decisions.answer(
        { kind: "user" },
        { cardId: card.id, revision: card.revision, optionId: "B", note: "Take B" },
      );
      assert.equal(answered.outcome, "CHOSE-against");
      assert.isTrue(
        Exit.isFailure(
          yield* decisions
            .answer({ kind: "user" }, { cardId: card.id, revision: card.revision, yourCall: true })
            .pipe(Effect.exit),
        ),
      );
      const wakes = yield* store.list("wakes");
      assert.lengthOf(wakes, 1);
      assert.include(wakes[0]!.text, "Take B");
    }),
  );

  it.effect("withdraws an answered card, revokes its wake and clears stale attention", () =>
    Effect.gen(function* () {
      const store = yield* Store.FactoryStore;
      const decisions = yield* Decisions.FactoryDecisions;
      const card = yield* decisions.file(actor, { id: "withdraw-choice", body });
      const agent = (yield* store.get("agents", owner.id))!;
      yield* store.transaction(store.put("agents", { ...agent, needs: card.id }));
      yield* decisions.answer(
        { kind: "user" },
        { cardId: card.id, revision: card.revision, yourCall: true },
      );
      const withdrawn = yield* decisions.withdraw(actor, card.id);
      assert.equal(withdrawn.state, "withdrawn");
      assert.equal(
        (yield* store.get("wakes", `answer:${card.id}:${card.revision}`))?.state,
        "cancelled",
      );
      assert.isNull((yield* store.get("agents", owner.id))?.needs);
    }),
  );
});
