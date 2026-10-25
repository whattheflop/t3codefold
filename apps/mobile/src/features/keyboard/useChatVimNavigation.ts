import type { LegendListRef } from "@legendapp/list/react-native";
import { useCallback, type RefObject } from "react";

import type { VimEffect } from "./vimNavigation";
import { useVimEffectHandler } from "./vimNavigationRuntime";

const CHAT_VIM_EFFECTS = ["scroll", "scrollToEdge", "focusComposer"] as const;
/** Pixels one j/k press scrolls the conversation. */
const VIM_LINE_SCROLL = 56;

/** Vim scrolling and composer focus for the thread conversation. */
export function useChatVimNavigation(input: {
  readonly listRef: RefObject<LegendListRef | null>;
  readonly composerEditorRef: RefObject<{ focus(): void } | null>;
  /** A native subagent has no composer to focus. */
  readonly composerAvailable: boolean;
  readonly onScrollToEnd: () => void;
}) {
  const { listRef, composerEditorRef, composerAvailable, onScrollToEnd } = input;
  const handleVimEffect = useCallback(
    (effect: VimEffect) => {
      const list = listRef.current;
      switch (effect.type) {
        case "focusComposer":
          if (!composerAvailable) return false;
          composerEditorRef.current?.focus();
          return;
        case "scrollToEdge":
          if (effect.edge === "bottom") onScrollToEnd();
          else void list?.scrollToOffset({ offset: 0, animated: true });
          return;
        case "scroll": {
          const state = list?.getState();
          if (!list || !state) return;
          const step = effect.unit === "line" ? VIM_LINE_SCROLL : state.scrollLength / 2;
          void list.scrollToOffset({
            offset: Math.max(0, state.scroll + step * effect.delta),
            animated: true,
          });
          return;
        }
        default:
          return false;
      }
    },
    [composerAvailable, composerEditorRef, listRef, onScrollToEnd],
  );
  useVimEffectHandler(CHAT_VIM_EFFECTS, handleVimEffect);
}
