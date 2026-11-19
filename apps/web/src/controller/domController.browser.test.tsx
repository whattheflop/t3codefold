import { createRef, useState } from "react";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { act, render } from "../../test/render";
import { Dialog, DialogPopup, DialogTitle } from "../components/ui/dialog";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../components/ui/menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Command, CommandInput, CommandItem, CommandList } from "../components/ui/command";
import { useDictationShortcut, cancelControllerDictation } from "../speech/useDictationShortcut";
import { createDomController } from "./domController";
import * as workspaceFocus from "../lib/workspaceFocus";

vi.mock("../hooks/useSettings", () => ({ useClientSettings: () => "toggle" }));

it("leaves editor ownership behind when the controller switches panes", async () => {
  await using screen = await render(
    <>
      <div data-workspace-area="composer" data-workspace-order="1" tabIndex={-1}>
        <textarea />
      </div>
      <div data-workspace-area="panel" data-workspace-order="2" tabIndex={-1}>
        <button>Panel action</button>
      </div>
    </>,
  );
  using _workspace = { [Symbol.dispose]: workspaceFocus.startWorkspaceFocus(screen.router!) };
  const unwind = vi.fn(() => true);
  const controller = createDomController(document, vi.fn(), vi.fn(), unwind);
  using _clear = { [Symbol.dispose]: () => controller.clear() };
  screen.container.querySelector("textarea")!.focus();
  await act(() => controller.dispatch("activate"));
  await act(() => controller.dispatch("nextPane"));
  await act(() => controller.dispatch("cancel"));
  expect(unwind).toHaveBeenCalledOnce();
});

