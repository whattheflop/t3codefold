import type { ReactNode } from "react";

import { AndroidKeyboardBackCoordinator } from "./components/AndroidKeyboardBackCoordinator";
import { LocalAgentNotificationsCoordinator } from "./features/agent-awareness/localNotifications";
import { VoiceWorkspaceProvider } from "./features/voice-input/VoiceWorkspaceProvider";

/**
 * Fold's app-wide coordinators around the navigator: live Codex voice calls (whose panel docks
 * below the navigator), Android agent activity notifications, and hardware-keyboard Back.
 */
export function FoldAppShell({ children }: { children: ReactNode }) {
  return (
    <VoiceWorkspaceProvider>
      <LocalAgentNotificationsCoordinator />
      {children}
      <AndroidKeyboardBackCoordinator />
    </VoiceWorkspaceProvider>
  );
}
