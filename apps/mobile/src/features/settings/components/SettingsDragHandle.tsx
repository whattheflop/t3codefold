import { useEffect, useMemo, useRef } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector, type GestureType } from "react-native-gesture-handler";
import type { SharedValue } from "react-native-reanimated";

import { SymbolView } from "../../../components/ui/AppSymbol";
import { useUIThreadDrag } from "../../threads/use-ui-thread-drag";

interface SettingsDragHandleProps {
  readonly title: string;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly onStart: () => void;
  readonly onMove: (translation: number) => void;
  readonly onEnd: (translation: number, cancelled: boolean) => void;
  readonly onStep: (direction: "up" | "down") => void;
}

/**
 * Pan recognition wins over the settings scroll view only inside the handle. Pass `translation`
 * to track the finger on the UI thread; `onMove` then only reports crossed slots.
 */
export function SettingsDragHandle(
  props: SettingsDragHandleProps & { readonly translation?: SharedValue<number> },
) {
  const { translation } = props;
  return translation ? (
    <UIThreadSettingsDragHandle {...props} translation={translation} />
  ) : (
    <JSThreadSettingsDragHandle {...props} />
  );
}

function UIThreadSettingsDragHandle(
  props: SettingsDragHandleProps & { readonly translation: SharedValue<number> },
) {
  const gesture = useUIThreadDrag({
    ...props,
    onEnd: (value, success) => props.onEnd(value, !success),
  });
  return <SettingsDragHandleView {...props} gesture={gesture} />;
}

function JSThreadSettingsDragHandle(props: SettingsDragHandleProps) {
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });
  const translation = useRef(0);
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .shouldCancelWhenOutside(false)
        .runOnJS(true)
        .onStart(() => {
          translation.current = 0;
          latest.current.onStart();
        })
        .onUpdate((event) => {
          translation.current = event.translationY;
          latest.current.onMove(event.translationY);
        })
        .onFinalize((_, success) => latest.current.onEnd(translation.current, !success)),
    [],
  );
  return <SettingsDragHandleView {...props} gesture={gesture} />;
}

function SettingsDragHandleView(
  props: SettingsDragHandleProps & { readonly gesture: GestureType },
) {
  return (
    <GestureDetector gesture={props.gesture}>
      <View
        collapsable={false}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={`Reorder ${props.title}`}
        accessibilityActions={[
          ...(props.canMoveUp ? [{ name: "decrement", label: "Move up" }] : []),
          ...(props.canMoveDown ? [{ name: "increment", label: "Move down" }] : []),
        ]}
        onAccessibilityAction={({ nativeEvent }) => {
          if (nativeEvent.actionName === "decrement" && props.canMoveUp) props.onStep("up");
          if (nativeEvent.actionName === "increment" && props.canMoveDown) props.onStep("down");
        }}
        style={{ width: 48, alignSelf: "stretch", alignItems: "center", justifyContent: "center" }}
      >
        <SymbolView
          name="line.3.horizontal"
          size={20}
          tintColorClassName="accent-foreground-muted"
        />
      </View>
    </GestureDetector>
  );
}
