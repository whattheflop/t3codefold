import { useLayoutEffect, useRef, useState } from "react";
import { createThreadRibbonMirror } from "./threadRibbonMirrors";
import { observeResize } from "../../lib/observeResize";

// Keep in sync with --thread-wrap-column-width and --thread-wrap-gap.
const COLUMN_WIDTH_REM = 42;
const COLUMN_GAP_REM = 3.5;
const TOP_INSET_REM = 0.75;
const BOTTOM_GAP_REM = 0.75;
const MIN_PAGE_HEIGHT_REM = 18;

export interface ThreadRibbon {
  readonly columns: number;
  readonly pageHeight: number;
}

/**
 * Which columns a row touches, given its single-column window offset. The
 * live element takes the piece under the pointer, else the largest piece, so
 * links and buttons stay reachable; null when the row is out of the window.
 */
export function resolveRibbonPlacement({
  top,
  height,
  pageHeight,
  columns,
  pointer,
}: {
  top: number;
  height: number;
  pageHeight: number;
  columns: number;
  /** The pointer's single-column window offset, or -1. */
  pointer: number;
}): { first: number; last: number; live: number } | null {
  if (!Number.isFinite(top) || height <= 0 || top + height <= 0 || top >= columns * pageHeight) {
    return null;
  }
  const first = Math.max(0, Math.floor(top / pageHeight));
  const last = Math.min(columns - 1, Math.floor((top + height - 1) / pageHeight));
  if (pointer >= top && pointer < top + height) {
    return { first, last, live: Math.max(first, Math.min(last, Math.floor(pointer / pageHeight))) };
  }
  let live = first;
  let largest = 0;
  for (let column = first; column <= last; column++) {
    const size =
      Math.min(top + height, (column + 1) * pageHeight) - Math.max(top, column * pageHeight);
    if (size > largest) {
      largest = size;
      live = column;
    }
  }
  return { first, last, live };
}

/** A row that straddles column seams, with its mirror copies by column. */
interface MirroredRow {
  readonly mirrors: Map<number, HTMLElement>;
  readonly observer: MutationObserver;
  stale: boolean;
}

/**
 * Thread wrapping's ribbon: once a thread is taller than one screen and the
 * timeline fits several reading-width columns, the whole thread flows
 * through them like one continuous strip of paper. LegendList's content
 * container pins as a screen-height window, and scrolling feeds the thread
 * through it, so text leaving the top of one column arrives at the bottom of
 * the column before it.
 *
 * Scroll position maps 1:1 to the ribbon position: scrollTop is the
 * single-column offset of the first column's top. LegendList keeps measuring
 * and virtualizing in single-column coordinates, so jumps, anchoring and the
 * minimap keep working; it only needs to draw the extra columns' worth of rows
 * (see the returned page size). A spacer after the window keeps the scroll
 * range ending exactly when the thread's end reaches the last column.
 *
 * Columns are not CSS fragmentation. Fragmentation moves whole lines and
 * whole blocks across a seam as it slides, so everything after the seam steps
 * instead of scrolling, and the stepped heights feed back into LegendList's
 * measurements. Instead each row keeps its single-column layout and a
 * transform carries it into its column; the window's clip cuts it at the
 * seams. A row that straddles a seam is painted once per column it touches:
 * the live element in one, an inert mirror copy in each other. The live
 * element takes the piece under the pointer so links and buttons work on
 * either side of the seam, and the swap is pixel-identical.
 *
 * Every per-frame write is a DOM style, so rows never re-render while
 * scrolling; the hook re-renders its owner only when the ribbon turns on, off,
 * or changes shape.
 */
