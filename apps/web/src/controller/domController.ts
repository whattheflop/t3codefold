import { openCommandPalette } from "../commandPaletteBus";
import {
  cancelControllerDictation,
  toggleControllerDictation,
} from "../speech/useDictationShortcut";
import { focusWorkspaceArea, moveWorkspaceFocus } from "../lib/workspaceFocus";
import { navigateControllerThread } from "./controllerStore";
import type { ControllerAction } from "./gamepad";

const boundarySelector =
  '[role="dialog"], [role="alertdialog"], [aria-modal="true"], [role="menu"], [data-slot="popover-popup"], [data-slot="select-popup"], [data-slot="combobox-popup"], [data-slot="autocomplete-popup"]';
const controlsSelector =
  'button, a[href], input, textarea, select, [contenteditable="true"], [role="button"], [role="checkbox"], [role="radio"], [role="switch"], [role="option"], [role^="menuitem"], [role="slider"], [tabindex], [data-controller-tree]';
export function controllerVisible(element: HTMLElement) {
  return (
    element.isConnected &&
    !element.closest(
      '[hidden], [inert], [aria-hidden="true"], [data-closed], [data-ending-style], [data-workspace-unavailable="true"], [data-chat-column-maximized-away="true"], [data-slot="sidebar"][data-state="collapsed"]',
    ) &&
    getComputedStyle(element).visibility !== "hidden" &&
    element.getClientRects().length > 0
  );
}
function usable(element: HTMLElement) {
  return (
    controllerVisible(element) &&
    !element.matches(':disabled, [aria-disabled="true"], [data-disabled]')
  );
}
function textField(element: HTMLElement) {
  return element.matches(
    'textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"]), [contenteditable="true"], [contenteditable="plaintext-only"]',
  );
}
function controllerBoundary(doc: Document) {
  return (
    [...doc.querySelectorAll<HTMLElement>(boundarySelector)].filter(controllerVisible).at(-1) ??
    null
  );
}
function controllerScope(doc: Document) {
  return (
    controllerBoundary(doc) ??
    (doc.activeElement instanceof HTMLElement
      ? doc.activeElement.closest<HTMLElement>("[data-workspace-area]")
      : null) ??
    doc.body
  );
}
function controllerTargets(scope: HTMLElement) {
  return [...scope.querySelectorAll<HTMLElement>(controlsSelector)].filter(
    (element) =>
      usable(element) &&
      !element.matches("[data-controller-hints] *") &&
      (element.tabIndex >= 0 ||
        element.matches(
          '[role="option"], [role^="menuitem"], [role="radio"], [data-controller-tree]',
        )),
  );
}
function inScrollView(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  if (
    rect.bottom <= 0 ||
    rect.top >= element.ownerDocument.documentElement.clientHeight ||
    rect.right <= 0 ||
    rect.left >= element.ownerDocument.documentElement.clientWidth
  )
    return false;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (!/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) continue;
    const box = parent.getBoundingClientRect();
    if (rect.bottom <= box.top || rect.top >= box.bottom) return false;
  }
  return true;
}
function activate(target: HTMLElement) {
  if (target.matches('[role="option"]')) {
    target.dispatchEvent(
      new PointerEvent("click", { bubbles: true, cancelable: true, pointerType: "", detail: 0 }),
    );
  } else target.click();
}
function adjustNative(target: HTMLInputElement | HTMLSelectElement, direction: number) {
  if (target instanceof HTMLSelectElement) {
    const options = [...target.options].filter((option) => !option.disabled && !option.hidden);
    const next =
      options[
        Math.max(
          0,
          Math.min(options.length - 1, options.findIndex((option) => option.selected) + direction),
        )
      ];
    if (!next) return;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(
      target,
      next.value,
    );
  } else {
    const step = Number(target.step) || 1;
    const next = Math.max(
      Number(target.min) || 0,
      Math.min(Number(target.max) || 100, target.valueAsNumber + step * direction),
    );
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      target,
      String(next),
    );
  }
  target.dispatchEvent(new Event("input", { bubbles: true }));
  target.dispatchEvent(new Event("change", { bubbles: true }));
}
function keyHandler(target: HTMLElement, key: string) {
  // Only custom widgets with explicit key handlers receive keys; never Tab or browser defaults.
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

export function createDomController(
  doc: Document,
  hint: (text: string) => void,
  back: () => void,
  unwindPane: (scope: HTMLElement) => boolean = () => false,
) {
  let marked: HTMLElement | null = null;
  let editing: HTMLElement | null = null;
  const mark = (target: HTMLElement) => {
    marked?.removeAttribute("data-controller-focus");
    marked = target;
    target.setAttribute("data-controller-focus", "");
  };
  const focus = (target: HTMLElement) => {
    editing = null;
    target.focus({ preventScroll: true });
    mark(target);
    target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  };
  const active = () => (doc.activeElement instanceof HTMLElement ? doc.activeElement : null);
  const chatArea = (name: "conversation" | "composer") => {
    const selector = `[data-workspace-area="${name}"]`;
    const column = active()?.closest<HTMLElement>(
      "[data-chat-column], [data-right-panel-surface-content]",
    );
    return (
      (column
        ? [...column.querySelectorAll<HTMLElement>(selector)].find(controllerVisible)
        : undefined) ?? [...doc.querySelectorAll<HTMLElement>(selector)].find(controllerVisible)
    );
  };
  const conversation = () => chatArea("conversation");
  const enterComposer = () => {
    const area = chatArea("composer");
    if (!area) return false;
    const destination = controllerTargets(area).find(textField) ?? area;
    editing = null;
    destination.focus({ preventScroll: true });
    mark(destination);
    return true;
  };
  const enterConversation = () => {
    const destination = conversation();
    if (!destination) return;
    editing = null;
    destination.focus({ preventScroll: true });
    mark(destination);
  };
  const reset = () => {
    cancelControllerDictation();
    editing = null;
  };
  return {
    reset,
    editTarget(target: EventTarget | null) {
      const field =
        target instanceof HTMLElement
          ? target.closest<HTMLElement>(
              'input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]',
            )
          : null;
      if (field && textField(field)) editing = field;
    },
    clear() {
      marked?.removeAttribute("data-controller-focus");
      marked = null;
    },
    scope() {
      return controllerScope(doc);
    },
    dispatch(action: ControllerAction) {
      const scope = controllerScope(doc);
      const boundary = controllerBoundary(doc);
      const target = active();
      const controlled = target?.getAttribute("aria-controls");
      const controlledNode = controlled ? doc.getElementById(controlled) : null;
      const owned =
        target &&
        (scope.contains(target) || (controlledNode && scope.contains(controlledNode))) &&
        usable(target);
      if (!boundary && action === "conversation") {
        reset();
        enterConversation();
        return;
      }
      if (!boundary && action === "reply") {
        enterComposer();
        return;
      }
      if (action === "conversation" || action === "reply") return;
      if (action === "cancel") {
        if (cancelControllerDictation()) {
          hint("Dictation cancelled");
          return;
        }
        if (editing) {
          editing.blur();
          editing = null;
          scope.focus({ preventScroll: true });
          mark(scope);
          return;
        }
        if (boundary) {
          keyHandler(owned ? target : boundary, "Escape");
          return;
        }
        if (unwindPane(scope)) return;
        if (scope.dataset.workspaceArea !== "sidebar" && focusWorkspaceArea("sidebar")) return;
        back();
        return;
      }
      if (action === "dictate") {
        let destination = owned ? target : null;
        if (!boundary && (!destination || !textField(destination))) {
          const composer = chatArea("composer");
          destination = composer ? (controllerTargets(composer).find(textField) ?? null) : null;
          if (destination) {
            destination.focus({ preventScroll: true });
            mark(destination);
          }
        }
        hint(
          toggleControllerDictation(destination)
            ? "□ Finish dictation · ○ Cancel"
            : "Voice unavailable here. Focus a supported text field and configure Voice in Settings.",
        );
        return;
      }
      if (action === "palette" || action === "chooser") {
        if (!boundary) openCommandPalette(action === "chooser" ? { query: "" } : {});
        return;
      }
      if (action === "previousThread" || action === "nextThread") {
        if (!boundary) {
          reset();
          navigateControllerThread(action === "previousThread" ? "previous" : "next");
        }
        return;
      }
      if (action === "previousPane" || action === "nextPane") {
        reset();
        if (!boundary || boundary.hasAttribute("data-app-modal"))
          moveWorkspaceFocus(action === "previousPane" ? -1 : 1);
        else
          this.scroll(
            0,
            action === "previousPane" ? -scope.clientHeight * 0.8 : scope.clientHeight * 0.8,
          );
        const destination = active();
        if (destination && usable(destination)) mark(destination);
        return;
      }
      const targets = controllerTargets(scope);
      if (action === "footer") {
        const findFooter = (root: HTMLElement) =>
          controllerTargets(root)
            .filter((element) => element.matches('[data-controller-footer], button[type="submit"]'))
            .at(-1);
        let footer = findFooter(scope);
        if (!footer && !boundary) {
          const composer = chatArea("composer");
          if (composer) footer = findFooter(composer);
        }
        if (footer) focus(footer);
        else hint("No enabled submit action in this pane");
        return;
      }
      if (action === "activate") {
        if (owned && target.matches("[data-controller-tree]")) {
          keyHandler(target, "Enter");
          mark(target);
          return;
        }
        // Acquiring focus never also activates the first (possibly destructive) action.
        if (!owned) {
          const first = targets.find(inScrollView);
          if (first) focus(first);
          return;
        }
        const selectedId = target.getAttribute("aria-activedescendant");
        const selected = selectedId ? doc.getElementById(selectedId) : null;
        if (selected && scope.contains(selected) && usable(selected)) {
          mark(selected);
          activate(selected);
          return;
        }
        if (!targets.includes(target)) {
          const first = targets.find(inScrollView);
          if (first) focus(first);
          return;
        }
        mark(target);
        if (textField(target)) {
          editing = target;
          hint("Editing · □ Dictate · ○ Leave editor");
          return;
        }
        activate(target);
        if (
          target.matches('[data-sidebar-row^="draft:"]') ||
          (target.matches("[data-sidebar-row]") && target.closest("[data-thread-item]"))
        )
          enterConversation();
        return;
      }
      if (editing === target) {
        hint("○ Leave editor to navigate · □ Dictate");
        return;
      }
      const key = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" }[
        action
      ];
      if (owned && target.matches("[data-controller-tree]")) {
        keyHandler(target, key);
        mark(target);
        return;
      }
      if (
        owned &&
        (action === "left" || action === "right") &&
        (target instanceof HTMLSelectElement ||
          (target instanceof HTMLInputElement && target.type === "range"))
      ) {
        adjustNative(target, action === "left" ? -1 : 1);
        mark(target);
        return;
      }
      if (
        owned &&
        target.matches(
          '[role="combobox"], [role="slider"], [role^="menuitem"], [role="option"], [data-slot="autocomplete-input"]',
        )
      ) {
        keyHandler(target, key);
        const selected = doc.getElementById(target.getAttribute("aria-activedescendant") ?? "");
        if (selected && usable(selected)) mark(selected);
        else mark(active() ?? target);
        return;
      }
      const current = owned && targets.includes(target) ? target : null;
      const box = current?.getBoundingClientRect();
      const horizontal = action === "left" || action === "right";
      const sign = action === "left" || action === "up" ? -1 : 1;
      const candidates = box
        ? targets
            .filter((element) => element !== current)
            .map((element) => {
              const rect = element.getBoundingClientRect();
              const dx = (rect.left + rect.right - box.left - box.right) / 2;
              const dy = (rect.top + rect.bottom - box.top - box.bottom) / 2;
              return {
                element,
                along: (horizontal ? dx : dy) * sign,
                across: Math.abs(horizontal ? dy : dx),
              };
            })
            .filter(({ along }) => along > 2)
            .sort((a, b) => a.along + a.across * 2 - b.along - b.across * 2)
        : [];
      const next = candidates[0]?.element ?? (!current ? targets.find(inScrollView) : undefined);
      if (next) focus(next);
    },
    scroll(x: number, y: number) {
      const focusedScope = controllerScope(doc);
      const scope =
        !controllerBoundary(doc) && focusedScope.dataset.workspaceArea === "composer"
          ? (conversation() ?? focusedScope)
          : focusedScope;
      let element = active();
      while (element && scope.contains(element)) {
        const style = getComputedStyle(element);
        if (
          /(auto|scroll)/.test(style.overflowY + style.overflowX) &&
          (element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth)
        ) {
          element.scrollBy({ left: x, top: y, behavior: "instant" });
          return;
        }
        element = element.parentElement;
      }
      const scroller = [...scope.querySelectorAll<HTMLElement>("*")].find(
        (node) =>
          controllerVisible(node) &&
          /(auto|scroll)/.test(getComputedStyle(node).overflowY) &&
          node.scrollHeight > node.clientHeight,
      );
      (scroller ?? scope).scrollBy({ left: x, top: y, behavior: "instant" });
    },
  };
}
