import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, type AccessibilityActionEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { cn } from "../../lib/cn";
import { resolvePaneDividerRelease, type PaneDividerRelease } from "../../lib/foldable-pane-layout";

const ACCESSIBILITY_RESIZE_STEP = 24;
const HANDLE_FADE = { duration: 120 } as const;

interface WorkspacePaneDividerProps {
  readonly accessibilityLabel: string;
  /** Rendered width of the trailing pane this divider resizes. */
  readonly width: number;
  readonly range: { readonly min: number; readonly max: number };
  readonly maximized: boolean;
  /** Resting widths worth snapping to, such as the hinge of a foldable. */
  readonly snapWidths?: ReadonlyArray<number>;
  readonly onRelease: (release: PaneDividerRelease) => void;
  readonly onToggleMaximized: () => void;
}

/**
 * Fold's drag handle between the chat and the trailing pane (replacing upstream's
 * WorkspacePaneDivider).
 *
 * While dragging only the handle moves, on the UI thread; the panes lay out
 * once on release. Resizing the chat feed or a terminal on every frame both
 * drops frames and makes full-screen terminal programs repaint for widths the
 * user never stops at. Dragging past either end maximizes or closes the pane,
 * and tapping the grip toggles maximize.
 */
export function FoldWorkspacePaneDivider(props: WorkspacePaneDividerProps) {
  const latestProps = useRef(props);
  latestProps.current = props;
  const translationX = useSharedValue(0);
  const active = useSharedValue(0);

  // The handle keeps its dragged offset until the panes re-lay out around it,
  // so it never jumps back to the old edge for a frame. The release count
  // covers a release the layout clamps back to the same width.
  const [releaseCount, setReleaseCount] = useState(0);
  useEffect(() => {
    translationX.value = 0;
  }, [props.width, props.maximized, releaseCount, translationX]);

  const release = useCallback(
    (finalTranslationX: number) => {
      const current = latestProps.current;
      const result = resolvePaneDividerRelease({
        startWidth: current.width,
        translationX: finalTranslationX,
        range: current.range,
        ...(current.snapWidths ? { snapWidths: current.snapWidths } : {}),
      });
      const unchanged =
        (result.kind === "maximize" && current.maximized) ||
        (result.kind === "resize" && !current.maximized && result.width === current.width);
      if (unchanged) {
        translationX.value = withTiming(0, HANDLE_FADE);
        return;
      }
      current.onRelease(result);
      setReleaseCount((count) => count + 1);
    },
    [translationX],
  );
  const toggleMaximized = useCallback(() => latestProps.current.onToggleMaximized(), []);

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .activeOffsetX([-6, 6])
      .failOffsetY([-24, 24])
      .onStart(() => {
        active.value = withTiming(1, HANDLE_FADE);
      })
      .onUpdate((event) => {
        translationX.value = event.translationX;
      })
      .onEnd((event, success) => {
        if (success) runOnJS(release)(event.translationX);
        else translationX.value = withTiming(0, HANDLE_FADE);
      })
      .onFinalize(() => {
        active.value = withTiming(0, HANDLE_FADE);
      });
    const tap = Gesture.Tap().onEnd((_event, success) => {
      if (success) runOnJS(toggleMaximized)();
    });
    return Gesture.Exclusive(pan, tap);
  }, [active, release, toggleMaximized, translationX]);

  const handleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translationX.value }],
  }));
  const activeStyle = useAnimatedStyle(() => ({ opacity: active.value }));

  const handleAccessibilityAction = (event: AccessibilityActionEvent) => {
    const { width, range, onRelease, onToggleMaximized } = latestProps.current;
    switch (event.nativeEvent.actionName) {
      case "increment":
        onRelease({
          kind: "resize",
          width: Math.min(range.max, width + ACCESSIBILITY_RESIZE_STEP),
        });
        return;
      case "decrement":
        onRelease({
          kind: "resize",
          width: Math.max(range.min, width - ACCESSIBILITY_RESIZE_STEP),
        });
        return;
      case "activate":
        onToggleMaximized();
        return;
    }
  };

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        // Straddles the seam; a maximized pane's seam is the screen edge, so the
        // handle sits just inside it instead of half off-screen.
        className={cn(
          "relative z-[100] w-6 self-stretch items-center justify-center",
          props.maximized ? "-mr-6" : "-mx-3",
        )}
        accessible
        accessibilityActions={[
          { name: "increment", label: "Make pane wider" },
          { name: "decrement", label: "Make pane narrower" },
          { name: "activate", label: props.maximized ? "Restore pane" : "Maximize pane" },
        ]}
        accessibilityLabel={props.accessibilityLabel}
        accessibilityRole="adjustable"
        accessibilityValue={{
          now: Math.round(props.width),
          text: props.maximized ? "Maximized" : `${Math.round(props.width)} points wide`,
        }}
        onAccessibilityAction={handleAccessibilityAction}
        style={handleStyle}
      >
        <View className="absolute inset-y-0 w-px bg-border" />
        <Animated.View className="absolute inset-y-0 w-0.5 bg-primary" style={activeStyle} />
        <View className="h-10 w-1.5 rounded-full bg-border" />
        <Animated.View
          className="absolute h-14 w-1.5 rounded-full bg-primary"
          style={activeStyle}
        />
      </Animated.View>
    </GestureDetector>
  );
}
