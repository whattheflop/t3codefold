import { FactoryError, type FactoryWake } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as DateTime from "effect/DateTime";
import { FactoryStore } from "./FactoryStore.ts";

// The caller holds the same transaction as the member mutation and acceptance fence.
export const cancelPendingClaim = Effect.fn("WakeQueue.cancelPendingClaim")(function* (
  store: FactoryStore["Service"],
  id: string | null,
  now: number,
) {
  if (!id) return;
  const claim = yield* store.get("deliveries", id);
  if (claim?.state !== "claimed") return;
  yield* store.put("deliveries", { ...claim, state: "cancelled", updatedAt: now });
  for (const memberId of claim.wakeIds) {
    const member = yield* store.get("wakes", memberId);
    if (member?.deliveryId === id)
      yield* store.put("wakes", { ...member, deliveryId: null, updatedAt: now });
  }
});

export class WakeQueue extends Context.Service<
  WakeQueue,
  {
    /** Joins the caller's FactoryStore transaction. */
    readonly enqueue: (input: {
      readonly id: string;
      readonly targetId: string;
      readonly text: string;
      readonly refKind: string;
      readonly refId: string;
      readonly sourceId?: string;
    }) => Effect.Effect<FactoryWake, FactoryError>;
    readonly revokeSource: (sourceId: string) => Effect.Effect<void, FactoryError>;
  }
>()("t3/factory/WakeQueue") {}

const make = Effect.gen(function* () {
  const store = yield* FactoryStore;
  const enqueue: WakeQueue["Service"]["enqueue"] = Effect.fn("WakeQueue.enqueue")(
    function* (input) {
      const existing = yield* store.get("wakes", input.id);
      if (existing) return existing;
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      const sourceId = input.sourceId ?? `${input.refKind}:${input.refId}`;
      let source = yield* store.get("sources", sourceId);
      if (!source)
        source = yield* store.put("sources", {
          id: sourceId,
          version: 0,
          createdAt: now,
          updatedAt: now,
          epoch: 1,
          state: "active",
        });
      if (source.state === "revoked")
        return yield* new FactoryError({ code: "conflict", entityId: sourceId });
      return yield* store.put("wakes", {
        ...input,
        sourceId,
        sourceEpoch: source.epoch,
        version: 0,
        createdAt: now,
        updatedAt: now,
        routingEpoch: 1,
        state: "queued",
        holdReason: null,
        attempts: 0,
        nextAttemptAt: now,
        deferUntil: null,
        deliveryId: null,
      });
    },
  );
  const revokeSource = Effect.fn("WakeQueue.revokeSource")(function* (sourceId: string) {
    const source = yield* store.get("sources", sourceId);
    if (!source) return;
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    yield* store.put("sources", {
      ...source,
      updatedAt: now,
      epoch: source.epoch + 1,
      state: "revoked",
    });
    for (const claim of yield* store.list("deliveries")) {
      if (claim.sourceId === sourceId) yield* cancelPendingClaim(store, claim.id, now);
    }
    for (const wake of yield* store.list("wakes")) {
      if (wake.sourceId === sourceId && !["acked", "cancelled"].includes(wake.state))
        yield* store.put("wakes", { ...wake, state: "cancelled", updatedAt: now });
    }
  });
  return WakeQueue.of({ enqueue, revokeSource });
});
export const layer = Layer.effect(WakeQueue, make);
