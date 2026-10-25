/**
 * Fold's additions to CodexAdapterV2: live realtime voice per native thread, app
 * permission prompts, and ChatGPT-managed sessions (token rotation and sharing errors). Kept out of the upstream
 * adapter so it carries only the seams.
 */
import type {
  CodexSettings,
  OrchestrationV2ProviderThread,
  ProviderSetupError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import type * as CodexClient from "effect-codex-app-server/client";
import type * as CodexSchema from "effect-codex-app-server/schema";

import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { classifyCodexManagedError } from "../../provider/CodexManagedErrors.ts";
import type { CodexEffectiveRuntime } from "../../provider/CodexManagedRuntime.ts";
import {
  makeCodexRealtimeVoice,
  type CodexRealtimeVoice,
} from "../../provider/codexRealtimeVoice.ts";
import { makeManagedCodexClient } from "./CodexManagedClient.ts";

/**
 * Prompt for an app permission request: its nonblank reason, else the paths it
 * asked for, so a reasonless request still says what it wants.
 */
export function codexPermissionApprovalPrompt(
  input: Pick<CodexSchema.PermissionsRequestApprovalParams, "reason" | "permissions">,
): string | undefined {
  const reason = input.reason?.trim();
  if (reason) return reason;
  const paths = [
    ...(input.permissions.fileSystem?.read ?? []),
    ...(input.permissions.fileSystem?.write ?? []),
  ];
  return paths.length > 0 ? `Access: ${paths.join(", ")}` : undefined;
}

/** Codex limit codes, plus ChatGPT sharing's own usage limit on managed sessions. */
export function isCodexUsageLimitCode(code: string | null | undefined): boolean {
  return (
    code === "usageLimitExceeded" ||
    code === "rateLimitExceeded" ||
    code === "subscription_sharing_usage_limit_exceeded"
  );
}

/**
 * App-server args for T3 sessions. Realtime voice is opt-in upstream, so it is enabled here
 * without touching the host config; launch args still come last so an administrator can
 * turn it off again.
 */
export const withCodexRealtimeVoiceFeature = (args: ReadonlyArray<string>) => [
  ...args.slice(0, 1),
  "-c",
  "features.realtime_conversation=true",
  ...args.slice(1),
];

type VoiceMethods = Pick<
  ProviderAdapter.ProviderAdapterV2SessionRuntime,
  | "listRealtimeVoices"
  | "appendRealtimeVoiceContext"
  | "realtimeVoiceEvents"
  | "startRealtimeVoice"
  | "stopRealtimeVoice"
>;

/**
 * One realtime voice controller per native thread of a Codex session, created on first
 * use. `isActive` is readable before the client exists, so the managed client and
 * `hasPendingBackgroundWork` can keep a live call's process; `methods` binds the
 * session runtime's voice methods once the client is open.
 */
export const makeCodexSessionVoices = () => {
  const controllers = new Map<string, CodexRealtimeVoice>();
  const isActive = Effect.gen(function* () {
    for (const voice of controllers.values()) {
      if (yield* voice.isActive) return true;
    }
    return false;
  });
  const methods = Effect.fn("CodexAdapterV2.voiceMethods")(function* <E>(input: {
    readonly client: CodexClient.CodexAppServerClient["Service"];
    readonly driver: ProviderAdapter.ProviderAdapterProtocolError["driver"];
    readonly getNativeThreadId: (
      providerThread: OrchestrationV2ProviderThread,
    ) => Effect.Effect<string, E>;
  }) {
    const scope = yield* Scope.Scope;
    const lock = yield* Semaphore.make(1);
    const voiceForThread = (nativeThreadId: string) =>
      lock.withPermit(
        Effect.gen(function* () {
          const existing = controllers.get(nativeThreadId);
          if (existing) return existing;
          const voice = yield* makeCodexRealtimeVoice(input.client, {
            providerThreadId: nativeThreadId,
          }).pipe(Effect.provideService(Scope.Scope, scope));
          controllers.set(nativeThreadId, voice);
          return voice;
        }),
      );
    yield* Effect.addFinalizer(() =>
      Effect.forEach(controllers.values(), (voice) => voice.close, { discard: true }),
    );
    const voiceError = (detail: string) => (cause: unknown) =>
      new ProviderAdapter.ProviderAdapterProtocolError({
        driver: input.driver,
        detail,
        payload: cause,
      });
    const { getNativeThreadId } = input;
    return {
      listRealtimeVoices: (voiceInput) =>
        Effect.gen(function* () {
          const id = yield* getNativeThreadId(voiceInput.providerThread);
          return yield* (yield* voiceForThread(id)).listVoices;
        }).pipe(Effect.mapError(voiceError("Could not list voices."))),
      appendRealtimeVoiceContext: (voiceInput) =>
        Effect.gen(function* () {
          const id = yield* getNativeThreadId(voiceInput.providerThread);
          yield* (yield* voiceForThread(id)).appendContext(voiceInput.callId, voiceInput.text);
        }).pipe(Effect.mapError(voiceError("Could not share voice context."))),
      realtimeVoiceEvents: (voiceInput) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const id = yield* getNativeThreadId(voiceInput.providerThread);
            return (yield* voiceForThread(id)).events;
          }).pipe(Effect.mapError(voiceError("Could not subscribe to voice."))),
        ),
      startRealtimeVoice: (voiceInput) =>
        Effect.gen(function* () {
          const id = yield* getNativeThreadId(voiceInput.providerThread);
          const voice = yield* voiceForThread(id);
          return { sdp: yield* voice.startRealtimeVoice(voiceInput.sdp, voiceInput.options) };
        }).pipe(Effect.mapError(voiceError("Codex realtime voice failed."))),
      stopRealtimeVoice: (voiceInput) =>
        Effect.gen(function* () {
          const id = yield* getNativeThreadId(voiceInput.providerThread);
          const voice = controllers.get(id);
          if (voice) yield* voice.stopRealtimeVoice;
        }).pipe(Effect.mapError(voiceError("Codex realtime voice failed."))),
    } satisfies VoiceMethods;
  });
  return { isActive, methods };
};

