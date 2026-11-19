/** What workspace Vim mode needs from the live conversation, when one is on screen. */
export interface VimConversation {
  /** Scopes marks to one thread. */
  readonly routeKey: string;
  readonly getScrollNode: () => HTMLElement | null;
  readonly focusComposer: () => void;
  readonly onUserNavigation: () => void;
  readonly onScrollToEnd: () => void;
}

let current: VimConversation | null = null;
const listeners = new Set<() => void>();

/** The shown thread registers itself; a thread kept inert under Settings does not. */
export function registerVimConversation(conversation: VimConversation): () => void {
  current = conversation;
  for (const listener of listeners) listener();
  return () => {
    if (current !== conversation) return;
    current = null;
    for (const listener of listeners) listener();
  };
}

export function vimConversation(): VimConversation | null {
  return current;
}

/** For React: whether any conversation has Vim mode on, read with useSyncExternalStore. */
export function hasVimConversation(): boolean {
  return current !== null;
}

export function subscribeVimConversation(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
