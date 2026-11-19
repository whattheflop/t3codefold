import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { shouldTypeToFocusComposer } from "./composerFocusRedirect";

function keydown(key: string): KeyboardEvent {
  return {
    key,
    isComposing: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    defaultPrevented: false,
    target: null,
    composedPath: () => [],
  } as unknown as KeyboardEvent;
}

function stubDocument(vimMounted: boolean) {
  vi.stubGlobal("document", {
    querySelector: (selector: string) =>
      vimMounted && selector === "[data-timeline-vim-mode]" ? {} : null,
  });
}

describe("type-to-focus with Vim mode", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("leaves printable keys to Vim while Vim mode is mounted", () => {
    stubDocument(true);
    for (const key of ["j", "k", "f", "G"])
      expect(shouldTypeToFocusComposer(keydown(key))).toBe(false);
  });

  it("still sends printable keys to the composer without Vim mode", () => {
    stubDocument(false);
    expect(shouldTypeToFocusComposer(keydown("j"))).toBe(true);
  });
});