/**
 * Opens a session's Codex client. Managed Codex reads its ChatGPT token from the process
 * environment, so a managed session gets a client that respawns Codex when the token
 * rotates, kept alive while a voice call is live. `classifyManagedError` reads a ChatGPT
 * sharing failure on a managed session, and drops a revoked connection.
 */
export const openCodexSessionClient = Effect.fn("CodexAdapterV2.openSessionClient")(
  function* (input: {
    readonly settings: CodexSettings;
    readonly environment: NodeJS.ProcessEnv;
    readonly resolveRuntime:
      | Effect.Effect<CodexEffectiveRuntime, ProviderSetupError, Scope.Scope>
      | undefined;
    readonly onConnectionRevoked: Effect.Effect<void> | undefined;
    readonly open: (
      settings: CodexSettings,
      environment: NodeJS.ProcessEnv,
    ) => Effect.Effect<
      CodexClient.CodexAppServerClient["Service"],
      ProviderAdapter.ProviderAdapterOpenSessionError,
      Scope.Scope
    >;
    readonly onOpenError: (
      cause: ProviderSetupError,
    ) => ProviderAdapter.ProviderAdapterOpenSessionError;
  }) {
    const voices = makeCodexSessionVoices();
    const { resolveRuntime, onConnectionRevoked } = input;
    const client =
      resolveRuntime === undefined
        ? yield* input.open(input.settings, input.environment)
        : yield* makeManagedCodexClient({
            resolve: resolveRuntime,
            open: (runtime) => input.open(runtime.config, runtime.environment),
            onOpenError: input.onOpenError,
            isBusy: voices.isActive,
          });
    const classifyManagedError = (value: unknown) =>
      Effect.gen(function* () {
        if (resolveRuntime === undefined) return undefined;
        const failure = classifyCodexManagedError(value);
        if (failure?.revoke && onConnectionRevoked) yield* onConnectionRevoked;
        return failure;
      });
    return { client, voices, classifyManagedError };
  },
);
