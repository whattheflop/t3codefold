import { useRef } from "react";
import { useStableCallback } from "../../hooks/useStableCallback";

import type { ComposerVimModeDisplay } from "../ComposerPromptEditorTiptapVim";

function formatComposerVimDisplay(display: ComposerVimModeDisplay): string {
  return display.pending ? `${display.mode} ${display.pending}` : display.mode;
}

/**
 * The Vim indicator is written through a ref so mode changes never re-render
 * the composer. The editor reads `onDisplayChange` once at mount, so it stays stable.
 */
export function useComposerVimModeIndicator() {
  const displayRef = useRef<ComposerVimModeDisplay>({ mode: "NORMAL", pending: "" });
  const indicatorElementRef = useRef<HTMLSpanElement | null>(null);
  const onDisplayChange = useStableCallback((display: ComposerVimModeDisplay) => {
    displayRef.current = display;
    const indicator = indicatorElementRef.current;
    if (indicator) indicator.textContent = formatComposerVimDisplay(display);
  });
  const attachIndicator = useStableCallback((indicator: HTMLSpanElement | null) => {
    indicatorElementRef.current = indicator;
    if (indicator) indicator.textContent = formatComposerVimDisplay(displayRef.current);
  });
  return { onDisplayChange, attachIndicator };
}

export function ComposerVimModeIndicator({
  indicatorRef,
}: {
  readonly indicatorRef: (indicator: HTMLSpanElement | null) => void;
}) {
  return (
    <span
      ref={indicatorRef}
      aria-live="polite"
      className="pointer-events-none rounded bg-primary/15 px-1.5 py-0.5 font-mono text-3xs font-semibold text-primary"
      data-testid="composer-vim-mode"
    />
  );
}
