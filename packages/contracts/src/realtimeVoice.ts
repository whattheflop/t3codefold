/** Fold's live Codex realtime voice: the RPC payloads in foldRpc.ts and provider adapter inputs. */
import * as Schema from "effect/Schema";

import { ThreadId } from "./baseSchemas.ts";

const RealtimeSessionDescription = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(256 * 1024),
);

export const RealtimeVoiceOptions = Schema.Struct({
  voice: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(40))),
  callId: Schema.optional(Schema.String.check(Schema.isMaxLength(80))),
});
export type RealtimeVoiceOptions = typeof RealtimeVoiceOptions.Type;
export const RealtimeVoiceContext = Schema.String.check(Schema.isMaxLength(8_192));
export const ProviderRealtimeVoiceContextInput = Schema.Struct({
  threadId: ThreadId,
  callId: Schema.String,
  text: RealtimeVoiceContext,
});
export const ProviderRealtimeVoiceListResult = Schema.Struct({
  voices: Schema.Array(Schema.String),
  defaultVoice: Schema.String,
});
export type ProviderRealtimeVoiceListResult = typeof ProviderRealtimeVoiceListResult.Type;
export const ProviderRealtimeVoiceEvent = Schema.Struct({
  callId: Schema.String,
  sequence: Schema.Number,
  type: Schema.Literals(["started", "closed", "error", "transcript"]),
  role: Schema.optional(Schema.Literals(["user", "assistant"])),
  text: Schema.optional(Schema.String.check(Schema.isMaxLength(8_192))),
  final: Schema.optional(Schema.Boolean),
});
export type ProviderRealtimeVoiceEvent = typeof ProviderRealtimeVoiceEvent.Type;

export const ProviderRealtimeVoiceStartInput = Schema.Struct({
  threadId: ThreadId,
  sdp: RealtimeSessionDescription,
  options: Schema.optional(RealtimeVoiceOptions),
});
export type ProviderRealtimeVoiceStartInput = typeof ProviderRealtimeVoiceStartInput.Type;

export const ProviderRealtimeVoiceStartResult = Schema.Struct({
  sdp: RealtimeSessionDescription,
});
export type ProviderRealtimeVoiceStartResult = typeof ProviderRealtimeVoiceStartResult.Type;

export const ProviderRealtimeVoiceStopInput = Schema.Struct({
  threadId: ThreadId,
});
export type ProviderRealtimeVoiceStopInput = typeof ProviderRealtimeVoiceStopInput.Type;

export class ProviderRealtimeVoiceError extends Schema.TaggedError<ProviderRealtimeVoiceError>()(
  "ProviderRealtimeVoiceError",
  {
    threadId: ThreadId,
    operation: Schema.Literals(["start", "stop", "list voices", "share context", "subscribe"]),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} realtime voice for thread ${this.threadId}.`;
  }
}
