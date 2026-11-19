import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

const voice = vi.hoisted(() => ({
  input: null as null | {
    ownerKey: string | null;
    readDraftMessage: () => string | null;
    selection: { start: number; end: number };
    onChangeDraftMessage: (value: string) => void;
    onChangeSelection: (value: { start: number; end: number }) => void;
  },
  start: vi.fn(),
  stop: vi.fn(),
  busy: false,
}));
vi.mock("../../features/voice-input/useVoiceInputController", () => ({
  useVoiceInputController: (input: NonNullable<typeof voice.input>) => {
    voice.input = input;
    return {
      isAvailable: true,
      isBusy: voice.busy,
      freezesEditor: voice.busy,
      start: voice.start,
      stop: voice.stop,
    };
  },
}));
vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  View: (props: { nativeID?: string; children?: ReactNode }) => (
    <div data-target={props.nativeID}>{props.children}</div>
  ),
  Modal: (props: { children?: ReactNode }) => <div>{props.children}</div>,
  Pressable: (props: { nativeID?: string; children?: ReactNode }) => (
    <div data-target={props.nativeID}>{props.children}</div>
  ),
}));
vi.mock("./AppText", () => ({
  AppText: (props: { children?: ReactNode }) => <span>{props.children}</span>,
  AppTextInput: (props: { value: string; editable: boolean }) => (
    <input value={props.value} readOnly={!props.editable} onChange={() => {}} />
  ),
}));
vi.mock("@expo/ui/jetpack-compose", () => {
  const Slot = (props: { children?: ReactNode }) => <div>{props.children}</div>;
  const NativeButton = (props: {
    children?: ReactNode;
    enabled?: boolean;
    onClick?: () => void;
  }) => (
    <button disabled={!props.enabled} onClick={props.onClick}>
      {props.children}
    </button>
  );
  return {
    Box: Slot,
    Row: Slot,
    Text: Slot,
    RNHostView: Slot,
    LoadingIndicator: () => null,
    Button: NativeButton,
    FilledTonalButton: NativeButton,
    TextButton: NativeButton,
  };
});
vi.mock("@expo/ui/jetpack-compose/modifiers", () => ({
  defaultMinSize: () => ({}),
  fillMaxWidth: () => ({}),
  size: () => ({}),
}));
vi.mock("./NativeThemeHost.android", () => ({
  NativeThemeHost: (props: { children?: ReactNode }) => <div>{props.children}</div>,
}));
vi.mock("./AppSymbol", () => ({ SymbolView: () => null }));
vi.mock("./useControlTheme", () => ({ useControlTheme: () => ({ colors: {} }) }));
vi.mock("./useAndroidControlSizing", () => ({
  useAndroidControlSizing: () => ({ scale: 1, mediumIconSize: 18 }),
}));
vi.mock("../../features/settings/appearance/useScaledTextRole", () => ({
  useScaledTextRole: () => ({}),
}));

vi.mock("./ControllerTextInput", async () => import("./ControllerTextInput.android"));
vi.mock("./Button", async () => import("./Button.android"));
vi.mock("../../features/layout/nested-stacks", () => ({
  StandaloneStack: (props: { children?: ReactNode }) => <div>{props.children}</div>,
}));
vi.mock("../../features/controller/ControllerConsole", () => ({
  ControllerConsole: (props: { children?: ReactNode }) => (
    <ControllerScope value="prompt">{props.children}</ControllerScope>
  ),
}));
vi.mock("../../features/settings/appearance/AppearancePreferencesProvider", () => ({
  useAppearancePreferences: () => ({ themeVariables: {} }),
}));
vi.mock("../../lib/mobileTheme", () => ({ themeColorWithContrast: () => "#ffffff" }));

import * as Dialog from "./Dialog.android";
import { Button } from "./Button.android";
import { ControllerScope } from "../../features/controller/controllerScope";
import { controllerTargets } from "../../features/controller/controllerTargets";
import { ControllerTextInput } from "./ControllerTextInput.android";

