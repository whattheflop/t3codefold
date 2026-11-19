import { expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import {
  AuthSettingsWriteScope,
  EnvironmentId,
  WS_METHODS,
  type AuthSessionState,
  type FactoryBoard,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "../connection/model.ts";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import { EnvironmentCacheStore } from "../platform/persistence.ts";
import type { RpcSession } from "../rpc/session.ts";

import { createServerEnvironmentAtoms } from "./server.ts";

vi.mock("./session.ts", () => ({
  createEnvironmentSessionAtoms: () => ({ sessionStateAtom: sessions }),
}));
const sessions = Atom.family((_id: EnvironmentId) =>
  Atom.make<AsyncResult.AsyncResult<AuthSessionState, string>>(AsyncResult.initial()),
);

it.effect("routes Factory switches and live boards independently for two connected servers", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const a = EnvironmentId.make("server-a");
      const b = EnvironmentId.make("server-b");
      const makeServer = Effect.fn(function* (environmentId: EnvironmentId, enabled: boolean) {
        const board = yield* SubscriptionRef.make<FactoryBoard>({
          environmentId,
          sequence: 0,
          status: { enabled, forcedOff: false, stopping: false },
          agents: [],
          cards: [],
          triggers: [],
          runs: [],
          wakes: [],
          spawns: [],
          jobs: [],
          executions: [],
        });
        const writes: boolean[] = [];
        const session = {
          client: {
            [WS_METHODS.factorySubscribeBoard]: () => SubscriptionRef.changes(board),
            [WS_METHODS.factorySetEnabled]: ({ enabled }: { enabled: boolean }) =>
              Effect.gen(function* () {
                writes.push(enabled);
                yield* SubscriptionRef.update(board, (current) => ({
                  ...current,
                  status: { ...current.status, enabled },
                }));
                return (yield* SubscriptionRef.get(board)).status;
              }),
          },
        } as unknown as RpcSession;
        const supervisor = EnvironmentSupervisor.of({
          target: new PrimaryConnectionTarget({
            environmentId,
            label: environmentId,
            httpBaseUrl: "https://example.test",
            wsBaseUrl: "wss://example.test",
          }),
          state: yield* SubscriptionRef.make<SupervisorConnectionState>({
            ...AVAILABLE_CONNECTION_STATE,
            desired: true,
            network: "online",
            phase: "connected",
            generation: 1,
            attempt: 1,
          }),
          session: yield* SubscriptionRef.make(Option.some(session)),
          prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
          connect: Effect.void,
          disconnect: Effect.void,
          retryNow: Effect.void,
        });
        return { supervisor, board, writes };
      });
      const servers = new Map([
        [a, yield* makeServer(a, true)],
        [b, yield* makeServer(b, false)],
      ]);
      const getServer = (id: EnvironmentId) => servers.get(id)!;
      const connectionPorts: Pick<
        EnvironmentRegistry["Service"],
        "run" | "followStream" | "stateChanges"
      > = {
        run: (id, work) =>
          Effect.provideService(work, EnvironmentSupervisor, getServer(id).supervisor),
        followStream: (id, source) =>
          Stream.provideService(source, EnvironmentSupervisor, getServer(id).supervisor),
        stateChanges: (id) => SubscriptionRef.changes(getServer(id).supervisor.state),
      };
      const connections = EnvironmentRegistry.of(connectionPorts as EnvironmentRegistry["Service"]);
      const runtime = Atom.runtime(
        Layer.mergeAll(
          Layer.succeed(EnvironmentRegistry, connections),
          Layer.succeed(EnvironmentCacheStore, {} as EnvironmentCacheStore["Service"]),
        ),
      );
      const registry = AtomRegistry.make();
      yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
      const server = createServerEnvironmentAtoms(runtime, {
        initialConfigValueAtom: () => Atom.make(null),
      });
      const grant = (allowed: boolean): AuthSessionState => ({
        authenticated: true,
        auth: {
          policy: "remote-reachable",
          bootstrapMethods: [],
          sessionMethods: [],
          sessionCookieName: "test",
        },
        scopes: allowed ? [AuthSettingsWriteScope] : [],
        permissions: allowed ? [AuthSettingsWriteScope] : [],
      });
      for (const id of [a, b]) {
        registry.mount(sessions(id));
        registry.set(sessions(id), AsyncResult.success(grant(true)));
      }
      const boardA = server.factoryBoard({ environmentId: a, input: {} });
      const boardB = server.factoryBoard({ environmentId: b, input: {} });
      registry.mount(boardA);
      registry.mount(boardB);
      const waitFor = (atom: typeof boardA, enabled: boolean) =>
        AtomRegistry.toStream(registry, atom).pipe(
          Stream.filter(
            (result) => AsyncResult.isSuccess(result) && result.value.status.enabled === enabled,
          ),
          Stream.take(1),
          Stream.runDrain,
        );
      yield* waitFor(boardA, true);
      yield* waitFor(boardB, false);
      expect(boardA).not.toBe(boardB);
      expect(
        (yield* Effect.promise(() =>
          server.factorySetEnabled.run(registry, {
            environmentId: b,
            input: { enabled: true },
          }),
        ))._tag,
      ).toBe("Success");
      yield* waitFor(boardB, true);
      expect(getServer(a).writes).toEqual([]);
      expect((yield* SubscriptionRef.get(getServer(a).board)).status.enabled).toBe(true);
      expect(
        (yield* Effect.promise(() =>
          server.factorySetEnabled.run(registry, {
            environmentId: a,
            input: { enabled: false },
          }),
        ))._tag,
      ).toBe("Success");
      yield* waitFor(boardA, false);
      expect((yield* SubscriptionRef.get(getServer(b).board)).status.enabled).toBe(true);
      expect(getServer(a).writes).toEqual([false]);
      expect(getServer(b).writes).toEqual([true]);
      registry.set(sessions(a), AsyncResult.success(grant(false)));
      expect(registry.get(server.factorySetEnabled.permissionAtom(a))).toBe(false);
      expect(registry.get(server.factorySetEnabled.permissionAtom(b))).toBe(true);
      expect(
        (yield* Effect.promise(() =>
          server.factorySetEnabled.run(registry, {
            environmentId: a,
            input: { enabled: true },
          }),
        ))._tag,
      ).toBe("Failure");
      expect(getServer(a).writes).toEqual([false]);
      // Switching back reads A's own cached/live status, never B's enabled board.
      expect(server.factoryBoard({ environmentId: a, input: {} })).toBe(boardA);
      const currentA = registry.get(boardA);
      const currentB = registry.get(boardB);
      expect(AsyncResult.isSuccess(currentA) ? currentA.value.status : null).toEqual({
        enabled: false,
        forcedOff: false,
        stopping: false,
      });
      expect(AsyncResult.isSuccess(currentB) && currentB.value.status.enabled).toBe(true);
    }),
  ),
);
