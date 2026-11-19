import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";

const modalBack = vi.hoisted(() => ({ current: () => {} }));
const renderedClicks = vi.hoisted(() => [] as Array<() => void>);
vi.mock("react-native", () => {
  const Slot = (props: { readonly children?: ReactNode }) => <div>{props.children}</div>;
  return {
    Keyboard: { isVisible: () => false },
    Platform: { OS: "android" },
    Modal: (props: { readonly children?: ReactNode; readonly onRequestClose: () => void }) => {
      modalBack.current = props.onRequestClose;
      return <div>{props.children}</div>;
    },
    View: Slot,
    Pressable: Slot,
    ScrollView: Slot,
  };
});
vi.mock("../../features/controller/ControllerConsole", () => ({
  ControllerConsole: (props: { readonly children?: ReactNode }) => <div>{props.children}</div>,
}));
vi.mock("./ControllerTextInput", () => ({ ControllerTextInput: () => null }));
vi.mock("./AppText", () => ({
  AppText: (props: { readonly children?: ReactNode }) => <span>{props.children}</span>,
}));
vi.mock("./Button", () => ({
  Button: (props: { readonly label: string; readonly onPress: () => void }) => {
    renderedClicks.push(props.onPress);
    return <button onClick={props.onPress}>{props.label}</button>;
  },
}));

import * as Dialog from "./Dialog.android";

const roots: Root[] = [];

function mountHost() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(<Dialog.Host />));
  return { root, container };
}

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  renderedClicks.length = 0;
  document.body.innerHTML = "";
});

it("keeps presenting dialogs after an older root's Host unmounts", () => {
  // Android activity replacement mounts the new root before the old one stops.
  const previous = mountHost();
  const current = mountHost();
  roots.splice(roots.indexOf(previous.root), 1);
  act(() => previous.root.unmount());

  act(() => Dialog.alert("Saved", undefined, [{ text: "OK" }]));

  expect(current.container.textContent).toContain("Saved");
});

it("presents a dialog requested before any Host mounted", () => {
  Dialog.alert("Could not import shared content", undefined, [{ text: "Dismiss" }]);

  const { container } = mountHost();

  expect(container.textContent).toContain("Could not import shared content");
});

it("keeps a dialog raised while the activity is replaced", () => {
  const previous = mountHost();
  act(() => Dialog.alert("Shared content imported", undefined, [{ text: "OK" }]));
  const current = mountHost();
  roots.splice(roots.indexOf(previous.root), 1);
  act(() => previous.root.unmount());

  expect(current.container.textContent).toContain("Shared content imported");
});

it("tells a replaced alert it was dismissed", () => {
  mountHost();
  const onDismiss = vi.fn();
  act(() => Dialog.alert("Older", undefined, [{ text: "OK" }], { onDismiss }));
  act(() => Dialog.alert("Newer", undefined, [{ text: "OK" }]));

  expect(onDismiss).toHaveBeenCalledOnce();
});

it("ignores a late action from a dialog that a newer one replaced", () => {
  const { container } = mountHost();
  const olderAction = vi.fn();
  act(() => Dialog.alert("Older", undefined, [{ text: "OK", onPress: olderAction }]));
  const olderClick = renderedClicks.at(-1)!;
  act(() => Dialog.alert("Newer", undefined, [{ text: "OK" }]));

  act(() => olderClick());

  expect(olderAction).toHaveBeenCalledOnce();
  expect(container.textContent).toContain("Newer");
});

it("respects alert cancelability and reports dismissal only for a cancelable alert", () => {
  const { container } = mountHost();
  const onDismiss = vi.fn();
  act(() => Dialog.alert("Cannot cancel", undefined, undefined, { cancelable: false, onDismiss }));
  act(() => modalBack.current());
  expect(container.textContent).toContain("Cannot cancel");
  expect(onDismiss).not.toHaveBeenCalled();
  act(() => Dialog.alert("Can cancel", undefined, undefined, { cancelable: true, onDismiss }));
  onDismiss.mockClear();
  act(() => modalBack.current());
  expect(container.textContent).toBe("");
  expect(onDismiss).toHaveBeenCalledOnce();
});

it("confirms or cancels through the public confirm callbacks", () => {
  const { container } = mountHost();
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const request = {
    title: "Delete thread",
    confirmText: "Delete",
    destructive: true,
    onConfirm,
    onCancel,
  };
  act(() => Dialog.confirm(request));
  act(() => modalBack.current());
  expect(onCancel).toHaveBeenCalledOnce();
  expect(onConfirm).not.toHaveBeenCalled();
  act(() => Dialog.confirm(request));
  act(() => container.querySelectorAll("button")[1]!.click());
  expect(onConfirm).toHaveBeenCalledOnce();
  expect(onCancel).toHaveBeenCalledOnce();
  expect(container.textContent).toBe("");
});
