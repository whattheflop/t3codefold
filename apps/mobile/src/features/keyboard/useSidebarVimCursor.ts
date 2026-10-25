import type { LegendListRef } from "@legendapp/list/react-native";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useCallback, type RefObject } from "react";

import { scopedThreadKey } from "../../lib/scopedEntities";
import type { ThreadListV2ThreadListItem } from "../threads/threadListV2";
import { moveVimCursor, type VimEffect } from "./vimNavigation";
import { getVimFocus, setVimFocus, useVimEffectHandler, useVimFocus } from "./vimNavigationRuntime";

const SIDEBAR_VIM_EFFECTS = ["moveCursor", "cursorToEdge", "openCursor"] as const;

/**
 * Vim cursor movement over the thread sidebar's rows. Returns the scoped key of the row under the
 * cursor while the sidebar holds Vim focus, else null.
 */
export function useSidebarVimCursor(input: {
  readonly listItems: ReadonlyArray<{ readonly type: string; readonly key: string }>;
  readonly listRef: RefObject<LegendListRef | null>;
  readonly selectedThreadKey: string | null | undefined;
  readonly onSelectThread: (thread: EnvironmentThreadShell) => void;
}): string | null {
  const { listItems, listRef, selectedThreadKey, onSelectThread } = input;
  const handleVimEffect = useCallback(
    (effect: VimEffect) => {
      const threads = listItems.flatMap((item) =>
        item.type === "v2-thread"
          ? [
              {
                item: item as ThreadListV2ThreadListItem,
                thread: (item as ThreadListV2ThreadListItem).item.thread,
              },
            ]
          : [],
      );
      const keyOf = (entry: (typeof threads)[number]) =>
        scopedThreadKey(entry.thread.environmentId, entry.thread.id);
      const currentKey = getVimFocus().cursorThreadKey ?? selectedThreadKey ?? null;
      const current = threads.find((entry) => keyOf(entry) === currentKey) ?? null;
      if (effect.type === "openCursor") {
        if (current !== null) onSelectThread(current.thread);
        return;
      }
      const target =
        effect.type === "moveCursor"
          ? moveVimCursor(threads, current, effect.delta, (a, b) => keyOf(a) === keyOf(b))
          : effect.type === "cursorToEdge"
            ? ((effect.edge === "first" ? threads[0] : threads.at(-1)) ?? null)
            : current;
      if (target === null) return;
      setVimFocus({ cursorThreadKey: keyOf(target) });
      const list = listRef.current;
      const index = list?.getState().indexByKey(target.item.key);
      const state = list?.getState();
      if (list && state && index !== undefined && (index < state.start || index > state.end)) {
        void list.scrollToItem({ item: target.item, animated: true, viewPosition: 0.5 });
      }
    },
    [listItems, listRef, onSelectThread, selectedThreadKey],
  );
  useVimEffectHandler(SIDEBAR_VIM_EFFECTS, handleVimEffect);
  const vimFocus = useVimFocus();
  return vimFocus.region === "sidebar"
    ? (vimFocus.cursorThreadKey ?? selectedThreadKey ?? null)
    : null;
}
