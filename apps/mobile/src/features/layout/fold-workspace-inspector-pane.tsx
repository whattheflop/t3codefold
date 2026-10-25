import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import {
  type FoldWorkspacePaneLayout,
  type PaneDividerRelease,
} from "../../lib/foldable-pane-layout";
import { AndroidHeaderIconButton } from "../../components/ui/AndroidScreenHeader";
import { RenderErrorBoundary, RenderFailureView } from "../../components/RenderErrorBoundary";
import { FoldWorkspacePaneDivider } from "./fold-workspace-pane-divider";
import { VimPaneFocusMarker } from "../keyboard/useWorkspaceVimNavigation";

// Animate opacity and translation only; animated widths reflow chat and resize terminals every frame.
export const WORKSPACE_PANE_REVEAL_TIMING = {
  duration: 180,
  easing: Easing.out(Easing.cubic),
  reduceMotion: ReduceMotion.System,
} as const;

// Keep hidden content mounted at its last width to preserve scroll and terminal state.
// Accept layout via props to avoid an import cycle with AdaptiveWorkspaceLayout.
export function FoldWorkspaceInspectorPane(props: {
  readonly topRegionHeight?: number | null;
  readonly fixedDivider?: boolean;
  readonly pathname: string;
  readonly panes: FoldWorkspacePaneLayout;
  readonly renderInspector?: () => ReactNode;
  readonly snapWidths?: ReadonlyArray<number>;
  readonly onDividerRelease: (release: PaneDividerRelease) => void;
  readonly onToggleMaximized: () => void;
}) {
  const { panes } = props;
  const width = panes.auxiliaryPaneWidth;
  const visible = props.renderInspector !== undefined && panes.auxiliaryPaneVisible;
  const lastVisibleWidth = useRef(width ?? 0);
  if (visible && width !== null) lastVisibleWidth.current = width;

  // A route replace remounts the screen that owns the inspector; starting at
  // the current visibility keeps an already-open pane from replaying its reveal.
  const [retainedInspector, setRetainedInspector] = useState<{ render: () => ReactNode } | null>(
    props.renderInspector ? { render: props.renderInspector } : null,
  );
  if (props.renderInspector && props.renderInspector !== retainedInspector?.render) {
    setRetainedInspector({ render: props.renderInspector });
  }
  const exitGeneration = useRef(0);
  const finishExit = useCallback((generation: number) => {
    if (exitGeneration.current === generation) setRetainedInspector(null);
  }, []);
  const reveal = useSharedValue(visible ? 1 : 0);
  useLayoutEffect(() => {
    const generation = ++exitGeneration.current;
    const releaseRegistration = props.renderInspector === undefined;
    reveal.value = withTiming(visible ? 1 : 0, WORKSPACE_PANE_REVEAL_TIMING, (finished) => {
      if (finished && !visible && releaseRegistration) runOnJS(finishExit)(generation);
    });
  }, [finishExit, props.renderInspector, reveal, visible]);
  const revealStyle = useAnimatedStyle(() => ({
    opacity: reveal.value,
    transform: [{ translateX: (1 - reveal.value) * 16 }],
  }));

  if (retainedInspector === null || width === null) return null;

  return (
    <>
      {visible && !props.fixedDivider && panes.auxiliaryPaneWidthRange !== null ? (
        <FoldWorkspacePaneDivider
          accessibilityLabel="Resize detail pane"
          width={width}
          range={panes.auxiliaryPaneWidthRange}
          maximized={panes.auxiliaryPaneMaximized}
          {...(props.snapWidths ? { snapWidths: props.snapWidths } : {})}
          onRelease={props.onDividerRelease}
          onToggleMaximized={props.onToggleMaximized}
        />
      ) : null}
      <View
        className="shrink-0"
        accessibilityElementsHidden={!visible}
        collapsable={false}
        importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
        pointerEvents={visible ? "auto" : "none"}
        style={{
          width: visible ? width : 0,
          ...(props.topRegionHeight != null && !panes.auxiliaryPaneMaximized
            ? { height: props.topRegionHeight }
            : {}),
          zIndex: visible ? undefined : 20,
        }}
      >
        <Animated.View
          className="flex-1"
          style={[
            {
              width: visible ? width : lastVisibleWidth.current,
              ...(visible
                ? {}
                : {
                    position: "absolute",
                    right: 0,
                    top: 0,
                    bottom: 0,
                  }),
            },
            revealStyle,
          ]}
        >
          {props.fixedDivider ? (
            <View className="h-12 flex-row items-center justify-end bg-header px-2">
              <AndroidHeaderIconButton
                accessibilityLabel={
                  panes.auxiliaryPaneMaximized ? "Restore detail pane" : "Maximize detail pane"
                }
                icon={
                  panes.auxiliaryPaneMaximized
                    ? "arrow.down.right.and.arrow.up.left"
                    : "arrow.up.left.and.arrow.down.right"
                }
                onPress={props.onToggleMaximized}
              />
            </View>
          ) : null}
          <RenderErrorBoundary
            resetKeys={[props.pathname]}
            renderFallback={(fallback) => (
              <RenderFailureView {...fallback} title="The inspector couldn't be displayed" />
            )}
          >
            <InspectorRenderer render={retainedInspector.render} />
          </RenderErrorBoundary>
        </Animated.View>
        <VimPaneFocusMarker region="inspector" />
      </View>
    </>
  );
}

// The render callback must run inside the boundary's child, not while its
// parent constructs the boundary element.
function InspectorRenderer(props: { readonly render?: () => ReactNode }) {
  return <>{props.render?.()}</>;
}
