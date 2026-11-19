import { useGT } from "gt-react-native";
import { isAppSymbolName, SymbolView } from "./AppSymbol.android";
import { dismissAndroidKeyboard } from "../../lib/android-back";
import type { MenuAction, MenuComponentProps } from "@react-native-menu/menu";
import type { ReactNode } from "react";
import { use, useRef, useState } from "react";
import type { StyleProp, ViewInstance, ViewStyle } from "react-native";
import { Pressable, ScrollView, View } from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";

import { useHardwareBack } from "../../lib/backHandler";
import {
  deriveMenuHorizontalPlacement,
  deriveMenuVerticalPlacement,
} from "../../lib/menu-placement";
import { WindowHingeContext } from "../../native/window-hinge-context";
import { OverlayPortal } from "./OverlayPortal";
import { useAndroidControlSizing } from "./useAndroidControlSizing";
import { AppText } from "./AppText";
import { ControllerConsole } from "../../features/controller/ControllerConsole";
import { ControllerPressable } from "../../features/controller/ControllerPressable";
import { useControllerRegionId } from "../../features/controller/ControllerRegion";

const SCREEN_MARGIN = 12;
const ANCHOR_GAP = 6;

// Freeze both snapshots at opening so keyboard and screen reflows cannot flip menu direction.
type AnchorSnapshot = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly keyboardWasVisible: boolean;
};

type OverlayFrame = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type AndroidAnchoredMenuProps = {
  readonly actions: readonly MenuAction[];
  readonly title?: string;
  readonly onPressAction?: MenuComponentProps["onPressAction"];
  readonly className?: string;
  readonly style?: StyleProp<ViewStyle>;
  readonly children: ReactNode | ((open: () => void) => ReactNode);
};

