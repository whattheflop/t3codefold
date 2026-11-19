import type { ProviderSetupError } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import type * as CodexClient from "effect-codex-app-server/client";
import * as CodexErrors from "effect-codex-app-server/errors";

import type { CodexEffectiveRuntime } from "../../provider/CodexManagedRuntime.ts";
import type { ProviderAdapterOpenSessionError } from "@t3tools/provider-core/server/ProviderAdapter";

type Client = CodexClient.CodexAppServerClient["Service"];

interface Connection {
  readonly scope: Scope.Closeable;
  readonly client: Client;
  readonly revision: string;
  /** Completes when rotation replaces this connection, so its exit is not the session's. */
  readonly retired: Deferred.Deferred<void>;
}

function responseThreadId(response: unknown): string | undefined {
  if (typeof response !== "object" || response === null || !("thread" in response)) return;
  const thread = response.thread;
  if (typeof thread !== "object" || thread === null || !("id" in thread)) return;
  return typeof thread.id === "string" ? thread.id : undefined;
}

function payloadRecord(payload: unknown): Record<string, unknown> {
  return typeof payload === "object" && payload !== null ? { ...payload } : {};
}

// Token rotation respawns idle managed clients and replays registrations and loaded threads.
// Active turns and voice calls keep their process until the next idle turn start.
export const makeManagedCodexClient = Effect.fn("makeManagedCodexClient")(function* (input: {
  readonly resolve: Effect.Effect<CodexEffectiveRuntime, ProviderSetupError, Scope.Scope>;
  readonly open: (
    runtime: CodexEffectiveRuntime,
  ) => Effect.Effect<Client, ProviderAdapterOpenSessionError, Scope.Scope>;
  readonly onOpenError: (error: ProviderSetupError) => ProviderAdapterOpenSessionError;
  readonly isBusy?: Effect.Effect<boolean>;
}) {
  const sessionScope = yield* Scope.Scope;
  const activeTurns = new Set<string>();
  const trackTurns = (client: Client) =>
    Effect.all(
      [
        client.handleServerNotification("turn/started", (payload) =>
          Effect.sync(() => activeTurns.add(payload.turn.id)),
        ),
        client.handleServerNotification("turn/completed", (payload) =>
          Effect.sync(() => activeTurns.delete(payload.turn.id)),
        ),
      ],
      { discard: true },
    );
  const resolveIn = (scope: Scope.Closeable) =>
    input.resolve.pipe(
      Effect.mapError(input.onOpenError),
      Effect.provideService(Scope.Scope, scope),
      Effect.onError(() => Scope.close(scope, Exit.void)),
    );
  const openIn = Effect.fn("CodexManagedClient.openIn")(
    function* (scope: Scope.Closeable, runtime: CodexEffectiveRuntime) {
      const client = yield* input.open(runtime);
      yield* trackTurns(client);
      const retired = yield* Deferred.make<void>();
      return { scope, client, revision: runtime.revision, retired } satisfies Connection;
    },
    (effect, scope) =>
      effect.pipe(
        Effect.provideService(Scope.Scope, scope),
        Effect.onError(() => Scope.close(scope, Exit.void)),
      ),
  );
  const connect = Effect.gen(function* () {
    const scope = yield* Scope.fork(sessionScope, "sequential");
    return yield* openIn(scope, yield* resolveIn(scope));
  });

  let current = yield* connect;
  const registrations: Array<(client: Client) => Effect.Effect<void>> = [];
  const initialization: Array<
    (client: Client) => Effect.Effect<unknown, CodexErrors.CodexAppServerError>
  > = [];
  const loadedThreads = new Map<string, Record<string, unknown>>();
  const rotation = yield* Semaphore.make(1);

  const register = (registration: (client: Client) => Effect.Effect<void>) => {
    registrations.push(registration);
    return registration(current.client);
  };

  const rotateIfStale = rotation
    .withPermit(
      Effect.gen(function* () {
        if (activeTurns.size > 0) return;
        if (input.isBusy !== undefined && (yield* input.isBusy)) return;
        const scope = yield* Scope.fork(sessionScope, "sequential");
        const runtime = yield* resolveIn(scope);
        if (runtime.revision === current.revision) {
          yield* Scope.close(scope, Exit.void);
          return;
        }
        const next = yield* openIn(scope, runtime);
        const previous = current;
        current = next;
        yield* Deferred.succeed(previous.retired, undefined);
        yield* Scope.close(previous.scope, Exit.void);
        for (const registration of registrations) yield* registration(next.client);
        for (const step of initialization) yield* step(next.client);
        for (const [threadId, params] of loadedThreads) {
          yield* next.client.raw
            .request("thread/resume", { ...params, threadId, excludeTurns: true })
            .pipe(
              Effect.catch((cause) =>
                Effect.logWarning("Managed Codex could not resume a thread after token rotation", {
                  threadId,
                  cause,
                }),
              ),
            );
        }
      }),
    )
    .pipe(
      Effect.catchTags({
        ProviderAdapterOpenSessionError: (error) =>
          Effect.fail(
            new CodexErrors.CodexAppServerRequestError({
              code: -32000,
              errorMessage:
                typeof error.cause === "object" &&
                error.cause !== null &&
                "detail" in error.cause &&
                typeof error.cause.detail === "string"
                  ? error.cause.detail
                  : "Could not restart managed Codex.",
              method: "turn/start",
            }),
          ),
      }),
    );

  const request: Client["request"] = Effect.fn("request")(function* (method, payload) {
    if (method === "turn/start") yield* rotateIfStale;
    const response = yield* current.client.request(method, payload);
    if (method === "initialize") {
      initialization.push((client) => client.request(method, payload));
    } else if (method === "thread/start" || method === "thread/fork") {
      const threadId = responseThreadId(response);
      if (threadId !== undefined) {
        loadedThreads.set(threadId, method === "thread/start" ? payloadRecord(payload) : {});
      }
    } else if (method === "thread/unsubscribe") {
      loadedThreads.delete((payload as { readonly threadId: string }).threadId);
    } else if (method === "turn/start") {
      const turnId = (response as { readonly turn?: { readonly id?: unknown } }).turn?.id;
      if (typeof turnId === "string") activeTurns.add(turnId);
    }
    return response;
  });

  // The session ends when its current process does; a process rotated away ends quietly.
  const awaitTermination: Client["awaitTermination"] = Effect.suspend(() => {
    const connection = current;
    return Effect.raceFirst(
      connection.client.awaitTermination,
      Deferred.await(connection.retired).pipe(Effect.andThen(awaitTermination)),
    );
  });

  return {
    awaitTermination,
    raw: {
      get notifications() {
        return current.client.raw.notifications;
      },
      get requests() {
        return current.client.raw.requests;
      },
      request: (method, payload) =>
        current.client.raw.request(method, payload).pipe(
          Effect.tap((response) =>
            Effect.sync(() => {
              if (method !== "thread/resume") return;
              const threadId = responseThreadId(response);
              if (threadId !== undefined) loadedThreads.set(threadId, payloadRecord(payload));
            }),
          ),
        ),
      notify: (method, payload) => current.client.raw.notify(method, payload),
      respond: (...args) => current.client.raw.respond(...args),
      respondError: (...args) => current.client.raw.respondError(...args),
    },
    request,
    notify: (method, payload) =>
      current.client.notify(method, payload).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            if (method === "initialized") {
              initialization.push((client) => client.notify(method, payload));
            }
          }),
        ),
      ),
    handleServerRequest: (method, handler) =>
      register((client) => client.handleServerRequest(method, handler)),
    handleServerNotification: (method, handler) =>
      register((client) => client.handleServerNotification(method, handler)),
    handleUnknownServerRequest: (handler) =>
      register((client) => client.handleUnknownServerRequest(handler)),
    handleUnknownServerNotification: (handler) =>
      register((client) => client.handleUnknownServerNotification(handler)),
  } satisfies Client;
});
