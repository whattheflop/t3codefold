import { expect, it, vi } from "vite-plus/test";
import {
  createControllerNavigation,
  type ControllerNativeEffect,
  type ControllerScene,
} from "./controllerNavigation";

const region = (
  id: string,
  kind: ControllerScene["regions"][number]["kind"],
  surfaceId = "chat",
  pane: "sidebar" | "content" | "inspector" = kind === "threads"
    ? "sidebar"
    : kind === "inspector"
      ? "inspector"
      : "content",
) => ({ id, kind, surfaceId, pane, viewportHeight: 600, canScrollUp: false, canScrollDown: false });
const target = (
  id: string,
  regionId: string,
  kind: ControllerScene["targets"][number]["kind"] = "action",
  registered = true,
) => ({ id, regionId, kind, registered, selected: false });
const conversation = (): ControllerScene => ({
  regions: [
    region("threads", "threads", ""),
    region("chat", "conversation"),
    region("reply", "composer"),
  ],
  targets: [
    target("thread", "threads", "thread"),
    target("fold", "chat"),
    target("field", "reply", "reply"),
    target("microphone", "reply", "action", false),
    target("send", "reply", "footer"),
  ],
  focusedTargetId: null,
  editorFocused: false,
});
function setup() {
  const navigation = createControllerNavigation();
  const effects: ControllerNativeEffect[] = [];
  let scene = conversation();
  const jobs: Promise<ControllerScene | null>[] = [];
  const invoke = vi.fn(() => true);
  const back = vi.fn();
  const command = vi.fn();
  const voice = vi.fn(() => false);
  const host = (id: string, parentId: string | null = null, modal = false) => ({
    id,
    parentId,
    modal,
    invoke,
    back,
    command,
    voice,
    failed: vi.fn(),
    native: (effect: ControllerNativeEffect) => {
      effects.push(effect);
      const job = Promise.resolve(scene);
      jobs.push(job);
      return job;
    },
  });
  const dispose = navigation.present(host("workspace"));
  const send = (action: string, id = "workspace", targetId = "") =>
    navigation.dispatch(id, { action, targetId, scene });
  return {
    navigation,
    effects,
    invoke,
    back,
    command,
    voice,
    host,
    dispose,
    send,
    setScene(value: ControllerScene) {
      scene = value;
    },
    settle: () => Promise.all(jobs),
  };
}

