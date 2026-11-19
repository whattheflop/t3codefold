import { enabledControl } from "./testControl.ts";
import {
  CommandId,
  MessageId,
  ThreadId,
  type FactoryDelivery,
  type FactoryWake,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as FactoryStore from "./FactoryStore.ts";
import { acceptFactoryDelivery } from "./deliveryFence.ts";

const TestLayer = enabledControl.pipe(
  Layer.provideMerge(FactoryStore.layer),
  Layer.provideMerge(Sqlite.layerMemory),
);
const threadId = ThreadId.make("target-thread");
const wake = (id: string, sourceId: string): FactoryWake => ({
  id,
  targetId: "target",
  version: 0,
  createdAt: 1,
  updatedAt: 1,
  routingEpoch: 1,
  sourceId,
  sourceEpoch: 1,
  refKind: "watch",
  refId: sourceId,
  text: id,
  state: "queued",
  holdReason: null,
  attempts: 0,
  nextAttemptAt: 1,
  deferUntil: null,
  deliveryId: `claim-${id}`,
});
const claim = (wakes: ReadonlyArray<FactoryWake>, id = wakes[0]!.deliveryId!): FactoryDelivery => ({
  id,
  targetId: "target",
  threadId,
  version: 0,
  createdAt: 1,
  updatedAt: 1,
  routingEpoch: 1,
  sourceId: wakes[0]!.sourceId,
  sourceEpoch: 1,
  wakeIds: wakes.map((w) => w.id),
  attempt: 1,
  text: "[factory] notice",
  commandId: `cmd-${id}`,
  messageId: `msg-${id}`,
  state: "claimed",
});

it.layer(TestLayer)("Factory delivery fence", (it) => {
  it.effect("revoking A cannot commit A or prevent independent B acceptance", () =>
    Effect.gen(function* () {
      const store = yield* FactoryStore.FactoryStore;
      const a = wake("a", "source-a"),
        b = wake("b", "source-b");
      const ca = claim([a]),
        cb = claim([b]);
      yield* store.transaction(
        Effect.gen(function* () {
          for (const id of ["source-a", "source-b"])
            yield* store.put("sources", {
              id,
              version: 0,
              createdAt: 1,
              updatedAt: 1,
              epoch: 1,
              state: "active",
            });
          yield* store.put("wakes", a);
          yield* store.put("wakes", b);
          yield* store.put("deliveries", ca);
          yield* store.put("deliveries", cb);
          const source = (yield* store.get("sources", "source-a"))!;
          yield* store.put("sources", { ...source, epoch: 2, state: "revoked" });
        }),
      );
      const accept = (c: FactoryDelivery) =>
        acceptFactoryDelivery({
          commandId: CommandId.make(c.commandId),
          threadId,
          delivery: {
            deliveryId: c.id,
            routingEpoch: 1,
            sourceId: c.sourceId,
            sourceEpoch: 1,
            messageId: MessageId.make(c.messageId),
            text: c.text,
          },
        });
      const sql = yield* SqlClient.SqlClient;
      assert.isTrue(Exit.isFailure(yield* sql.withTransaction(accept(ca)).pipe(Effect.exit)));
      yield* sql.withTransaction(accept(cb));
      assert.equal((yield* store.get("wakes", "a"))?.attempts, 0);
      assert.equal((yield* store.get("wakes", "b"))?.attempts, 1);
      assert.equal((yield* store.get("deliveries", cb.id))?.state, "accepted");
      assert.isTrue(Exit.isFailure(yield* sql.withTransaction(accept(cb)).pipe(Effect.exit)));
      assert.equal((yield* store.get("wakes", "b"))?.attempts, 1);
    }),
  );

  it.effect("rejects a mixed-source batch and rolls back earlier member updates", () =>
    Effect.gen(function* () {
      const store = yield* FactoryStore.FactoryStore;
      const a = wake("mixed-a", "mixed-source-a"),
        b = { ...wake("mixed-b", "mixed-source-b"), deliveryId: "claim-mixed-a" };
      const c = claim([a, b]);
      yield* store.transaction(
        Effect.gen(function* () {
          for (const id of [a.sourceId, b.sourceId])
            yield* store.put("sources", {
              id,
              version: 0,
              createdAt: 1,
              updatedAt: 1,
              epoch: 1,
              state: "active",
            });
          yield* store.put("wakes", a);
          yield* store.put("wakes", b);
          yield* store.put("deliveries", c);
        }),
      );
      const sql = yield* SqlClient.SqlClient;
      const result = yield* sql
        .withTransaction(
          acceptFactoryDelivery({
            commandId: CommandId.make(c.commandId),
            threadId,
            delivery: {
              deliveryId: c.id,
              routingEpoch: 1,
              sourceId: c.sourceId,
              sourceEpoch: 1,
              messageId: MessageId.make(c.messageId),
              text: c.text,
            },
          }),
        )
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(result));
      assert.equal((yield* store.get("wakes", a.id))?.attempts, 0);
      assert.equal((yield* store.get("deliveries", c.id))?.state, "claimed");
    }),
  );
});
