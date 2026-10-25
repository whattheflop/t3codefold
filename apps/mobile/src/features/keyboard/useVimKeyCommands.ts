import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useCallback } from "react";

import { mobilePreferencesAtom } from "../../state/preferences";
import { useHasVimKeyHandler, useVimEffectHandler } from "./vimNavigationRuntime";

const PALETTE_VIM_EFFECTS = ["commandPalette"] as const;

/** Workspace screens: Home, threads with their files/terminal/review, and pull requests. */
function isVimWorkspacePath(pathname: string) {
  return (
    pathname === "/" || pathname.startsWith("/threads/") || pathname.startsWith("/pull-requests")
  );
}

/**
 * Whether the hardware keyboard should route plain keys to Vim navigation, and the Vim
 * effect that opens the command palette. `setPaletteOpen` must be a stable setter.
 */
export function useVimKeysEnabled(input: {
  readonly pathname: string;
  readonly paletteOpen: boolean;
  readonly setPaletteOpen: (open: boolean) => void;
}) {
  const { setPaletteOpen } = input;
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const vimNavigationEnabled =
    AsyncResult.isSuccess(preferencesResult) &&
    preferencesResult.value.vimNavigationEnabled === true;
  const hasVimKeyHandler = useHasVimKeyHandler();
  const openPaletteFromVim = useCallback(() => setPaletteOpen(true), [setPaletteOpen]);
  useVimEffectHandler(PALETTE_VIM_EFFECTS, openPaletteFromVim);
  return (
    vimNavigationEnabled &&
    hasVimKeyHandler &&
    !input.paletteOpen &&
    isVimWorkspacePath(input.pathname)
  );
}
