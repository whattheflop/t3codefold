import {
  type AuthSessionId,
  FoldRpcGroup,
  PitbossError,
  ProviderRealtimeVoiceError,
  type ThreadId,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as ServerConfig from "./config.ts";
import { FleetBroker } from "./mcp/FleetBroker.ts";
import { FleetExecutor } from "./mcp/FleetExecutor.ts";
import { FleetRouter } from "./mcp/FleetRouter.ts";
import { RpcInstrumentation } from "./observability/RpcInstrumentation.ts";
import * as ProviderSessionManager from "./orchestration-v2/ProviderSessionManager.ts";
import { makeRealtimeVoiceSessionResolver } from "./orchestration-v2/RealtimeVoiceSession.ts";
import * as ThreadManagementService from "./orchestration-v2/ThreadManagementService.ts";
import { makeHome } from "./pitboss/Home.ts";
import { PeerService } from "./pitboss/PeerService.ts";
import { SourceService } from "./pitboss/SourceService.ts";
import { WorkStore } from "./pitboss/WorkStore.ts";

// Handlers register per group: a single handler map for the merged WsRpcGroup exceeds
// TypeScript's instantiation depth, so ws.ts registers UpstreamWsRpcGroup and this file FoldRpcGroup.
const ServerFoldWsRpcGroup = FoldRpcGroup.middleware(RpcInstrumentation);

/**
 * Fold's pitboss, fleet and realtime voice handlers, spread into the socket's
 * RPC handlers. The GLaDOS home and the fleet services are server-lifetime and
 * passed in, so every socket shares one home lock and one fleet broker.
 */
export const makeFoldWsHandlers = Effect.fn("ws.makeFoldWsHandlers")(function* (input: {
  readonly sessionId: AuthSessionId;
  readonly openGladosHome: Effect.Success<ReturnType<typeof makeHome>>;
}) {
  const work = yield* WorkStore;
  const workPeers = yield* PeerService;
  const workSources = yield* SourceService;
  const fleetBroker = yield* FleetBroker;
  const fleetRouter = yield* FleetRouter;
  const fleetExecutor = yield* FleetExecutor;
  const threadManagement = yield* ThreadManagementService.ThreadManagementService;
  const providerSessions = yield* ProviderSessionManager.ProviderSessionManagerV2;
  const realtimeVoiceSession = yield* makeRealtimeVoiceSessionResolver({
    getThreadProjection: threadManagement.getThreadProjection,
    sessions: providerSessions,
  });
  const voiceError = (threadId: ThreadId, operation: ProviderRealtimeVoiceError["operation"]) =>
    new ProviderRealtimeVoiceError({ threadId, operation });
  const mapVoiceError = <A, E>(
    threadId: ThreadId,
    operation: ProviderRealtimeVoiceError["operation"],
    effect: Effect.Effect<A, E>,
  ) =>
    effect.pipe(
      Effect.tapError((cause) =>
        Effect.logError("Provider realtime voice failed.", { threadId, operation, cause }),
      ),
      Effect.mapError(() => voiceError(threadId, operation)),
    );

  return FoldRpcGroup.of({
    [WS_METHODS.pitbossPeers]: () => workPeers.list(),
    [WS_METHODS.pitbossPeerCommand]: (command) => workPeers.execute(command),
    [WS_METHODS.pitbossSources]: () => workSources.list(),
    [WS_METHODS.pitbossSourceCommand]: (command) => workSources.execute(command),
    [WS_METHODS.pitbossRead]: () => work.read(),
    [WS_METHODS.pitbossSubscribe]: () => work.subscribe(),
    [WS_METHODS.pitbossCommand]: (command) =>
      Effect.gen(function* () {
        if (command.action.type === "activate-home" || command.action.type === "reset")
          return yield* input.openGladosHome(command);
        if (command.action.type === "elect") {
          yield* threadManagement
            .getProjectThreadRecords(
              { projectId: command.action.projectId, threadId: command.action.threadId },
              [],
            )
            .pipe(
              Effect.mapError(
                () =>
                  new PitbossError({
                    code: "invalid",
                    message: "Choose an existing thread in this project.",
                  }),
              ),
            );
        }
        return yield* work.command(command, { type: "user" });
      }),
    [WS_METHODS.fleetConnect]: (connect) =>
      Stream.unwrap(fleetBroker.connect(input.sessionId, connect)),
    [WS_METHODS.fleetRespond]: (response) => fleetBroker.respond(input.sessionId, response),
    [WS_METHODS.fleetExecute]: (request) => fleetExecutor.execute(request),
    // The CLI entry runs locally or routes; FleetRouter alone refuses local targets.
    [WS_METHODS.fleetInvoke]: (request) => fleetExecutor.invoke(request),
    [WS_METHODS.fleetEnvironments]: () => fleetRouter.environments,
    [WS_METHODS.providerRealtimeVoiceList]: ({ threadId }) =>
      mapVoiceError(
        threadId,
        "list voices",
        Effect.gen(function* () {
          const { runtime, providerThread } = yield* realtimeVoiceSession(
            threadId,
            "list voices",
            true,
          );
          if (!runtime.listRealtimeVoices) return yield* voiceError(threadId, "list voices");
          return yield* runtime.listRealtimeVoices({ providerThread });
        }),
      ),
    [WS_METHODS.providerRealtimeVoiceContext]: ({ threadId, callId, text }) =>
      mapVoiceError(
        threadId,
        "share context",
        Effect.gen(function* () {
          const { runtime, providerThread } = yield* realtimeVoiceSession(
            threadId,
            "share context",
          );
          if (!runtime.appendRealtimeVoiceContext)
            return yield* voiceError(threadId, "share context");
          return yield* runtime.appendRealtimeVoiceContext({ providerThread, callId, text });
        }),
      ),
    [WS_METHODS.providerRealtimeVoiceEvents]: ({ threadId }) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const { runtime, providerThread } = yield* realtimeVoiceSession(
            threadId,
            "subscribe",
            true,
          );
          if (!runtime.realtimeVoiceEvents) return yield* voiceError(threadId, "subscribe");
          return runtime.realtimeVoiceEvents({ providerThread });
        }),
      ).pipe(Stream.mapError(() => voiceError(threadId, "subscribe"))),
    [WS_METHODS.providerRealtimeVoiceStart]: ({ threadId, sdp, options }) =>
      mapVoiceError(
        threadId,
        "start",
        Effect.gen(function* () {
          const { runtime, providerThread } = yield* realtimeVoiceSession(threadId, "start", true);
          if (!runtime.startRealtimeVoice) return yield* voiceError(threadId, "start");
          return yield* runtime.startRealtimeVoice({
            providerThread,
            sdp,
            ...(options ? { options } : {}),
          });
        }),
      ),
    // Stopping never resumes a session and must work even after the thread was archived.
    [WS_METHODS.providerRealtimeVoiceStop]: ({ threadId }) =>
      mapVoiceError(
        threadId,
        "stop",
        Effect.gen(function* () {
          const projection = yield* threadManagement.getThreadProjection(threadId);
          const providerThread =
            projection.providerThreads.find(
              (candidate) => candidate.id === projection.thread.activeProviderThreadId,
            ) ?? projection.providerThreads.at(-1);
          const providerSessionId = providerThread?.providerSessionId;
          if (!providerThread || !providerSessionId) return yield* voiceError(threadId, "stop");
          const runtime = Option.getOrNull(yield* providerSessions.get(providerSessionId));
          if (!runtime?.stopRealtimeVoice) return yield* voiceError(threadId, "stop");
          return yield* runtime.stopRealtimeVoice({ providerThread });
        }),
      ),
  });
});

/**
 * Builds, once per server, the factory for each socket's Fold RPC layer. ws.ts merges
 * that layer beside its own handlers. The GLaDOS home and the fleet services are
 * server-lifetime: a lease taken on one socket must be visible to MCP routing and to
 * the other sockets.
 */
export const makeFoldWsRpcLayer = Effect.gen(function* () {
  const fleetBroker = yield* FleetBroker;
  const fleetRouter = yield* FleetRouter;
  const fleetExecutor = yield* FleetExecutor;
  const config = yield* ServerConfig.ServerConfig;
  const openGladosHome = yield* makeHome(config.stateDir);
  return (sessionId: AuthSessionId) =>
    ServerFoldWsRpcGroup.toLayer(makeFoldWsHandlers({ sessionId, openGladosHome })).pipe(
      Layer.provide(Layer.succeed(FleetBroker, fleetBroker)),
      Layer.provide(Layer.succeed(FleetRouter, fleetRouter)),
      Layer.provide(Layer.succeed(FleetExecutor, fleetExecutor)),
    );
});
