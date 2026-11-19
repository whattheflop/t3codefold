import { expect, it, vi } from "vite-plus/test";

import { act, fakeTimers, render } from "../../test/render";
import { TimelineVimMode } from "./TimelineVimMode";
import { registerVimConversation, type VimConversation } from "./vimConversation";

/** Elements the test builds outside React, removed when the test ends. */
function fixture() {
  const elements: HTMLElement[] = [];
  const add = (selector: string, region?: HTMLElement) => {
    const target = document.createElement(selector.startsWith("input") ? "input" : "div");
    if (selector.includes("type=")) target.setAttribute("type", "search");
    for (const match of selector.matchAll(/\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]/g)) {
      target.setAttribute(match[1]!, match[2] ?? "");
    }
    target.tabIndex = 0;
    target.style.cssText = "width:100px;height:30px";
    (region ?? document.body).append(target);
    elements.push(target);
    return target;
  };
  return {
    add,
    [Symbol.dispose]: () => {
      for (const element of elements.splice(0)) element.remove();
    },
  };
}

function conversationFor(
  scrollNode: HTMLElement | null,
  overrides: Partial<VimConversation> = {},
): Disposable {
  const unregister = registerVimConversation({
    routeKey: "test",
    getScrollNode: () => scrollNode,
    focusComposer: vi.fn(),
    onUserNavigation: vi.fn(),
    onScrollToEnd: vi.fn(),
    ...overrides,
  });
  return { [Symbol.dispose]: unregister };
}

// The controller listens on window and renders only overlays, so it needs no router.
const renderMode = (previewThreads = false) =>
  render(<TimelineVimMode previewThreads={previewThreads} />, { router: false });

async function press(key: string, properties = {}) {
  const event = Object.assign(new Event("keydown", { cancelable: true }), {
    key,
    ...properties,
  });
  await act(() => window.dispatchEvent(event));
  return event;
}

it.each(['input[type="search"]', '[role="searchbox"]', "input"])(
  "Escape leaves %s and returns focus to navigation",
  async (selector) => {
    using dom = fixture();
    const conversation = dom.add("conversation");
    using _conversation = conversationFor(conversation);
    await using _screen = await renderMode();
    dom.add(selector).focus();
    await press("Escape");
    expect(document.activeElement === conversation).toBe(true);
  },
);

it("does not leave search during composition", async () => {
  using dom = fixture();
  using _conversation = conversationFor(dom.add("conversation"));
  await using _screen = await renderMode();
  const input = dom.add('input[type="search"]');
  input.focus();
  await press("Escape", { isComposing: true });
  expect(document.activeElement).toBe(input);
});

