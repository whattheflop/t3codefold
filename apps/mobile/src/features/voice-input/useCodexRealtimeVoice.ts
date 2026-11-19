import { useEffect } from "react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useVoiceWorkspace } from "./VoiceWorkspaceProvider";
export function useCodexRealtimeVoice(input: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  enabled: boolean;
  title?: string;
}) {
  const { workspace, state, audio } = useVoiceWorkspace();
  const { environmentId, threadId, enabled, title = "Current thread" } = input;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers this thread as the voice workspace view while mounted
  useEffect(() => {
    workspace.setView(enabled ? { environmentId, threadId, title } : null);
    return () => workspace.setView(null);
  }, [workspace, environmentId, threadId, enabled, title]);
  return {
    ...state.voice,
    ...audio,
    start: () => {
      if (enabled) void workspace.start({ environmentId, threadId, title });
    },
    stop: () => {
      void workspace.stop();
    },
    toggleMuted: () => workspace.toggleMuted(),
  };
}
