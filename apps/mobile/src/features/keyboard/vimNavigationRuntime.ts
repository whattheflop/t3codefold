import { useEffect, useSyncExternalStore } from "react";

import type { VimEffect, VimKey, VimRegion } from "./vimNavigation";

type VimEffectType = VimEffect["type"];
type VimEffectHandler = (effect: VimEffect) => boolean | void;

const effectHandlers = new Map<VimEffectType, Set<VimEffectHandler>>();
let keyHandler: ((key: VimKey) => void) | null = null;
const keyHandlerListeners = new Set<() => void>();

/**
 * Lets the component that owns a behavior perform a Vim effect: the sidebar
 * moves its cursor, the chat scrolls, the composer takes focus. The most
 * recently mounted handler goes first; returning false passes it on.
 */
export function useVimEffectHandler(
  types: ReadonlyArray<VimEffectType>,
  handler: VimEffectHandler,
): void {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers a Vim effect handler in the module registry until unmount
  useEffect(() => {
    for (const type of types) {
      const handlers = effectHandlers.get(type) ?? new Set();
      handlers.add(handler);
      effectHandlers.set(type, handlers);
    }
    return () => {
      for (const type of types) {
        const handlers = effectHandlers.get(type);
        handlers?.delete(handler);
        if (handlers?.size === 0) effectHandlers.delete(type);
      }
    };
  }, [types, handler]);
}

export function dispatchVimEffect(effect: VimEffect): boolean {
  const handlers = Array.from(effectHandlers.get(effect.type) ?? []);
  for (let index = handlers.length - 1; index >= 0; index -= 1) {
    if (handlers[index]?.(effect) !== false) return true;
  }
  return false;
}

/** The workspace registers the one handler that interprets Vim keys. */
export function useVimKeyHandler(handler: (key: VimKey) => void): void {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- installs the workspace Vim key handler in the module registry until unmount
  useEffect(() => {
    keyHandler = handler;
    keyHandlerListeners.forEach((listener) => listener());
    return () => {
      if (keyHandler !== handler) return;
      keyHandler = null;
      keyHandlerListeners.forEach((listener) => listener());
    };
  }, [handler]);
}

export function dispatchVimKey(key: VimKey): void {
  keyHandler?.(key);
}

function subscribeToKeyHandler(listener: () => void) {
  keyHandlerListeners.add(listener);
  return () => keyHandlerListeners.delete(listener);
}

/** Whether a workspace is mounted to receive Vim keys. */
export function useHasVimKeyHandler(): boolean {
  return useSyncExternalStore(
    subscribeToKeyHandler,
    () => keyHandler !== null,
    () => keyHandler !== null,
  );
}

/**
 * What Vim navigation is pointing at, for display: the focused pane and the
 * sidebar's thread cursor. `region` is null until a Vim key has been pressed,
 * so touch-only use never shows keyboard focus.
 */
export interface VimFocus {
  readonly region: VimRegion | null;
  readonly cursorThreadKey: string | null;
}

let focus: VimFocus = { region: null, cursorThreadKey: null };
const focusListeners = new Set<() => void>();

export function setVimFocus(next: Partial<VimFocus>): void {
  const merged = { ...focus, ...next };
  if (merged.region === focus.region && merged.cursorThreadKey === focus.cursorThreadKey) return;
  focus = merged;
  focusListeners.forEach((listener) => listener());
}

export function getVimFocus(): VimFocus {
  return focus;
}

function subscribeToFocus(listener: () => void) {
  focusListeners.add(listener);
  return () => focusListeners.delete(listener);
}

export function useVimFocus(): VimFocus {
  return useSyncExternalStore(subscribeToFocus, getVimFocus, getVimFocus);
}
