import { useHardwareKeyboardCommand } from "../keyboard/hardwareKeyboardCommands";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useCallback,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
} from "react";
import { useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import * as SecureStore from "expo-secure-store";
import { Platform, View, Pressable, ScrollView } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { ComposerToolbarButton } from "../../components/ComposerToolbar";
import { ThemedSwitch } from "../../components/ui/ThemedSwitch";
import { cn } from "../../lib/cn";
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
import { realtimeVoiceEnvironment } from "../../state/realtime-voice";
import { useAtomCommand } from "../../state/use-atom-command";
import { useThreadShells, useServerConfigs } from "../../state/entities";
import { uuidv4 } from "../../lib/uuid";
import { voiceAudio } from "./voiceAudio";
import { createNativeVoiceMedia } from "./codexVoiceMedia";
import { mediaDevices } from "react-native-webrtc";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { voiceInputBlocksSubmission } from "@t3tools/client-runtime/voice-input";
import { useGlobalVoiceInput } from "./VoiceInputProvider";
type VoiceAudioControls = {
  speaker: boolean;
  audioRoute: string;
  audioError: string | null;
  chooseAudioOutput(): Promise<void>;
  volumeUp(): void;
};
const VoiceContext = createContext<{ workspace: VoiceWorkspace; audio: VoiceAudioControls } | null>(
  null,
);
const emptyFeedAtom = Atom.make(AsyncResult.success(emptyVoiceFeed));
const preferenceKey = "fold.liveVoice.preferences";
function readPreferences(value: string): Partial<VoicePreferences> {
  try {
    const raw: unknown = JSON.parse(value);
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
export function useVoiceWorkspace() {
  const value = useContext(VoiceContext);
  if (!value) throw new Error("Voice workspace is not mounted");
  const state = useSyncExternalStore(value.workspace.subscribe, value.workspace.getSnapshot);
  return { ...value, state };
}
export function VoiceWorkspaceProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState({ speaker: false, audioRoute: "Phone" });
  const [audioError, setAudioError] = useState<string | null>(null);
  // Dictation and a live call share the microphone; whichever started first keeps it.
  const { session: dictationSession, setLiveCallActive } = useGlobalVoiceInput();
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
  const nativeMedia = useMemo(
    () => createNativeVoiceMedia((speaker, audioRoute) => setRoute({ speaker, audioRoute })),
    [],
  );
  const workspace = useMemo(
    () =>
      new VoiceWorkspace({
        createCallId: uuidv4,
        openMedia: (handlers, preferences) => {
          if (voiceInputBlocksSubmission(dictationSession.controller.currentState))
            throw new Error("Finish dictation before starting a voice call.");
          return nativeMedia(handlers, preferences);
        },
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
          void SecureStore.setItemAsync(preferenceKey, JSON.stringify(preferences)).catch(() => {});
        },
      }),
    [dictationSession, nativeMedia, start, stop, list, context],
  );
  useEffect(() => {
    let mounted = true;
    void SecureStore.getItemAsync(preferenceKey)
      .then((value) => {
        if (!mounted || !value) return;
        try {
          workspace.restorePreferences(readPreferences(value));
        } catch {
          /* Ignore malformed preferences. */
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [workspace]);
  useEffect(() => {
    const end = voiceAudio.addListener("endCall", () => {
      void workspace.stop();
    });
    const route = voiceAudio.addListener("audioRoute", (value) =>
      setRoute({ speaker: value.speaker, audioRoute: value.name }),
    );
    const mute = voiceAudio.addListener("systemMute", ({ muted }) => workspace.setMuted(muted));
    return () => {
      end.remove();
      route.remove();
      mute.remove();
    };
  }, [workspace]);
  useHardwareKeyboardCommand(
    "voiceToggle",
    useCallback(() => {
      const state = workspace.getSnapshot();
      if (state.voice.status === "idle" || state.voice.status === "error") void workspace.start();
      else void workspace.stop();
    }, [workspace]),
  );
  useHardwareKeyboardCommand(
    "voiceMute",
    useCallback(() => workspace.toggleMuted(), [workspace]),
  );
  useHardwareKeyboardCommand(
    "voiceOutputMute",
    useCallback(() => {
      void workspace.setPreferences({
        outputMuted: !workspace.getSnapshot().preferences.outputMuted,
      });
    }, [workspace]),
  );
  const state = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot);
  const callActive = state.voice.status !== "idle" && state.voice.status !== "error";
  useEffect(() => {
    setLiveCallActive(callActive);
  }, [setLiveCallActive, callActive]);
  useEffect(() => () => setLiveCallActive(false), [setLiveCallActive]);
  const shells = useThreadShells();
  const configs = useServerConfigs();
  const targets = useMemo(
    () =>
      shells
        .filter(
          (shell) =>
            !shell.archivedAt &&
            !shell.deletedAt &&
            configs
              .get(shell.environmentId)
              ?.providers.some(
                (provider) =>
                  provider.instanceId === shell.providerInstanceId && provider.driver === "codex",
              ),
        )
        .map((shell) => ({
          environmentId: shell.environmentId,
          threadId: shell.id,
          title: shell.title,
          enhancedVoice:
            configs.get(shell.environmentId)?.environment.capabilities.realtimeVoiceControls ===
            true,
        })),
    [shells, configs],
  );
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
  const audio = useMemo(
    () => ({
      ...route,
      audioError,
      chooseAudioOutput: async () => {
        try {
          if (Platform.OS === "android") await voiceAudio.chooseEndpoint();
          else {
            await voiceAudio.setSpeaker(!route.speaker);
            setRoute({
              speaker: !route.speaker,
              audioRoute: !route.speaker ? "Speaker" : "Phone / headset",
            });
          }
          setAudioError(null);
        } catch (error) {
          setAudioError(error instanceof Error ? error.message : "Could not change audio output.");
        }
      },
      volumeUp: () => voiceAudio.volumeUp(),
    }),
    [route, audioError],
  );
  const value = useMemo(() => ({ workspace, audio }), [workspace, audio]);
  return (
    <VoiceContext value={value}>
      <View style={{ flex: 1 }}>
        <View style={{ flex: 1 }}>{children}</View>
        <VoicePanel />
      </View>
    </VoiceContext>
  );
}
type VoiceIcon = ComponentProps<typeof SymbolView>["name"];

function VoiceChoiceChip({
  label,
  selected = false,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      className={cn(
        "min-h-10 justify-center rounded-full border px-4 active:opacity-70",
        selected ? "border-primary bg-primary" : "border-border-subtle bg-subtle",
      )}
    >
      <Text
        className={cn(
          "text-sm font-t3-medium",
          selected ? "text-primary-foreground" : "text-foreground",
        )}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function VoiceSettingsRow({
  icon,
  label,
  value,
  disabled,
  onPress,
}: {
  icon: VoiceIcon;
  label: string;
  value?: string;
  disabled?: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      className={cn(
        "min-h-14 flex-row items-center gap-3 px-4 py-3 active:bg-subtle",
        disabled && "opacity-45",
      )}
      disabled={disabled}
      onPress={onPress}
    >
      <View className="size-9 items-center justify-center rounded-full bg-subtle">
        <SymbolView name={icon} size={18} tintColorClassName="accent-icon" type="monochrome" />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-base font-t3-medium text-foreground">{label}</Text>
        {value ? (
          <Text className="text-sm text-foreground-muted" numberOfLines={1}>
            {value}
          </Text>
        ) : null}
      </View>
      <SymbolView
        name="chevron.right"
        size={15}
        tintColorClassName="accent-icon-muted"
        type="monochrome"
      />
    </Pressable>
  );
}

function VoiceSwitchRow({
  icon,
  label,
  subtitle,
  disabled,
  value,
  onValueChange,
}: {
  icon: VoiceIcon;
  label: string;
  subtitle?: string;
  disabled?: boolean;
  value: boolean;
  onValueChange(value: boolean): void;
}) {
  return (
    <View
      className={cn("min-h-14 flex-row items-center gap-3 px-4 py-3", disabled && "opacity-45")}
    >
      <View className="size-9 items-center justify-center rounded-full bg-subtle">
        <SymbolView name={icon} size={18} tintColorClassName="accent-icon" type="monochrome" />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-base font-t3-medium text-foreground">{label}</Text>
        {subtitle ? <Text className="text-sm text-foreground-muted">{subtitle}</Text> : null}
      </View>
      <ThemedSwitch
        accessibilityLabel={label}
        disabled={disabled}
        value={value}
        onValueChange={onValueChange}
      />
    </View>
  );
}

function VoiceSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-2">
      <Text className="px-2 text-sm font-t3-medium text-foreground-muted">{title}</Text>
      <View className="overflow-hidden rounded-[22px] border border-border bg-card">
        {children}
      </View>
    </View>
  );
}

export function VoiceSettings() {
  const { workspace, state, audio } = useVoiceWorkspace();
  const enhanced = workspace.supportsVoiceControls();
  const [microphones, setMicrophones] = useState<Array<{ deviceId: string; label: string }>>([]);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const refresh = async () => {
    if (enhanced) await workspace.loadVoices();
    try {
      const devices = await mediaDevices.enumerateDevices();
      if (Array.isArray(devices))
        setMicrophones(
          devices
            .filter((device) => device.kind === "audioinput")
            .map((device) => ({
              deviceId: String(device.deviceId),
              label: String(device.label || "Microphone"),
            })),
        );
      setDeviceError(null);
    } catch {
      setDeviceError("Could not list microphones. Check microphone access in system settings.");
    }
  };
  return (
    <View className="gap-4 py-3">
      {deviceError ? (
        <View className="rounded-2xl border border-danger-border bg-danger px-4 py-3">
          <Text className="text-sm text-danger-foreground">{deviceError}</Text>
        </View>
      ) : null}
      {!enhanced ? (
        <Text className="px-2 text-sm leading-normal text-foreground-muted">
          {BASIC_VOICE_NOTICE}
        </Text>
      ) : null}

      <VoiceSection title="Voice and microphone">
        <VoiceSettingsRow
          icon="waveform"
          label="Refresh voice devices"
          value={enhanced ? "Voices and microphones" : "Microphones"}
          onPress={() => void refresh()}
        />
        {enhanced ? (
          <View className="gap-2 border-t border-border px-4 py-3">
            <Text className="text-sm font-t3-medium text-foreground">Speaking voice</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerClassName="gap-2"
            >
              <VoiceChoiceChip
                label="Provider default"
                selected={!state.preferences.voice}
                onPress={() => void workspace.setPreferences({ voice: "" })}
              />
              {state.voices.map((voice) => (
                <VoiceChoiceChip
                  key={voice}
                  label={voice}
                  selected={state.preferences.voice === voice}
                  onPress={() => void workspace.setPreferences({ voice })}
                />
              ))}
            </ScrollView>
            <Text className="text-xs text-foreground-muted">Changes apply to the next call.</Text>
          </View>
        ) : null}
        <View className="gap-2 border-t border-border px-4 py-3">
          <Text className="text-sm font-t3-medium text-foreground">Microphone</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerClassName="gap-2"
          >
            <VoiceChoiceChip
              label="System default"
              selected={!state.preferences.microphoneId}
              onPress={() => void workspace.setPreferences({ microphoneId: "" })}
            />
            {microphones
              .filter((device) => device.deviceId)
              .map((device) => (
                <VoiceChoiceChip
                  key={device.deviceId}
                  label={device.label}
                  selected={state.preferences.microphoneId === device.deviceId}
                  onPress={() => void workspace.setPreferences({ microphoneId: device.deviceId })}
                />
              ))}
          </ScrollView>
        </View>
      </VoiceSection>

      <VoiceSection title="Call audio">
        <VoiceSettingsRow
          icon={audio.speaker ? "speaker.wave.2.fill" : "iphone"}
          label="Audio output"
          value={audio.audioRoute}
          onPress={() => void audio.chooseAudioOutput()}
        />
        {Platform.OS === "android" ? (
          <View className="border-t border-border">
            <VoiceSettingsRow
              icon="plus"
              label="Increase call volume"
              onPress={() => audio.volumeUp()}
            />
          </View>
        ) : null}
        <View className="border-t border-border">
          <VoiceSwitchRow
            icon="speaker.wave.2.fill"
            label="Mute speaker"
            value={state.preferences.outputMuted}
            onValueChange={(outputMuted) => void workspace.setPreferences({ outputMuted })}
          />
        </View>
      </VoiceSection>

      <VoiceSection title="Context">
        <VoiceSwitchRow
          icon="eye"
          label="Share what I’m viewing"
          subtitle="Files, diffs and questions only"
          disabled={!enhanced}
          value={enhanced && state.preferences.shareContext}
          onValueChange={(shareContext) => void workspace.setPreferences({ shareContext })}
        />
      </VoiceSection>
    </View>
  );
}
function VoicePanel() {
  const { workspace, state } = useVoiceWorkspace();
  const [expanded, setExpanded] = useState(false);
  const insets = useSafeAreaInsets();
  const shells = useThreadShells();
  const active = state.voice.status !== "idle" && state.voice.status !== "error";
  const target = shells.find(
    (shell) =>
      shell.environmentId === state.target?.environmentId && shell.id === state.target?.threadId,
  );
  if (!active && !state.notice && !state.voice.error && state.feed.transcripts.length === 0)
    return null;
  return (
    <View
      accessibilityLabel="Live voice"
      className="mx-3 mb-3 overflow-hidden rounded-[24px] border border-border bg-card shadow-xl shadow-adaptive-black-a10-a25"
      style={{
        marginLeft: Math.max(insets.left, 12),
        marginRight: Math.max(insets.right, 12),
        marginBottom: Math.max(insets.bottom, 12),
        maxHeight: "55%",
      }}
    >
      <View className="min-h-[76px] flex-row items-center gap-3 px-3 py-2.5">
        <Pressable
          accessibilityLabel={`${expanded ? "Collapse" : "Expand"} live voice controls`}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          className="min-w-0 flex-1 flex-row items-center gap-3 rounded-2xl px-1 py-1 active:bg-subtle"
          onPress={() => setExpanded(!expanded)}
        >
          <View className="size-10 items-center justify-center rounded-full bg-primary">
            <SymbolView
              name="waveform"
              size={20}
              tintColorClassName="accent-primary-foreground"
              type="monochrome"
            />
          </View>
          <View className="min-w-0 flex-1">
            <View className="flex-row items-center gap-2">
              <View className="size-2 rounded-full bg-success" />
              <Text className="text-xs font-t3-medium uppercase tracking-wide text-foreground-muted">
                {state.voice.status === "live" ? "Live with Codex" : state.voice.status}
              </Text>
            </View>
            <Text className="text-base font-t3-bold text-foreground" numberOfLines={1}>
              {state.target?.title ?? "Live voice"}
            </Text>
            <Text className="text-xs text-foreground-muted" numberOfLines={1}>
              Agent {target?.runtime?.status ?? "idle"}
              {target?.hasPendingUserInput ? " · needs input" : ""}
            </Text>
          </View>
          <SymbolView
            name={expanded ? "chevron.down" : "chevron.up"}
            size={16}
            tintColorClassName="accent-icon-muted"
            type="monochrome"
          />
        </Pressable>
        {active ? (
          <View className="flex-row items-center gap-1">
            <ComposerToolbarButton
              accessibilityLabel={state.voice.muted ? "Unmute microphone" : "Mute microphone"}
              active={state.voice.muted}
              icon={state.voice.muted ? "mic.slash" : "mic"}
              onPress={() => workspace.toggleMuted()}
              showChevron={false}
            />
            <ComposerToolbarButton
              accessibilityLabel={state.preferences.outputMuted ? "Unmute speaker" : "Mute speaker"}
              active={state.preferences.outputMuted}
              icon="speaker.wave.2.fill"
              onPress={() =>
                void workspace.setPreferences({ outputMuted: !state.preferences.outputMuted })
              }
              showChevron={false}
            />
            <ComposerToolbarButton
              accessibilityLabel="End voice call"
              icon="phone.down.fill"
              onPress={() => void workspace.stop()}
              showChevron={false}
              variant="danger"
            />
          </View>
        ) : (
          <ComposerToolbarButton
            accessibilityLabel="Close voice panel"
            icon="xmark"
            onPress={() => workspace.dismiss()}
            showChevron={false}
          />
        )}
      </View>
      {state.notice || state.voice.error ? (
        <View className="border-t border-border px-4 py-3">
          <Text className="text-sm text-foreground-muted">{state.notice ?? state.voice.error}</Text>
        </View>
      ) : null}
      {expanded && (
        <ScrollView className="border-t border-border px-3" showsVerticalScrollIndicator={false}>
          <VoiceSettings />
          <VoiceSection title="Voice task">
            <View className="gap-2 px-4 py-3">
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerClassName="gap-2"
              >
                {state.targets.map((item) => (
                  <VoiceChoiceChip
                    key={`${item.environmentId}:${item.threadId}`}
                    label={item.title}
                    selected={
                      item.environmentId === state.target?.environmentId &&
                      item.threadId === state.target?.threadId
                    }
                    onPress={() => void workspace.start(item)}
                  />
                ))}
              </ScrollView>
              {state.view ? (
                <VoiceSettingsRow
                  icon="arrow.right.circle"
                  label="Switch to viewed task"
                  value="Reconnects this call"
                  onPress={() => {
                    if (state.view) void workspace.start(state.view);
                  }}
                />
              ) : null}
            </View>
          </VoiceSection>
          {state.feed.transcripts.length > 0 ||
          state.feed.partial.user ||
          state.feed.partial.assistant ? (
            <View className="pt-4">
              <VoiceSection title="Transcript">
                <View className="gap-3 px-4 py-3">
                  {state.feed.transcripts.map((entry) => (
                    <View key={entry.id} className="gap-0.5">
                      <Text className="text-xs font-t3-medium uppercase tracking-wide text-foreground-muted">
                        {entry.role === "user" ? "You" : "Codex"}
                      </Text>
                      <Text className="text-sm leading-normal text-foreground">{entry.text}</Text>
                    </View>
                  ))}
                  {state.feed.partial.user || state.feed.partial.assistant ? (
                    <Text className="text-sm italic leading-normal text-foreground-muted">
                      {state.feed.partial.user || state.feed.partial.assistant}
                    </Text>
                  ) : null}
                </View>
              </VoiceSection>
            </View>
          ) : null}
          <Text className="px-2 pb-3 pt-4 text-xs leading-normal text-foreground-muted">
            {workspace.hasVoiceEvents
              ? "Say ‘end voice call’ or ‘switch voice to [thread title]’. Switching reconnects."
              : BASIC_VOICE_NOTICE}
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

export function useVoiceViewContext(source: string, text: string | null) {
  const workspace = useContext(VoiceContext)?.workspace;
  useEffect(() => {
    workspace?.setContext(source, text);
    return () => workspace?.setContext(source, null);
  }, [workspace, source, text]);
}