it("dictates into the current field and selection, stops recording, and unregisters unavailable targets", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  voice.busy = false;
  voice.start.mockClear();
  voice.stop.mockClear();
  const container = document.createElement("div");
  const root = createRoot(container);
  const change = vi.fn();
  const render = (value: string, editable = true, selection?: { start: number; end: number }) =>
    act(() =>
      root.render(
        <ControllerScope value="settings">
          <ControllerTextInput
            value={value}
            editable={editable}
            selection={selection}
            onChangeText={change}
          />
        </ControllerScope>,
      ),
    );
  let id = "";
  try {
    render("old");
    id = container.querySelector("[data-target]")!.getAttribute("data-target")!;
    expect(controllerTargets.dispatch(id, "dictate", "another-route")).toBe(false);
    const readDraft = voice.input!.readDraftMessage;
    act(() => voice.input!.onChangeSelection({ start: 1, end: 3 }));
    render("current");
    expect(readDraft()).toBe("current");
    expect(voice.input!.selection).toEqual({ start: 1, end: 3 });
    render("current", true, { start: 2, end: 4 });
    expect(voice.input!.selection).toEqual({ start: 2, end: 4 });
    act(() => {
      expect(controllerTargets.dispatch(id, "dictate", "settings")).toBe(true);
    });
    expect(voice.start).toHaveBeenCalledOnce();
    act(() => voice.input!.onChangeDraftMessage("transcript"));
    expect(change).toHaveBeenCalledWith("transcript");
    voice.busy = true;
    render("transcript");
    expect(container.querySelector("input")!.readOnly).toBe(true);
    act(() => {
      controllerTargets.dispatch(id, "dictate", "settings");
    });
    expect(voice.stop).toHaveBeenCalledOnce();
    render("transcript", false);
    expect(controllerTargets.dispatch(id, "dictate", "settings")).toBe(false);
  } finally {
    act(() => root.unmount());
  }
  expect(controllerTargets.dispatch(id, "dictate", "settings")).toBe(false);
});

it("registers native Android buttons for controller activation and removes disabled or loading actions", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const undo = vi.fn();
  const render = (disabled = false, loading = false) =>
    act(() =>
      root.render(
        <ControllerScope value="thread">
          <Button label="Undo" onPress={undo} disabled={disabled} loading={loading} />
        </ControllerScope>,
      ),
    );
  let id = "";
  try {
    render();
    id = container.querySelector("[data-target]")!.getAttribute("data-target")!;
    expect(controllerTargets.dispatch(id, "activate", "thread")).toBe(true);
    expect(undo).toHaveBeenCalledOnce();
    act(() => container.querySelector("button")!.click());
    expect(undo).toHaveBeenCalledTimes(2);
    render(true);
    expect(controllerTargets.dispatch(id, "activate", "thread")).toBe(false);
    expect(container.querySelector("button")!.disabled).toBe(true);
    render(false, true);
    expect(controllerTargets.dispatch(id, "activate", "thread")).toBe(false);
    expect(container.querySelector("button")!.disabled).toBe(true);
    render();
    expect(controllerTargets.dispatch(id, "activate", "thread")).toBe(true);
    expect(undo).toHaveBeenCalledTimes(3);
  } finally {
    act(() => root.unmount());
  }
  expect(controllerTargets.dispatch(id, "activate", "thread")).toBe(false);
});

it("confirms the dictated rename value through the Android prompt", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  voice.busy = false;
  voice.start.mockClear();
  const container = document.createElement("div");
  const root = createRoot(container);
  const confirm = vi.fn();
  try {
    act(() => root.render(<Dialog.Host />));
    act(() =>
      Dialog.prompt({
        title: "Rename thread",
        initialValue: "Old name",
        confirmText: "Rename",
        onConfirm: confirm,
      }),
    );
    const field = container.querySelector("[data-target]")!.getAttribute("data-target")!;
    act(() => {
      expect(controllerTargets.dispatch(field, "dictate", "prompt")).toBe(true);
    });
    expect(voice.start).toHaveBeenCalledOnce();
    act(() => voice.input!.onChangeDraftMessage("Dictated name"));
    const rename = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Rename",
    )!;
    const target = rename.closest("[data-target]")!.getAttribute("data-target")!;
    act(() => {
      expect(controllerTargets.dispatch(target, "activate", "prompt")).toBe(true);
    });
    expect(confirm).toHaveBeenCalledWith("Dictated name");
    expect(controllerTargets.dispatch(field, "dictate", "prompt")).toBe(false);
  } finally {
    act(() => root.unmount());
  }
});
