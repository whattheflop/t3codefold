import { expect, it, vi } from "vite-plus/test";
import { act, fakeTimers, render } from "../../test/render";
import { TimelineVimMode } from "./TimelineVimMode";

async function setup(previewThreads = false) {
  await using stack = new AsyncDisposableStack();
  const targets = document.createElement("div");
  document.body.append(targets);
  stack.defer(() => targets.remove());
  const focusTarget = (selector: string, region: HTMLElement = targets) => {
    const target = document.createElement(selector.startsWith("input") ? "input" : "div");
    if (selector.includes("type=")) target.setAttribute("type", "search");
    for (const match of selector.matchAll(/\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]/g)) {
      target.setAttribute(match[1]!, match[2] ?? "");
    }
    target.tabIndex = 0;
    target.style.cssText = "width:100px;height:30px";
    region.append(target);
    return target;
  };
  const conversation = focusTarget("conversation");
  stack.use(
    await render(
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
  const environment = stack.move();
  return {
    conversation,
    focusTarget,
    async press(key: string, properties = {}) {
      const event = Object.assign(new Event("keydown", { cancelable: true }), {
        key,
        ...properties,
      });
      await act(() => window.dispatchEvent(event));
      return event;
    },
    [Symbol.asyncDispose]: () => environment.disposeAsync(),
  };
}

it.each(['input[type="search"]', '[role="searchbox"]'])(
  "Escape leaves %s and returns focus to navigation",
  async (selector) => {
    await using fixture = await setup();
    const { focusTarget, press } = fixture;
    focusTarget(selector).focus();
    await press("Escape");
    expect(document.activeElement === fixture.conversation).toBe(true);
  },
);

it("leaves ordinary input editing alone", async () => {
  await using fixture = await setup();
  const { focusTarget, press } = fixture;
  const input = focusTarget("input");
  input.focus();
  expect((await press("Escape")).defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(input);
});

it("does not leave search during composition", async () => {
  await using fixture = await setup();
  const { focusTarget, press } = fixture;
  const input = focusTarget('input[type="search"]');
  input.focus();
  await press("Escape", { isComposing: true });
  expect(document.activeElement).toBe(input);
});

it("keeps typing in the search field", async () => {
  await using fixture = await setup();
  const { focusTarget, press } = fixture;
  const input = focusTarget('input[type="search"]');
  input.focus();
  expect((await press("j")).defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(input);
});

it.each(["[data-app-sidebar]", "[data-right-panel-surface-content]"])(
  "returns search focus to its %s region and preserves local Escape handling",
  async (selector) => {
    await using fixture = await setup();
    const { focusTarget, press } = fixture;
    const region = focusTarget(selector);
    focusTarget('input[type="search"]', region).focus();
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
  await using fixture = await setup();
  const { focusTarget, press } = fixture;
  const input = focusTarget('input[type="search"]');
  input.focus();
  await press("Escape", { ctrlKey: true });
  expect(document.activeElement).toBe(input);
});

it("lets an open dialog own Escape", async () => {
  await using fixture = await setup();
  const { focusTarget, press } = fixture;
  const input = focusTarget('input[type="search"]');
  input.focus();
  const dialog = focusTarget('[role="dialog"]');
  dialog.style.cssText = "position:fixed;top:0;left:0;width:100px;height:100px";
  expect((await press("Escape")).defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(input);
});

function setupSidebar(fixture: Awaited<ReturnType<typeof setup>>) {
  using stack = new DisposableStack();
  const sidebar = fixture.focusTarget("[data-app-sidebar]");
  const rows = Array.from({ length: 3 }, () => {
    const thread = fixture.focusTarget("[data-thread-item]", sidebar);
    const row = fixture.focusTarget("[role=button]", thread);
    stack.use(vi.spyOn(row, "click"));
    return row;
  });
  rows[0]!.focus();
  const environment = stack.move();
  return { rows, [Symbol.dispose]: () => environment.dispose() };
}

it("keeps sidebar navigation focus-only when preview is disabled, and i opens the selection", async () => {
  await using fixture = await setup(false);
  using _timers = fakeTimers();
  using sidebar = setupSidebar(fixture);
  const { rows } = sidebar;
  const { press } = fixture;
  await press("j");
  await act(() => vi.runAllTimers());
  expect(document.activeElement).toBe(rows[1]);
  expect(rows[1]!.click).not.toHaveBeenCalled();
  expect((await press("i")).defaultPrevented).toBe(true);
  expect(rows[1]!.click).toHaveBeenCalledOnce();
});

it("previews only the final thread after rapid sidebar navigation, preserving focus", async () => {
  await using fixture = await setup(true);
  using _timers = fakeTimers();
  using sidebar = setupSidebar(fixture);
  const { rows } = sidebar;
  const { press } = fixture;
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
  await using fixture = await setup(true);
  using _timers = fakeTimers();
  using sidebar = setupSidebar(fixture);
  const { rows } = sidebar;
  const { press } = fixture;
  await press("j");
  fixture.conversation.focus();
  await act(() => vi.runAllTimers());
  expect(rows[1]!.click).not.toHaveBeenCalled();
});

it("does not preview project headers", async () => {
  await using fixture = await setup(true);
  using _timers = fakeTimers();
  using sidebar = setupSidebar(fixture);
  const { rows } = sidebar;
  const { press } = fixture;
  using _closest = vi.spyOn(rows[1]!, "closest").mockReturnValue(null);
  await press("j");
  await act(() => vi.runAllTimers());
  expect(rows[1]!.click).not.toHaveBeenCalled();
});
