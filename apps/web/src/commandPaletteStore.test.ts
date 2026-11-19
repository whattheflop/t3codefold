import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { afterEach, expect, it, vi } from "vite-plus/test";

import { queuedRunEditDraftId, useComposerDraftStore } from "./composerDraftStore";
import {
  dispatchCommandPalette,
  getCommandPaletteComposerTarget,
  registerCommandPaletteComposer,
} from "./commandPaletteStore";
import { discardComposerDraft } from "./lib/discardComposerDraft";
import { showThreadUndoNotice } from "./hooks/showThreadUndoNotice";

vi.mock("./lib/workspaceFocus", () => ({ getWorkspaceFocusRequestVersion: () => 0 }));
vi.mock("./lib/attachmentUploadQueue", () => ({ releaseDraftAttachments: vi.fn() }));
vi.mock("./hooks/showThreadUndoNotice", () => ({ showThreadUndoNotice: vi.fn() }));

class ComposerElement {
  isConnected = true;
  constructor(readonly form?: ComposerElement) {}
  closest() {
    return this.form ?? this;
  }
  matches() {
    return false;
  }
}

const environmentId = EnvironmentId.make("local");
const main = scopeThreadRef(environmentId, ThreadId.make("main"));
const side = scopeThreadRef(environmentId, ThreadId.make("side"));

function setup() {
  dispatchCommandPalette({ _tag: "SetOpen", open: false });
  useComposerDraftStore.setState({
    draftsByThreadKey: {},
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
  });
  vi.clearAllMocks();
  const document = { activeElement: new ComposerElement() };
  vi.stubGlobal("HTMLElement", ComposerElement);
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", { location: { href: "/threads/main" } });
  return document;
}

afterEach(() => vi.unstubAllGlobals());

it.each([main, side])(
  "discards only the invoking composer and can undo it: $threadId",
  async (target) => {
    const document = setup();
    const store = useComposerDraftStore.getState();
    store.setPrompt(main, "main reply");
    store.setPrompt(side, "side reply");
    const mainForm = new ComposerElement();
    const sideForm = new ComposerElement();
    using _main = {
      [Symbol.dispose]: registerCommandPaletteComposer(mainForm as unknown as HTMLElement, main),
    };
    using _side = {
      [Symbol.dispose]: registerCommandPaletteComposer(sideForm as unknown as HTMLElement, side),
    };
    document.activeElement = new ComposerElement(target === main ? mainForm : sideForm);
    dispatchCommandPalette({ _tag: "SetOpen", open: true });
    document.activeElement = new ComposerElement();
    dispatchCommandPalette({ _tag: "OpenSearch", query: "discard" });

    expect(getCommandPaletteComposerTarget()).toEqual(target);
    discardComposerDraft(getCommandPaletteComposerTarget()!);
    expect(useComposerDraftStore.getState().getComposerDraft(target)?.prompt ?? "").toBe("");
    const other = target === main ? side : main;
    expect(useComposerDraftStore.getState().getComposerDraft(other)?.prompt).toBe(
      `${other.threadId} reply`,
    );
    await vi.mocked(showThreadUndoNotice).mock.calls.at(-1)![0].undo();
    expect(useComposerDraftStore.getState().getComposerDraft(target)?.prompt).toBe(
      `${target.threadId} reply`,
    );
  },
);

it("hides discard during a queued edit without touching the ordinary draft", () => {
  const document = setup();
  const edit = queuedRunEditDraftId(main, "queued-run");
  useComposerDraftStore.getState().setPrompt(main, "hidden ordinary draft");
  useComposerDraftStore.getState().setPrompt(edit, "queued edit");
  const form = new ComposerElement();
  using _form = {
    [Symbol.dispose]: registerCommandPaletteComposer(form as unknown as HTMLElement, null),
  };
  document.activeElement = new ComposerElement(form);
  dispatchCommandPalette({ _tag: "SetOpen", open: true });
  expect(getCommandPaletteComposerTarget()).toBeNull();
  expect(useComposerDraftStore.getState().getComposerDraft(main)?.prompt).toBe(
    "hidden ordinary draft",
  );
  expect(useComposerDraftStore.getState().getComposerDraft(edit)?.prompt).toBe("queued edit");
});

it.each(["target changes", "permission lost", "unmounts", "navigates"])(
  "rejects a captured composer when it %s",
  (change) => {
    const document = setup();
    const form = new ComposerElement();
    const unregister = registerCommandPaletteComposer(form as unknown as HTMLElement, main);
    document.activeElement = new ComposerElement(form);
    dispatchCommandPalette({ _tag: "SetOpen", open: true });
    expect(getCommandPaletteComposerTarget()).toEqual(main);
    using _form = { [Symbol.dispose]: unregister };
    using replacements = new DisposableStack();
    if (change === "target changes" || change === "permission lost") {
      replacements.defer(
        registerCommandPaletteComposer(
          form as unknown as HTMLElement,
          change === "target changes" ? side : null,
        ),
      );
    } else if (change === "unmounts") {
      form.isConnected = false;
    } else {
      window.location.href = "/threads/elsewhere";
    }
    expect(getCommandPaletteComposerTarget()).toBeNull();
  },
);

it("does not reuse a previous composer when reopened from outside a composer", () => {
  const document = setup();
  const form = new ComposerElement();
  using _form = {
    [Symbol.dispose]: registerCommandPaletteComposer(form as unknown as HTMLElement, main),
  };
  document.activeElement = new ComposerElement(form);
  dispatchCommandPalette({ _tag: "SetOpen", open: true });
  expect(getCommandPaletteComposerTarget()).toEqual(main);
  dispatchCommandPalette({ _tag: "SetOpen", open: false });
  document.activeElement = new ComposerElement();
  dispatchCommandPalette({ _tag: "SetOpen", open: true });
  expect(getCommandPaletteComposerTarget()).toBeNull();
});
