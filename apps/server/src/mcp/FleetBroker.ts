import {
  OrchestratorMcpFailure,
  type FleetConnectInput,
  type FleetEnvironment,
  type FleetExecuteInput,
  type FleetInvocation,
  type FleetResponse,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";

interface Lease {
  readonly key: string;
  readonly sessionId: string;
  readonly environments: ReadonlyArray<FleetEnvironment>;
  readonly queue: Queue.Queue<FleetInvocation>;
}
interface Pending {
  readonly lease: Lease;
  readonly result: Deferred.Deferred<unknown, OrchestratorMcpFailure>;
}
interface State {
  readonly leases: ReadonlyMap<string, Lease>;
  readonly pending: ReadonlyMap<string, Pending>;
}
export class FleetBroker extends Context.Service<
  FleetBroker,
  {
    readonly connect: (
      sessionId: string,
      input: FleetConnectInput,
    ) => Effect.Effect<Stream.Stream<FleetInvocation>>;
    readonly environments: Effect.Effect<ReadonlyArray<FleetEnvironment>>;
    readonly invoke: (request: FleetExecuteInput) => Effect.Effect<unknown, OrchestratorMcpFailure>;
    readonly respond: (
      sessionId: string,
      response: FleetResponse,
    ) => Effect.Effect<void, OrchestratorMcpFailure>;
  }
>()("t3/mcp/FleetBroker") {}

const unavailable = (message: string) =>
  new OrchestratorMcpFailure({ code: "orchestration_error", message });
const MAX_PENDING = 64;
const encodeLeaseKey = Schema.encodeSync(
  Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.String])),
);
export const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const state = yield* SynchronizedRef.make<State>({ leases: new Map(), pending: new Map() });
  const disconnect = Effect.fn("FleetBroker.disconnect")(function* (lease: Lease) {
    const interrupted = yield* SynchronizedRef.modify(state, (current) => {
      const leases = new Map(current.leases);
      if (leases.get(lease.key) === lease) leases.delete(lease.key);
      const pending = new Map(current.pending);
      const removed: Array<Pending> = [];
      for (const [id, item] of pending) {
        if (item.lease === lease) {
          removed.push(item);
          pending.delete(id);
        }
      }
      return [removed, { leases, pending }] as const;
    });
    yield* Effect.forEach(
      interrupted,
      (item) =>
        Deferred.fail(
          item.result,
          unavailable(
            "The client connecting these environments disconnected. Delivery may already have been accepted; retry with the same clientRequestId to avoid duplicate work.",
          ),
        ),
      { discard: true },
    );
    yield* Queue.shutdown(lease.queue);
  });
  const acquire = Effect.fn("FleetBroker.acquire")(function* (
    sessionId: string,
    input: FleetConnectInput,
  ) {
    const queue = yield* Queue.bounded<FleetInvocation>(MAX_PENDING);
    const lease: Lease = {
      key: encodeLeaseKey([sessionId, input.clientId]),
      sessionId,
      environments: input.environments,
      queue,
    };
    const previous = yield* SynchronizedRef.modify(state, (current) => {
      const leases = new Map(current.leases);
      const prior = leases.get(lease.key);
      leases.set(lease.key, lease);
      return [prior, { ...current, leases }] as const;
    });
    if (previous) yield* disconnect(previous);
    return lease;
  });
  const connect: FleetBroker["Service"]["connect"] = (sessionId, input) =>
    Effect.succeed(
      Stream.unwrap(
        Effect.acquireRelease(acquire(sessionId, input), disconnect).pipe(
          Effect.map((lease) =>
            Stream.fromQueue(lease.queue).pipe(
              Stream.filterEffect((invocation) =>
                SynchronizedRef.get(state).pipe(
                  Effect.map(
                    (current) => current.pending.get(invocation.requestId)?.lease === lease,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  const environments = SynchronizedRef.get(state).pipe(
    Effect.map((current) => {
      const unique = new Map<string, FleetEnvironment>();
      for (const lease of current.leases.values())
        for (const environment of lease.environments)
          unique.set(environment.environmentId, environment);
      return [...unique.values()].sort(
        (a, b) => a.label.localeCompare(b.label) || a.environmentId.localeCompare(b.environmentId),
      );
    }),
  );
  const invoke = Effect.fn("FleetBroker.invoke")(function* (request: FleetExecuteInput) {
    const requestId = yield* crypto.randomUUIDv4().pipe(Effect.orDie);
    const result = yield* Deferred.make<unknown, OrchestratorMcpFailure>();
    const lease = yield* SynchronizedRef.modify(state, (current) => {
      const target =
        current.pending.size < MAX_PENDING
          ? [...current.leases.values()].find((candidate) =>
              candidate.environments.some(
                (environment) => environment.environmentId === request.environmentId,
              ),
            )
          : undefined;
      if (!target) return [undefined, current] as const;
      const pending = new Map(current.pending);
      pending.set(requestId, { lease: target, result });
      return [target, { ...current, pending }] as const;
    });
    if (!lease)
      return yield* unavailable(
        `No available client route to environment '${request.environmentId}'. Connect a fleet-capable client to both environments, or retry when pending requests finish.`,
      );
    return yield* Effect.gen(function* () {
      const offered = yield* Queue.offer(lease.queue, { requestId, request });
      if (!offered) return yield* unavailable("The fleet connection closed before dispatch.");
      return yield* Deferred.await(result);
    }).pipe(
      Effect.timeoutOrElse({
        duration: "125 seconds",
        orElse: () =>
          Effect.fail(
            unavailable(
              "Fleet delivery timed out. The destination may have accepted the work; retry with the same clientRequestId. A timeout does not cancel destination work.",
            ),
          ),
      }),
      Effect.ensuring(
        SynchronizedRef.update(state, (current) => {
          const pending = new Map(current.pending);
          pending.delete(requestId);
          return { ...current, pending };
        }),
      ),
    );
  });
  const respond = Effect.fn("FleetBroker.respond")(function* (
    sessionId: string,
    response: FleetResponse,
  ) {
    const pending = yield* SynchronizedRef.get(state).pipe(
      Effect.map((current) => current.pending.get(response.requestId)),
    );
    // A late response after cancellation/reconnect has no receiver and must not revive the request.
    if (!pending) return;
    if (pending.lease.sessionId !== sessionId)
      return yield* unavailable("Fleet response belongs to another client session.");
    if (response.result.ok) yield* Deferred.succeed(pending.result, response.result.value);
    else yield* Deferred.fail(pending.result, response.result.error);
  });
  return { connect, environments, invoke, respond } satisfies FleetBroker["Service"];
});
export const layer = Layer.effect(FleetBroker, make);
