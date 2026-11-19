import { ControllerPressable } from "../../features/controller/ControllerPressable";
import type { ComponentProps, ReactNode } from "react";
import { Pressable, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";

import { cn } from "../../lib/cn";
import { useHoverGesture } from "../../lib/useHoverGesture";

export function RowPressable({
  controllerActivate,
  controllerKey,
  controllerThread,
  children,
  className,
  interactionClassName = "bg-row-hover",
  interactionOpacity = 1,
  ...props
}: Omit<ComponentProps<typeof Pressable>, "children"> & {
  readonly controllerActivate?: () => void;
  readonly controllerKey?: string;
  readonly controllerThread?: boolean;
  readonly children: ReactNode;
  readonly interactionClassName?: string;
  readonly interactionOpacity?: number;
}) {
  const { hovered, hoverGesture } = useHoverGesture(props.disabled ?? false);
  const content = () => (
    <>
      <View
        pointerEvents="none"
        className={cn("absolute inset-0", interactionClassName)}
        style={{ opacity: props.disabled || !hovered ? 0 : interactionOpacity }}
      />
      {children}
    </>
  );
  return (
    <GestureDetector gesture={hoverGesture}>
      {controllerActivate ? (
        <ControllerPressable
          {...props}
          onActivate={controllerActivate}
          thread={controllerThread}
          controllerKey={controllerKey}
          className={cn("relative overflow-hidden", className)}
        >
          {content}
        </ControllerPressable>
      ) : (
        <Pressable {...props} className={cn("relative overflow-hidden", className)}>
          {content}
        </Pressable>
      )}
    </GestureDetector>
  );
}
