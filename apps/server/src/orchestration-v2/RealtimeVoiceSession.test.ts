import { assert, it, vi } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderThreadId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import type { ProviderAdapterV2SessionRuntime } from "@t3tools/provider-core/server/ProviderAdapter";
import { makeRealtimeVoiceSessionResolver } from "./RealtimeVoiceSession.ts";
class TestRuntime extends Context.Service<TestRuntime, ProviderAdapterV2SessionRuntime>()(
  "t3/orchestration-v2/RealtimeVoiceSession.test/TestRuntime",
) {}
const threadId = ThreadId.make("voice-thread");
const driver = ProviderDriverKind.make("codex");
const providerInstanceId = ProviderInstanceId.make("codex");
const providerSessionId = ProviderSessionId.make("voice-session");
const providerThreadId = ProviderThreadId.make("voice-provider-thread");
const now = DateTime.makeUnsafe(0);
const providerThread = {
  id: providerThreadId,
  driver,
  providerInstanceId,
  providerSessionId,
  appThreadId: threadId,
  ownerNodeId: null,
  nativeThreadRef: { driver, nativeId: "native-thread", strength: "strong" as const },
  nativeConversationHeadRef: null,
  status: "idle" as const,
  firstRunOrdinal: null,
  lastRunOrdinal: null,
  handoffIds: [],
  forkedFrom: null,
  createdAt: now,
  updatedAt: now,
};
const savedSession = {
  id: providerSessionId,
  driver,
  providerInstanceId,
  status: "stopped" as const,
  cwd: "/tmp/voice-workspace",
  model: "gpt-test",
  capabilities: CodexProviderCapabilitiesV2,
  createdAt: now,
  updatedAt: now,
  lastError: null,
};
const projection = {
  thread: {
    activeProviderThreadId: providerThreadId,
    archivedAt: null,
    deletedAt: null,
    modelSelection: { instanceId: providerInstanceId, model: "gpt-test" },
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
    worktreePath: null,
  },
  providerThreads: [providerThread],
  providerSessions: [savedSession],
};
it.effect(
  "resumes an idle task once for simultaneous start and transcript subscriptions without a coding turn",
  () =>
    Effect.gen(function* () {
      const resumeThread = vi.fn(() => Effect.succeed(providerThread));
      const runtime = yield* TestRuntime.pipe(
        Effect.provide(
          Layer.mock(TestRuntime)({
            resumeThread,
            instanceId: providerInstanceId,
            driver,
            providerSessionId,
            providerSession: savedSession,
          }),
        ),
      );
      let resident = false;
      const open = vi.fn(() =>
        Effect.sync(() => {
          resident = true;
          return runtime;
        }),
      );
      const resolve = yield* makeRealtimeVoiceSessionResolver({
        getThreadProjection: () => Effect.succeed(projection),
        sessions: {
          get: () => Effect.sync(() => (resident ? Option.some(runtime) : Option.none())),
          open,
        },
      });
      const results = yield* Effect.all(
        [resolve(threadId, "start", true), resolve(threadId, "subscribe", true)],
        { concurrency: "unbounded" },
      );
      assert.equal(open.mock.calls.length, 1);
      assert.equal(resumeThread.mock.calls.length, 1);
      assert.isTrue(results.every((value) => value.runtime === runtime));
    }),
);
it.effect("does not resurrect a task for a late context update", () =>
  Effect.gen(function* () {
    const open = vi.fn(() => Effect.die("Must not open"));
    const resolve = yield* makeRealtimeVoiceSessionResolver({
      getThreadProjection: () => Effect.succeed(projection),
      sessions: { get: () => Effect.succeed(Option.none()), open },
    });
    const error = yield* resolve(threadId, "share context").pipe(Effect.flip);
    assert.equal(error.operation, "share context");
    assert.equal(open.mock.calls.length, 0);
  }),
);
it.effect("does not start a provider for an archived task", () =>
  Effect.gen(function* () {
    const open = vi.fn(() => Effect.die("Must not open"));
    const resolve = yield* makeRealtimeVoiceSessionResolver({
      getThreadProjection: () =>
        Effect.succeed({ ...projection, thread: { ...projection.thread, archivedAt: now } }),
      sessions: { get: () => Effect.succeed(Option.none()), open },
    });
    yield* resolve(threadId, "start", true).pipe(Effect.flip);
    assert.equal(open.mock.calls.length, 0);
  }),
);
