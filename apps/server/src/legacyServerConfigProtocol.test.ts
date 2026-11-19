import { assert, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ServerConfig,
  ServerConfigStreamEvent,
  WS_METHODS,
  type IdleCompactionMode,
  type ServerConfig as ServerConfigType,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import { RpcSerialization, type RpcMessage, type RpcServer } from "effect/rpc";

import {
  needsLegacyServerConfig,
  serverConfigProtocolForClient,
  withLegacyServerConfigProtocol,
} from "./legacyServerConfigProtocol.ts";

const modes = [
  ["onReturn", false],
  ["beforeCacheExpires", true],
  ["off", false],
] as const;

const serverConfig = (compactIdleThreads: IdleCompactionMode): ServerConfigType => ({
  environment: {
    environmentId: EnvironmentId.make("environment-legacy-compatibility"),
    label: "Compatibility test",
    platform: { os: "linux", arch: "arm64" },
    serverVersion: "0.0.0-test",
    capabilities: { repositoryIdentity: true, connectionProbe: true },
  },
  auth: {
    policy: "loopback-browser",
    bootstrapMethods: ["one-time-token"],
    sessionMethods: ["browser-session-cookie", "bearer-access-token"],
    sessionCookieName: "t3_session",
  },
  cwd: "/workspace",
  keybindingsConfigPath: "/workspace/keybindings.json",
  keybindings: [],
  issues: [],
  providers: [],
  availableEditors: [],
  observability: {
    logsDirectoryPath: "/logs",
    localTracingEnabled: false,
    otlpTracesEnabled: false,
    otlpMetricsEnabled: false,
    otlpLogsEnabled: false,
  },
  settings: { ...DEFAULT_SERVER_SETTINGS, compactIdleThreads },
});

const encodeServerConfig = Schema.encodeSync(ServerConfig);
const encodeServerConfigEvent = Schema.encodeSync(ServerConfigStreamEvent);

const makeProtocol = Effect.fn("test.makeLegacyServerConfigProtocol")(function* (
  incoming: ReadonlyArray<RpcMessage.FromClientEncoded>,
) {
  const sent: RpcMessage.FromServerEncoded[] = [];
  const wire: Array<string | Uint8Array> = [];
  const received: RpcMessage.FromClientEncoded[] = [];
  const serializer = RpcSerialization.json.makeUnsafe();
  const disconnects = yield* Queue.unbounded<number>();
  const base = {
    run: (write) =>
      Effect.forEach(
        incoming,
        (message) =>
          write(0, message).pipe(Effect.tap(() => Effect.sync(() => received.push(message)))),
        { discard: true },
      ).pipe(Effect.andThen(Effect.never)),
    disconnects,
    send: (_clientId, response) =>
      Effect.sync(() => {
        sent.push(response);
        const encoded = serializer.encode(response);
        if (encoded !== undefined) wire.push(encoded);
      }),
    end: (_clientId) => Effect.void,
    clientIds: Effect.succeed(new Set([0])),
    initialMessage: Effect.succeedNone,
    supportsAck: true,
    supportsTransferables: false,
    supportsSpanPropagation: true,
    supportsNotifications: false,
    codecFor: Schema.toCodecJson,
  } satisfies RpcServer.Protocol["Service"];
  return { base, received, sent, wire };
});

const request = (id: string, tag: string): RpcMessage.FromClientEncoded => ({
  _tag: "Request",
  id,
  tag,
  payload: {},
  headers: [],
});

it("selects only the identified legacy mobile release", () => {
  assert.isTrue(needsLegacyServerConfig({ surface: "mobile", appVersion: "1.4.5" }));
  assert.isFalse(needsLegacyServerConfig({ surface: "mobile", appVersion: "1.4.4" }));
  assert.isFalse(needsLegacyServerConfig({ surface: "mobile", appVersion: "1.4.6" }));
  assert.isFalse(needsLegacyServerConfig({ surface: "web", appVersion: "1.4.5" }));
  assert.isFalse(needsLegacyServerConfig({ surface: "desktop", appVersion: "1.4.5" }));
  assert.isFalse(needsLegacyServerConfig({}));
});

it.effect("uses the original protocol for current and unknown clients", () =>
  Effect.gen(function* () {
    const { base } = yield* makeProtocol([]);
    for (const origin of [
      { surface: "web", appVersion: "1.4.5" },
      { surface: "desktop", appVersion: "1.4.5" },
      { surface: "mobile", appVersion: "1.4.6" },
      {},
    ] as const) {
      assert.strictEqual(serverConfigProtocolForClient(base, origin), base);
    }
    assert.notStrictEqual(
      serverConfigProtocolForClient(base, { surface: "mobile", appVersion: "1.4.5" }),
      base,
    );
  }),
);

it.effect.each(modes)(
  "serializes %s for legacy unary, snapshot, and settings update",
  ([mode, expected]) =>
    Effect.gen(function* () {
      const requests = [
        request("unary", WS_METHODS.serverGetConfig),
        request("stream", WS_METHODS.subscribeServerConfig),
      ];
      const { base, received, wire } = yield* makeProtocol(requests);
      const protocol = withLegacyServerConfigProtocol(base);
      yield* Effect.forkScoped(
        protocol.run(() => Effect.void),
        { startImmediately: true },
      );

      const config = serverConfig(mode);
      const encodedConfig = encodeServerConfig(config);
      const encodedSnapshot = encodeServerConfigEvent({ version: 1, type: "snapshot", config });
      const encodedSettingsUpdate = encodeServerConfigEvent({
        version: 1,
        type: "settingsUpdated",
        payload: { settings: config.settings },
      });
      assert.equal(encodedConfig.settings.compactIdleThreads, mode);

      yield* protocol.send(0, {
        _tag: "Exit",
        requestId: "unary",
        exit: { _tag: "Success", value: encodedConfig },
      });
      yield* protocol.send(0, {
        _tag: "Chunk",
        requestId: "stream",
        values: [encodedSnapshot, encodedSettingsUpdate],
      });

      const frames = wire.map((frame) =>
        JSON.parse(typeof frame === "string" ? frame : new TextDecoder().decode(frame)),
      ) as [
        { exit: { value: { settings: { compactIdleThreads: boolean } } } },
        {
          values: [
            { config: { settings: { compactIdleThreads: boolean } } },
            { payload: { settings: { compactIdleThreads: boolean } } },
          ];
        },
      ];
      assert.equal(frames[0].exit.value.settings.compactIdleThreads, expected);
      assert.equal(frames[1].values[0].config.settings.compactIdleThreads, expected);
      assert.equal(frames[1].values[1].payload.settings.compactIdleThreads, expected);
      assert.deepEqual(received, requests);
    }),
);

it.effect("leaves unrelated RPCs and payloads unchanged", () =>
  Effect.gen(function* () {
    const unrelated = {
      _tag: "Chunk",
      requestId: "other",
      values: [{ compactIdleThreads: "off" }],
    } as const;
    const unrelatedConfigEvent = {
      _tag: "Chunk",
      requestId: "stream",
      values: [{ type: "providerStatuses", payload: { compactIdleThreads: "off" } }],
    } as const;
    const { base, sent } = yield* makeProtocol([
      request("other", WS_METHODS.serverProbe),
      request("stream", WS_METHODS.subscribeServerConfig),
    ]);
    const protocol = withLegacyServerConfigProtocol(base);
    yield* Effect.forkScoped(
      protocol.run(() => Effect.void),
      { startImmediately: true },
    );
    yield* protocol.send(0, unrelated);
    yield* protocol.send(0, unrelatedConfigEvent);
    assert.strictEqual(sent[0], unrelated);
    assert.deepEqual(sent[1], unrelatedConfigEvent);
  }),
);

it.effect("stops adapting a request after exit or interruption", () =>
  Effect.gen(function* () {
    const exitRequest = request("reused", WS_METHODS.serverGetConfig);
    const interrupt = { _tag: "Interrupt", requestId: "interrupted" } as const;
    const { base, sent } = yield* makeProtocol([
      exitRequest,
      request("interrupted", WS_METHODS.subscribeServerConfig),
      interrupt,
    ]);
    const protocol = withLegacyServerConfigProtocol(base);
    yield* Effect.forkScoped(
      protocol.run(() => Effect.void),
      { startImmediately: true },
    );

    const exit = {
      _tag: "Exit",
      requestId: "reused",
      exit: { _tag: "Success", value: { settings: { compactIdleThreads: "off" } } },
    } as const;
    const afterExit = { ...exit, exit: { ...exit.exit, value: exit.exit.value } };
    const afterInterrupt = {
      _tag: "Chunk",
      requestId: "interrupted",
      values: [
        {
          type: "settingsUpdated",
          payload: { settings: { compactIdleThreads: "off" } },
        },
      ],
    } as const;
    yield* protocol.send(0, exit);
    yield* protocol.send(0, afterExit);
    yield* protocol.send(0, afterInterrupt);

    assert.deepEqual(sent[0], {
      _tag: "Exit",
      requestId: "reused",
      exit: { _tag: "Success", value: { settings: { compactIdleThreads: false } } },
    });
    assert.strictEqual(sent[1], afterExit);
    assert.strictEqual(sent[2], afterInterrupt);
  }),
);