it("reaches the actual microphone in deterministic composer order and separates acquisition from activation", async () => {
  const f = setup();
  f.setScene({
    regions: [region("root", "content", "")],
    targets: [],
    focusedTargetId: null,
    editorFocused: false,
  });
  f.send("scene");
  f.setScene({
    ...conversation(),
    regions: [region("root", "content", ""), ...conversation().regions],
  });
  f.send("scene");
  const withHeader = conversation();
  f.setScene({
    ...withHeader,
    regions: [region("header", "header", ""), ...withHeader.regions],
    targets: [target("tools", "header"), ...withHeader.targets],
  });
  f.send("enabled");
  expect(f.navigation.snapshot().position?.regionId).toBe("chat");
  f.send("up");
  expect(f.navigation.snapshot().position?.targetId).toBe("tools");
  f.send("down");
  expect(f.navigation.snapshot().position?.regionId).toBe("chat");
  f.setScene({
    ...conversation(),
    targets: conversation().targets.filter((candidate) => candidate.kind !== "reply"),
  });
  f.send("reply");
  f.setScene(conversation());
  f.send("scene");
  expect(f.navigation.snapshot().position?.targetId).toBe("field");
  f.send("down");
  expect(f.navigation.snapshot().position?.targetId).toBe("microphone");
  f.send("conversation");
  expect(f.navigation.snapshot().position?.regionId).toBe("chat");
  f.send("reply");
  f.send("down");
  expect(f.navigation.snapshot().position?.targetId).toBe("microphone");
  expect(f.invoke).not.toHaveBeenCalled();
  f.send("activate");
  expect(f.effects.at(-1)?.kind).toBe("activate");
  expect(f.effects.at(-1)?.targetId).toBe("microphone");
  f.send("down");
  f.send("activate");
  expect(f.invoke).toHaveBeenCalledWith("send", "activate");
  f.invoke.mockClear();
  f.setScene({
    ...conversation(),
    targets: conversation().targets.filter((candidate) => candidate.regionId !== "reply"),
  });
  f.send("conversation");
  f.send("dictate");
  f.send("back");
  f.setScene(conversation());
  f.send("scene");
  expect(f.invoke).not.toHaveBeenCalled();
  f.setScene({
    ...conversation(),
    targets: conversation().targets.filter((candidate) => candidate.regionId !== "reply"),
  });
  f.send("conversation");
  f.send("dictate");
  f.setScene(conversation());
  f.send("scene");
  expect(f.invoke).toHaveBeenCalledOnce();
  expect(f.invoke).toHaveBeenLastCalledWith("field", "dictate");
  f.invoke.mockClear();
  f.setScene({
    ...conversation(),
    targets: conversation().targets.filter((candidate) => candidate.regionId !== "reply"),
  });
  f.send("conversation");
  f.send("dictate");
  f.send("suspended");
  f.setScene(conversation());
  f.send("resumed");
  expect(f.navigation.snapshot().position?.targetId).toBe("field");
  expect(f.invoke).not.toHaveBeenCalled();
  const compact = conversation();
  f.setScene({
    ...compact,
    regions: compact.regions.filter((region) => region.kind !== "threads"),
    targets: compact.targets.filter((target) => target.regionId !== "threads"),
  });
  f.send("conversation");
  f.send("left");
  expect(f.back).toHaveBeenCalledOnce();
  await f.settle();
});

it("owns nested modal input by declared ancestry even when child presentation precedes its parent", async () => {
  const f = setup();
  f.send("enabled");
  f.send("reply");
  const child = f.navigation.present(f.host("child", "modal", true));
  const modal = f.navigation.present(f.host("modal", "workspace", true));
  expect(f.navigation.isActive("child")).toBe(true);
  f.send("next");
  expect(f.command).not.toHaveBeenCalled();
  f.setScene({
    regions: [region("dialog", "content", "")],
    targets: [target("cancel", "dialog"), target("confirm", "dialog")],
    focusedTargetId: null,
    editorFocused: false,
  });
  f.send("scene", "child");
  f.send("activate", "child");
  expect(f.invoke).toHaveBeenCalledWith("cancel", "activate");
  child();
  expect(f.navigation.isActive("modal")).toBe(true);
  modal();
  expect(f.navigation.snapshot().position?.targetId).toBe("field");
  await f.settle();
});

it("preserves selection through interruptions and repairs removed controls without activating their replacements", async () => {
  const f = setup();
  f.send("enabled");
  f.send("activate");
  expect(f.navigation.snapshot().position?.targetId).toBe("fold");
  f.navigation.dispatch("workspace", {
    action: "activate",
    scopeId: "retired-route",
    targetId: "fold",
    scene: conversation(),
  });
  expect(f.invoke).not.toHaveBeenCalled();
  f.send("suspended");
  f.send("activate");
  expect(f.invoke).not.toHaveBeenCalled();
  const scene = conversation();
  f.setScene({ ...scene, focusedTargetId: "thread" });
  f.send("resumed");
  expect(f.effects.at(-1)?.targetId).toBe("fold");
  expect(f.invoke).not.toHaveBeenCalled();
  f.setScene({
    ...scene,
    targets: [
      target("replacement", "chat"),
      ...scene.targets.filter((entry) => entry.id !== "fold"),
    ],
  });
  f.send("scene");
  f.send("activate");
  expect(f.navigation.snapshot().position?.targetId).toBe("replacement");
  expect(f.invoke).not.toHaveBeenCalled();
  f.send("activate");
  expect(f.invoke).toHaveBeenCalledWith("replacement", "activate");
  await f.settle();
});

