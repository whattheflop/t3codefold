import {
  ProviderRealtimeVoiceError,
  type ThreadId,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import type { ProviderSessionManagerV2Shape } from "./ProviderSessionManager.ts";

/** Starting voice is an explicit user action, so an idle provider may be resumed without starting a coding turn. */
type VoiceProjection = {
  thread: Pick<
    OrchestrationV2ThreadProjection["thread"],
    | "activeProviderThreadId"
    | "archivedAt"
    | "deletedAt"
    | "modelSelection"
    | "runtimeMode"
    | "interactionMode"
    | "worktreePath"
  >;
  providerThreads: OrchestrationV2ThreadProjection["providerThreads"];
  providerSessions: OrchestrationV2ThreadProjection["providerSessions"];
};
export const makeRealtimeVoiceSessionResolver = <E>(dependencies: {
  getThreadProjection(threadId: ThreadId): Effect.Effect<VoiceProjection, E>;
  sessions: Pick<ProviderSessionManagerV2Shape, "get" | "open">;
}) =>
  Effect.gen(function* () {
    const { sessions } = dependencies;
    const locks = yield* KeyedLock.make<ThreadId>();
    return (
      threadId: ThreadId,
      operation: ProviderRealtimeVoiceError["operation"],
      resume = false,
    ) =>
      locks
        .withLock(
          threadId,
          Effect.gen(function* () {
            const projection = yield* dependencies.getThreadProjection(threadId);
            const providerThread =
              projection.providerThreads.find(
                (candidate) => candidate.id === projection.thread.activeProviderThreadId,
              ) ?? projection.providerThreads.at(-1);
            if (
              !providerThread?.providerSessionId ||
              providerThread.driver !== "codex" ||
              providerThread.providerInstanceId !== projection.thread.modelSelection.instanceId ||
              projection.thread.archivedAt !== null ||
              projection.thread.deletedAt !== null
            ) {
              return yield* new ProviderRealtimeVoiceError({ threadId, operation });
            }
            const existing = Option.getOrNull(
              yield* sessions.get(providerThread.providerSessionId),
            );
            if (existing) return { runtime: existing, providerThread };
            if (!resume) return yield* new ProviderRealtimeVoiceError({ threadId, operation });
            const modelSelection = projection.thread.modelSelection;
            const resumeFromSession = projection.providerSessions.find(
              (candidate) => candidate.id === providerThread.providerSessionId,
            );
            if (!resumeFromSession)
              return yield* new ProviderRealtimeVoiceError({ threadId, operation });
            const runtimePolicy = {
              runtimeMode: projection.thread.runtimeMode,
              interactionMode: projection.thread.interactionMode,
              cwd: projection.thread.worktreePath ?? resumeFromSession.cwd,
            };
            const runtime = yield* sessions.open({
              threadId,
              providerSessionId: providerThread.providerSessionId,
              modelSelection,
              runtimePolicy,
              resumeFromSession,
            });
            const resumed = yield* runtime.resumeThread({
              providerThread,
              threadId,
              modelSelection,
              runtimePolicy,
            });
            return { runtime, providerThread: resumed };
          }),
        )
        .pipe(Effect.mapError(() => new ProviderRealtimeVoiceError({ threadId, operation })));
  });

type VoiceRuntime = Pick<
  ProviderAdapter.ProviderAdapterV2SessionRuntime,
  "startRealtimeVoice" | "stopRealtimeVoice"
>;

/**
 * ProviderSessionManager's wrapper around a runtime's voice methods. Voice start counts as
 * activity so the idle reaper cannot release the session mid-handshake; the adapter keeps a
 * live call pinned through hasPendingBackgroundWork afterwards. Stopping records activity.
 */
export const withRealtimeVoiceActivity = (
  runtime: VoiceRuntime,
  activity: {
    readonly begin: (key: string) => Effect.Effect<void>;
    readonly end: (key: string) => Effect.Effect<void>;
    readonly touch: Effect.Effect<void>;
  },
): VoiceRuntime => {
  const { startRealtimeVoice, stopRealtimeVoice } = runtime;
  let nextVoiceStartId = 0;
  return {
    ...(startRealtimeVoice === undefined
      ? {}
      : {
          startRealtimeVoice: (input) =>
            Effect.suspend(() => {
              const activityKey = `voice:${nextVoiceStartId++}`;
              return Effect.acquireUseRelease(
                activity.begin(activityKey),
                () => startRealtimeVoice(input),
                () => activity.end(activityKey),
              );
            }),
        }),
    ...(stopRealtimeVoice === undefined
      ? {}
      : {
          stopRealtimeVoice: (input) =>
            activity.touch.pipe(Effect.andThen(stopRealtimeVoice(input))),
        }),
  };
};
