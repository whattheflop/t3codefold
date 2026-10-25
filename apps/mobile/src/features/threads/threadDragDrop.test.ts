import { describe, expect, it } from "vite-plus/test";
import {
  completeThreadDragGeometry,
  resolveThreadDrop,
  threadDropInsertionOffset,
  threadDragReturnDestination,
  type ThreadDragRow,
} from "./threadDragDrop";

describe("thread list drop targets", () => {
  // Mixed-height Home rows: one pin, two active cards, a queued task, then Settled.
  const rows: ThreadDragRow[] = [
    { key: "p1", threadKey: "env:p1", section: "pinned", offset: 0, height: 80 },
    { key: "a1", threadKey: "env:a1", section: "active", offset: 80, height: 90 },
    { key: "a2", threadKey: "env:a2", section: "active", offset: 170, height: 80 },
    { key: "queued", threadKey: null, section: null, offset: 250, height: 50 },
    { key: "settled-shelf", threadKey: null, section: "settled", offset: 300, height: 40 },
    { key: "s1", threadKey: "env:s1", section: "settled", offset: 340, height: 60 },
  ];
  const drop = (contentY: number, canDrop: () => boolean = () => true) =>
    resolveThreadDrop({
      rows,
      contentY,
      source: { threadKey: "env:a1", section: "active" },
      canDrop,
    });

  it("places by the hovered row's midpoint across sections", () => {
    expect(drop(20)).toEqual({ section: "pinned", targetId: "env:p1", placement: "before" });
    expect(drop(60)).toEqual({ section: "pinned", targetId: "env:p1", placement: "after" });
    expect(drop(240)).toEqual({ section: "active", targetId: "env:a2", placement: "after" });
  });
  it("offers no move over the source, queued tasks, or a refused plan", () => {
    expect(drop(120)).toBeNull();
    expect(drop(270)).toBeNull();
    expect(drop(200, () => false)).toBeNull();
  });
  it("settles anywhere over the Settled shelf and clamps past the end", () => {
    const settle = { section: "settled", targetId: null, placement: "before" };
    expect(drop(310)).toEqual(settle);
    expect(drop(900)).toEqual(settle);
  });
  it("opens the gap at the destination row's edge, or not at all", () => {
    expect(threadDropInsertionOffset(rows, drop(60), 80)).toBe(80);
    expect(threadDropInsertionOffset(rows, drop(240), 80)).toBe(250);
    expect(threadDropInsertionOffset(rows, drop(310), 80)).toBe(80);
    expect(threadDropInsertionOffset(rows, null, 80)).toBe(80);
  });
});

describe("thread list drops into empty sections", () => {
  const active: ThreadDragRow[] = [
    { key: "a1", threadKey: "env:a1", section: "active", offset: 0, height: 80 },
    { key: "a2", threadKey: "env:a2", section: "active", offset: 80, height: 80 },
  ];
  const pins: ThreadDragRow[] = [
    { key: "p1", threadKey: "env:p1", section: "pinned", offset: 0, height: 80 },
    { key: "p2", threadKey: "env:p2", section: "pinned", offset: 80, height: 80 },
  ];
  const drop = (rows: ThreadDragRow[], contentY: number, source: ThreadDragRow) =>
    resolveThreadDrop({
      rows,
      contentY,
      source: { threadKey: source.threadKey!, section: source.section! },
      canDrop: () => true,
    });

  it("pins from the top edge when there are no pins", () => {
    const pin = drop(active, 10, active[1]!);
    expect(pin).toEqual({ section: "pinned", targetId: null, placement: "before" });
    expect(threadDropInsertionOffset(active, pin, 80)).toBe(0);
    expect(drop(active, 30, active[1]!)).toEqual({
      section: "active",
      targetId: "env:a1",
      placement: "before",
    });
  });
  it("unpins from the bottom edge of the pins when Active is empty", () => {
    const unpin = drop(pins, 150, pins[0]!);
    expect(unpin).toEqual({ section: "active", targetId: null, placement: "before" });
    expect(threadDropInsertionOffset(pins, unpin, 0)).toBe(160);
    expect(drop(pins, 130, pins[0]!)).toEqual({
      section: "pinned",
      targetId: "env:p2",
      placement: "after",
    });
  });
});

describe("drag geometry outside the render window", () => {
  it("derives unmeasured sizes from the next position, else the estimate", () => {
    expect(
      completeThreadDragGeometry(
        [0, 90, 170, undefined],
        [90, undefined, undefined, undefined],
        72,
      ),
    ).toEqual([
      { offset: 0, height: 90 },
      { offset: 90, height: 80 },
      { offset: 170, height: 72 },
      { offset: 242, height: 72 },
    ]);
  });
});

describe("state-changing drop Undo", () => {
  it("restores between original neighbors including hidden rows", () => {
    expect(threadDragReturnDestination(["hidden", "source", "next"], "source", "active")).toEqual({
      section: "active",
      targetId: "next",
      placement: "before",
    });
  });
  it("restores a last pin after its predecessor and a lone pin into an empty section", () => {
    expect(threadDragReturnDestination(["previous", "source"], "source", "pinned")).toEqual({
      section: "pinned",
      targetId: "previous",
      placement: "after",
    });
    expect(threadDragReturnDestination(["source"], "source", "pinned")).toEqual({
      section: "pinned",
      targetId: null,
      placement: "before",
    });
  });
  it("refuses Undo when the source was absent from the complete section", () => {
    expect(threadDragReturnDestination(["other"], "source", "active")).toBeNull();
  });
});
