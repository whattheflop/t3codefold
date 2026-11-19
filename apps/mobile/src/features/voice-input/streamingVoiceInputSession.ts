import {
  voiceInputBlocksSubmission,
  resolveTranscriptCommit,
  type VoiceDraftSnapshot,
  type VoiceInputState,
} from "@t3tools/client-runtime/voice-input";
import type { LocalDictationBackend } from "../../native/localDictation";
import type {
  VoiceInputSnapshot,
  VoiceInputSessionDependencies,
  VoiceInputTarget,
} from "./voiceInputSession";

import { normalizeVoiceInputDecibels, VOICE_WAVEFORM_SAMPLE_COUNT } from "./voiceInputMetering";

const IDLE: VoiceInputState = { phase: "idle", error: null, errorAction: null };

/** Owns one draft while native Android capture streams completed phrases into it. */
export class StreamingVoiceInputSession {
  readonly controller = this;
  private state = IDLE;
  private target: VoiceInputTarget | null = null;
  private captured: VoiceDraftSnapshot | null = null;
  private abort: AbortController | null = null;
  private cleanup: Promise<void> = Promise.resolve();
  private generation = 0;

  private snapshot: VoiceInputSnapshot = {
    state: IDLE,
    ownerKey: null,
    label: null,
    elapsedSeconds: 0,
    focusedOwners: new Set(),
  };
  private readonly listeners = new Set<() => void>();
  private levels: ReadonlyArray<number> = Array<number>(VOICE_WAVEFORM_SAMPLE_COUNT).fill(0);
  private meteringInterval: ReturnType<typeof setInterval> | null = null;
  private releaseKeepAwake: (() => void) | null = null;

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly getSnapshot = () => this.snapshot;
  setOwnerFocused(ownerKey: string, focused: boolean) {
    if (this.snapshot.focusedOwners.has(ownerKey) === focused) return;
    const focusedOwners = new Set(this.snapshot.focusedOwners);
    if (focused) focusedOwners.add(ownerKey);
    else focusedOwners.delete(ownerKey);
    this.publish({ ...this.snapshot, focusedOwners });
  }

  constructor(
    private readonly backend: LocalDictationBackend,
    private readonly changed: (state: VoiceInputState) => void,
    private readonly activity?: Pick<
      VoiceInputSessionDependencies,
      "sampleRecording" | "publishAudioLevels" | "keepAwake"
    >,
  ) {}
  get currentState() {
    return this.state;
  }
  get ownerKey() {
    return this.target?.ownerKey ?? null;
  }
  get label() {
    return this.target?.label ?? null;
  }

  async start(target: VoiceInputTarget): Promise<void> {
    if (voiceInputBlocksSubmission(this.state)) return;
    const generation = ++this.generation;
    this.target = target;
    this.captured = target.readDraft();
    const abort = new AbortController();
    this.abort = abort;
    this.setState({ phase: "preparing", error: null, errorAction: null });
    try {
      await this.cleanup;
      if (generation !== this.generation) return;
      if (!this.captured) throw new Error("This draft is no longer available.");
      await this.backend.start(
        {
          phrase: (text) => {
            if (generation === this.generation) this.commit(text);
          },
          ended: () => {
            if (generation === this.generation) {
              if (this.state.phase === "preparing") this.cancel();
              else void this.stop();
            }
          },
          failed: (message) => {
            if (generation === this.generation) this.fail(message);
          },
          preparing: (status) => {
            if (generation === this.generation && this.state.phase === "preparing") {
              this.setState({ phase: "preparing", error: null, errorAction: null, status });
            }
          },
        },
        abort.signal,
      );
      if (generation === this.generation)
        this.setState({ phase: "recording", error: null, errorAction: null });
    } catch (error) {
      if (generation === this.generation) {
        const settings =
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "PERMISSION_DENIED";
        this.fail(
          error instanceof Error ? error.message : "Could not start local dictation.",
          settings ? "settings" : "retry",
        );
      }
    }
  }