it("keeps control-list changes separate from scope changes and restores editing before screen Back", async () => {
  const f = setup();
  const initial = conversation();
  f.setScene({ ...initial, focusedTargetId: "field", editorFocused: true });
  f.send("enabled");
  await f.settle();
  expect(f.navigation.snapshot().position?.targetId).toBe("field");
  expect(f.navigation.snapshot().editing).toBe(true);
  f.send("chooser");
  expect(f.command).toHaveBeenLastCalledWith("controllerHelp");
  f.setScene({
    regions: [region("help", "content", "")],
    targets: [target("close", "help")],
    focusedTargetId: null,
    editorFocused: false,
  });
  const dismissHelp = f.navigation.present(f.host("help", "workspace", true));
  f.send("back", "help");
  expect(f.back).toHaveBeenCalledOnce();
  f.setScene({ ...initial, focusedTargetId: "field", editorFocused: true });
  dismissHelp();
  await f.settle();
  expect(f.navigation.snapshot().position?.targetId).toBe("field");
  expect(f.navigation.snapshot().editing).toBe(true);
  f.back.mockClear();
  f.setScene(initial);
  f.send("pageUp");
  expect(f.effects.at(-1)?.kind).toBe("scroll");
  expect(f.effects.at(-1)?.regionId).toBe("chat");
  expect(f.navigation.snapshot().position?.targetId).toBe("field");
  expect(f.navigation.snapshot().editing).toBe(true);
  f.send("suspended");
  f.send("resumed");
  expect(f.effects.at(-1)?.kind).toBe("edit");
  f.send("editorBlurred");
  expect(f.navigation.snapshot().editing).toBe(false);
  f.send("activate");
  f.send("back");
  expect(f.effects.at(-1)?.kind).toBe("blur");
  expect(f.back).not.toHaveBeenCalled();
  const scene = conversation();
  f.setScene({ ...scene, targets: [...scene.targets, target("new", "reply")] });
  f.send("scene");
  f.send("down");
  expect(f.navigation.snapshot().position?.targetId).toBe("microphone");
  f.send("back");
  expect(f.navigation.snapshot().position?.regionId).toBe("chat");
  f.setScene({ ...initial, width: 1000, focusedTargetId: "field", editorFocused: true });
  f.send("editorFocused", "workspace", "field");
  f.setScene({ ...initial, width: 1000, targets: [] });
  f.send("editorBlurred");
  f.setScene({ ...initial, width: 700, targets: [] });
  f.send("scene");
  f.setScene({ ...initial, width: 700 });
  f.send("scene");
  expect(f.navigation.snapshot().editing).toBe(true);
  expect(f.invoke).toHaveBeenLastCalledWith("field", "activate");
  f.send("back");
  f.invoke.mockClear();
  f.setScene({ ...initial, width: 1000 });
  f.send("scene");
  expect(f.navigation.snapshot().editing).toBe(false);
  expect(f.invoke).not.toHaveBeenCalled();
  f.setScene({ ...initial, width: 1000, focusedTargetId: "field", editorFocused: true });
  f.send("editorFocused", "workspace", "field");
  f.send("next");
  f.setScene({ ...initial, width: 700 });
  f.send("scene");
  expect(f.command).toHaveBeenLastCalledWith("thread.next");
  expect(f.invoke).not.toHaveBeenCalled();
  await f.settle();
});

