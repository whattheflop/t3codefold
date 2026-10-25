import { useEnvironmentProviders } from "../../state/environments";
import { withDefaultVoiceKeybindings } from "@t3tools/shared/keybindings";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { resolveShortcutCommand } from "../../keybindings";
import { randomUUID } from "../../lib/utils";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import {
  VoiceWorkspace,
  voiceStartInput,
  BASIC_VOICE_NOTICE,
  type VoicePreferences,
} from "@t3tools/client-runtime/realtime-voice/workspace";
import { emptyVoiceFeed } from "@t3tools/client-runtime/realtime-voice/feed";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { createRealtimeVoiceEnvironmentAtoms } from "@t3tools/client-runtime/state/realtime-voice";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useAtomCommand } from "../../state/use-atom-command";
import { useThreadShells, useServerConfigs } from "../../state/entities";
import { openWebVoiceMedia } from "../../hooks/codexVoiceMedia";

const realtimeVoiceEnvironment = createRealtimeVoiceEnvironmentAtoms(connectionAtomRuntime);
const VoiceContext = createContext<VoiceWorkspace | null>(null);
const emptyFeedAtom = Atom.make(AsyncResult.success(emptyVoiceFeed));
const preferenceKey = "fold.liveVoice.preferences";
function readPreferences(): Partial<VoicePreferences> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(preferenceKey) ?? "{}");
    if (!raw || typeof raw !== "object") return {};
    return {
      voice: "voice" in raw && typeof raw.voice === "string" ? raw.voice : "",
      microphoneId:
        "microphoneId" in raw && typeof raw.microphoneId === "string" ? raw.microphoneId : "",
      outputMuted: "outputMuted" in raw && raw.outputMuted === true,
      shareContext: "shareContext" in raw && raw.shareContext === true,
    };
  } catch {
    return {};
  }
}
function unwrap<A, E>(result: AtomCommandResult<A, E>): A {
  if (result._tag === "Success") return result.value;
  throw squashAtomCommandFailure(result);
}
export function useOptionalVoiceWorkspace() {
  return useContext(VoiceContext);
}
export function useVoiceWorkspace() {
  const workspace = useContext(VoiceContext);
  if (!workspace) throw new Error("Voice workspace is not mounted");
  const state = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot);
  return { workspace, state };
}
export function VoiceWorkspaceProvider({ children }: { children: ReactNode }) {
  const start = useAtomCommand(realtimeVoiceEnvironment.startRealtimeVoice, {
    reportFailure: false,
  });
  const stop = useAtomCommand(realtimeVoiceEnvironment.stopRealtimeVoice, { reportFailure: false });
  const list = useAtomCommand(realtimeVoiceEnvironment.listRealtimeVoices, {
    reportFailure: false,
  });
  const context = useAtomCommand(realtimeVoiceEnvironment.appendRealtimeVoiceContext, {
    reportFailure: false,
  });
  const [workspace] = useState(
    () =>
      new VoiceWorkspace(
        {
          createCallId: randomUUID,
          openMedia: openWebVoiceMedia,
          startRemote: async (target, sdp, callId, voice) =>
            unwrap(
              await start({
                environmentId: target.environmentId,
                input: voiceStartInput(target, sdp, callId, voice),
              }),
            ).sdp,
          stopRemote: async (target) => {
            unwrap(
              await stop({
                environmentId: target.environmentId,
                input: { threadId: target.threadId },
              }),
            );
          },
          listVoices: async (target) =>
            unwrap(
              await list({
                environmentId: target.environmentId,
                input: { threadId: target.threadId },
              }),
            ),
          appendContext: async (target, callId, text) => {
            unwrap(
              await context({
                environmentId: target.environmentId,
                input: { threadId: target.threadId, callId, text },
              }),
            );
          },
          savePreferences: (preferences) => {
            try {
              localStorage.setItem(preferenceKey, JSON.stringify(preferences));
            } catch {
              /* Storage can be unavailable in private browsing. */
            }
          },
        },
        readPreferences(),
      ),
  );
  const serverKeybindings = useAtomValue(primaryServerKeybindingsAtom);
  const keybindings = withDefaultVoiceKeybindings(serverKeybindings);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: { terminalFocus: Boolean((event.target as Element | null)?.closest?.(".xterm")) },
      });
      if (command !== "voice.toggle" && command !== "voice.mute" && command !== "voice.outputMute")
        return;
      event.preventDefault();
      runVoiceAction(workspace, command);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [workspace, keybindings]);
  const state = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot);
  const shells = useThreadShells();
  const configs = useServerConfigs();
  const providersByEnvironment = useEnvironmentProviders();
  const targets = shells
    .filter(
      (shell) =>
        !shell.archivedAt &&
        !shell.deletedAt &&
        providersByEnvironment
          .get(shell.environmentId)
          ?.some(
            (provider) =>
              provider.instanceId === shell.providerInstanceId && provider.driver === "codex",
          ),
    )
    .map((shell) => ({
      environmentId: shell.environmentId,
      threadId: shell.id,
      title: shell.title,
      enhancedVoice:
        configs.get(shell.environmentId)?.environment.capabilities.realtimeVoiceControls === true,
    }));
  useEffect(() => workspace.setTargets(targets), [workspace, targets]);
  const subscription = useAtomValue(
    state.target &&
      workspace.hasVoiceEvents &&
      state.voice.status !== "idle" &&
      state.voice.status !== "error"
      ? realtimeVoiceEnvironment.realtimeVoiceEvents({
          environmentId: state.target.environmentId,
          input: { threadId: state.target.threadId },
        })
      : emptyFeedAtom,
  );
  const feed = Option.getOrElse(AsyncResult.value(subscription), () => emptyVoiceFeed);
  useEffect(() => workspace.receiveFeed(feed), [workspace, feed]);
  useEffect(
    () => () => {
      void workspace.stop();
    },
    [workspace],
  );
  return (
    <VoiceContext value={workspace}>
      {children}
      <VoicePanel />
    </VoiceContext>
  );
}
export function VoiceSettings() {
  const { workspace, state } = useVoiceWorkspace();
  const enhanced = workspace.supportsVoiceControls();
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const refreshMicrophones = async () => {
    try {
      const devices = await navigator.mediaDevices?.enumerateDevices();
      setMicrophones(devices?.filter((device) => device.kind === "audioinput") ?? []);
      setDeviceError(null);
    } catch {
      setDeviceError("Could not list microphones. Check browser microphone access.");
    }
  };
  return (
    <fieldset className="space-y-3 rounded-lg border p-3 text-sm">
      <legend className="px-1 font-medium">Live voice</legend>
      {!enhanced && <p className="text-xs text-muted-foreground">{BASIC_VOICE_NOTICE}</p>}
      {deviceError && <p role="status">{deviceError}</p>}
      <label className="flex items-center justify-between gap-3">
        Speaking voice
        <select
          disabled={!enhanced}
          aria-label="Speaking voice"
          value={enhanced ? state.preferences.voice : ""}
          onFocus={() => void workspace.loadVoices()}
          onChange={(event) => void workspace.setPreferences({ voice: event.target.value })}
        >
          <option value="">Provider default</option>
          {[
            ...new Set([
              ...state.voices,
              ...(state.preferences.voice ? [state.preferences.voice] : []),
            ]),
          ].map((voice) => (
            <option key={voice} value={voice}>
              {voice}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-muted-foreground">
        Voice changes apply to the next call. Open a connected Codex thread to load its voices.
      </p>
      <label className="flex items-center justify-between gap-3">
        Microphone
        <select
          aria-label="Microphone"
          value={state.preferences.microphoneId}
          onFocus={() => void refreshMicrophones()}
          onChange={(event) => void workspace.setPreferences({ microphoneId: event.target.value })}
        >
          <option value="">System default</option>
          {microphones
            .filter((device) => device.deviceId)
            .map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Microphone ${index + 1}`}
              </option>
            ))}
        </select>
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={state.preferences.outputMuted}
          onChange={(event) => void workspace.setPreferences({ outputMuted: event.target.checked })}
        />
        Mute speaker
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          disabled={!enhanced}
          checked={enhanced && state.preferences.shareContext}
          onChange={(event) =>
            void workspace.setPreferences({ shareContext: event.target.checked })
          }
        />
        Share what I’m viewing
      </label>
      <p className="text-xs text-muted-foreground">
        Shares bounded file, diff and question context with the voice call. Already shared content
        remains in the conversation.
      </p>
    </fieldset>
  );
}
function VoicePanel() {
  const { workspace, state } = useVoiceWorkspace();
  const [expanded, setExpanded] = useState(false);
  const shells = useThreadShells();
  const active = state.voice.status !== "idle" && state.voice.status !== "error";
  const target = shells.find(
    (shell) =>
      shell.environmentId === state.target?.environmentId && shell.id === state.target?.threadId,
  );
  if (!active && !state.notice && !state.voice.error && state.feed.transcripts.length === 0)
    return null;
  return (
    <aside
      aria-label="Live voice"
      className="fixed bottom-52 right-4 z-40 w-80 max-w-[calc(100vw-2rem)] rounded-xl border bg-background p-3 shadow-lg"
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="text-left text-sm font-medium"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          {state.target?.title ?? "Live voice"} · {state.voice.status}
        </button>
        {!active && (
          <button type="button" aria-label="Close voice panel" onClick={() => workspace.dismiss()}>
            Close
          </button>
        )}
        {active && (
          <button type="button" aria-label="End voice call" onClick={() => void workspace.stop()}>
            End
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Agent: {target?.runtime?.status ?? "idle"}
        {target?.hasPendingUserInput ? " · needs input" : ""}
      </p>
      {state.notice || state.voice.error ? (
        <p role="status" className="mt-2 text-sm">
          {state.notice ?? state.voice.error}
        </p>
      ) : null}
      {active && (
        <div className="my-2 flex gap-3 text-xs">
          <button type="button" onClick={() => workspace.toggleMuted()}>
            {state.voice.muted ? "Unmute mic" : "Mute mic"}
          </button>
          <button
            type="button"
            onClick={() =>
              void workspace.setPreferences({ outputMuted: !state.preferences.outputMuted })
            }
          >
            {state.preferences.outputMuted ? "Unmute speaker" : "Mute speaker"}
          </button>
          {state.voice.status === "playback-blocked" && (
            <button type="button" onClick={() => void workspace.resumeAudio()}>
              Resume audio
            </button>
          )}
        </div>
      )}
      {expanded && (
        <div className="max-h-[40vh] space-y-3 overflow-y-auto">
          <VoiceSettings />
          {active && (
            <label className="block text-sm">
              Voice task (reconnects)
              <select
                aria-label="Voice task"
                className="mt-1 w-full"
                value={JSON.stringify([state.target?.environmentId, state.target?.threadId])}
                onChange={(event) => {
                  const target = state.targets.find(
                    (target) =>
                      JSON.stringify([target.environmentId, target.threadId]) ===
                      event.target.value,
                  );
                  if (target) void workspace.start(target);
                }}
              >
                {state.targets.map((target) => (
                  <option
                    key={JSON.stringify([target.environmentId, target.threadId])}
                    value={JSON.stringify([target.environmentId, target.threadId])}
                  >
                    {target.title} · {target.environmentId.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {active && state.view && (
            <button
              type="button"
              className="text-sm underline"
              onClick={() => void workspace.start(state.view)}
            >
              Switch voice to viewed task
            </button>
          )}
          <p className="text-xs text-muted-foreground">
            {workspace.hasVoiceEvents
              ? "Say ‘end voice call’ or ‘switch voice to [thread title]’. Switching reconnects the call."
              : BASIC_VOICE_NOTICE}
          </p>
          <div aria-label="Voice transcript" className="space-y-2 text-sm">
            {state.feed.transcripts.map((entry) => (
              <p key={entry.id}>
                <strong>{entry.role === "user" ? "You" : "Codex"}:</strong> {entry.text}
              </p>
            ))}
            {state.feed.partial.user && <p>You: {state.feed.partial.user}</p>}
            {state.feed.partial.assistant && <p>Codex: {state.feed.partial.assistant}</p>}
          </div>
        </div>
      )}
    </aside>
  );
}

export function useVoiceViewContext(source: string, text: string | null) {
  const workspace = useContext(VoiceContext);
  useEffect(() => {
    workspace?.setContext(source, text);
    return () => workspace?.setContext(source, null);
  }, [workspace, source, text]);
}

export function runVoiceAction(
  workspace: VoiceWorkspace,
  command: "voice.toggle" | "voice.mute" | "voice.outputMute",
) {
  const state = workspace.getSnapshot();
  if (command === "voice.toggle") {
    if (state.voice.status === "idle" || state.voice.status === "error") void workspace.start();
    else void workspace.stop();
  } else if (command === "voice.mute") workspace.toggleMuted();
  else void workspace.setPreferences({ outputMuted: !state.preferences.outputMuted });
}