  async stop(): Promise<void> {
    if (this.state.phase !== "recording") return;
    const generation = this.generation;
    this.setState({ phase: "transcribing", error: null, errorAction: null });
    try {
      // Keep accepting final phrases until the decoder has flushed.
      await this.backend.stop(true);
      if (generation === this.generation) this.finish(IDLE);
    } catch (error) {
      if (generation === this.generation)
        this.fail(error instanceof Error ? error.message : "Could not finish dictation.");
    }
  }

  cancel(ownerKey?: string | null): void {
    if (ownerKey !== undefined && ownerKey !== this.ownerKey) return;
    if (this.state.phase === "idle") return;
    this.finish(IDLE);
  }
  retry() {
    return this.target ? this.start(this.target) : Promise.resolve();
  }
  dispose() {
    this.cancel();
    this.stopRecordingActivity();
    this.listeners.clear();
  }
  appMovedToBackground() {
    // Android reports background while its runtime permission activity is open.
    if (this.backend.isRequestingPermission?.()) return;
    if (voiceInputBlocksSubmission(this.state))
      this.fail("Dictation stopped when the app moved to the background.");
  }
  handleRecorderStatus(_status?: unknown) {
    /* Native capture owns recorder interruptions. */
  }

  private commit(phrase: string) {
    if (!this.captured || !this.target) return;
    const current = this.target.readDraft();
    const result = resolveTranscriptCommit(
      this.captured,
      current?.text === this.captured.text ? current : null,
      phrase,
      "en",
    );
    if (result.kind === "stale") {
      this.fail("The draft changed. Dictation stopped without overwriting your edits.");
    } else if (result.kind === "commit") {
      this.target.commitDraft(result.text, result.selection);
      const next = this.target.readDraft();
      if (next?.text !== result.text) {
        this.fail("The draft is no longer available.");
        return;
      }
      this.captured = { ...next, selection: result.selection };
    }
  }
  private fail(error: string, errorAction: VoiceInputState["errorAction"] = "retry") {
    this.finish({ phase: "error", error, errorAction });
  }
  private finish(state: VoiceInputState) {
    ++this.generation;
    this.abort?.abort();
    this.abort = null;
    this.captured = null;
    this.cleanup = this.cleanup.then(() => this.backend.stop(false)).catch(() => {});
    this.setState(state);
  }
  private publish(snapshot: VoiceInputSnapshot) {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
  private stopRecordingActivity() {
    if (this.meteringInterval !== null) clearInterval(this.meteringInterval);
    this.meteringInterval = null;
    this.releaseKeepAwake?.();
    this.releaseKeepAwake = null;
  }
  private sampleRecording() {
    const sample = this.activity?.sampleRecording();
    if (!sample || this.state.phase !== "recording") return;
    const level = normalizeVoiceInputDecibels(sample.metering);
    if (level !== 0 || this.levels.some((sample) => sample !== 0)) {
      this.levels = [...this.levels.slice(1), level];
      this.activity?.publishAudioLevels(this.levels);
    }
    const elapsedSeconds = Math.max(0, Math.floor(sample.durationMillis / 1000));
    if (elapsedSeconds !== this.snapshot.elapsedSeconds)
      this.publish({ ...this.snapshot, elapsedSeconds });
  }
  private setState(state: VoiceInputState) {
    const previousPhase = this.state.phase;
    if (previousPhase === "recording" && state.phase !== "recording") this.stopRecordingActivity();
    this.state = state;
    const capturesAudio = state.phase === "preparing" || state.phase === "recording";
    if (previousPhase !== state.phase && capturesAudio) {
      this.levels = Array<number>(VOICE_WAVEFORM_SAMPLE_COUNT).fill(0);
      this.activity?.publishAudioLevels(this.levels);
    }
    this.publish({
      ...this.snapshot,
      state,
      ownerKey: this.ownerKey,
      label: this.label,
      elapsedSeconds:
        previousPhase !== state.phase && capturesAudio ? 0 : this.snapshot.elapsedSeconds,
    });
    this.changed(state);
    if (state.phase === "recording" && previousPhase !== "recording" && this.activity) {
      this.releaseKeepAwake = this.activity.keepAwake();
      this.sampleRecording();
      this.meteringInterval = setInterval(() => this.sampleRecording(), 80);
    }
  }
}
