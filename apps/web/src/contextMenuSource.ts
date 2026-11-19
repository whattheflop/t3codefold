import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ContextMenuSource } from "@t3tools/contracts";

// Chromium uses no button for keyboard context menus and zero clicks for keyboard activation.
export function contextMenuSourceOf(
  event: Pick<MouseEvent, "type" | "button" | "detail">,
): ContextMenuSource {
  return (event.type === "click" ? event.detail === 0 : event.button === -1) ? "keyboard" : "mouse";
}

// Chromium on macOS does not synthesize a contextmenu event for Shift+F10.
export function openContextMenuFromKeyboard(event: ReactKeyboardEvent<HTMLElement>) {
  if (
    event.defaultPrevented ||
    event.nativeEvent.isComposing ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    !(event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))
  )
    return;
  event.preventDefault();
  event.stopPropagation();
  if (event.repeat) return;
  const target = event.currentTarget;
  const rect = target.getBoundingClientRect();
  target.dispatchEvent(
    new PointerEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: -1,
      clientX: rect.left,
      clientY: rect.bottom,
    }),
  );
}