it("keeps typing in the search field", async () => {
  using dom = fixture();
  using _conversation = conversationFor(dom.add("conversation"));
  await using _screen = await renderMode();
  const input = dom.add('input[type="search"]');
  input.focus();
  expect((await press("j")).defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(input);
});

it.each(["[data-app-sidebar]", "[data-right-panel-surface-content]"])(
  "returns search focus to its %s region and preserves local Escape handling",
  async (selector) => {
    using dom = fixture();
    using _conversation = conversationFor(dom.add("conversation"));
    await using _screen = await renderMode();
    const region = dom.add(selector);
    dom.add('input[type="search"]', region).focus();
    const localEscape = vi.fn();
    using listener = new DisposableStack();
    window.addEventListener("keydown", localEscape, { once: true });
    listener.defer(() => window.removeEventListener("keydown", localEscape));
    expect((await press("Escape")).defaultPrevented).toBe(false);
    expect(document.activeElement === region).toBe(true);
    expect(localEscape).toHaveBeenCalledOnce();
  },
);

it("leaves modified Escape to the field", async () => {
  using dom = fixture();
  using _conversation = conversationFor(dom.add("conversation"));
  await using _screen = await renderMode();
  const input = dom.add('input[type="search"]');
  input.focus();
  await press("Escape", { ctrlKey: true });
  expect(document.activeElement).toBe(input);
});

it("lets an open dialog own Escape", async () => {
  using dom = fixture();
  using _conversation = conversationFor(dom.add("conversation"));
  await using _screen = await renderMode();
  const input = dom.add('input[type="search"]');
  input.focus();
  const dialog = dom.add('[role="dialog"]');
  dialog.style.cssText = "position:fixed;top:0;left:0;width:100px;height:100px";
  expect((await press("Escape")).defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(input);
});

it("lets Escape reach other listeners when Vim has nothing to cancel", async () => {
  using dom = fixture();
  const conversation = dom.add("conversation");
  using _conversation = conversationFor(conversation);
  await using _screen = await renderMode();
  conversation.focus();
  expect((await press("Escape")).defaultPrevented).toBe(false);
});

it("steps through a page area's list when no conversation is shown", async () => {
  using dom = fixture();
  const area = dom.add('[data-workspace-area="factory-fleet"][data-workspace-order="1"]');
  area.style.cssText = "width:200px;height:200px";
  const rows = Array.from({ length: 3 }, () => dom.add("[data-vim-list-item]", area));
  await using _screen = await renderMode();
  await press("j");
  expect(document.activeElement).toBe(rows[0]);
  await press("j");
  expect(document.activeElement).toBe(rows[1]);
  await press("G");
  expect(document.activeElement).toBe(rows[2]);
  await press("g");
  await press("g");
  expect(document.activeElement).toBe(rows[0]);
  // Keys the area does not use stay with the page.
  expect((await press("x")).defaultPrevented).toBe(false);
});

it("sends keys to the shown conversation, not a page area, when nothing is focused", async () => {
  using dom = fixture();
  const area = dom.add('[data-workspace-area="details"][data-workspace-order="3"]');
  dom.add("[data-vim-list-item]", area);
  const focusComposer = vi.fn();
  using _conversation = conversationFor(dom.add("conversation"), { focusComposer });
  await using _screen = await renderMode();
  await press("i");
  expect(focusComposer).toHaveBeenCalledOnce();
});

it("treats an empty thread as the conversation even before it has a message list", async () => {
  using dom = fixture();
  const area = dom.add('[data-workspace-area="details"][data-workspace-order="3"]');
  dom.add("[data-vim-list-item]", area);
  const focusComposer = vi.fn();
  using _conversation = conversationFor(null, { focusComposer });
  await using _screen = await renderMode();
  await press("i");
  expect(focusComposer).toHaveBeenCalledOnce();
});

it("labels a dialog's controls with f and activates the chosen one", async () => {
  using dom = fixture();
  await using _screen = await renderMode();
  const dialog = dom.add('[role="dialog"]');
  dialog.style.cssText = "position:fixed;top:0;left:0;width:200px;height:200px";
  const clicks = Array.from({ length: 2 }, () => {
    const button = document.createElement("button");
    button.style.cssText = "display:block;width:80px;height:30px";
    dialog.append(button);
    return vi.spyOn(button, "click");
  });
  expect((await press("f")).defaultPrevented).toBe(true);
  await press("s");
  expect(clicks[0]).not.toHaveBeenCalled();
  expect(clicks[1]).toHaveBeenCalledOnce();
});

function sidebarRows(dom: ReturnType<typeof fixture>) {
  const sidebar = dom.add("[data-app-sidebar]");
  return Array.from({ length: 3 }, () => {
    const thread = dom.add("[data-thread-item]", sidebar);
    const row = dom.add("[role=button]", thread);
    vi.spyOn(row, "click");
    return row;
  });
}

it("keeps sidebar navigation focus-only when preview is disabled, and i opens the selection", async () => {
  using dom = fixture();
  const conversation = dom.add("conversation");
  using _conversation = conversationFor(conversation);
  const rows = sidebarRows(dom);
  await using _screen = await renderMode(false);
  using _timers = fakeTimers();
  rows[0]!.focus();
  await press("j");
  await act(() => vi.runAllTimers());
  expect(document.activeElement).toBe(rows[1]);
  expect(rows[1]!.click).not.toHaveBeenCalled();
  expect((await press("i")).defaultPrevented).toBe(true);
  expect(rows[1]!.click).toHaveBeenCalledOnce();
});

it("previews only the final thread after rapid sidebar navigation, preserving focus", async () => {
  using dom = fixture();
  using _conversation = conversationFor(dom.add("conversation"));
  const rows = sidebarRows(dom);
  await using _screen = await renderMode(true);
  using _timers = fakeTimers();
  rows[0]!.focus();
  await press("j");
  expect(document.activeElement).toBe(rows[1]);
  await press("j");
  expect(document.activeElement).toBe(rows[2]);
  expect(rows[2]!.click).not.toHaveBeenCalled();
  await act(() => vi.runAllTimers());
  expect(rows[1]!.click).not.toHaveBeenCalled();
  expect(rows[2]!.click).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(rows[2]);
});

it("cancels a preview when focus leaves the selected thread", async () => {
  using dom = fixture();
  const conversation = dom.add("conversation");
  using _conversation = conversationFor(conversation);
  const rows = sidebarRows(dom);
  await using _screen = await renderMode(true);
  using _timers = fakeTimers();
  rows[0]!.focus();
  await press("j");
  conversation.focus();
  await act(() => vi.runAllTimers());
  expect(rows[1]!.click).not.toHaveBeenCalled();
});

it("does not preview project headers", async () => {
  using dom = fixture();
  using _conversation = conversationFor(dom.add("conversation"));
  const rows = sidebarRows(dom);
  await using _screen = await renderMode(true);
  using _timers = fakeTimers();
  rows[0]!.focus();
  using _closest = vi.spyOn(rows[1]!, "closest").mockReturnValue(null);
  await press("j");
  await act(() => vi.runAllTimers());
  expect(rows[1]!.click).not.toHaveBeenCalled();
});
