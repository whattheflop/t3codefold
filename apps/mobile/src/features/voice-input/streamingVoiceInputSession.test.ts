import { describe, expect, it, vi } from "vite-plus/test";
import type { LocalDictationBackend } from "../../native/localDictation";
import { createVoiceInputTarget } from "./voiceInputSession";
import { StreamingVoiceInputSession } from "./streamingVoiceInputSession";

function fixture(activity?: ConstructorParameters<typeof StreamingVoiceInputSession>[2]) {
  let callbacks: Parameters<LocalDictationBackend["start"]>[0] | undefined;
  let signal: AbortSignal | undefined;
  let text = "hello world";
  let final = "";
  const change = (value: string) => {
    text = value;
  };
  const backend: LocalDictationBackend = {
    start: vi.fn(async (next, abort) => {
      callbacks = next;
      signal = abort;
    }),
    stop: vi.fn(async (flush) => {
      if (flush && final) callbacks?.phrase(final);
    }),
    getStatus: () => ({ isRecording: true, metering: -20, durationMillis: 0 }),
    configure: vi.fn(async () => {}),
  };
  const session = new StreamingVoiceInputSession(backend, vi.fn(), activity);
  const target = createVoiceInputTarget(
    "thread:first",
    () => text,
    (next) => change(next),
    { start: 6, end: 11 },
  );
  return {
    session,
    target,
    backend,
    change,
    text: () => text,
    phrase: (value: string) => callbacks?.phrase(value),
    final: (value: string) => {
      final = value;
    },
    signal: () => signal,
  };
}

describe("phone-local streaming dictation", () => {
  it("replaces the selected text, appends phrases, and flushes the last phrase on stop", async () => {
    const f = fixture();
    await f.session.start(f.target);
    f.phrase("first");
    f.phrase("second");
    expect(f.text()).toBe("hello first second");
    f.final("last");
    await f.session.stop();
    expect(f.text()).toBe("hello first second last");
    expect(f.session.currentState.phase).toBe("idle");
  });
  it("rejects stale events after cancellation and preserves completed phrases", async () => {
    const f = fixture();
    await f.session.start(f.target);
    f.phrase("first");
    f.session.cancel();
    f.phrase("late");
    expect(f.signal()?.aborted).toBe(true);
    expect(f.text()).toBe("hello first");
  });
  it("stops when the draft is edited without overwriting those edits", async () => {
    const f = fixture();
    await f.session.start(f.target);
    f.phrase("first");
    f.change("manual edit");
    f.phrase("next");
    expect(f.text()).toBe("manual edit");
    expect(f.session.currentState.phase).toBe("error");
  });
  it("has no five-minute duration limit and keeps the original target", async () => {
    const f = fixture();
    await f.session.start(f.target);
    const other = createVoiceInputTarget("thread:second", () => "other", vi.fn(), {
      start: 0,
      end: 0,
    });
    await f.session.start(other);
    for (let minute = 0; minute < 45; minute++) f.phrase(`minute ${minute}`);
    expect(f.session.currentState.phase).toBe("recording");
    expect(f.session.ownerKey).toBe("thread:first");
    expect(f.text()).toContain("minute 44");
    await f.session.stop();
  });
  it("waits for canceled native preparation to clean up before restarting", async () => {
    const f = fixture();
    const entered = Promise.withResolvers<void>();
    const prepared = Promise.withResolvers<void>();
    const cleanupEntered = Promise.withResolvers<void>();
    const cleanup = Promise.withResolvers<void>();
    vi.mocked(f.backend.start).mockImplementationOnce(async () => {
      entered.resolve();
      await prepared.promise;
    });
    vi.mocked(f.backend.stop).mockImplementationOnce(async () => {
      cleanupEntered.resolve();
      await cleanup.promise;
    });
    const first = f.session.start(f.target);
    await entered.promise;
    f.session.cancel();
    const second = f.session.start(f.target);
    await cleanupEntered.promise;
    expect(f.backend.start).toHaveBeenCalledTimes(1);
    prepared.resolve();
    await first;
    cleanup.resolve();
    await second;
    expect(f.backend.start).toHaveBeenCalledTimes(2);
    expect(f.session.currentState.phase).toBe("recording");
    await f.session.stop();
  });
  it("honors the system end-call action while the local model is still preparing", async () => {
    const f = fixture();
    const entered = Promise.withResolvers<void>();
    const prepared = Promise.withResolvers<void>();
    let end = () => {};
    let signal: AbortSignal | undefined;
    vi.mocked(f.backend.start).mockImplementationOnce(async (callbacks, abort) => {
      end = callbacks.ended;
      signal = abort;
      callbacks.preparing("Loading on-device speech model");
      entered.resolve();
      await prepared.promise;
    });
    const starting = f.session.start(f.target);
    await entered.promise;
    end();
    expect(signal?.aborted).toBe(true);
    prepared.resolve();
    await starting;
    expect(f.session.currentState.phase).toBe("idle");
    expect(f.text()).toBe("hello world");
  });
  it("allows Android permission dialogs to finish without canceling preparation", async () => {
    const f = fixture();
    const entered = Promise.withResolvers<void>();
    const permission = Promise.withResolvers<void>();
    let requestingPermission = false;
    f.backend.isRequestingPermission = () => requestingPermission;
    vi.mocked(f.backend.start).mockImplementationOnce(async (_, signal) => {
      requestingPermission = true;
      entered.resolve();
      await permission.promise;
      requestingPermission = false;
      signal.throwIfAborted();
    });
    const starting = f.session.start(f.target);
    await entered.promise;
    f.session.appMovedToBackground();
    permission.resolve();
    await starting;
    expect(f.session.currentState.phase).toBe("recording");
    f.session.appMovedToBackground();
    expect(f.session.currentState.phase).toBe("error");
    expect(f.text()).toBe("hello world");
  });
  it("keeps a permanently denied microphone permission actionable through Android settings", async () => {
    const f = fixture();
    vi.mocked(f.backend.start).mockRejectedValueOnce(
      Object.assign(new Error("Microphone permission denied"), { code: "PERMISSION_DENIED" }),
    );
    await f.session.start(f.target);
    expect(f.session.currentState.errorAction).toBe("settings");
    expect(f.text()).toBe("hello world");
  });
});