export function useThreadRibbon({
  getScroller,
  threadKey,
  maxColumns,
  composerInset,
}: {
  getScroller: () => HTMLElement | null;
  /** A new thread starts a fresh ribbon. */
  threadKey: string | null;
  maxColumns: number | null;
  composerInset: number;
}) {
  const [ribbon, setRibbon] = useState<ThreadRibbon | null>(null);
  const endRef = useRef<number | null>(null);
  // A thread switch must tear down the ribbon even when it reuses the same scroller.
  const target = { getScroller, threadKey };

  useLayoutEffect(() => {
    const scroller = target.getScroller();
    const content = scroller?.firstElementChild;
    // A previous run's cleanup already cleared the ribbon.
    if (!scroller || maxColumns === null || !(content instanceof HTMLElement)) return;
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const columnWidth = COLUMN_WIDTH_REM * rem;
    const stride = columnWidth + COLUMN_GAP_REM * rem;
    const spacer = document.createElement("div");
    spacer.setAttribute("aria-hidden", "true");
    spacer.dataset.threadRibbonSpacer = "";
    const mirrorLayer = document.createElement("div");
    mirrorLayer.setAttribute("aria-hidden", "true");
    mirrorLayer.dataset.threadRibbonMirrors = "";
    const portalLayer = document.createElement("div");
    portalLayer.setAttribute("aria-hidden", "true");
    portalLayer.dataset.threadRibbonPortals = "";
    const mirrored = new Map<HTMLElement, MirroredRow>();
    let columns = 0;
    let pageHeight = 0;
    let offset = -1;
    let frame: number | null = null;
    let pointer: { x: number; y: number } | null = null;

    // The flow's first child carries the ribbon offset as a negative margin.
    const lead = () =>
      content.firstElementChild instanceof HTMLElement ? content.firstElementChild : null;
    // LegendList's containers layer is the one positioned child; rows sit in
    // it at their single-column offsets.
    const layerOf = () =>
      Array.from(content.children).find(
        (child): child is HTMLElement =>
          child instanceof HTMLElement && child.style.position === "relative",
      ) ?? null;

    const placement = (column: number) =>
      column === 0 ? "" : `translate(${column * stride}px, ${-column * pageHeight}px)`;
    const place = (element: HTMLElement, column: number) => {
      const value = placement(column);
      if (element.style.transform !== value) element.style.transform = value;
    };

    const unmirror = (row: HTMLElement) => {
      const entry = mirrored.get(row);
      if (!entry) return;
      entry.observer.disconnect();
      for (const mirror of entry.mirrors.values()) mirror.remove();
      mirrored.delete(row);
    };

    /** The pointer's single-column offset within the window, or -1. */
    const pointerOffset = () => {
      if (!pointer) return -1;
      const rect = content.getBoundingClientRect();
      const x = pointer.x - rect.left;
      const y = pointer.y - rect.top;
      const column = Math.floor(x / stride);
      if (column < 0 || column >= columns || x - column * stride >= columnWidth) return -1;
      if (y < 0 || y >= pageHeight) return -1;
      return column * pageHeight + y;
    };

    const arrange = () => {
      const layer = layerOf();
      if (!layer) return;
      if (mirrorLayer.parentElement !== layer) layer.append(mirrorLayer);
      layer.dataset.threadRibbonLayer = "";
      const layerTop = layer.offsetTop;
      const pointed = pointerOffset();
      const straddling = new Set<HTMLElement>();
      for (const row of Array.from(layer.children)) {
        if (!(row instanceof HTMLElement) || row === mirrorLayer) continue;
        const placed = resolveRibbonPlacement({
          top: layerTop + Number.parseFloat(row.style.top),
          height: row.offsetHeight,
          pageHeight,
          columns,
          pointer: pointed,
        });
        if (!placed) {
          place(row, 0);
          unmirror(row);
          continue;
        }
        const { first, last, live } = placed;
        place(row, live);
        if (first === last) {
          unmirror(row);
          continue;
        }
        straddling.add(row);
        let entry = mirrored.get(row);
        if (!entry) {
          const created: MirroredRow = {
            mirrors: new Map(),
            stale: false,
            observer: new MutationObserver((records) => {
              // The row's own style changes are LegendList positioning it or
              // this hook placing it; its contents are what the copies show.
              if (records.some((record) => record.type !== "attributes" || record.target !== row)) {
                created.stale = true;
                schedule();
              }
            }),
          };
          created.observer.observe(row, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
          });
          mirrored.set(row, created);
          entry = created;
        }
        const needed: number[] = [];
        for (let column = first; column <= last; column++) {
          if (column !== live) needed.push(column);
        }
        const spare = Array.from(entry.mirrors).filter(([column]) => !needed.includes(column));
        for (const [column] of spare) entry.mirrors.delete(column);
        for (const column of needed) {
          if (entry.mirrors.has(column)) continue;
          const reused = spare.pop();
          const mirror = reused ? reused[1] : createThreadRibbonMirror(row);
          if (!reused) mirrorLayer.append(mirror);
          entry.mirrors.set(column, mirror);
        }
        for (const [, mirror] of spare) mirror.remove();
        if (entry.stale) {
          entry.stale = false;
          for (const [column, mirror] of entry.mirrors) {
            const fresh = createThreadRibbonMirror(row);
            mirror.replaceWith(fresh);
            entry.mirrors.set(column, fresh);
          }
        }
        for (const [column, mirror] of entry.mirrors) {
          // Expanding an earlier row changes LegendList's offsets without
          // changing this row's contents, so an existing copy must move too.
          if (mirror.style.top !== row.style.top) mirror.style.top = row.style.top;
          place(mirror, column);
        }
      }
      for (const row of Array.from(mirrored.keys())) {
        if (!straddling.has(row)) unmirror(row);
      }
    };

    const follow = () => {
      frame = null;
      const end = endRef.current;
      if (end === null) return;
      const next = Math.round(Math.min(end, Math.max(0, scroller.scrollTop)));
      if (next !== offset) {
        offset = next;
        lead()?.style.setProperty("margin-top", `${-offset}px`);
      }
      arrange();
    };
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(follow);
    };

    // LegendList's containers layer carries its total row size as an explicit height.
    const contentLength = () =>
      Array.from(content.children).reduce(
        (sum, child) => sum + (Number.parseFloat(getComputedStyle(child).height) || 0),
        0,
      );

    const deactivate = () => {
      endRef.current = null;
      delete scroller.dataset.threadRibbon;
      spacer.remove();
      portalLayer.remove();
      lead()?.style.removeProperty("margin-top");
      const layer = layerOf();
      if (layer) {
        delete layer.dataset.threadRibbonLayer;
        for (const row of Array.from(layer.children)) {
          if (row instanceof HTMLElement) row.style.removeProperty("transform");
        }
      }
      for (const row of Array.from(mirrored.keys())) unmirror(row);
      mirrorLayer.remove();
      offset = -1;
      setRibbon(null);
    };

    // Rows move as LegendList lays them out and resize as they expand or
    // stream; either can change which columns a row touches.
    let stopWatchingRowSizes = () => {};
    const rowStyleObserver = new MutationObserver(schedule);
    const rowListObserver = new MutationObserver(() => {
      watchRows();
      schedule();
    });
    const watchRows = () => {
      const layer = layerOf();
      stopWatchingRowSizes();
      rowStyleObserver.disconnect();
      rowListObserver.disconnect();
      if (!layer || endRef.current === null) return;
      rowListObserver.observe(layer, { childList: true });
      const rows = Array.from(layer.children).filter((row) => row !== mirrorLayer);
      stopWatchingRowSizes = observeResize(rows, schedule);
      for (const row of rows) {
        rowStyleObserver.observe(row, { attributes: true, attributeFilter: ["style"] });
      }
    };

    const measure = () => {
      const style = getComputedStyle(scroller);
      const width =
        scroller.clientWidth -
        Number.parseFloat(style.paddingLeft) -
        Number.parseFloat(style.paddingRight);
      const viewport = scroller.clientHeight;
      const top = TOP_INSET_REM * rem;
      columns = Math.min(maxColumns, Math.floor((width + stride - columnWidth) / stride));
      pageHeight = Math.floor(viewport - top - composerInset - BOTTOM_GAP_REM * rem);
      const length = contentLength();
      if (columns < 2 || pageHeight < MIN_PAGE_HEIGHT_REM * rem || length <= pageHeight) {
        if (endRef.current !== null) {
          deactivate();
          watchRows();
        }
        return;
      }
      const previousEnd = endRef.current;
      // Entering the ribbon from the bottom of the thread lands at its end.
      const wasAtEnd =
        previousEnd === null
          ? scroller.scrollTop + viewport >= scroller.scrollHeight - 2
          : scroller.scrollTop >= previousEnd - 2;
      const end = Math.max(0, Math.ceil(length - columns * pageHeight));
      endRef.current = end;
      scroller.dataset.threadRibbon = "true";
      if (portalLayer.childElementCount !== (columns - 1) * 2) {
        portalLayer.replaceChildren();
        for (let column = 0; column < columns - 1; column++) {
          for (const edge of ["exit", "entry"] as const) {
            const portal = document.createElement("span");
            portal.dataset.threadRibbonPortal = edge;
            portal.style.setProperty(
              "--thread-ribbon-portal-column",
              String(edge === "exit" ? column : column + 1),
            );
            portalLayer.append(portal);
          }
        }
      }
      if (portalLayer.parentElement !== content) content.append(portalLayer);
      scroller.style.setProperty("--thread-ribbon-columns", String(columns));
      scroller.style.setProperty("--thread-ribbon-page-height", `${pageHeight}px`);
      scroller.style.setProperty("--thread-ribbon-top", `${top}px`);
      // scrollHeight - viewport = top + pageHeight + spacer - viewport = end.
      spacer.style.height = `${Math.max(0, end + viewport - pageHeight - top)}px`;
      if (!spacer.isConnected) scroller.append(spacer);
      if (wasAtEnd) scroller.scrollTop = end;
      setRibbon((current) =>
        current?.columns === columns && current.pageHeight === pageHeight
          ? current
          : { columns, pageHeight },
      );
      watchRows();
      offset = -1;
      follow();
    };

    let stopWatchingShape = () => {};
    const watchShape = () => {
      stopWatchingShape();
      stopWatchingShape = observeResize([scroller, ...Array.from(content.children)], measure);
    };
    // LegendList swaps its header and footer as history and anchoring change.
    const childObserver = new MutationObserver(() => {
      watchShape();
      measure();
    });
    childObserver.observe(content, { childList: true });
    const onPointerMove = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
      if (mirrored.size > 0) schedule();
    };
    const onPointerLeave = () => {
      pointer = null;
    };
    scroller.addEventListener("scroll", schedule, { passive: true });
    scroller.addEventListener("pointermove", onPointerMove, { passive: true });
    scroller.addEventListener("pointerleave", onPointerLeave);
    watchShape();
    measure();
    return () => {
      stopWatchingShape();
      childObserver.disconnect();
      stopWatchingRowSizes();
      rowStyleObserver.disconnect();
      rowListObserver.disconnect();
      scroller.removeEventListener("scroll", schedule);
      scroller.removeEventListener("pointermove", onPointerMove);
      scroller.removeEventListener("pointerleave", onPointerLeave);
      if (frame !== null) cancelAnimationFrame(frame);
      deactivate();
      for (const name of [
        "--thread-ribbon-columns",
        "--thread-ribbon-page-height",
        "--thread-ribbon-top",
      ]) {
        scroller.style.removeProperty(name);
      }
    };
  }, [composerInset, maxColumns, target]);

  /** At the ribbon's end, or undefined when the ribbon is off. */
  const ribbonIsAtEnd = () => {
    const scroller = getScroller();
    const end = endRef.current;
    if (end === null || !scroller) return undefined;
    return scroller.scrollTop >= end - 2;
  };

  return { ribbon, ribbonIsAtEnd };
}