export function AndroidAnchoredMenu(props: AndroidAnchoredMenuProps) {
  const gt = useGT();
  const regionId = useControllerRegionId("content");
  const {
    scale,
    menuWidth: desiredMenuWidth,
    menuItemHeight,
    iconSize,
  } = useAndroidControlSizing();
  const [anchor, setAnchor] = useState<AnchorSnapshot | null>(null);
  const [path, setPath] = useState<readonly MenuAction[]>([]);
  const [overlay, setOverlay] = useState<OverlayFrame | null>(null);
  const windowHinge = use(WindowHingeContext);
  // State, not a ref: `open` reaches render-prop children, and the compiler
  // bails out of the whole component when a ref might be read during render.
  const [anchorNode, setAnchorNode] = useState<ViewInstance | null>(null);
  const overlayRef = useRef<ViewInstance>(null);

  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  const keyboardHeight = useKeyboardState((state) => state.height);
  const close = () => {
    setAnchor(null);
    setPath([]);
    setOverlay(null);
  };
  // The in-window menu is pinned to the trigger's spot above the keyboard, which is stale once it hides.
  if (anchor?.keyboardWasVisible === true && !keyboardVisible) {
    close();
  }

  const open = () => {
    anchorNode?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height, keyboardWasVisible: keyboardVisible });
    });
  };

  const measureOverlay = () => {
    overlayRef.current?.measureInWindow((x, y, width, height) => {
      setOverlay({ x, y, width, height });
    });
  };

  const back = () => {
    if (dismissAndroidKeyboard()) return;
    if (path.length > 0) setPath((current) => current.slice(0, -1));
    else close();
  };
  useHardwareBack(anchor !== null, () => {
    back();
    return true;
  });

  const parent = path[path.length - 1] ?? null;
  const levelActions = (parent?.subactions ?? props.actions).filter(
    (action) => !(action.attributes?.hidden ?? false),
  );

  const local =
    anchor === null || overlay === null
      ? null
      : {
          x: anchor.x - overlay.x,
          y: anchor.y - overlay.y,
          width: anchor.width,
          height: anchor.height,
        };
  const { left, width: menuWidth } =
    local === null || overlay === null
      ? { left: 0, width: desiredMenuWidth }
      : deriveMenuHorizontalPlacement({
          anchorX: local.x,
          anchorWidth: local.width,
          overlayWidth: overlay.width,
          desiredWidth: desiredMenuWidth,
          margin: SCREEN_MARGIN,
          hinge: windowHinge && { x: windowHinge.x - overlay.x, width: windowHinge.width },
        });
  const verticalPlacement =
    local === null || overlay === null
      ? null
      : deriveMenuVerticalPlacement({
          anchorY: local.y,
          anchorHeight: local.height,
          overlayHeight: overlay.height,
          // This in-window menu preserves keyboard focus; subtract the IME area so its items remain tappable.
          keyboardInset: keyboardVisible ? keyboardHeight : 0,
          gap: ANCHOR_GAP,
          margin: SCREEN_MARGIN,
          minHeight: 2 * menuItemHeight + 14 * scale,
        });

  const onPressItem = (action: MenuAction) => {
    if ((action.subactions?.length ?? 0) > 0) {
      setPath((current) => [...current, action]);
      return;
    }
    close();
    if (action.id !== undefined) {
      props.onPressAction?.({
        nativeEvent: { event: action.id },
      } as Parameters<NonNullable<MenuComponentProps["onPressAction"]>>[0]);
    }
  };

  return (
    <>
      {typeof props.children === "function" ? (
        <View
          ref={setAnchorNode}
          collapsable={false}
          className={props.className}
          style={props.style}
        >
          {props.children(open)}
        </View>
      ) : (
        <Pressable
          ref={setAnchorNode}
          accessibilityRole="button"
          className={props.className}
          collapsable={false}
          style={props.style}
          onPress={open}
        >
          <View pointerEvents="none">{props.children}</View>
        </Pressable>
      )}
      {anchor === null ? null : (
        <OverlayPortal>
          <ControllerConsole scopeKey={regionId} onBack={back}>
            <View
              ref={overlayRef}
              collapsable={false}
              className="absolute inset-0"
              onLayout={measureOverlay}
            >
              <Pressable
                accessible={false}
                importantForAccessibility="no-hide-descendants"
                className="absolute inset-0"
                onPress={close}
              />
              {local === null ? null : (
                <View
                  collapsable={false}
                  nativeID={regionId}
                  className="absolute overflow-hidden bg-card-alt shadow-md"
                  style={{ left, width: menuWidth, borderRadius: 4 * scale, ...verticalPlacement }}
                >
                  <ScrollView
                    contentContainerStyle={{ paddingVertical: 7 * scale }}
                    bounces={false}
                    keyboardShouldPersistTaps="always"
                    showsVerticalScrollIndicator={false}
                  >
                    {parent ? (
                      <ControllerPressable
                        accessibilityRole="button"
                        accessibilityLabel={
                          props.title == null
                            ? gt("Back to menu")
                            : gt("Back to {title}", { title: props.title })
                        }
                        onActivate={() => setPath((current) => current.slice(0, -1))}
                        onPress={() => setPath((current) => current.slice(0, -1))}
                        style={{
                          minHeight: menuItemHeight,
                          paddingHorizontal: 16 * scale,
                          justifyContent: "center",
                        }}
                      >
                        <AppText>{parent.title}</AppText>
                      </ControllerPressable>
                    ) : props.title ? (
                      <AppText className="px-4 py-2 text-foreground-muted">{props.title}</AppText>
                    ) : null}
                    {levelActions.map((action, index) => (
                      <ControllerPressable
                        key={action.id ?? `${index}:${action.title}`}
                        accessibilityRole="menuitem"
                        accessibilityLabel={action.title}
                        accessibilityState={{
                          disabled: action.attributes?.disabled,
                          selected: action.state === "on",
                        }}
                        disabled={
                          action.attributes?.disabled ||
                          (!action.subactions?.length && action.id === undefined)
                        }
                        onActivate={() => onPressItem(action)}
                        onPress={() => onPressItem(action)}
                        className="flex-row items-center gap-3 active:bg-subtle"
                        style={{
                          minHeight: menuItemHeight,
                          paddingHorizontal: 16 * scale,
                          opacity: action.attributes?.disabled ? 0.4 : 1,
                        }}
                      >
                        {action.image && isAppSymbolName(action.image) ? (
                          <SymbolView
                            name={action.image}
                            size={iconSize}
                            type="monochrome"
                            tintColorClassName={
                              action.attributes?.destructive
                                ? "accent-danger-foreground"
                                : "accent-foreground"
                            }
                          />
                        ) : null}
                        <View className="min-w-0 flex-1 py-2">
                          <AppText
                            className={
                              action.attributes?.destructive
                                ? "text-danger-foreground"
                                : "text-foreground"
                            }
                          >
                            {action.title}
                          </AppText>
                          {action.subtitle ? (
                            <AppText className="text-sm text-foreground-muted">
                              {action.subtitle}
                            </AppText>
                          ) : null}
                        </View>
                        {action.state === "on" ? <AppText>✓</AppText> : null}
                        {action.subactions?.length ? <AppText>›</AppText> : null}
                      </ControllerPressable>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>
          </ControllerConsole>
        </OverlayPortal>
      )}
    </>
  );
}
