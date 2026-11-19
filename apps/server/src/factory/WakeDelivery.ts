import {
  CommandId,
  FactoryError,
  MessageId,
  type FactoryDelivery,
  type FactoryWake,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { FactoryControl } from "./FactoryControl.ts";
import { FactoryStore } from "./FactoryStore.ts";
import { cancelPendingClaim, WakeQueue } from "./WakeQueue.ts";
import { callerAgent, type FactoryActor } from "./access.ts";
import * as BackgroundPolicy from "../background/BackgroundPolicy.ts";
import * as Threads from "../orchestration-v2/ThreadManagementService.ts";

export class WakeDelivery extends Context.Service<
  WakeDelivery,
  {
    readonly drain: Effect.Effect<void, FactoryError>;
    readonly acknowledge: (
      actor: FactoryActor,
      refKind: string,
      refId: string,
    ) => Effect.Effect<void, FactoryError>;
    readonly defer: (
      actor: FactoryActor,
      wakeId: string,
      until: number,
    ) => Effect.Effect<void, FactoryError>;
    readonly retry: (wakeId: string) => Effect.Effect<void, FactoryError>;
  }
>()("t3/factory/WakeDelivery") {}

const make = Effect.gen(function* () {
  const store = yield* FactoryStore;
  const control = yield* FactoryControl;
  const queue = yield* WakeQueue;
  const threads = yield* Threads.ThreadManagementService;
  const background = yield* BackgroundPolicy.BackgroundPolicy;
  const random = yield* SecureRandom.SecureRandom;
  const actorAgent = Effect.fn("WakeDelivery.actorAgent")((actor: FactoryActor) =>
    callerAgent(actor).pipe(Effect.provideService(FactoryStore, store)),
  );

  const send = Effect.fn("WakeDelivery.send")(function* (claim: FactoryDelivery) {
    const target = yield* store.get("agents", claim.targetId);
    if (!target) return;
    const source = yield* store.get("sources", claim.sourceId);
    if (!source || source.epoch !== claim.sourceEpoch || source.state === "revoked") {
      yield* store.transaction(
        Effect.gen(function* () {
          const latest = yield* store.get("deliveries", claim.id);
          if (latest?.state === "claimed")
            yield* store.put("deliveries", {
              ...latest,
              state: "cancelled",
              updatedAt: DateTime.toEpochMillis(yield* DateTime.now),
            });
        }),
      );
      return;
    }
    // EventSink rechecks every member and source epoch atomically with the dispatch receipt.
    yield* control.admit(
      threads
        .sendToThread({
          projectId: target.projectId,
          threadId: claim.threadId,
          commandId: CommandId.make(claim.commandId),
          messageId: MessageId.make(claim.messageId),
          text: claim.text,
          attachments: [],
          mode: "queue",
          createdBy: "system",
          creationSource: "server",
          factoryDelivery: {
            deliveryId: claim.id,
            routingEpoch: claim.routingEpoch,
            sourceId: claim.sourceId,
            sourceEpoch: claim.sourceEpoch,
          },
          notification: {
            source: { kind: "background_task" },
            outcome: "updated",
            summary: "Factory wake",
          },
        })
        .pipe(
          Effect.mapError(
            (cause) => new FactoryError({ code: "unavailable", entityId: claim.id, cause }),
          ),
        ),
    );
  });

  const drain = Effect.gen(function* () {
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    const agents = yield* store.list("agents");
    for (const target of agents.filter(
      (a) => !["closed", "retired", "parked"].includes(a.lifecycle),
    )) {
      const shell = yield* threads
        .getThreadShell(target.threadId)
        .pipe(Effect.mapError((cause) => new FactoryError({ code: "unavailable", cause })));
      const snapshot = yield* background.snapshot;
      const focused = snapshot.leases.some(
        (lease) =>
          lease.visible &&
          lease.focused &&
          lease.recentlyInteracted &&
          lease.scopes.some(
            (scope) => scope.type === "thread" && scope.threadId === target.threadId,
          ),
      );
      const reason =
        !shell || shell.archivedAt !== null
          ? "missing"
          : shell.pendingRuntimeRequest
            ? "blocked"
            : shell.activeRunId
              ? "busy"
              : focused
                ? "focused"
                : null;
      const due = (yield* store.list("wakes")).filter(
        (w) =>
          w.targetId === target.id &&
          ["queued", "held", "delivered", "deferred"].includes(w.state) &&
          w.nextAttemptAt <= now &&
          (w.deferUntil === null || w.deferUntil <= now),
      );
      if (due.length === 0) continue;
      if (reason !== null) {
        yield* store.transaction(
          Effect.gen(function* () {
            for (const candidate of due) {
              const wake = yield* store.get("wakes", candidate.id);
              if (!wake || ["cancelled", "acked"].includes(wake.state)) continue;
              if (wake.state !== "held" || wake.holdReason !== reason)
                yield* store.put("wakes", {
                  ...wake,
                  state: "held",
                  holdReason: reason,
                  updatedAt: now,
                });
            }
          }),
        );
        continue;
      }
      for (const pending of (yield* store.list("deliveries")).filter(
        (d) => d.state === "claimed" && d.targetId === target.id,
      ))
        yield* send(pending);
      const groups = new Map<string, ReadonlyArray<FactoryWake>>();
      for (const wake of due) {
        const key = `${wake.routingEpoch}\0${wake.sourceId}\0${wake.sourceEpoch}`;
        groups.set(key, [...(groups.get(key) ?? []), wake]);
      }
      for (const batch of groups.values()) {
        const uuid = yield* random.uuidV4();
        const claim = yield* store.transaction(
          Effect.gen(function* () {
            const eligible: FactoryWake[] = [];
            for (const candidate of batch) {
              const wake = yield* store.get("wakes", candidate.id);
              if (!wake || ["cancelled", "acked"].includes(wake.state)) continue;
              if (wake.deliveryId) {
                const old = yield* store.get("deliveries", wake.deliveryId);
                if (old?.state === "claimed") continue;
              }
              const source = yield* store.get("sources", wake.sourceId);
              if (!source || source.state === "revoked" || source.epoch !== wake.sourceEpoch) {
                yield* store.put("wakes", { ...wake, state: "cancelled", updatedAt: now });
                continue;
              }
              if (wake.attempts >= 4) {
                yield* store.put("wakes", { ...wake, state: "undelivered", updatedAt: now });
                const parent =
                  agents.find((a) => a.id === target.parentId) ??
                  agents.find((a) => a.role === "commander" && a.lifecycle === "active");
                if (parent && parent.id !== target.id)
                  yield* queue.enqueue({
                    id: `escalate:${wake.id}`,
                    targetId: parent.id,
                    text: `Wake ${wake.id} was not acknowledged by ${target.id}.`,
                    refKind: "undelivered",
                    refId: wake.id,
                  });
                continue;
              }
              eligible.push(wake);
            }
            const first = eligible[0];
            if (!first) return undefined;
            const id = `delivery:${uuid}`;
            const text = `[factory] ${eligible.map((w) => `${w.text}\n(ref ${w.refKind}:${w.refId}: when handled: factory_ack)`).join("\n\n")}`;
            const claim = yield* store.put("deliveries", {
              id,
              version: 0,
              createdAt: now,
              updatedAt: now,
              targetId: target.id,
              threadId: target.threadId,
              routingEpoch: first.routingEpoch,
              sourceId: first.sourceId,
              sourceEpoch: first.sourceEpoch,
              wakeIds: eligible.map((w) => w.id),
              attempt: Math.max(...eligible.map((w) => w.attempts)) + 1,
              text,
              commandId: `factory-wake:${uuid}`,
              messageId: `factory-wake:${uuid}`,
              state: "claimed",
            });
            for (const wake of eligible)
              yield* store.put("wakes", {
                ...wake,
                deliveryId: id,
                state: "queued",
                updatedAt: now,
              });
            return claim;
          }),
        );
        if (claim) yield* send(claim);
      }
    }
  });

  const acknowledge: WakeDelivery["Service"]["acknowledge"] = Effect.fn("WakeDelivery.acknowledge")(
    (actor, refKind, refId) =>
      store.transaction(
        Effect.gen(function* () {
          const owner = yield* actorAgent(actor);
          const now = DateTime.toEpochMillis(yield* DateTime.now);
          const matches = (yield* store.list("wakes")).filter(
            (w) =>
              w.targetId === owner.id &&
              w.refKind === refKind &&
              w.refId === refId &&
              w.state === "delivered",
          );
          if (matches.length === 0)
            return yield* new FactoryError({ code: "not-found", entityId: refId });
          for (const wake of matches)
            yield* store.put("wakes", { ...wake, state: "acked", updatedAt: now });
          if (refKind === "card") {
            const card = yield* store.get("cards", refId);
            if (card?.ownerId === owner.id && card.state === "answered")
              yield* store.put("cards", { ...card, state: "acked", updatedAt: now });
          }
        }),
      ),
  );
  const defer: WakeDelivery["Service"]["defer"] = Effect.fn("WakeDelivery.defer")(
    (actor, id, until) =>
      store.transaction(
        Effect.gen(function* () {
          let wake = yield* store.get("wakes", id);
          if (!wake) return yield* new FactoryError({ code: "not-found", entityId: id });
          if (actor.kind === "agent" && (yield* actorAgent(actor)).id !== wake.targetId)
            return yield* new FactoryError({ code: "forbidden" });
          const now = DateTime.toEpochMillis(yield* DateTime.now);
          if (until <= now) return yield* new FactoryError({ code: "invalid", entityId: id });
          if (["cancelled", "acked"].includes(wake.state))
            return yield* new FactoryError({ code: "conflict", entityId: id });
          yield* cancelPendingClaim(store, wake.deliveryId, now);
          wake = (yield* store.get("wakes", id))!;
          yield* store.put("wakes", {
            ...wake,
            state: "deferred",
            deferUntil: until,
            nextAttemptAt: until,
            attempts: 0,
            updatedAt: now,
          });
        }),
      ),
  );
  const retry = Effect.fn("WakeDelivery.retry")((id: string) =>
    store.transaction(
      Effect.gen(function* () {
        let wake = yield* store.get("wakes", id);
        if (!wake) return yield* new FactoryError({ code: "not-found", entityId: id });
        if (wake.state === "acked" || wake.state === "cancelled")
          return yield* new FactoryError({ code: "conflict", entityId: id });
        const now = DateTime.toEpochMillis(yield* DateTime.now);
        yield* cancelPendingClaim(store, wake.deliveryId, now);
        wake = (yield* store.get("wakes", id))!;
        yield* store.put("wakes", {
          ...wake,
          state: "queued",
          deferUntil: null,
          nextAttemptAt: now,
          attempts: 0,
          updatedAt: now,
        });
      }),
    ),
  );
  return WakeDelivery.of({ drain, acknowledge, defer, retry });
});
export const layer = Layer.effect(WakeDelivery, make);
