import { useEffect } from "react";
import { create } from "zustand";

import {
  type CommandPaletteUiAction,
  type CommandPaletteUiState,
  reduceCommandPaletteUiState,
} from "./components/CommandPalette.logic";
import { getWorkspaceFocusRequestVersion } from "./lib/workspaceFocus";
import { composerTargetKey, type ComposerThreadTarget } from "./composerDraftStore";

const INITIAL_STATE: CommandPaletteUiState = {
  open: false,
  mode: "command",
  openIntent: null,
  session: 0,
};

export const useCommandPaletteStore = create<CommandPaletteUiState>(() => INITIAL_STATE);

let returnFocus: { element: HTMLElement | null; href: string; focusRequest: number } | null = null;
const composerTargets = new WeakMap<HTMLElement, ComposerThreadTarget | null>();
let invokingComposer: { element: HTMLElement; target: ComposerThreadTarget } | null = null;

export function registerCommandPaletteComposer(
  element: HTMLElement,
  target: ComposerThreadTarget | null,
) {
  composerTargets.set(element, target);
  return () => composerTargets.delete(element);
}

export function getCommandPaletteComposerTarget(): ComposerThreadTarget | null {
  if (!invokingComposer || getCommandPaletteReturnFocus() === false) return null;
  const { element, target } = invokingComposer;
  const current = composerTargets.get(element);
  return element.isConnected && current && composerTargetKey(current) === composerTargetKey(target)
    ? target
    : null;
}

export function dispatchCommandPalette(action: CommandPaletteUiAction): void {
  const state = useCommandPaletteStore.getState();
  const next = reduceCommandPaletteUiState(state, action);
  if (!state.open && next.open) {
    // The workspace turns inert before the popup mounts, which blurs the opener.
    returnFocus = {
      element: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      href: window.location.href,
      focusRequest: getWorkspaceFocusRequestVersion(),
    };
    const element = returnFocus.element?.closest<HTMLElement>('[data-chat-composer-form="true"]');
    const target = element ? composerTargets.get(element) : null;
    invokingComposer = element && target ? { element, target } : null;
  }
  useCommandPaletteStore.setState(next, true);
}

/**
 * Where the closing palette should return focus: `false` when a command navigated or asked
 * for workspace focus (the destination owns it), else the opener, or `true` for the default.
 */
export function getCommandPaletteReturnFocus(): HTMLElement | boolean {
  if (
    !returnFocus ||
    window.location.href !== returnFocus.href ||
    getWorkspaceFocusRequestVersion() !== returnFocus.focusRequest
  )
    return false;
  const { element } = returnFocus;
  return element?.isConnected && !element.matches(":disabled") ? element : true;
}

// The palette is only mounted on app-shell routes (not /pair, sign-in or
// landings), so its shortcuts must stay inert elsewhere.
let mountedPalettes = 0;

export function isCommandPaletteMounted(): boolean {
  return mountedPalettes > 0;
}

/**
 * Marks the palette as mounted while the calling component is. An unmounted
 * palette cannot stay open, so the last unmount resets the store.
 */
export function useCommandPaletteMount(): void {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The palette's mount gates its global shortcuts, and leaving the route while it is open calls no close handler, so only unmount can reset the store.
  useEffect(() => {
    mountedPalettes += 1;
    return () => {
      mountedPalettes -= 1;
      if (mountedPalettes === 0) {
        useCommandPaletteStore.setState(
          (state) => ({ ...INITIAL_STATE, session: state.session + 1 }),
          true,
        );
      }
    };
  }, []);
}