it("binds dictation to the selected surface and respects an explicit touch-selected editor", async () => {
  const f = setup();
  const scene = conversation();
  f.setScene({
    ...scene,
    regions: [
      ...scene.regions,
      region("side-chat", "conversation", "side"),
      region("side-reply", "composer", "side"),
    ],
    targets: [
      ...scene.targets,
      target("side-field", "side-reply", "reply"),
      target("side-tool", "side-chat"),
    ],
  });
  f.send("enabled");
  f.send("pointer", "workspace", "side-tool");
  f.send("dictate");
  expect(f.invoke).toHaveBeenLastCalledWith("side-field", "dictate");
  expect(f.invoke).not.toHaveBeenCalledWith("field", "dictate");
  f.voice.mockReturnValue(true);
  const beforeRecording = f.navigation.snapshot().scene;
  f.setScene({
    ...beforeRecording,
    targets: beforeRecording.targets.filter((candidate) => candidate.id !== "side-field"),
  });
  f.send("back");
  f.setScene(beforeRecording);
  f.send("scene");
  expect(f.navigation.snapshot().position?.targetId).toBe("side-field");
  expect(f.navigation.snapshot().editing).toBe(false);
  f.send("back");
  f.setScene({
    ...beforeRecording,
    targets: beforeRecording.targets.filter((candidate) => candidate.id !== "side-field"),
  });
  f.send("scene");
  f.setScene(beforeRecording);
  f.send("scene");
  expect(f.navigation.snapshot().position?.targetId).toBe("side-field");
  expect(f.back).not.toHaveBeenCalled();
  expect(f.voice).toHaveBeenLastCalledWith("cancel", "side");
  f.voice.mockReturnValue(false);
  f.invoke.mockClear();
  const both = f.navigation.snapshot().scene;
  f.setScene({
    ...both,
    targets: both.targets.filter((candidate) => candidate.id !== "side-field"),
  });
  f.send("pointer", "workspace", "side-tool");
  f.send("dictate");
  f.setScene(conversation());
  f.send("scene");
  expect(f.invoke).not.toHaveBeenCalled();
  await f.settle();
});

it("reads without selecting inline actions and keeps scrolling local until an explicit reply jump", async () => {
  const f = setup();
  const scene = conversation();
  f.setScene({
    ...scene,
    regions: scene.regions.map((entry) =>
      entry.id === "chat" ? { ...entry, canScrollDown: true } : entry,
    ),
  });
  f.send("enabled");
  f.send("down");
  expect(f.effects.at(-1)?.kind).toBe("scroll");
  expect(f.navigation.snapshot().position?.regionId).toBe("chat");
  f.send("down");
  expect(f.effects.filter((entry) => entry.kind === "scroll")).toHaveLength(1);
  await f.settle();
  f.send("activate");
  f.send("down");
  expect(f.navigation.snapshot().inspecting).toBe(true);
  await f.settle();
  f.setScene({
    ...scene,
    targets: scene.targets.map((entry) =>
      entry.id === "fold" ? target("next-fold", "chat") : entry,
    ),
  });
  f.send("down");
  expect(f.navigation.snapshot().position?.targetId).toBe("next-fold");
  f.send("down");
  expect(f.navigation.snapshot().position?.targetId).toBe("next-fold");
  f.send("back");
  expect(f.navigation.snapshot().position?.targetId).toBeNull();
  f.send("reply");
  expect(f.navigation.snapshot().position?.targetId).toBe("field");
  await f.settle();
});

it("rejects a late scroll completion from an underlying scope", async () => {
  const f = setup();
  f.send("enabled");
  const updated = {
    ...conversation(),
    targets: [...conversation().targets, target("new-target", "chat")],
  };
  f.setScene(updated);
  f.send("scene");
  await f.settle();
  expect(f.navigation.snapshot().scene.targets.some((target) => target.id === "new-target")).toBe(
    true,
  );
  f.send("reply");
  const dispose = f.navigation.present(f.host("modal", "workspace", true));
  f.setScene({
    regions: [region("modal-content", "content")],
    targets: [target("modal-action", "modal-content")],
    focusedTargetId: null,
    editorFocused: false,
  });
  f.send("scene", "modal");
  f.send("down", "modal");
  await f.settle();
  expect(f.navigation.snapshot().scopeId).toBe("modal");
  expect(f.navigation.snapshot().position?.targetId).toBe("modal-action");
  dispose();
  expect(f.navigation.snapshot().scopeId).toBe("workspace");
  expect(f.navigation.snapshot().position?.targetId).toBe("field");
  await f.settle();
});

