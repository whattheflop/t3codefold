import { useGT } from "gt-react-native";
import { useEffect, useEffectEvent, useState } from "react";
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

// Move only the handle while dragging; resizing chat and terminals every frame causes repaint spikes.
export function FoldWorkspacePaneDivider(props: WorkspacePaneDividerProps) {
  const gt = useGT();
  const translationX = useSharedValue(0);
  const active = useSharedValue(0);

  // The handle keeps its dragged offset until the panes re-lay out around it,
  // so it never jumps back to the old edge for a frame. The release count
  // covers a release the layout clamps back to the same width.
  const [releaseCount, setReleaseCount] = useState(0);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- resets the Reanimated divider drag offset after the pane width settles
  useEffect(() => {
    translationX.set(0);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A committed pane resize or clamped release resets the native offset.
  }, [props.width, props.maximized, releaseCount, translationX]);

  const release = useEffectEvent((finalTranslationX: number) => {
    const current = props;
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
      translationX.set(withTiming(0, HANDLE_FADE));
      return;
    }
    current.onRelease(result);
    setReleaseCount((count) => count + 1);
  });
  const toggleMaximized = useEffectEvent(() => props.onToggleMaximized());

  const [gesture] = useState(() => {
    const pan = Gesture.Pan()
      .activeOffsetX([-6, 6])
      .failOffsetY([-24, 24])
      .onStart(() => {
        active.set(withTiming(1, HANDLE_FADE));
      })
      .onUpdate((event) => {
        translationX.set(event.translationX);
      })
      .onEnd((event, success) => {
        if (success) runOnJS(release)(event.translationX);
        else translationX.set(withTiming(0, HANDLE_FADE));
      })
      .onFinalize(() => {
        active.set(withTiming(0, HANDLE_FADE));
      });
    const tap = Gesture.Tap().onEnd((_event, success) => {
      if (success) runOnJS(toggleMaximized)();
    });
    return Gesture.Exclusive(pan, tap);
  });

  const handleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translationX.get() }],
  }));
  const activeStyle = useAnimatedStyle(() => ({ opacity: active.get() }));

  const handleAccessibilityAction = (event: AccessibilityActionEvent) => {
    const { width, range, onRelease, onToggleMaximized } = props;
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
          { name: "increment", label: gt("Make pane wider") },
          { name: "decrement", label: gt("Make pane narrower") },
          { name: "activate", label: props.maximized ? gt("Restore pane") : gt("Maximize pane") },
        ]}
        accessibilityLabel={props.accessibilityLabel}
        accessibilityRole="adjustable"
        accessibilityValue={{
          now: Math.round(props.width),
          text: props.maximized
            ? gt("Maximized")
            : gt("{width} points wide", { width: Math.round(props.width) }),
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
