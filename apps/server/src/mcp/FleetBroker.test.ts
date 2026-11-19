import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { EnvironmentId, ThreadId, type FleetExecuteInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import * as Stream from "effect/Stream";
import { expect } from "vite-plus/test";
import { make } from "./FleetBroker.ts";

const NodeLayer = Layer.mergeAll(NodeServices.layer, NodeCrypto.layer);

const source = EnvironmentId.make("source");
const target = EnvironmentId.make("target");
const other = EnvironmentId.make("other");
const request: FleetExecuteInput = {
  source: { environmentId: source, threadId: ThreadId.make("source-thread") },
  environmentId: target,
  operation: "t3_thread_start",
  input: { prompt: "continue", clientRequestId: "stable" },
};
const connect = Effect.fn(function* (
  broker: Effect.Success<typeof make>,
  session = "session",
  clientId = "client",
  environmentId = target,
) {
  const scope = yield* Scope.make();
  yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
  const stream = yield* broker.connect(session, {
    clientId,
    environments: [{ environmentId, label: "Host" }],
  });
  const pull = yield* Stream.toPull(stream).pipe(Effect.provideService(Scope.Scope, scope));
  const firstPull = yield* pull.pipe(
    Effect.forkScoped({ startImmediately: true }),
    Effect.provideService(Scope.Scope, scope),
  );
  return { scope, pull: Fiber.join(firstPull) };
});

it.effect("routes an exact destination and rejects unavailable hosts without fallback", () =>
  Effect.gen(function* () {
    const broker = yield* make;
    const route = yield* connect(broker);
    expect(yield* broker.environments).toEqual([{ environmentId: target, label: "Host" }]);
    const missing = yield* Effect.result(broker.invoke({ ...request, environmentId: other }));
    expect(missing._tag === "Failure" && missing.failure.message).toContain(
      "No available client route",
    );
    const pending = yield* broker.invoke(request).pipe(Effect.forkScoped);
    const [invocation] = yield* route.pull;
    expect(invocation.request).toEqual(request);
    yield* broker.respond("session", {
      requestId: invocation.requestId,
      result: { ok: true, value: { threadId: "created" } },
    });
    expect(yield* Fiber.join(pending)).toEqual({ threadId: "created" });
  }).pipe(Effect.provide(NodeLayer)),
);

it.effect("rejects replies from another session without completing the legitimate request", () =>
  Effect.gen(function* () {
    const broker = yield* make;
    const route = yield* connect(broker);
    const pending = yield* broker.invoke(request).pipe(Effect.forkScoped);
    const [invocation] = yield* route.pull;
    const reply = {
      requestId: invocation.requestId,
      result: { ok: true as const, value: "correct" },
    };
    const rejected = yield* Effect.result(broker.respond("wrong-session", reply));
    expect(rejected._tag === "Failure" && rejected.failure.message).toContain(
      "another client session",
    );
    yield* broker.respond("session", reply);
    expect(yield* Fiber.join(pending)).toBe("correct");
  }).pipe(Effect.provide(NodeLayer)),
);

it.effect("disconnect fails pending work, removes route, and ignores late responses", () =>
  Effect.gen(function* () {
    const broker = yield* make;
    const route = yield* connect(broker);
    const pending = yield* Effect.result(broker.invoke(request)).pipe(Effect.forkScoped);
    const [invocation] = yield* route.pull;
    yield* Scope.close(route.scope, Exit.void);
    const result = yield* Fiber.join(pending);
    expect(result._tag === "Failure" && result.failure.message).toContain("disconnected");
    expect(yield* broker.environments).toEqual([]);
    yield* broker.respond("session", {
      requestId: invocation.requestId,
      result: { ok: true, value: "late" },
    });
    const retry = yield* Effect.result(broker.invoke(request));
    expect(retry._tag).toBe("Failure");
  }).pipe(Effect.provide(NodeLayer)),
);

it.effect(
  "replacement fails old pending work and never replays it onto the new client stream",
  () =>
    Effect.gen(function* () {
      const broker = yield* make;
      const oldRoute = yield* connect(broker);
      const oldPending = yield* Effect.result(broker.invoke(request)).pipe(Effect.forkScoped);
      const [oldInvocation] = yield* oldRoute.pull;
      const newRoute = yield* connect(broker);
      const failed = yield* Fiber.join(oldPending);
      expect(failed._tag === "Failure" && failed.failure.message).toContain("disconnected");
      yield* Scope.close(oldRoute.scope, Exit.void);
      expect(yield* broker.environments).toHaveLength(1);
      const retriedRequest = {
        ...request,
        input: { prompt: "explicit retry", clientRequestId: "stable" },
      };
      const newPending = yield* broker.invoke(retriedRequest).pipe(Effect.forkScoped);
      const [newInvocation] = yield* newRoute.pull;
      expect(newInvocation.request).toEqual(retriedRequest);
      expect(newInvocation.requestId).not.toBe(oldInvocation.requestId);
      yield* broker.respond("session", {
        requestId: oldInvocation.requestId,
        result: { ok: true, value: "stale" },
      });
      yield* broker.respond("session", {
        requestId: newInvocation.requestId,
        result: { ok: true, value: "retried" },
      });
      expect(yield* Fiber.join(newPending)).toBe("retried");
    }).pipe(Effect.provide(NodeLayer)),
);

it.effect("times out enqueueing behind stale queued requests instead of hanging forever", () =>
  Effect.gen(function* () {
    const broker = yield* make;
    const route = yield* connect(broker);
    const seed = yield* broker.invoke(request).pipe(Effect.forkScoped({ startImmediately: true }));
    yield* route.pull;
    yield* Fiber.interrupt(seed);
    const stalled = yield* Effect.forEach(Array.from({ length: 64 }), () =>
      Effect.result(broker.invoke(request)).pipe(Effect.forkScoped({ startImmediately: true })),
    );
    yield* TestClock.adjust("125 seconds");
    yield* Effect.forEach(stalled, (fiber) => Fiber.join(fiber));
    const queued = yield* Effect.result(broker.invoke(request)).pipe(
      Effect.forkScoped({ startImmediately: true }),
    );
    yield* TestClock.adjust("125 seconds");
    const result = yield* Fiber.join(queued);
    expect(result._tag === "Failure" && result.failure.message).toContain("timed out");
  }).pipe(Effect.provide(NodeLayer)),
);
