import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { TimelineVimMode } from "./TimelineVimMode";

let renderer: Root;
let container: HTMLDivElement;
let keyboard: Window;
let conversation: HTMLElement;
const targets: HTMLElement[] = [];

function focusTarget(selector: string, region?: HTMLElement) {
  const target = document.createElement(selector.startsWith("input") ? "input" : "div");
  if (selector.includes("type=")) target.setAttribute("type", "search");
  for (const match of selector.matchAll(/\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]/g)) {
    target.setAttribute(match[1]!, match[2] ?? "");
  }
  target.tabIndex = 0;
  target.style.cssText = "width:100px;height:30px";
  (region ?? document.body).append(target);
  targets.push(target);
  return target;
}

function renderMode(previewThreads = false) {
  act(() =>
    renderer.render(
      <TimelineVimMode
        routeKey="test"
        previewThreads={previewThreads}
        getScrollNode={() => conversation}
        focusComposer={vi.fn()}
        onUserNavigation={vi.fn()}
        onScrollToEnd={vi.fn()}
      />,
    ),
  );
}

beforeEach(() => {
  keyboard = window;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  conversation = focusTarget("conversation");
  container = document.createElement("div");
  document.body.append(container);
  renderer = createRoot(container);
  renderMode();
});

afterEach(() => {
  act(() => renderer.unmount());
  container.remove();
  for (const target of targets.splice(0)) target.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function press(key: string, properties = {}) {
  const event = Object.assign(new Event("keydown", { cancelable: true }), {
    key,
    ...properties,
  });
  act(() => keyboard.dispatchEvent(event));
  return event;
}

it.each(['input[type="search"]', '[role="searchbox"]'])(
  "Escape leaves %s and returns focus to navigation",
  (selector) => {
    focusTarget(selector).focus();
    press("Escape");
    expect(document.activeElement === conversation).toBe(true);
  },
);

it("leaves ordinary input editing alone", () => {
  const input = focusTarget("input");
  input.focus();
  expect(press("Escape").defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(input);
});

it("does not leave search during composition", () => {
  const input = focusTarget('input[type="search"]');
  input.focus();
  press("Escape", { isComposing: true });
  expect(document.activeElement).toBe(input);
});

it("keeps typing in the search field", () => {
  const input = focusTarget('input[type="search"]');
  input.focus();
  expect(press("j").defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(input);
});

it.each(["[data-app-sidebar]", "[data-right-panel-surface-content]"])(
  "returns search focus to its %s region and preserves local Escape handling",
  (selector) => {
    const region = focusTarget(selector);
    focusTarget('input[type="search"]', region).focus();
    const localEscape = vi.fn();
    keyboard.addEventListener("keydown", localEscape, { once: true });
    expect(press("Escape").defaultPrevented).toBe(false);
    expect(document.activeElement === region).toBe(true);
    expect(localEscape).toHaveBeenCalledOnce();
  },
);

it("leaves modified Escape to the field", () => {
  const input = focusTarget('input[type="search"]');
  input.focus();
  press("Escape", { ctrlKey: true });
  expect(document.activeElement).toBe(input);
});

it("lets an open dialog own Escape", () => {
  const input = focusTarget('input[type="search"]');
  input.focus();
  const dialog = focusTarget('[role="dialog"]');
  dialog.style.cssText = "position:fixed;top:0;left:0;width:100px;height:100px";
  expect(press("Escape").defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(input);
});

function setupSidebar(previewThreads: boolean) {
  vi.useFakeTimers();
  const sidebar = focusTarget("[data-app-sidebar]");
  const rows = Array.from({ length: 3 }, () => {
    const thread = focusTarget("[data-thread-item]", sidebar);
    const row = focusTarget("[role=button]", thread);
    vi.spyOn(row, "click");
    return row;
  });
  renderMode(previewThreads);
  rows[0]!.focus();
  return rows;
}

it("keeps sidebar navigation focus-only when preview is disabled, and i opens the selection", () => {
  const rows = setupSidebar(false);
  press("j");
  act(() => vi.runAllTimers());
  expect(document.activeElement).toBe(rows[1]);
  expect(rows[1]!.click).not.toHaveBeenCalled();
  expect(press("i").defaultPrevented).toBe(true);
  expect(rows[1]!.click).toHaveBeenCalledOnce();
});

it("previews only the final thread after rapid sidebar navigation, preserving focus", () => {
  const rows = setupSidebar(true);
  press("j");
  expect(document.activeElement).toBe(rows[1]);
  press("j");
  expect(document.activeElement).toBe(rows[2]);
  expect(rows[2]!.click).not.toHaveBeenCalled();
  act(() => vi.runAllTimers());
  expect(rows[1]!.click).not.toHaveBeenCalled();
  expect(rows[2]!.click).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(rows[2]);
});

it("cancels a preview when focus leaves the selected thread", () => {
  const rows = setupSidebar(true);
  press("j");
  conversation.focus();
  act(() => vi.runAllTimers());
  expect(rows[1]!.click).not.toHaveBeenCalled();
});

it("does not preview project headers", () => {
  const rows = setupSidebar(true);
  vi.spyOn(rows[1]!, "closest").mockReturnValue(null);
  press("j");
  act(() => vi.runAllTimers());
  expect(rows[1]!.click).not.toHaveBeenCalled();
});
