import type { ResolvedKeybindingsConfig } from "@t3tools/contracts";

import { DEFAULT_RESOLVED_KEYBINDINGS } from "./keybindings.ts";

// Live voice shortcut compatibility across client and host versions.
// Re-exported from ./keybindings.ts.

/** Old clients must never receive command literals their config decoder cannot represent. */
export function keybindingsForVoiceClient(
  keybindings: ResolvedKeybindingsConfig,
  voiceControls: boolean,
): ResolvedKeybindingsConfig {
  return voiceControls
    ? keybindings
    : keybindings.filter((binding) => !binding.command.startsWith("voice."));
}

/** Older hosts do not know the voice shortcuts. Host bindings retain precedence. */
export function withDefaultVoiceKeybindings(
  keybindings: ResolvedKeybindingsConfig,
): ResolvedKeybindingsConfig {
  return [
    ...DEFAULT_RESOLVED_KEYBINDINGS.filter(
      (binding) =>
        binding.command.startsWith("voice.") &&
        !keybindings.some((existing) => existing.command === binding.command),
    ),
    ...keybindings,
  ];
}
