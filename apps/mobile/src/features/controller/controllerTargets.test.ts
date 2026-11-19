import { expect, it, vi } from "vite-plus/test";
import { createControllerTargets } from "./controllerTargets";
it("rejects resolved request generations and keeps dictation separate from activation", () => {
  const targets = createControllerTargets();
  const approve = vi.fn();
  const dictate = vi.fn();
  const dispose = targets.register("request-1", { activate: approve, dictate });
  expect(targets.dispatch("request-1", "dictate")).toBe(true);
  expect(approve).not.toHaveBeenCalled();
  expect(dictate).toHaveBeenCalledOnce();
  dispose();
  targets.register("request-2", { activate: approve });
  expect(targets.dispatch("request-1", "activate")).toBe(false);
  expect(approve).not.toHaveBeenCalled();
});

it("rejects an event queued by another route or modal scope", () => {
  const targets = createControllerTargets();
  const approve = vi.fn();
  const adjust = vi.fn();
  targets.register("approval", { activate: approve }, "thread-a");
  const removeSlider = targets.register("slider", { activate: approve, adjust }, "thread-a");
  expect(targets.dispatch("slider", "decrement", "thread-b")).toBe(false);
  expect(targets.dispatch("slider", "increment", "question-modal")).toBe(false);
  expect(adjust).not.toHaveBeenCalled();
  expect(targets.dispatch("approval", "increment", "thread-a")).toBe(false);
  expect(targets.dispatch("slider", "decrement", "thread-a")).toBe(true);
  expect(targets.dispatch("slider", "increment", "thread-a")).toBe(true);
  expect(adjust.mock.calls).toEqual([[-1], [1]]);
  expect(approve).not.toHaveBeenCalled();
  removeSlider();
  expect(targets.dispatch("slider", "increment", "thread-a")).toBe(false);
  expect(adjust).toHaveBeenCalledTimes(2);
  expect(targets.dispatch("approval", "activate", "thread-b")).toBe(false);
  expect(targets.dispatch("approval", "activate", "question-modal")).toBe(false);
  expect(approve).not.toHaveBeenCalled();
  expect(targets.dispatch("approval", "activate", "thread-a")).toBe(true);
  expect(approve).toHaveBeenCalledOnce();
});

it("requires an explicit dictation target in the current scope", () => {
  const targets = createControllerTargets();
  const dictate = vi.fn();
  targets.register("reply", { activate: vi.fn(), dictate }, "thread-a");
  targets.register("tool", { activate: vi.fn() }, "thread-a");
  expect(targets.dispatch("tool", "dictate", "thread-a")).toBe(false);
  expect(targets.dispatch("", "dictate", "thread-a")).toBe(false);
  expect(targets.dispatch("reply", "dictate", "modal")).toBe(false);
  expect(dictate).not.toHaveBeenCalled();
  expect(targets.dispatch("reply", "dictate", "thread-a")).toBe(true);
  expect(dictate).toHaveBeenCalledOnce();
});

it("rejects a retired registration without deleting its replacement", () => {
  const targets = createControllerTargets();
  const oldAction = vi.fn();
  const nextAction = vi.fn();
  const dispose = targets.register("row", { activate: oldAction }, "thread-a");
  targets.register("row", { activate: nextAction }, "thread-a");
  dispose();
  expect(targets.dispatch("row", "activate", "thread-a")).toBe(true);
  expect(oldAction).not.toHaveBeenCalled();
  expect(nextAction).toHaveBeenCalledOnce();
});
