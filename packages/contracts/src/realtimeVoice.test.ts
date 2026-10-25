import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ThreadId } from "./baseSchemas.ts";
import {
  ProviderRealtimeVoiceError,
  ProviderRealtimeVoiceStartInput,
  ProviderRealtimeVoiceStartResult,
} from "./realtimeVoice.ts";

const decodeProviderRealtimeVoiceStartInput = Schema.decodeUnknownSync(
  ProviderRealtimeVoiceStartInput,
);
const decodeProviderRealtimeVoiceStartResult = Schema.decodeUnknownSync(
  ProviderRealtimeVoiceStartResult,
);
const encodeProviderRealtimeVoiceError = Schema.encodeUnknownSync(ProviderRealtimeVoiceError);

describe("provider realtime voice", () => {
  it("accepts bounded WebRTC offer and answer descriptions", () => {
    expect(
      decodeProviderRealtimeVoiceStartInput({ threadId: "thread-1", sdp: "offer-sdp" }),
    ).toEqual({ threadId: "thread-1", sdp: "offer-sdp" });
    expect(decodeProviderRealtimeVoiceStartResult({ sdp: "answer-sdp" })).toEqual({
      sdp: "answer-sdp",
    });
  });

  it("rejects empty session descriptions", () => {
    expect(() =>
      decodeProviderRealtimeVoiceStartInput({ threadId: "thread-1", sdp: "" }),
    ).toThrow();
    expect(() => decodeProviderRealtimeVoiceStartResult({ sdp: "" })).toThrow();
  });

  it("does not encode upstream request details on the public RPC error", () => {
    const error = new ProviderRealtimeVoiceError({
      threadId: ThreadId.make("thread-1"),
      operation: "start",
    });
    const encoded = encodeProviderRealtimeVoiceError(error);

    expect(error.message).toBe("Failed to start realtime voice for thread thread-1.");
    expect(encoded).toEqual({
      _tag: "ProviderRealtimeVoiceError",
      threadId: "thread-1",
      operation: "start",
    });
  });
});
