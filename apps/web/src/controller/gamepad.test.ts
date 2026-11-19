import { describe, expect, it } from "vite-plus/test";
import { createGamepadReader, type PadSnapshot } from "./gamepad";

function pad(buttons: number[] = [], axes = [0, 0, 0, 0], index = 0): PadSnapshot {
  return {
    index,
    id: "DualSense",
    mapping: "standard",
    axes,
    buttons: Array.from({ length: 17 }, (_, i) => ({
      pressed: buttons.includes(i),
      value: buttons.includes(i) ? 1 : 0,
    })),
  };
}

describe("renderer gamepad ownership", () => {
  it("requires neutral at bootstrap, scope replacement, device replacement and reset", () => {
    const reader = createGamepadReader();
    expect(reader.read(pad([0]), "request-a", 0).actions).toEqual([]);
    reader.read(pad(), "request-a", 1);
    expect(reader.read(pad([0]), "request-a", 2).actions).toEqual(["activate"]);
    expect(reader.read(pad([0]), "request-b", 3).actions).toEqual([]);
    expect(reader.read(pad([0]), "request-b", 1000).actions).toEqual([]);
    reader.read(pad(), "request-b", 1001);
    expect(reader.read(pad([0]), "request-b", 1002).actions).toEqual(["activate"]);
    expect(reader.read(pad([0], undefined, 1), "request-b", 1003).actions).toEqual([]);
    reader.reset();
    expect(reader.read(pad([0], undefined, 1), "request-b", 1004).actions).toEqual([]);
  });

  it("deduplicates dpad and stick, adds hysteresis and repeats navigation only", () => {
    const reader = createGamepadReader();
    reader.read(pad(), "scope", 0);
    expect(reader.read(pad([0, 13], [0, 0.6, 0, 0]), "scope", 1).actions).toEqual([
      "activate",
      "down",
    ]);
    expect(reader.read(pad([0, 13], [0, 0.5, 0, 0]), "scope", 350).actions).toEqual([]);
    expect(reader.read(pad([0], [0, 0.4, 0, 0]), "scope", 351).actions).toEqual(["down"]);
    expect(reader.read(pad([0], [0, 0.3, 0, 0]), "scope", 500).actions).toEqual([]);
    expect(reader.read(pad([0], [0, 0.5, 0, 0]), "scope", 600).actions).toEqual([]);
    expect(reader.read(pad([0], [0, 0.6, 0, 0]), "scope", 601).actions).toEqual(["down"]);
  });

  it("rejects unknown mappings and right-stick drift; maps PlayStation positions", () => {
    const reader = createGamepadReader();
    expect(reader.read({ ...pad([0]), mapping: "" }, "scope", 0).actions).toEqual([]);
    reader.read(pad(), "scope", 1);
    expect(
      reader.read(pad([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], [0, 0, 0.1, -0.8]), "scope", 2),
    ).toEqual({
      actions: [
        "cancel",
        "dictate",
        "footer",
        "previousThread",
        "nextThread",
        "previousPane",
        "nextPane",
        "chooser",
        "palette",
        "conversation",
        "reply",
      ],
      scroll: [0, -0.8],
    });
  });
  it("never repeats decisions, dictation, footer, threads or palette while held", () => {
    const reader = createGamepadReader();
    reader.read(pad(), "scope", 0);
    const held = pad([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(reader.read(held, "scope", 1).actions).toHaveLength(12);
    expect(reader.read(held, "scope", 500).actions).toEqual([]);
    expect(reader.read(held, "scope", 5000).actions).toEqual([]);
  });
});
