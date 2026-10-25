import { type ComponentProps, useCallback, useRef, useState } from "react";
import { type LayoutChangeEvent, View, type ViewInstance } from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";

import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { deriveTabletopChatLayout } from "./tabletop-chat-layout";

/**
 * Fold's tabletop posture for the thread detail screen: the transcript sits above a horizontal
 * fold and the composer controls below it. `layout` is null outside tabletop posture (or when
 * the lower half cannot fit the controls), in which case the screen lays out normally.
 */
export function useTabletopChat(input: {
  readonly navigationHeaderHeight: number;
  readonly windowHeight: number;
  readonly keyboardHeight: number;
  /** Height the composer and floating status cover before the controls have been measured. */
  readonly estimatedControlsHeight: number;
  /** Floating status coverage above the measured composer overlay. */
  readonly floatingCoverage: number;
}) {
  const { tabletopHingeTop, tabletopHingeHeight } = useAdaptiveWorkspaceLayout();
  const detailViewRef = useRef<ViewInstance>(null);
  const [detailViewport, setDetailViewport] = useState<{ top: number; height: number } | null>(
    null,
  );
  const [measuredControlsHeight, setMeasuredControlsHeight] = useState(0);
  const measureDetailViewport = useCallback(() => {
    detailViewRef.current?.measureInWindow((_x, top, _width, height) => {
      setDetailViewport((current) =>
        current?.top === top && current.height === height ? current : { top, height },
      );
    });
  }, []);
  const { floatingCoverage } = input;
  const onControlsLayout = useCallback(
    (event: LayoutChangeEvent) =>
      setMeasuredControlsHeight(event.nativeEvent.layout.height + floatingCoverage),
    [floatingCoverage],
  );
  const layout = deriveTabletopChatLayout({
    hingeTop: tabletopHingeTop,
    hingeHeight: tabletopHingeHeight,
    viewportTop: detailViewport?.top ?? input.navigationHeaderHeight,
    viewportHeight: detailViewport?.height ?? input.windowHeight - input.navigationHeaderHeight,
    keyboardHeight: input.keyboardHeight,
    controlsHeight: Math.max(measuredControlsHeight, input.estimatedControlsHeight),
  });
  return {
    layout,
    hingeTop: tabletopHingeTop,
    detailViewRef,
    measureDetailViewport,
    onControlsLayout,
  };
}

/** KeyboardStickyView inside a frame that starts below the fold in tabletop posture. */
export function TabletopKeyboardStickyView(
  props: ComponentProps<typeof KeyboardStickyView> & {
    readonly tabletop: { readonly controlsTop: number } | null;
  },
) {
  const { tabletop, ...stickyProps } = props;
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        top: tabletop?.controlsTop ?? 0,
        bottom: 0,
        left: 0,
        right: 0,
        overflow: tabletop ? "hidden" : "visible",
      }}
    >
      <KeyboardStickyView {...stickyProps} />
    </View>
  );
}