type Speech = Parameters<typeof useDictationShortcut>[0]["speech"];
function VoiceTarget({
  speech,
  fieldRef,
}: {
  speech: Speech;
  fieldRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  useDictationShortcut({
    keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
    speech,
    targetRef: fieldRef,
    disabled: false,
    terminalOpen: false,
    modelPickerOpen: false,
  });
  return <textarea ref={fieldRef} aria-label="Custom answer" />;
}

it("moves within the top dialog, excludes disabled/hidden choices, and activates only the focused semantic action", async () => {
  const approve = vi.fn();
  const underlying = vi.fn();
  await using screen = await render(
    <>
      <button onClick={underlying}>Underlying</button>
      <Dialog defaultOpen>
        <DialogPopup>
          <DialogTitle>Decision</DialogTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <button disabled>Disabled</button>
            <button hidden>Hidden</button>
            <button>Review</button>
            <button data-controller-footer onClick={approve}>
              Allow once
            </button>
          </div>
        </DialogPopup>
      </Dialog>
    </>,
  );
  await expect.element(page.getByRole("dialog")).toBeVisible();
  const controller = createDomController(document, vi.fn(), vi.fn());
  using _clear = { [Symbol.dispose]: () => controller.clear() };
  document.querySelector<HTMLElement>('[role="dialog"]')!.focus();
  await act(() => controller.dispatch("down"));
  expect(document.activeElement?.textContent).toBe("Review");
  await act(() => controller.dispatch("down"));
  expect(document.activeElement?.textContent).toBe("Allow once");
  expect(approve).not.toHaveBeenCalled();
  await act(() => controller.dispatch("activate"));
  expect(approve).toHaveBeenCalledOnce();
  expect(underlying).not.toHaveBeenCalled();
  expect(screen.container.querySelector("button")?.hasAttribute("data-controller-focus")).toBe(
    false,
  );
});

it("uses custom menu/select handlers and closes popups through their Escape owner", async () => {
  const choose = vi.fn();
  await using screen = await render(
    <div data-workspace-area="composer">
      <Menu>
        <MenuTrigger>Actions</MenuTrigger>
        <MenuPopup>
          <MenuItem onClick={choose}>Choose</MenuItem>
        </MenuPopup>
      </Menu>
      <Select onValueChange={choose}>
        <SelectTrigger aria-label="Theme">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="dark">Dark</SelectItem>
          <SelectItem value="light">Light</SelectItem>
        </SelectContent>
      </Select>
    </div>,
  );
  const controller = createDomController(document, vi.fn(), vi.fn());
  using _clear = { [Symbol.dispose]: () => controller.clear() };
  screen.container.querySelector<HTMLElement>("[data-slot=menu-trigger]")!.focus();
  await act(() => controller.dispatch("activate"));
  await expect.element(page.getByRole("menu")).toBeVisible();
  await expect.element(page.getByRole("menuitem", { name: "Choose" })).toHaveFocus();
  await act(() => controller.dispatch("activate"));
  expect(choose).toHaveBeenCalledOnce();
  screen.container.querySelector<HTMLElement>("[data-slot=select-trigger]")!.focus();
  await act(() => controller.dispatch("activate"));
  await expect.element(page.getByRole("option", { name: "Dark" })).toBeVisible();
  await act(() => controller.dispatch("down"));
  await act(() => controller.dispatch("activate"));
  expect(choose).toHaveBeenCalledTimes(2);
  screen.container.querySelector<HTMLElement>("[data-slot=menu-trigger]")!.focus();
  await act(() => controller.dispatch("activate"));
  await expect.element(page.getByRole("menu")).toBeVisible();
  await act(() => controller.dispatch("cancel"));
  await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
});

it("navigates virtual command options through the input's existing arrow handler and Cross click", async () => {
  const choose = vi.fn();
  await using screen = await render(
    <div role="dialog" aria-label="Commands">
      <Command>
        <CommandInput aria-label="Search" />
        <CommandList>
          <CommandItem value="first" onClick={() => choose("first")}>
            First
          </CommandItem>
          <CommandItem value="second" onClick={() => choose("second")}>
            Second
          </CommandItem>
        </CommandList>
      </Command>
    </div>,
  );
  const controller = createDomController(document, vi.fn(), vi.fn());
  using _clear = { [Symbol.dispose]: () => controller.clear() };
  const input = screen.container.querySelector("input")!;
  input.focus();
  await act(() => controller.dispatch("down"));
  const selectedId = input.getAttribute("aria-activedescendant");
  expect(selectedId).toBeTruthy();
  const expected = document.getElementById(selectedId!)?.textContent?.toLowerCase();
  expect(choose).not.toHaveBeenCalled();
  await act(() => controller.dispatch("activate"));
  expect(choose).toHaveBeenCalledWith(expected);
});

it("captures focused dictation, cancels async startup before popup unwind, and never targets an unrelated field", async () => {
  const fieldRef = createRef<HTMLTextAreaElement>();
  let finishStart!: () => void;
  const starting = new Promise<void>((resolve) => {
    finishStart = resolve;
  });
  const speech = {
    available: true,
    state: { phase: "idle" as const, error: null, errorAction: null },
    start: vi.fn(() => starting),
    stop: vi.fn(async () => {}),
    cancel: vi.fn(),
  };
  const hint = vi.fn();
  const close = vi.fn();
  await using screen = await render(
    <div data-workspace-area="composer">
      <VoiceTarget speech={speech} fieldRef={fieldRef} />
      <input aria-label="Unrelated" />
      <button onClick={close}>Send</button>
    </div>,
  );
  const controller = createDomController(document, hint, close);
  using _clear = {
    [Symbol.dispose]: () => {
      cancelControllerDictation();
      controller.clear();
    },
  };
  fieldRef.current!.focus();
  fieldRef.current!.blur();
  await act(() => controller.dispatch("dictate"));
  expect(speech.start).toHaveBeenCalledOnce();
  await act(() => controller.dispatch("cancel"));
  expect(speech.cancel).toHaveBeenCalledOnce();
  finishStart();
  await starting;
  expect(speech.stop).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  screen.container.querySelector("input")!.focus();
  await act(() => controller.dispatch("dictate"));
  expect(speech.start).toHaveBeenCalledOnce();
  expect(hint).toHaveBeenLastCalledWith(expect.stringContaining("Voice unavailable"));
});

it("enters the conversation at its current scroll position and scrolls it from the composer", async () => {
  await using screen = await render(
    <>
      <div data-workspace-area="sidebar">
        <div data-thread-item="env:thread">
          <button data-sidebar-row="env:thread">Thread</button>
        </div>
      </div>
      <div
        data-workspace-area="conversation"
        tabIndex={-1}
        style={{ height: 120, overflow: "auto" }}
      >
        <button>Old action</button>
        <div style={{ height: 800 }} />
        <button>Recent action</button>
      </div>
      <div data-workspace-area="composer">
        <textarea aria-label="Reply" />
      </div>
    </>,
  );
  const conversation = screen.container.querySelector<HTMLElement>(
    '[data-workspace-area="conversation"]',
  )!;
  conversation.scrollTop = conversation.scrollHeight - conversation.clientHeight;
  const initialScroll = conversation.scrollTop;
  screen.container.querySelector("button")!.focus();
  const controller = createDomController(document, vi.fn(), vi.fn());
  using _clear = { [Symbol.dispose]: () => controller.clear() };
  await act(() => controller.dispatch("activate"));
  expect(document.activeElement).toBe(conversation);
  expect(conversation.scrollTop).toBe(initialScroll);
  await act(() => controller.dispatch("activate"));
  expect(document.activeElement?.textContent).toBe("Recent action");
  screen.container.querySelector("textarea")!.focus();
  const before = conversation.scrollTop;
  await act(() => controller.scroll(0, -50));
  expect(conversation.scrollTop).toBe(before - 50);
});

it("adjusts native Settings ranges through their change handler and focuses submit without sending", async () => {
  function Settings() {
    const [value, setValue] = useState(2);
    return (
      <div
        data-workspace-area="settings"
        style={{ display: "flex", flexDirection: "column", gap: 16 }}
      >
        <select aria-label="Theme" defaultValue="light">
          <option value="light">Light</option>
          <option value="disabled" disabled>
            Unavailable
          </option>
          <option value="dark">Dark</option>
        </select>
        <input
          aria-label="Size"
          type="range"
          min={0}
          max={10}
          value={value}
          onChange={(event) => setValue(event.currentTarget.valueAsNumber)}
        />
        <output>{value}</output>
        <button type="submit" onClick={send}>
          Save
        </button>
      </div>
    );
  }
  const send = vi.fn();
  await using screen = await render(<Settings />);
  const controller = createDomController(document, vi.fn(), vi.fn());
  using _clear = { [Symbol.dispose]: () => controller.clear() };
  const select = screen.container.querySelector("select")!;
  select.focus();
  await act(() => controller.dispatch("right"));
  expect(select.value).toBe("dark");
  await act(() => controller.dispatch("left"));
  expect(select.value).toBe("light");
  await act(() => controller.dispatch("down"));
  expect(document.activeElement).toBe(screen.container.querySelector("input"));
  await act(() => controller.dispatch("right"));
  await expect.element(screen.getByRole("status")).toHaveTextContent("3");
  await act(() => controller.dispatch("down"));
  expect(document.activeElement?.textContent).toBe("Save");
  await expect.element(screen.getByRole("status")).toHaveTextContent("3");
  await act(() => controller.dispatch("footer"));
  expect(document.activeElement?.textContent).toBe("Save");
  expect(send).not.toHaveBeenCalled();
  await act(() => controller.dispatch("activate"));
  expect(send).toHaveBeenCalledOnce();
});

it("keeps passive toast popups outside the focused workspace scope", async () => {
  const activateWorkspace = vi.fn();
  const dismissToast = vi.fn();
  await using screen = await render(
    <>
      <div data-workspace-area="composer">
        <button onClick={activateWorkspace}>Workspace action</button>
      </div>
      <div data-slot="toast-popup" role="status">
        Copy failed
        <button onClick={dismissToast}>Dismiss notification</button>
      </div>
    </>,
  );
  const workspace = screen.container.querySelector<HTMLElement>("[data-workspace-area]")!;
  workspace.querySelector("button")!.focus();
  const controller = createDomController(document, vi.fn(), vi.fn());
  using _clear = { [Symbol.dispose]: () => controller.clear() };
  expect(controller.scope()).toBe(workspace);
  await act(() => controller.dispatch("activate"));
  expect(activateWorkspace).toHaveBeenCalledOnce();
  expect(dismissToast).not.toHaveBeenCalled();
});

it("activates sidebar grouping controls in place and enters chat only for thread and draft rows", async () => {
  const choose = vi.fn();
  await using screen = await render(
    <>
      <div data-workspace-area="sidebar">
        <button data-sidebar-row="group:env:project" onClick={choose}>
          Project
        </button>
        <button data-sidebar-row="shelf:settled" onClick={choose}>
          Settled
        </button>
        <button data-sidebar-row="settled:more" onClick={choose}>
          Show more
        </button>
        <button data-sidebar-row="draft:new" onClick={choose}>
          Draft
        </button>
      </div>
      <div data-workspace-area="conversation" tabIndex={-1} />
    </>,
  );
  const controller = createDomController(document, vi.fn(), vi.fn());
  using _clear = { [Symbol.dispose]: () => controller.clear() };
  for (const button of screen.container.querySelectorAll("button")) {
    button.focus();
    await act(() => controller.dispatch("activate"));
    expect(document.activeElement).toBe(
      button.textContent === "Draft"
        ? screen.container.querySelector('[data-workspace-area="conversation"]')
        : button,
    );
  }
  expect(choose).toHaveBeenCalledTimes(4);
});

it("keeps conversation, reply, footer and composer scrolling in the focused side chat", async () => {
  await using screen = await render(
    <>
      {["main", "side"].map((name) => (
        <div data-chat-column key={name}>
          <div
            data-workspace-area="conversation"
            tabIndex={-1}
            style={{ height: 100, overflow: "auto" }}
          >
            <div style={{ height: 800 }}>{name}</div>
          </div>
          <div data-workspace-area="composer" tabIndex={-1}>
            <textarea aria-label={name} />
            <button data-controller-footer>{name} send</button>
          </div>
        </div>
      ))}
    </>,
  );
  const side = screen.container.querySelectorAll("[data-chat-column]")[1]!;
  const conversation = side.querySelector<HTMLElement>('[data-workspace-area="conversation"]')!;
  const input = side.querySelector("textarea")!;
  const controller = createDomController(document, vi.fn(), vi.fn());
  using _clear = { [Symbol.dispose]: () => controller.clear() };
  input.focus();
  conversation.scrollTop = 100;
  await act(() => controller.scroll(0, 50));
  expect(conversation.scrollTop).toBe(150);
  await act(() => controller.dispatch("conversation"));
  expect(document.activeElement).toBe(conversation);
  await act(() => controller.dispatch("reply"));
  expect(document.activeElement).toBe(input);
  conversation.focus();
  await act(() => controller.dispatch("footer"));
  expect(document.activeElement?.textContent).toBe("side send");
});
