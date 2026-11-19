export type ControllerAction =
  | "up"
  | "down"
  | "left"
  | "right"
  | "activate"
  | "cancel"
  | "dictate"
  | "footer"
  | "previousThread"
  | "nextThread"
  | "previousPane"
  | "nextPane"
  | "chooser"
  | "palette"
  | "conversation"
  | "reply";

export interface PadSnapshot {
  readonly index: number;
  readonly id: string;
  readonly mapping: string;
  readonly buttons: ReadonlyArray<{ readonly pressed: boolean; readonly value: number }>;
  readonly axes: readonly number[];
}

const bindings = new Map<number, ControllerAction>([
  [0, "activate"],
  [1, "cancel"],
  [2, "dictate"],
  [3, "footer"],
  [4, "previousThread"],
  [5, "nextThread"],
  [6, "previousPane"],
  [7, "nextPane"],
  [8, "chooser"],
  [9, "palette"],
  [10, "conversation"],
  [11, "reply"],
  [12, "up"],
  [13, "down"],
  [14, "left"],
  [15, "right"],
]);
const directions = new Set<ControllerAction>(["up", "down", "left", "right"]);
const axisValue = (value = 0) => (Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0);
const scrollAxis = (value = 0) => (Math.abs(axisValue(value)) < 0.25 ? 0 : axisValue(value));

/** Requires neutral after every ownership change; only navigation may repeat. */
export function createGamepadReader() {
  let owner = "";
  let scope: unknown;
  let armed = false;
  let held = new Set<ControllerAction>();
  let nextRepeat = 0;
  let stickX = 0;
  let stickY = 0;
  const reset = () => {
    armed = false;
    held.clear();
    stickX = stickY = 0;
    nextRepeat = 0;
  };
  return {
    reset,
    read(pad: PadSnapshot, currentScope: unknown, now: number) {
      const identity = `${pad.index}:${pad.id}`;
      if (identity !== owner || currentScope !== scope) {
        reset();
        owner = identity;
        scope = currentScope;
      }
      if (pad.mapping !== "standard") {
        reset();
        return { actions: [], scroll: [0, 0] } as const;
      }
      const pressed = new Set<ControllerAction>();
      for (const [index, action] of bindings) {
        const button = pad.buttons[index];
        if (button && (button.pressed || button.value > 0.55)) pressed.add(action);
      }
      const axis = (value: number, previous: number) => {
        const normalized = axisValue(value);
        return Math.abs(normalized) >= (previous === Math.sign(normalized) ? 0.35 : 0.55)
          ? Math.sign(normalized)
          : 0;
      };
      stickX = axis(pad.axes[0] ?? 0, stickX);
      stickY = axis(pad.axes[1] ?? 0, stickY);
      if (stickX) pressed.add(stickX < 0 ? "left" : "right");
      if (stickY) pressed.add(stickY < 0 ? "up" : "down");
      const scroll = [scrollAxis(pad.axes[2]), scrollAxis(pad.axes[3])] as const;
      if (!armed) {
        // Include unused buttons and both sticks: reconnect must be a deliberate fresh press.
        armed =
          !pad.buttons.some((button) => button.pressed || button.value > 0.35) &&
          pad.axes.every((value) => Math.abs(axisValue(value)) < 0.35);
        held = pressed;
        return { actions: [], scroll: [0, 0] } as const;
      }
      const actions = [...pressed].filter((action) => !held.has(action));
      if (actions.some((action) => directions.has(action))) nextRepeat = now + 350;
      else if (now >= nextRepeat && [...pressed].some((action) => directions.has(action))) {
        actions.push(...[...pressed].filter((action) => directions.has(action)));
        nextRepeat = now + 110;
      }
      held = pressed;
      return { actions, scroll };
    },
  };
}
