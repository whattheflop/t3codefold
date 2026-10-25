import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { THREAD_JUMP_KEYBINDING_COMMANDS } from "@t3tools/contracts";
import { useCallback } from "react";

import type { ThreadListV2ListItem } from "../threads/threadListV2";
import {
  useHardwareKeyboardCommand,
  type HardwareKeyboardCommand,
} from "./hardwareKeyboardCommands";
import { useThreadTraversalShortcuts } from "./threadTraversalShortcuts";

export { adjacentThreadTarget } from "./threadTraversalShortcuts";

type ThreadShortcutListItem = ThreadListV2ListItem | { readonly type: "v2-show-more" };

export function threadJumpIndex(command: HardwareKeyboardCommand) {
  return THREAD_JUMP_KEYBINDING_COMMANDS.findIndex((candidate) => candidate === command);
}

export function threadJumpTarget(
  items: ReadonlyArray<ThreadShortcutListItem>,
  command: HardwareKeyboardCommand,
) {
  let index = threadJumpIndex(command);
  if (index < 0) return null;
  for (const item of items) {
    const thread = item.type === "v2-thread" ? item.item.thread : null;
    if (thread !== null && index-- === 0) return thread;
  }
  return null;
}

export function useThreadJumpShortcuts(
  items: ReadonlyArray<ThreadShortcutListItem>,
  onSelectThread: (thread: EnvironmentThreadShell) => void,
  // Fold: the selected thread (null when none) enables previous/next thread shortcuts.
  selectedThreadKey?: string | null,
) {
  const jumpToThread = useCallback(
    (command: HardwareKeyboardCommand) => {
      const thread = threadJumpTarget(items, command);
      if (thread !== null) onSelectThread(thread);
      return true;
    },
    [items, onSelectThread],
  );
  useHardwareKeyboardCommand(THREAD_JUMP_KEYBINDING_COMMANDS, jumpToThread);
  useThreadTraversalShortcuts(items, onSelectThread, selectedThreadKey);
}