it("crosses content panes directly while preserving modal controls and an editor focused before presentation", async () => {
  const f = setup();
  f.setScene({
    regions: [
      region("settings", "content", "", "sidebar"),
      region("page", "content", "", "content"),
    ],
    targets: [
      target("category", "settings"),
      target("another-category", "settings"),
      target("setting", "page"),
    ],
    focusedTargetId: null,
    editorFocused: false,
  });
  f.send("enabled");
  f.send("pointer", "workspace", "another-category");
  f.send("right");
  expect(f.navigation.snapshot().position?.regionId).toBe("page");
  f.send("left");
  expect(f.navigation.snapshot().position?.regionId).toBe("settings");
  expect(f.navigation.snapshot().position?.targetId).toBe("another-category");
  const close = f.navigation.present(f.host("prompt", "workspace", true));
  f.setScene({
    regions: [region("prompt", "content", "")],
    targets: [
      target("name", "prompt", "editor"),
      target("cancel", "prompt"),
      target("save", "prompt", "footer"),
    ],
    focusedTargetId: "name",
    editorFocused: true,
  });
  f.send("resumed", "prompt");
  await f.settle();
  expect(f.navigation.snapshot().editing).toBe(true);
  expect(f.navigation.snapshot().position?.targetId).toBe("name");
  f.send("back", "prompt");
  const promptScene = f.navigation.snapshot().scene;
  f.setScene({ ...promptScene, editorFocused: false, focusedTargetId: null });
  f.send("right", "prompt");
  expect(f.navigation.snapshot().position?.targetId).toBe("cancel");
  f.send("right", "prompt");
  expect(f.navigation.snapshot().position?.targetId).toBe("save");
  close();
});

it("keeps directions within a pane, unwinds inspector before chat regions, and exposes help inside selection-owned overlays", async () => {
  const f = setup();
  const scene = conversation();
  f.setScene({
    ...scene,
    regions: [
      region("header", "header", ""),
      ...scene.regions,
      region("terminal", "inspector", ""),
    ],
    targets: [
      target("files", "header"),
      target("terminal-button", "header"),
      ...scene.targets,
      { ...target("current-thread", "threads", "thread"), selected: true },
      target("keyboard", "terminal"),
      target("attach", "terminal"),
    ],
  });
  f.send("enabled");
  f.send("up");
  f.send("right");
  expect(f.navigation.snapshot().position?.targetId).toBe("terminal-button");
  f.send("conversation");
  f.send("left");
  expect(f.navigation.snapshot().position?.targetId).toBe("current-thread");
  f.send("right");
  f.send("right");
  expect(f.navigation.snapshot().position?.targetId).toBe("keyboard");
  f.send("down");
  f.send("down");
  f.send("right");
  expect(f.navigation.snapshot().position?.targetId).toBe("attach");
  f.send("left");
  expect(f.navigation.snapshot().position?.regionId).toBe("chat");
  f.send("reply");
  f.send("back");
  expect(f.back).toHaveBeenCalledOnce();
  expect(f.navigation.snapshot().position?.regionId).toBe("reply");
  f.setScene(scene);
  f.send("back");
  expect(f.navigation.snapshot().position?.regionId).toBe("chat");
  const selectionInput = vi.fn();
  const dismiss = f.navigation.present({ ...f.host("palette", "workspace", true), selectionInput });
  f.send("chooser", "palette");
  expect(f.command).toHaveBeenLastCalledWith("controllerHelp");
  expect(selectionInput).not.toHaveBeenCalled();
  f.send("down", "palette");
  expect(selectionInput).toHaveBeenCalledOnce();
  dismiss();
  await f.settle();
});
