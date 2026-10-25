import {
  type EnvironmentId,
  type FleetEnvironment,
  type FleetExecuteInput,
  type FleetInvocation,
  type FleetResponse,
  OrchestratorMcpFailure,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { request } from "../rpc/client.ts";
import type { ConnectionCatalogEntry } from "./catalog.ts";
import * as EnvironmentRegistry from "./registry.ts";
import * as EnvironmentSupervisor from "./supervisor.ts";

const isOrchestratorMcpFailure = Schema.is(OrchestratorMcpFailure);

/** A failed reply never replays the target mutation. Its native request ID owns retry identity. */
export function relayFleetInvocations<E, ExecuteError, RespondError, R>(
  invocations: Stream.Stream<FleetInvocation, E, R>,
  execute: (input: FleetExecuteInput) => Effect.Effect<unknown, ExecuteError, R>,
  respond: (response: FleetResponse) => Effect.Effect<unknown, RespondError, R>,
) {
  const relay = (invocation: FleetInvocation) =>
    execute(invocation.request).pipe(
      Effect.match({
        onSuccess: (value): FleetResponse => ({
          requestId: invocation.requestId,
          result: { ok: true, value },
        }),
        onFailure: (error): FleetResponse => ({
          requestId: invocation.requestId,
          result: {
            ok: false,
            error: isOrchestratorMcpFailure(error)
              ? error
              : new OrchestratorMcpFailure({
                  code: "orchestration_error",
                  message:
                    "The destination connection failed. The operation may have been accepted; retry with the same clientRequestId.",
                }),
          },
        }),
      }),
      Effect.flatMap(respond),
    );
  return Effect.scoped(
    Effect.gen(function* () {
      // Match the broker's pending bound so waits never block the partition reader.
      const [waits, ordinary] = yield* Stream.partition(
        invocations,
        (invocation) =>
          invocation.request.operation === "t3_thread_wait"
            ? Result.succeed(invocation)
            : Result.fail(invocation),
        { capacity: 64 },
      );
      yield* Effect.all(
        [
          ordinary.pipe(
            Stream.mapEffect(relay, { concurrency: 8, unordered: true }),
            Stream.runDrain,
          ),
          waits.pipe(Stream.mapEffect(relay, { concurrency: 4, unordered: true }), Stream.runDrain),
        ],
        { concurrency: 2, discard: true },
      );
    }),
  );
}

/** Descriptor changes retire the source lease and cancel only its in-flight proxy work. */
export function connectFleetLease<E, ExecuteError, RespondError, R>(options: {
  readonly supported: boolean;
  readonly descriptors: SubscriptionRef.SubscriptionRef<ReadonlyArray<FleetEnvironment>>;
  readonly connect: (
    environments: ReadonlyArray<FleetEnvironment>,
  ) => Stream.Stream<FleetInvocation, E, R>;
  readonly execute: (input: FleetExecuteInput) => Effect.Effect<unknown, ExecuteError, R>;
  readonly respond: (response: FleetResponse) => Effect.Effect<unknown, RespondError, R>;
}) {
  if (!options.supported) return Stream.empty;
  return SubscriptionRef.changes(options.descriptors).pipe(
    Stream.changes,
    Stream.switchMap((environments) =>
      Stream.fromEffect(
        relayFleetInvocations(options.connect(environments), options.execute, options.respond),
      ).pipe(Stream.catchCause(() => Stream.empty)),
    ),
  );
}

/** One foreground client connects existing authenticated environments; no credentials leave it. */
export const startFleetBridge = Effect.gen(function* () {
  const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
  const crypto = yield* Crypto.Crypto;
  const clientId = yield* crypto.randomUUIDv4().pipe(Effect.orDie);
  const descriptors = yield* SubscriptionRef.make<ReadonlyArray<FleetEnvironment>>([]);
  const parentScope = yield* Scope.Scope;
  const children = new Map<
    EnvironmentId,
    { entry: ConnectionCatalogEntry; scope: Scope.Closeable }
  >();

  const advertise = (environment: FleetEnvironment, connected: boolean) =>
    SubscriptionRef.update(descriptors, (current) => {
      const next = current.filter((entry) => entry.environmentId !== environment.environmentId);
      if (connected) next.push(environment);
      next.sort((a, b) => a.environmentId.localeCompare(b.environmentId));
      return JSON.stringify(current) === JSON.stringify(next) ? current : next;
    });

  const watch = (entry: ConnectionCatalogEntry) =>
    registry.run(
      entry.target.environmentId,
      Effect.gen(function* () {
        const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
        const environment: FleetEnvironment = {
          environmentId: entry.target.environmentId,
          label: entry.target.label,
        };
        return yield* SubscriptionRef.changes(supervisor.session).pipe(
          Stream.switchMap((sessionOption) =>
            Option.match(sessionOption, {
              onNone: () => Stream.fromEffect(advertise(environment, false)).pipe(Stream.drain),
              onSome: (session) =>
                Stream.unwrap(
                  Effect.gen(function* () {
                    const config = yield* session.initialConfig;
                    if (config.environment.capabilities.fleetOrchestration !== true)
                      return Stream.empty;
                    yield* advertise(environment, true);
                    return connectFleetLease({
                      supported: true,
                      descriptors,
                      connect: (environments) =>
                        session.client[WS_METHODS.fleetConnect]({ clientId, environments }),
                      execute: (input) =>
                        Effect.gen(function* () {
                          const available = yield* SubscriptionRef.get(descriptors);
                          if (
                            !available.some(
                              (target) => target.environmentId === input.environmentId,
                            )
                          ) {
                            return yield* new OrchestratorMcpFailure({
                              code: "orchestration_error",
                              message:
                                "The destination environment is no longer connected to this client.",
                            });
                          }
                          return yield* registry.run(
                            input.environmentId,
                            request(WS_METHODS.fleetExecute, input),
                          );
                        }),
                      // Bind replies to the lease's original authenticated session, including during reconnect.
                      respond: (response) => session.client[WS_METHODS.fleetRespond](response),
                    }).pipe(Stream.ensuring(advertise(environment, false)));
                  }),
                ).pipe(Stream.catchCause(() => Stream.empty)),
            }),
          ),
          Stream.runDrain,
          Effect.ensuring(advertise(environment, false)),
        );
      }),
    );

  yield* SubscriptionRef.changes(registry.entries).pipe(
    Stream.runForEach((entries) =>
      Effect.gen(function* () {
        for (const [id, child] of children) {
          if (!Equal.equals(entries.get(id), child.entry)) {
            yield* Scope.close(child.scope, Exit.void);
            children.delete(id);
          }
        }
        for (const [id, entry] of entries) {
          if (children.has(id)) continue;
          const scope = yield* Scope.fork(parentScope);
          children.set(id, { entry, scope });
          yield* watch(entry).pipe(Effect.forkIn(scope));
        }
      }),
    ),
    Effect.forkScoped,
  );
});
