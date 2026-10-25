import { supportsCodexRealtimeVoiceVersion } from "@t3tools/client-runtime/realtime-voice";
import type { EnvironmentId, ServerProvider, ThreadId } from "@t3tools/contracts";
import { useEffect } from "react";
import { Alert, Platform, View } from "react-native";
import { AppText } from "../../components/ui/AppText";
import { ComposerActionButton } from "../../components/ComposerToolbar";
import type { RemoteClientConnectionState } from "../../lib/connection";
import { useCodexRealtimeVoice } from "./useCodexRealtimeVoice";
import { useGlobalVoiceInput } from "./VoiceInputProvider";

/**
 * The thread composer's Codex realtime voice button. Null for non-Codex threads and while a call
 * is live, since a live call's controls move to the workspace voice panel.
 */
export function useCodexVoiceComposerControl(input: {
  readonly providerStatus: ServerProvider | null;
  readonly title: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly connectionState: RemoteClientConnectionState;
}) {
  // Any dictation, here or on another screen, holds the microphone a call needs.
  const dictationBusy = useGlobalVoiceInput().isBusy;
  const isCodexThread = input.providerStatus?.driver === "codex";
  const codexVoice = useCodexRealtimeVoice({
    title: input.title,
    environmentId: input.environmentId,
    threadId: input.threadId,
    enabled: isCodexThread && input.connectionState === "connected" && !dictationBusy,
  });
  const codexVoiceActive = codexVoice.status !== "idle" && codexVoice.status !== "error";
  useEffect(() => {
    if (codexVoice.error) Alert.alert("Codex voice", codexVoice.error);
  }, [codexVoice.error]);
  return isCodexThread && !codexVoiceActive ? (
    <CodexVoiceControl
      voice={codexVoice}
      disabled={
        dictationBusy ||
        input.connectionState !== "connected" ||
        !supportsCodexRealtimeVoiceVersion(input.providerStatus.version)
      }
    />
  ) : null;
}

export function CodexVoiceControl({
  voice,
  disabled,
}: {
  voice: ReturnType<typeof useCodexRealtimeVoice>;
  disabled: boolean;
}) {
  const active = ["connecting", "reconnecting", "live"].includes(voice.status);
  const label =
    voice.status === "connecting"
      ? "Connecting…"
      : voice.status === "reconnecting"
        ? "Reconnecting…"
        : voice.muted
          ? "Mic muted"
          : "Voice live";
  return (
    <View className="shrink flex-col gap-1">
      {active ? (
        <>
          <AppText accessibilityLiveRegion="polite" className="text-xs text-foreground-muted">
            {label} · {voice.audioRoute}
          </AppText>
          <View className="flex-row items-center gap-1">
            <ComposerActionButton
              accessibilityLabel={voice.muted ? "Unmute Codex voice" : "Mute Codex voice"}
              icon={voice.muted ? "mic.slash" : "mic"}
              disabled={voice.status === "connecting"}
              onPress={voice.toggleMuted}
            />
            <ComposerActionButton
              accessibilityLabel="Choose call audio output"
              icon={voice.speaker ? "speaker.wave.2.fill" : "iphone"}
              disabled={voice.status === "connecting"}
              onPress={() => {
                void voice.chooseAudioOutput();
              }}
            />
            {Platform.OS === "android" ? (
              <ComposerActionButton
                accessibilityLabel="Increase call volume"
                icon="plus"
                onPress={voice.volumeUp}
              />
            ) : null}
            <ComposerActionButton
              accessibilityLabel="End Codex voice"
              icon="phone.down.fill"
              variant="danger"
              onPress={voice.stop}
            />
          </View>
          {voice.audioError ? (
            <AppText className="text-xs text-foreground-muted">{voice.audioError}</AppText>
          ) : null}
        </>
      ) : (
        <View className="flex-row items-center gap-1">
          <ComposerActionButton
            accessibilityLabel={
              voice.status === "error" ? "Reconnect Codex voice" : "Talk to Codex"
            }
            icon="waveform"
            disabled={disabled}
            onPress={voice.start}
          />
          {voice.status === "error" ? (
            <AppText className="text-xs text-foreground-muted">Call ended · Retry</AppText>
          ) : null}
        </View>
      )}
    </View>
  );
}
