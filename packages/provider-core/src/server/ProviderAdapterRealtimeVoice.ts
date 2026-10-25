import type {
  OrchestrationV2ProviderThread,
  ProviderRealtimeVoiceEvent,
  ProviderRealtimeVoiceListResult,
  RealtimeVoiceOptions,
} from "@t3tools/contracts";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

import type { ProviderAdapterV2Error } from "./ProviderAdapter.ts";

/**
 * Fold's live realtime voice methods of a provider session runtime, which
 * `ProviderAdapterV2SessionRuntime` extends. Providers with a realtime voice
 * channel for a thread (Codex) expose them; absent means the driver has no
 * voice support.
 */
export interface ProviderAdapterV2RealtimeVoice {
  readonly listRealtimeVoices?: (input: {
    readonly providerThread: OrchestrationV2ProviderThread;
  }) => Effect.Effect<ProviderRealtimeVoiceListResult, ProviderAdapterV2Error>;
  readonly appendRealtimeVoiceContext?: (input: {
    readonly providerThread: OrchestrationV2ProviderThread;
    readonly callId: string;
    readonly text: string;
  }) => Effect.Effect<void, ProviderAdapterV2Error>;
  readonly realtimeVoiceEvents?: (input: {
    readonly providerThread: OrchestrationV2ProviderThread;
  }) => Stream.Stream<ProviderRealtimeVoiceEvent, ProviderAdapterV2Error>;
  readonly startRealtimeVoice?: (input: {
    readonly providerThread: OrchestrationV2ProviderThread;
    readonly sdp: string;
    readonly options?: RealtimeVoiceOptions;
  }) => Effect.Effect<{ readonly sdp: string }, ProviderAdapterV2Error>;
  readonly stopRealtimeVoice?: (input: {
    readonly providerThread: OrchestrationV2ProviderThread;
  }) => Effect.Effect<void, ProviderAdapterV2Error>;
}