it("publishes local dictation snapshots, focus and uncapped recording activity", async () => {
  vi.useFakeTimers();
  const release = vi.fn();
  const keepAwake = vi.fn(() => release);
  const publishAudioLevels = vi.fn();
  let durationMillis = 0;
  const f = fixture({
    keepAwake,
    publishAudioLevels,
    sampleRecording: () => ({ durationMillis, metering: 0 }),
  });
  const listener = vi.fn();
  const unsubscribe = f.session.subscribe(listener);
  try {
    f.session.setOwnerFocused(f.target.ownerKey, true);
    expect(f.session.getSnapshot().focusedOwners.has(f.target.ownerKey)).toBe(true);
    await f.session.start(f.target);
    expect(f.session.getSnapshot()).toMatchObject({
      state: { phase: "recording" },
      ownerKey: f.target.ownerKey,
    });
    expect(keepAwake).toHaveBeenCalledTimes(1);
    durationMillis = 600_000;
    vi.advanceTimersByTime(80);
    expect(f.session.getSnapshot().elapsedSeconds).toBe(600);
    expect(publishAudioLevels).toHaveBeenLastCalledWith(expect.arrayContaining([1]));
    await f.session.stop();
    expect(release).toHaveBeenCalledTimes(1);
    const published = listener.mock.calls.length;
    vi.advanceTimersByTime(800);
    expect(listener).toHaveBeenCalledTimes(published);
    expect(f.session.getSnapshot().state.phase).toBe("idle");
  } finally {
    unsubscribe();
    f.session.dispose();
    vi.useRealTimers();
  }
});
