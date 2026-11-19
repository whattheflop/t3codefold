import { expect, it, vi } from "vite-plus/test";
import type { VoiceInputSnapshot } from "../voice-input/voiceInputSession";
import { createControllerDictationOwnership } from "./controllerDictation";

it("resets only a recording started by that controller surface, retaining later touch recordings", () => {
  const ownership = createControllerDictationOwnership();
  let snapshot: Pick<VoiceInputSnapshot, "ownerKey" | "state" | "focusedOwners"> = {
    ownerKey: null,
    focusedOwners: new Set<string>(),
    state: { phase: "idle", error: null, errorAction: null },
  };
  const listeners = new Set<() => void>();
  const session = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    controller: { cancel: vi.fn() },
  };
  const recording = () => {
    snapshot = {
      ownerKey: "composer",
      focusedOwners: new Set(["composer"]),
      state: { phase: "recording", error: null, errorAction: null },
    };
    listeners.forEach((listener) => listener());
  };
  recording();
  ownership.cancel("workspace");
  expect(session.controller.cancel).not.toHaveBeenCalled();
  snapshot = {
    ownerKey: null,
    focusedOwners: new Set<string>(),
    state: { phase: "idle", error: null, errorAction: null },
  };
  ownership.start("workspace", session, recording, "composer-surface");
  expect(ownership.owns("workspace")).toBe(true);
  expect(ownership.owns("workspace", "composer-surface")).toBe(true);
  expect(ownership.owns("workspace", "other-surface")).toBe(false);
  expect(ownership.owns("unrelated-sheet")).toBe(false);
  ownership.cancel("unrelated-sheet");
  expect(session.controller.cancel).not.toHaveBeenCalled();
  ownership.cancel("workspace");
  expect(session.controller.cancel).toHaveBeenCalledOnce();
  expect(ownership.owns("workspace")).toBe(false);
  snapshot = {
    ownerKey: null,
    focusedOwners: new Set<string>(),
    state: { phase: "idle", error: null, errorAction: null },
  };
  ownership.start("workspace", session, recording);
  snapshot = {
    ownerKey: null,
    focusedOwners: new Set<string>(),
    state: { phase: "idle", error: null, errorAction: null },
  };
  listeners.forEach((listener) => listener());
  recording();
  ownership.cancel("workspace");
  expect(session.controller.cancel).toHaveBeenCalledOnce();
  expect(ownership.owns("workspace")).toBe(false);
  snapshot = {
    ownerKey: null,
    focusedOwners: new Set<string>(),
    state: { phase: "idle", error: null, errorAction: null },
  };
  ownership.start("workspace", session, recording);
  snapshot = { ...snapshot, focusedOwners: new Set<string>() };
  listeners.forEach((listener) => listener());
  expect(session.controller.cancel).toHaveBeenCalledTimes(2);
});
