import { assert, describe, it } from "@effect/vitest";
import { CodexSettings, ProviderDriverKind, ProviderSessionId } from "@t3tools/contracts";
import type * as CodexClient from "effect-codex-app-server/client";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import { ProviderAdapterOpenSessionError } from "@t3tools/provider-core/server/ProviderAdapter";
import { makeManagedCodexClient } from "./CodexManagedClient.ts";

type Client = CodexClient.CodexAppServerClient["Service"];
type Handler = (payload: unknown) => Effect.Effect<void, never>;

const config = Schema.decodeSync(CodexSettings)({});

function makeFakeCodex(label: string, log: Array<string>) {
  const notificationHandlers = new Map<string, Array<Handler>>();
  let turns = 0;
  const responses: Record<string, () => unknown> = {
    initialize: () => ({}),
    "thread/start": () => ({ thread: { id: "native-thread" } }),
    "turn/start": () => ({ turn: { id: `${label}-turn-${++turns}` } }),
  };
  const client = {
    raw: {
      request: (method: string, payload: { readonly threadId: string }) =>
        Effect.sync(() => {
          log.push(`${label} ${method} ${payload.threadId}`);
          return { thread: { id: payload.threadId } };
        }),
    },
    request: (method: string) =>
      Effect.sync(() => {
        log.push(`${label} ${method}`);
        return responses[method]?.();
      }),
    notify: (method: string) => Effect.sync(() => void log.push(`${label} notify ${method}`)),
    handleServerNotification: (method: string, handler: Handler) =>
      Effect.sync(() => {
        notificationHandlers.set(method, [...(notificationHandlers.get(method) ?? []), handler]);
      }),
    handleServerRequest: () => Effect.void,
    handleUnknownServerRequest: () => Effect.void,
    handleUnknownServerNotification: () => Effect.void,
  } as unknown as Client;
  return {
    client,
    handlerCount: (method: string) => notificationHandlers.get(method)?.length ?? 0,
    emit: (method: string, payload: unknown) =>
      Effect.forEach(notificationHandlers.get(method) ?? [], (handler) => handler(payload), {
        discard: true,
      }),
  };
}

describe("makeManagedCodexClient", () => {
  it.effect("respawns Codex only when an idle turn starts with a rotated token", () =>
    Effect.gen(function* () {
      const token = yield* Ref.make("token-1");
      const log: Array<string> = [];
      const processes: Array<ReturnType<typeof makeFakeCodex>> = [];
      let closedProcesses = 0;
      const client = yield* makeManagedCodexClient({
        resolve: Ref.get(token).pipe(
          Effect.map((revision) => ({ config, environment: {}, revision })),
        ),
        open: () =>
          Effect.gen(function* () {
            const process = makeFakeCodex(`codex-${processes.length}`, log);
            processes.push(process);
            yield* Effect.addFinalizer(() => Effect.sync(() => closedProcesses++));
            return process.client;
          }),
        onOpenError: (cause) =>
          new ProviderAdapterOpenSessionError({
            driver: ProviderDriverKind.make("codex"),
            providerSessionId: ProviderSessionId.make("session"),
            cause,
          }),
      });

      yield* client.handleServerNotification("item/started", () => Effect.void);
      yield* client.request("initialize", {} as never);
      yield* client.notify("initialized", undefined);
      yield* client.request("thread/start", {} as never);
      yield* client.request("turn/start", { threadId: "native-thread" } as never);
      assert.strictEqual(processes.length, 1, "an unchanged token keeps the process");

      yield* Ref.set(token, "token-2");
      yield* client.request("turn/start", { threadId: "native-thread" } as never);
      assert.strictEqual(processes.length, 1, "a running turn keeps the old process");

      yield* processes[0]!.emit("turn/completed", { turn: { id: "codex-0-turn-1" } });
      yield* processes[0]!.emit("turn/completed", { turn: { id: "codex-0-turn-2" } });
      log.length = 0;
      yield* client.request("turn/start", { threadId: "native-thread" } as never);

      assert.strictEqual(processes.length, 2);
      assert.strictEqual(closedProcesses, 1);
      assert.strictEqual(processes[1]!.handlerCount("item/started"), 1);
      assert.deepStrictEqual(log, [
        "codex-1 initialize",
        "codex-1 notify initialized",
        "codex-1 thread/resume native-thread",
        "codex-1 turn/start",
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("keeps the old process while the session reports other busy work", () =>
    Effect.gen(function* () {
      const token = yield* Ref.make("token-1");
      const busy = yield* Ref.make(true);
      const log: Array<string> = [];
      const processes: Array<ReturnType<typeof makeFakeCodex>> = [];
      const client = yield* makeManagedCodexClient({
        resolve: Ref.get(token).pipe(
          Effect.map((revision) => ({ config, environment: {}, revision })),
        ),
        open: () =>
          Effect.sync(() => {
            const process = makeFakeCodex(`codex-${processes.length}`, log);
            processes.push(process);
            return process.client;
          }),
        onOpenError: (cause) =>
          new ProviderAdapterOpenSessionError({
            driver: ProviderDriverKind.make("codex"),
            providerSessionId: ProviderSessionId.make("session"),
            cause,
          }),
        isBusy: Ref.get(busy),
      });

      yield* client.request("thread/start", {} as never);
      yield* client.request("thread/unsubscribe", { threadId: "native-thread" } as never);
      yield* Ref.set(token, "token-2");
      yield* client.request("turn/start", { threadId: "native-thread" } as never);
      assert.strictEqual(processes.length, 1, "a live voice call keeps the process");

      yield* processes[0]!.emit("turn/completed", { turn: { id: "codex-0-turn-1" } });
      yield* Ref.set(busy, false);
      log.length = 0;
      yield* client.request("turn/start", { threadId: "native-thread" } as never);
      assert.strictEqual(processes.length, 2);
      assert.deepEqual(log, ["codex-1 turn/start"], "an unsubscribed thread is not resumed");
    }).pipe(Effect.scoped),
  );
});
