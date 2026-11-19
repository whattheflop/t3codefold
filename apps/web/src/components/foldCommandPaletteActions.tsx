import { msg, useMessages } from "gt-react";
import { type MessageResolver } from "../i18n/messages";
import type { EnvironmentId } from "@t3tools/contracts";
import type { useNavigate } from "@tanstack/react-router";
import { CrownIcon, SettingsIcon } from "lucide-react";

import { ITEM_ICON_CLASS, type CommandPaletteActionItem } from "./CommandPalette.logic";
import { runVoiceAction, useOptionalVoiceWorkspace } from "./voice/VoiceWorkspaceProvider";

/** Live voice call controls; the palette lists them first while a voice workspace is mounted. */
export function useFoldVoiceActionItems(): CommandPaletteActionItem[] {
  const m = useMessages();
  const voiceWorkspace = useOptionalVoiceWorkspace();
  if (!voiceWorkspace) return [];
  return (
    [
      ["voice.toggle", msg("Start or end voice call")],
      ["voice.mute", msg("Mute or unmute voice microphone")],
      ["voice.outputMute", msg("Mute or unmute voice speaker")],
    ] as const
  ).map(([command, title]) => ({
    kind: "action",
    value: `action:${command}`,
    title: m(title),
    searchTerms: ["voice", "live", "audio", "microphone"],
    icon: <SettingsIcon className={ITEM_ICON_CLASS} />,
    shortcutCommand: command,
    run: async () => {
      runVoiceAction(voiceWorkspace, command);
    },
  }));
}

/** Opens GLaDOS settings, preselecting the active thread's machine. */
export function foldGladosActionItem(
  navigate: ReturnType<typeof useNavigate>,
  environmentId: EnvironmentId | undefined,
  m: MessageResolver,
): CommandPaletteActionItem {
  return {
    kind: "action",
    value: "action:pitboss",
    searchTerms: ["glados", "pitboss", "agents", "coordinator", "brief", "summon"],
    title: m(msg("Set up or edit GLaDOS")),
    icon: <CrownIcon className={ITEM_ICON_CLASS} />,
    run: async () => {
      await navigate({
        to: "/settings/glados",
        search: environmentId ? { machine: environmentId } : {},
      });
    },
  };
}
