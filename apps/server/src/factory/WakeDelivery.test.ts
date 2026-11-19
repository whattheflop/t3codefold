import { enabledControl } from "./testControl.ts";
import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  type FactoryAgent,
  type FactoryDelivery,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Sqlite from "../persistence/Sqlite.ts";
import { BackgroundPolicy } from "../background/BackgroundPolicy.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import * as Store from "./FactoryStore.ts";
import * as Queue from "./WakeQueue.ts";
import * as Delivery from "./WakeDelivery.ts";

const persistence = Queue.layer.pipe(
  Layer.provideMerge(enabledControl),
  Layer.provideMerge(Store.layer),
  Layer.provideMerge(Sqlite.layerMemory),
);
const TestLayer = Delivery.layer.pipe(
  Layer.provideMerge(persistence),
  Layer.provide(NodeCrypto.layer),
  Layer.provide(Layer.mock(ThreadManagementService, {})),
  Layer.provide(Layer.mock(BackgroundPolicy, {})),
);
const agent: FactoryAgent = {
  id: "target",
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
const claim: FactoryDelivery = {
  id: "claim",
  version: 0,
  createdAt: 1,
  updatedAt: 1,
  targetId: agent.id,
  threadId: agent.threadId,
  sourceId: "source",
  sourceEpoch: 1,
  routingEpoch: 1,
  wakeIds: ["a", "b"],
  attempt: 2,
  text: "a+b",
  commandId: "cmd",
  messageId: "msg",
  state: "claimed",
};

it.layer(TestLayer)("Factory pending wake recovery", (it) => {
  it.effect("deferring one member cancels an unaccepted batch and preserves its sibling", () =>
    Effect.gen(function* () {
      const store = yield* Store.FactoryStore;
      const queue = yield* Queue.WakeQueue;
      const delivery = yield* Delivery.WakeDelivery;
      yield* store.transaction(
        Effect.gen(function* () {
          yield* store.put("agents", agent);
          for (const id of claim.wakeIds) {
            const wake = yield* queue.enqueue({
              id,
              targetId: agent.id,
              text: id,
              refKind: "check",
              refId: id,
              sourceId: claim.sourceId,
            });
            yield* store.put("wakes", { ...wake, attempts: 1, deliveryId: claim.id });
          }
          yield* store.put("deliveries", claim);
        }),
      );
      yield* delivery.defer({ kind: "user" }, "a", 60_000);
      assert.equal((yield* store.get("deliveries", claim.id))?.state, "cancelled");
      const a = (yield* store.get("wakes", "a"))!;
      const b = (yield* store.get("wakes", "b"))!;
      assert.equal(a.state, "deferred");
      assert.isNull(a.deliveryId);
      assert.equal(b.state, "queued");
      assert.isNull(b.deliveryId);
      assert.equal(b.attempts, 1);
    }),
  );

  it.effect("source revocation cancels its pending claims without consuming attempts", () =>
    Effect.gen(function* () {
      const store = yield* Store.FactoryStore;
      const queue = yield* Queue.WakeQueue;
      yield* store.transaction(
        Effect.gen(function* () {
          for (const id of ["revoke-a", "revoke-b"]) {
            const wake = yield* queue.enqueue({
              id,
              targetId: agent.id,
              text: id,
              refKind: "check",
              refId: id,
              sourceId: "revoked-source",
            });
            yield* store.put("wakes", { ...wake, deliveryId: "revoked-claim" });
          }
          yield* store.put("deliveries", {
            ...claim,
            id: "revoked-claim",
            sourceId: "revoked-source",
            wakeIds: ["revoke-a", "revoke-b"],
          });
          yield* queue.revokeSource("revoked-source");
        }),
      );
      assert.equal((yield* store.get("deliveries", "revoked-claim"))?.state, "cancelled");
      assert.equal((yield* store.get("wakes", "revoke-a"))?.state, "cancelled");
      assert.equal((yield* store.get("wakes", "revoke-b"))?.attempts, 0);
    }),
  );
});
