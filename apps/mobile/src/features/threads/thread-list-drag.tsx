import type { LegendListRef } from "@legendapp/list/react-native";

type LegendListState = ReturnType<LegendListRef["getState"]>;
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import * as Haptics from "expo-haptics";
import {
  createContext,
  use,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Pressable, View, useWindowDimensions, type ViewInstance } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, {
  measure,
  useAnimatedRef,
  runOnJS,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { AppText as Text } from "../../components/ui/AppText";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { appAtomRegistry } from "../../state/atom-registry";
import { environmentServerConfigsAtom } from "../../state/server";
import { getPendingThreadOrder, threadDropBusyAtom } from "../../state/thread-order";
import { environmentThreadShells } from "../../state/threads";
import { queuedThreadKeysAtom } from "../../state/use-thread-outbox";
import {
  completeThreadDragGeometry,
  resolveThreadDrop,
  threadDropInsertionOffset,
  threadDragReturnDestination,
  type ThreadDragRow,
  type ThreadDropDestination,
} from "./threadDragDrop";
import { threadDragGapOffset } from "./threadDragGap";
import {
  getThreadListV2OrderedSection,
  isThreadListV2ListItem,
  type ThreadListV2ListItem,
} from "./threadListV2";
import { createThreadMovePlanner, threadDragAction, type ThreadDragSection } from "./threadOrder";

// Long enough that a flick still scrolls, short enough to beat the long-press
// menu: holding still opens the menu, moving after the hold lifts the row.
const HOLD_MS = 200;
const LIFT_SLOP = 6;
const AUTO_SCROLL_EDGE = 56;
// Matches the lists' estimatedItemSize for rows LegendList has not measured.
const ESTIMATED_ROW_HEIGHT = 72;

interface DragLayout {
  readonly sourceKey: string;
  readonly sourceOffset: number;
  readonly sourceHeight: number;
  readonly insertionOffset: number;
  readonly offsets: Readonly<Record<string, number>>;
}

interface Drag {
  readonly returnDestination: ThreadDropDestination | null;
  readonly itemKey: string;
  readonly thread: EnvironmentThreadShell;
  readonly section: ThreadDragSection;
  readonly grabY: number;
  /** Content Y of the finger is `anchor + absoluteY + scroll`. */
  readonly anchor: number;
  readonly minimumScroll: number;
  readonly canDrop: (destination: ThreadDropDestination) => boolean;
  rows: readonly ThreadDragRow[];
  offsets: Readonly<Record<string, number>>;
  geometryVersion: number;
  sourceOffset: number;
  sourceHeight: number;
  absoluteY: number;
  scroll: number;
  destination: ThreadDropDestination | null;
}

interface DropUndo {
  readonly thread: EnvironmentThreadShell;
  readonly destination: ThreadDropDestination;
  readonly expectedSection: "pinned" | "active" | "settled";
  readonly fingerprint: string | null;
  readonly busy: boolean;
}

function lifecycleFingerprint(thread: EnvironmentThreadShell) {
  return JSON.stringify([
    thread.pinnedAt,
    thread.settledOverride,
    thread.settledAt,
    thread.unsettledAt,
    thread.snoozedUntil,
    thread.pinOrderKey,
    thread.activeOrderKey,
  ]);
}

function currentDropSection(thread: EnvironmentThreadShell) {
  if (thread.archivedAt !== null || effectiveSnoozed(thread, { now: new Date().toISOString() }))
    return null;
  return thread.settledOverride === "settled" &&
    !appAtomRegistry.get(queuedThreadKeysAtom).has(scopedThreadKey(thread.environmentId, thread.id))
    ? "settled"
    : thread.pinnedAt != null
      ? "pinned"
      : "active";
}

export interface ThreadListDragListProps {
  readonly scrollEnabled: boolean;
  readonly alwaysRender?: { readonly keys: string[] };
}

interface DragPreview {
  readonly title: string;
  readonly height: number;
  readonly action: string | null;
}

interface ThreadListDragController {
  canStart(): boolean;
  arm(itemKey: string): void;
  disarm(): void;
  start(itemKey: string, thread: EnvironmentThreadShell, grabY: number, absoluteY: number): void;
  move(absoluteY: number): void;
  end(cancelled: boolean): void;
}

const ThreadListDragContext = createContext<{
  readonly controller: ThreadListDragController;
  readonly layout: SharedValue<DragLayout | null>;
  readonly fingerY: SharedValue<number>;
} | null>(null);

function dragSection(item: ThreadListV2ListItem): ThreadDragSection | null {
  if (item.type === "v2-settled-shelf") return "settled";
  if (item.type !== "v2-thread") return null;
  if (item.item.snoozed) return "snoozed";
  if (item.item.variant === "slim") return "settled";
  return item.item.pinned ? "pinned" : "active";
}

/** Plan against the complete sections, exactly as the drop's `moveThread` will. */
function createDropPolicy(
  thread: EnvironmentThreadShell,
  section: ThreadDragSection,
  workingShelfEnabled: boolean,
) {
  const shells = appAtomRegistry.get(environmentThreadShells.threadShellsAtom);
  const configs = appAtomRegistry.get(environmentServerConfigsAtom);
  const environmentsWith = (supported: (id: EnvironmentThreadShell["environmentId"]) => boolean) =>
    new Set([...configs.keys()].filter(supported));
  const capabilities = (id: EnvironmentThreadShell["environmentId"]) =>
    configs.get(id)?.environment.capabilities;
  const shared = {
    threads: shells,
    now: new Date().toISOString(),
    queuedThreadKeys: appAtomRegistry.get(queuedThreadKeysAtom),
    settlementEnvironmentIds: environmentsWith((id) => capabilities(id)?.threadSettlement === true),
    snoozeEnvironmentIds: environmentsWith((id) => capabilities(id)?.threadSnooze === true),
  };
  const planner = (destination: "pinned" | "active") =>
    createThreadMovePlanner({
      ordered: getThreadListV2OrderedSection({ ...shared, section: destination }),
      allThreads: shells,
      section: destination,
      // The Working beta orders Active by time, so only pins take a position.
      reorderableEnvironmentIds: environmentsWith((id) =>
        destination === "pinned"
          ? capabilities(id)?.threadPinReorder === true
          : !workingShelfEnabled && capabilities(id)?.threadActiveReorder === true,
      ),
    });
  const planners = { pinned: planner("pinned"), active: planner("active") };
  const own = capabilities(thread.environmentId);
  const threadKey = scopedThreadKey(thread.environmentId, thread.id);
  return (destination: ThreadDropDestination) => {
    const target = destination.section;
    if (target === undefined) return false;
    if (target === "settled") return own?.threadSettlement === true;
    if (
      target !== section &&
      (target === "pinned" || section === "pinned") &&
      own?.threadPinning !== true
    )
      return false;
    return planners[target](threadKey, destination) !== null;
  };
}

/** Untransformed list layout; the gap is a transform, so hit testing never sees it. */
function snapshotRows(
  state: LegendListState,
  items: readonly { readonly type: string; readonly key: string }[],
) {
  const geometry = completeThreadDragGeometry(
    items.map((item, index) => state.positionByKey(item.key) ?? state.positionAtIndex(index)),
    items.map((item) => state.sizes.get(item.key)),
    ESTIMATED_ROW_HEIGHT,
  );
  const rows: ThreadDragRow[] = [];
  const offsets: Record<string, number> = {};
  let version = items.length;
  items.forEach((item, index) => {
    const { offset, height } = geometry[index]!;
    offsets[item.key] = offset;
    version = (version * 31 + offset * 7 + height) % 2_147_483_647;
    if (!isThreadListV2ListItem(item)) return;
    rows.push({
      key: item.key,
      threadKey:
        item.type === "v2-thread"
          ? scopedThreadKey(item.item.thread.environmentId, item.item.thread.id)
          : null,
      section: dragSection(item),
      offset,
      height,
    });
  });
  return { rows, offsets, version };
}

/**
 * Hosts press-and-drag arrangement for a thread list. Rows join through
 * `useThreadListDragTarget`; hit testing uses the layout from when the drag
 * began while rows slide aside to show the insertion gap.
 */
export function ThreadListDragSurface(props: {
  readonly listRef: RefObject<LegendListRef | null>;
  readonly items: readonly { readonly type: string; readonly key: string }[];
  readonly workingShelfEnabled: boolean;
  /** Content hidden under translucent chrome, kept out of the auto-scroll edges. */
  readonly edgeInsets?: { readonly top: number; readonly bottom: number };
  /** Keep the inverse action above any floating controls outside the list. */
  readonly undoBottomInset?: number;
  readonly onMoveThread: (
    thread: EnvironmentThreadShell,
    destination: ThreadDropDestination,
  ) => Promise<boolean>;
  /** Spread onto the list: a held row stays mounted and the list stops scrolling. */
  readonly children: (listProps: ThreadListDragListProps) => ReactNode;
}) {
  const [heldKey, setHeldKey] = useState<string | null>(null);
  const [undo, setUndo] = useState<DropUndo | null>(null);
  const undoGeneration = useRef(0);
  useEffect(
    () => () => {
      undoGeneration.current += 1;
    },
    [],
  );
  useEffect(() => {
    if (!undo) return;
    const refresh = () =>
      setUndo((current) => {
        if (!current || current.busy) return current;
        const shells = appAtomRegistry.get(environmentThreadShells.threadShellsAtom);
        const thread = shells.find(
          (row) =>
            row.id === current.thread.id && row.environmentId === current.thread.environmentId,
        );
        const anchor = current.destination.targetId;
        if (
          !thread ||
          currentDropSection(thread) === null ||
          (anchor !== null &&
            !shells.some(
              (row) =>
                scopedThreadKey(row.environmentId, row.id) === anchor &&
                currentDropSection(row) === current.destination.section,
            ))
        )
          return null;
        if (currentDropSection(thread) !== current.expectedSection)
          return current.fingerprint === null &&
            lifecycleFingerprint(thread) === lifecycleFingerprint(current.thread)
            ? current
            : null;
        const fingerprint = lifecycleFingerprint(thread);
        return current.fingerprint === null
          ? { ...current, fingerprint }
          : current.fingerprint === fingerprint
            ? current
            : null;
      });
    const unsubscribe = appAtomRegistry.subscribe(
      environmentThreadShells.threadShellsAtom,
      refresh,
    );
    const unsubscribeQueued = appAtomRegistry.subscribe(queuedThreadKeysAtom, refresh);
    refresh();
    return () => {
      unsubscribe();
      unsubscribeQueued();
    };
  }, [undo]);
  const layout = useSharedValue<DragLayout | null>(null);
  const fingerY = useSharedValue(0);
  const previewAnchor = useSharedValue(0);
  const previewBounds = useSharedValue({ min: 0, max: 0 });
  const window = useWindowDimensions();
  const [preview, setPreview] = useState<DragPreview | null>(null);
  const container = useRef<ViewInstance>(null);
  const geometry = useRef({ top: 0, height: 0 });
  const drag = useRef<Drag | null>(null);
  const frame = useRef<number | null>(null);
  const latest = useRef(props);
  latest.current = props;

  const controller = useMemo<ThreadListDragController>(() => {
    const stopScrolling = () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
    const clear = () => {
      stopScrolling();
      drag.current = null;
      layout.set(null);
      setPreview(null);
    };
    // Rows are measured as auto-scroll reveals them, so every retarget reads
    // LegendList's current layout and the scroll offset it actually applied.
    const measure = (current: Drag, state: LegendListState) => {
      current.scroll = state.scroll;
      const snapshot = snapshotRows(state, latest.current.items);
      if (snapshot.version === current.geometryVersion) return false;
      const source = snapshot.rows.find((row) => row.key === current.itemKey);
      current.rows = snapshot.rows;
      current.offsets = snapshot.offsets;
      current.geometryVersion = snapshot.version;
      if (source !== undefined) {
        current.sourceOffset = source.offset;
        current.sourceHeight = source.height;
      }
      return true;
    };
    const retarget = () => {
      const current = drag.current;
      const list = latest.current.listRef.current;
      if (current === null || list === null) return;
      const remeasured = measure(current, list.getState());
      const destination = resolveThreadDrop({
        rows: current.rows,
        contentY: current.anchor + current.absoluteY + current.scroll,
        source: {
          threadKey: scopedThreadKey(current.thread.environmentId, current.thread.id),
          section: current.section,
        },
        canDrop: current.canDrop,
      });
      const retargeted =
        destination?.section !== current.destination?.section ||
        destination?.targetId !== current.destination?.targetId ||
        destination?.placement !== current.destination?.placement;
      if (!retargeted && !remeasured) return;
      current.destination = destination;
      layout.set({
        sourceKey: current.itemKey,
        sourceOffset: current.sourceOffset,
        sourceHeight: current.sourceHeight,
        insertionOffset: threadDropInsertionOffset(current.rows, destination, current.sourceOffset),
        offsets: current.offsets,
      });
      if (!retargeted) return;
      setPreview({
        title: current.thread.title,
        height: current.sourceHeight,
        action:
          destination?.section === undefined
            ? null
            : threadDragAction(current.section, destination.section),
      });
    };
    const autoScroll = () => {
      let last = performance.now();
      const tick = () => {
        const current = drag.current;
        const list = latest.current.listRef.current;
        if (current === null || list === null) return;
        const now = performance.now();
        const elapsed = Math.min(now - last, 32);
        last = now;
        const insets = latest.current.edgeInsets ?? { top: 0, bottom: 0 };
        current.absoluteY = fingerY.get();
        const y = current.absoluteY - geometry.current.top;
        const top = insets.top + AUTO_SCROLL_EDGE;
        const bottom = geometry.current.height - insets.bottom - AUTO_SCROLL_EDGE;
        const speed =
          y < top
            ? -Math.min(1, (top - y) / AUTO_SCROLL_EDGE)
            : y > bottom
              ? Math.min(1, (y - bottom) / AUTO_SCROLL_EDGE)
              : 0;
        if (speed !== 0) {
          const state = list.getState();
          const maximum = Math.max(state.scroll, state.contentLength - state.scrollLength);
          const scroll = Math.max(
            current.minimumScroll,
            Math.min(maximum, state.scroll + speed * elapsed * 0.5),
          );
          if (Math.abs(scroll - state.scroll) >= 0.5) {
            // LegendList clamps negative offsets; the native view keeps iOS insets.
            list.getNativeScrollRef()?.scrollTo({ y: scroll, animated: false });
          }
        }
        retarget();
        frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    };
    return {
      canStart: () =>
        drag.current === null &&
        getPendingThreadOrder() === null &&
        !appAtomRegistry.get(threadDropBusyAtom),
      arm: (itemKey) => {
        setHeldKey(itemKey);
        container.current?.measureInWindow((_x, y, _width, height) => {
          geometry.current = { top: y, height };
        });
      },
      disarm: () => setHeldKey(null),
      start: (itemKey, thread, grabY, absoluteY) => {
        const list = latest.current.listRef.current;
        if (list === null || drag.current !== null) return;
        undoGeneration.current += 1;
        setUndo(null);
        const state = list.getState();
        const snapshot = snapshotRows(state, latest.current.items);
        const source = snapshot.rows.find((row) => row.key === itemKey);
        if (source === undefined || (source.section !== "pinned" && source.section !== "active"))
          return;
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        const configs = appAtomRegistry.get(environmentServerConfigsAtom);
        const orderedSource = getThreadListV2OrderedSection({
          threads: appAtomRegistry.get(environmentThreadShells.threadShellsAtom),
          section: source.section,
          now: new Date().toISOString(),
          queuedThreadKeys: appAtomRegistry.get(queuedThreadKeysAtom),
          settlementEnvironmentIds: new Set(
            [...configs]
              .filter(([, config]) => config.environment.capabilities.threadSettlement)
              .map(([id]) => id),
          ),
          snoozeEnvironmentIds: new Set(
            [...configs]
              .filter(([, config]) => config.environment.capabilities.threadSnooze)
              .map(([id]) => id),
          ),
        });
        drag.current = {
          returnDestination: threadDragReturnDestination(
            orderedSource.map((row) => scopedThreadKey(row.environmentId, row.id)),
            scopedThreadKey(thread.environmentId, thread.id),
            source.section,
          ),
          itemKey,
          thread,
          section: source.section,
          grabY,
          anchor: source.offset + grabY - absoluteY - state.scroll,
          // iOS automatic insets rest the list at a negative offset.
          minimumScroll: Math.min(state.scroll, -(latest.current.edgeInsets?.top ?? 0)),
          canDrop: createDropPolicy(thread, source.section, latest.current.workingShelfEnabled),
          rows: snapshot.rows,
          offsets: snapshot.offsets,
          geometryVersion: snapshot.version,
          sourceOffset: source.offset,
          sourceHeight: source.height,
          absoluteY,
          scroll: state.scroll,
          // Differs from any resolved value so the first retarget publishes.
          destination: { section: "settled", targetId: itemKey, placement: "before" },
        };
        fingerY.set(absoluteY);
        const insets = latest.current.edgeInsets ?? { top: 0, bottom: 0 };
        previewAnchor.set(geometry.current.top + grabY);
        previewBounds.set({
          min: insets.top,
          max: Math.max(insets.top, geometry.current.height - insets.bottom - source.height),
        });
        retarget();
        autoScroll();
      },
      move: (absoluteY) => {
        const current = drag.current;
        if (current === null) return;
        current.absoluteY = absoluteY;
        retarget();
      },
      end: (cancelled) => {
        const current = drag.current;
        stopScrolling();
        if (current === null) return;
        if (cancelled) {
          clear();
          return;
        }
        current.absoluteY = fingerY.get();
        retarget();
        if (current.destination === null) {
          clear();
          return;
        }
        // Keep the gap until the saved order arrives, avoiding a flash back.
        const generation = undoGeneration.current;
        const destination = current.destination;
        void latest.current
          .onMoveThread(current.thread, destination)
          .then((success) => {
            if (
              success &&
              generation === undoGeneration.current &&
              current.returnDestination &&
              destination.section &&
              destination.section !== current.section
            ) {
              setUndo({
                thread: current.thread,
                destination: current.returnDestination,
                expectedSection: destination.section,
                fingerprint: null,
                busy: false,
              });
            }
          })
          .catch(() => {})
          .finally(() => {
            if (drag.current === current) clear();
          });
      },
    };
  }, [layout, fingerY, previewAnchor, previewBounds]);
  const previewStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: Math.max(
          previewBounds.value.min,
          Math.min(previewBounds.value.max, fingerY.value - previewAnchor.value),
        ),
      },
    ],
  }));

  // A reordered or rebuilt list invalidates the drag-start layout.
  // Sections count too: a remote pin keeps the order but changes the drop.
  const orderVersion = props.items
    .map((item) =>
      item.type === "v2-thread" && isThreadListV2ListItem(item)
        ? `${item.key}:${dragSection(item)}`
        : item.key,
    )
    .join("|");
  useEffect(() => {
    if (drag.current === null) return;
    drag.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    layout.set(null);
    setHeldKey(null);
    setPreview(null);
  }, [orderVersion, window.width, window.height, layout]);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const context = useMemo(() => ({ controller, layout, fingerY }), [controller, layout, fingerY]);
  // Preview updates re-render only the surface; an unchanged element skips the list.
  const list = useMemo(
    () =>
      props.children(
        heldKey === null
          ? { scrollEnabled: true }
          : // Recycling the held cell would cancel its gesture mid-drag.
            { scrollEnabled: false, alwaysRender: { keys: [heldKey] } },
      ),
    [props.children, heldKey],
  );
  return (
    <ThreadListDragContext value={context}>
      <View
        ref={container}
        collapsable={false}
        className="flex-1"
        onLayout={(event) => {
          geometry.current.height = event.nativeEvent.layout.height;
          container.current?.measureInWindow((_x, top, _width, height) => {
            geometry.current = { top, height };
          });
        }}
      >
        {list}
        {undo ? (
          <View
            accessibilityLiveRegion="polite"
            className="absolute left-3 right-3 flex-row items-center gap-3 rounded-xl border border-border bg-screen px-4 py-2"
            style={{ bottom: (props.undoBottomInset ?? props.edgeInsets?.bottom ?? 0) + 12 }}
          >
            <Text numberOfLines={1} className="flex-1 text-sm">
              {undo.expectedSection === "settled"
                ? "Settled"
                : undo.expectedSection === "pinned"
                  ? "Pinned"
                  : "Unpinned"}{" "}
              {undo.thread.title}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Undo move of ${undo.thread.title}`}
              disabled={undo.busy || undo.fingerprint === null}
              className="min-h-11 justify-center px-2 disabled:opacity-40"
              onPress={() => {
                const current = undo;
                const generation = undoGeneration.current;
                setUndo({ ...current, busy: true });
                void props
                  .onMoveThread(current.thread, current.destination)
                  .then((success) => {
                    if (generation !== undoGeneration.current) return;
                    setUndo((value) =>
                      value?.thread === current.thread
                        ? success
                          ? null
                          : { ...value, busy: false }
                        : value,
                    );
                  })
                  .catch(() => {
                    if (generation !== undoGeneration.current) return;
                    setUndo((value) =>
                      value?.thread === current.thread ? { ...value, busy: false } : value,
                    );
                  });
              }}
            >
              <Text className="font-t3-medium text-primary-text">Undo</Text>
            </Pressable>
          </View>
        ) : null}
        {preview === null ? null : (
          <Reanimated.View
            pointerEvents="none"
            style={[
              { position: "absolute", top: 0, left: 12, right: 12, height: preview.height },
              previewStyle,
            ]}
          >
            <View className="flex-1 justify-center rounded-xl border border-border bg-screen px-4">
              <Text numberOfLines={preview.action ? 1 : 2} className="text-base font-t3-medium">
                {preview.title}
              </Text>
              {preview.action ? (
                <Text className="text-xs text-foreground-muted">{preview.action}</Text>
              ) : null}
            </View>
          </Reanimated.View>
        )}
      </View>
    </ThreadListDragContext>
  );
}

/**
 * Press-and-drag for one row. A short hold followed by movement lifts the
 * row; a quick flick scrolls and holding still leaves the long-press menu to
 * the row. Call `onMenuOpen` when that menu appears so the hold cannot lift.
 */
export function useThreadListDragTarget(input: {
  readonly itemKey: string;
  readonly thread: EnvironmentThreadShell;
  readonly enabled: boolean;
}) {
  const drag = use(ThreadListDragContext);
  const fallbackLayout = useSharedValue<DragLayout | null>(null);
  const layout = drag?.layout ?? fallbackLayout;
  const controller = drag?.controller ?? null;
  const enabled = input.enabled && controller !== null;
  const row = useAnimatedRef<ViewInstance>();
  const latest = useRef(input);
  latest.current = input;
  const fallbackFinger = useSharedValue(0);
  const fingerY = drag?.fingerY ?? fallbackFinger;
  const menuOpen = useSharedValue(false);
  const active = useRef(false);
  const touch = useSharedValue({ time: 0, x: 0, y: 0, active: false });
  const keyAtRender = input.itemKey;
  const callbacks = useMemo(
    () => ({
      start: (key: string, grabY: number, absoluteY: number) => {
        if (key !== latest.current.itemKey || !controller?.canStart()) return;
        active.current = true;
        controller.arm(latest.current.itemKey);
        controller.start(latest.current.itemKey, latest.current.thread, grabY, absoluteY);
        controller.move(absoluteY);
      },
      end: (cancelled: boolean) => {
        if (!active.current) return;
        active.current = false;
        controller?.end(cancelled);
        controller?.disarm();
      },
    }),
    [controller],
  );
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        .manualActivation(true)
        .shouldCancelWhenOutside(false)
        .onTouchesDown((event, manager) => {
          const point = event.allTouches[0];
          if (event.numberOfTouches !== 1 || point === undefined) {
            manager.fail();
            return;
          }
          menuOpen.set(false);
          touch.set({ time: Date.now(), x: point.absoluteX, y: point.absoluteY, active: false });
        })
        .onTouchesMove((event, manager) => {
          if (touch.value.active) return;
          const point = event.allTouches[0];
          if (menuOpen.value || event.numberOfTouches !== 1 || point === undefined) {
            manager.fail();
            return;
          }
          const distance = Math.hypot(
            point.absoluteX - touch.value.x,
            point.absoluteY - touch.value.y,
          );
          if (Date.now() - touch.value.time < HOLD_MS) {
            if (distance > 10) manager.fail();
          } else if (distance > LIFT_SLOP) manager.activate();
        })
        .onTouchesUp((_, manager) => {
          if (!touch.value.active) manager.fail();
        })
        .onTouchesCancelled((_, manager) => {
          if (!touch.value.active) manager.fail();
        })
        .onStart((event) => {
          if (menuOpen.value) return;
          touch.modify((value) => {
            value.active = true;
            return value;
          });
          fingerY.set(event.absoluteY);
          const bounds = measure(row);
          const grabY = bounds ? touch.value.y - bounds.pageY : event.y - event.translationY;
          runOnJS(callbacks.start)(keyAtRender, grabY, event.absoluteY - event.translationY);
        })
        .onUpdate((event) => {
          fingerY.set(event.absoluteY);
        })
        .onFinalize((_, success) => {
          runOnJS(callbacks.end)(!success || menuOpen.value);
        }),
    [enabled, callbacks, fingerY, menuOpen, touch, row, keyAtRender],
  );

  const itemKey = input.itemKey;
  const style = useAnimatedStyle(() => {
    const value = layout.value;
    const offset = value?.offsets[itemKey];
    if (value == null || offset === undefined)
      return { opacity: 1, transform: [{ translateY: 0 }] };
    const shift = threadDragGapOffset(
      offset,
      value.sourceOffset,
      value.sourceHeight,
      value.insertionOffset,
    );
    return {
      opacity: value.sourceKey === itemKey ? 0 : 1,
      transform: [
        { translateY: withTiming(shift, { duration: 160, reduceMotion: ReduceMotion.System }) },
      ],
    };
  });

  useEffect(() => () => callbacks.end(true), [input.itemKey, callbacks]);
  const onMenuOpen = useMemo(
    () => () => {
      menuOpen.set(true);
      callbacks.end(true);
    },
    [callbacks, menuOpen],
  );
  return { gesture, style, onMenuOpen, ref: row };
}

/** The lifted wrapper for a row using `useThreadListDragTarget`. */
export function ThreadListDragRow(props: {
  readonly drag: ReturnType<typeof useThreadListDragTarget>;
  readonly children: ReactNode;
}) {
  return (
    <GestureDetector gesture={props.drag.gesture}>
      <Reanimated.View ref={props.drag.ref} collapsable={false} style={props.drag.style}>
        {props.children}
      </Reanimated.View>
    </GestureDetector>
  );
}
