import {
  terminalOutputText,
  type TerminalOutputState,
} from "@t3tools/client-runtime/state/terminal";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type TextInputInstance,
  type ViewProps,
} from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { normalizeTerminalFontSize } from "./terminalPreferences";
import { MOBILE_TYPOGRAPHY } from "../../lib/typography";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import {
  getNativeTerminalHardwareKeyRevision,
  resolveNativeTerminalSurfaceView,
} from "./nativeTerminalModule";
import {
  buildGhosttyThemeConfig,
  getMobileTerminalTheme,
  type TerminalTheme,
} from "./terminalTheme";
import { terminalDebugLog } from "./terminalDebugLog";
import { useNativeTerminalOutput } from "./terminalSurfaceOutput";

interface TerminalInputEvent {
  readonly data: string;
}

interface TerminalResizeEvent {
  readonly cols: number;
  readonly rows: number;
}

interface TerminalSurfaceProps extends ViewProps {
  readonly terminalKey: string;
  readonly output: TerminalOutputState;
  /** Changing this replays the retained output, e.g. after a font change. */
  readonly replayKey: string;
  readonly fontSize?: number;
  readonly isRunning: boolean;
  readonly readOnly?: boolean;
  readonly autoFocus?: boolean;
  readonly keyboardFocusRequest?: number;
  readonly captureRequest?: number;
  readonly onCapture?: (text: string) => void;
  readonly theme?: TerminalTheme;
  readonly onInput: (data: string) => void;
  readonly onResize: (size: { readonly cols: number; readonly rows: number }) => void;
  /** Whether the terminal wants application cursor keys (DECCKM) for its arrow keys. */
  readonly onApplicationCursorKeysChange?: (enabled: boolean) => void;
}

function estimateGridSize(input: {
  readonly width: number;
  readonly height: number;
  readonly fontSize: number;
}): { readonly cols: number; readonly rows: number } {
  const cellWidth = input.fontSize * 0.62;
  const cellHeight = input.fontSize * 1.35;
  return {
    cols: Math.max(20, Math.min(400, Math.floor(input.width / cellWidth))),
    rows: Math.max(5, Math.min(200, Math.floor(input.height / cellHeight))),
  };
}

const FallbackTerminalSurface = memo(function FallbackTerminalSurface(props: TerminalSurfaceProps) {
  const fontSize = props.fontSize ?? MOBILE_TYPOGRAPHY.label.fontSize;
  const inputRef = useRef<TextInputInstance>(null);
  const { themeAppearance, themeId } = useAppearancePreferences();
  const theme = props.theme ?? getMobileTerminalTheme(themeId, themeAppearance);
  const text = useMemo(() => terminalOutputText(props.output), [props.output]);
  const statusLabel = props.readOnly
    ? "Viewing terminal output."
    : props.isRunning
      ? "Native terminal unavailable. Using text fallback."
      : "Open terminal to start a shell.";

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    props.onResize(estimateGridSize({ width, height, fontSize }));
  };

  useEffect(() => {
    if (!props.readOnly && (props.keyboardFocusRequest ?? 0) > 0) {
      inputRef.current?.blur();
      const focusFrame = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(focusFrame);
    }

    return undefined;
  }, [props.keyboardFocusRequest, props.readOnly]);

  return (
    <View
      className="flex-1"
      style={[
        {
          backgroundColor: theme.background,
          borderRadius: 8,
          overflow: "hidden",
        },
        props.style,
      ]}
      onLayout={handleLayout}
    >
      <View className="flex-1 px-2.5 py-2">
        <Text
          className="pb-2 text-2xs"
          style={{
            color: theme.mutedForeground,
          }}
        >
          {statusLabel}
        </Text>
        <ScrollView
          className="flex-1"
          contentContainerClassName="pb-3"
          showsVerticalScrollIndicator={false}
        >
          <Text
            selectable
            style={{
              color: theme.foreground,
              fontFamily: "Menlo",
              fontSize,
              lineHeight: Math.round(fontSize * 1.35),
            }}
          >
            {text || "$ "}
          </Text>
        </ScrollView>
      </View>
      <View
        className="flex-row items-center gap-2 border-t p-2"
        style={{
          borderTopColor: theme.border,
        }}
      >
        <TextInput
          ref={inputRef}
          autoCapitalize="none"
          autoCorrect={false}
          blurOnSubmit={false}
          editable={props.isRunning && !props.readOnly}
          placeholder="type and press return"
          placeholderTextColor={theme.mutedForeground}
          returnKeyType="send"
          className="text-sm"
          style={{
            color: theme.foreground,
            flex: 1,
            fontFamily: "Menlo",
            padding: 0,
          }}
          onSubmitEditing={(event) => {
            const text = event.nativeEvent.text;
            if (text.length > 0) {
              // Terminal Enter is CR. LF is Ctrl+J and raw-mode TUIs can treat it as J.
              props.onInput(`${text}\r`);
            }
          }}
        />
        <Pressable
          disabled={!props.isRunning || props.readOnly}
          style={({ pressed }) => ({
            opacity: !props.isRunning || props.readOnly ? 0.35 : pressed ? 0.65 : 1,
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 8,
            backgroundColor: theme.border,
          })}
          onPress={() => props.onInput("\u0003")}
        >
          <Text className="text-2xs font-t3-bold" style={{ color: theme.foreground }}>
            Ctrl-C
          </Text>
        </Pressable>
      </View>
    </View>
  );
});

export const TerminalSurface = memo(function TerminalSurface(props: TerminalSurfaceProps) {
  const fontSize = props.fontSize ?? MOBILE_TYPOGRAPHY.label.fontSize;
  const { themeAppearance, themeId, setTerminalFontSize } = useAppearancePreferences();
  const theme = props.theme ?? getMobileTerminalTheme(themeId, themeAppearance);
  const { onInput, onResize } = props;
  const NativeTerminalSurfaceView = resolveNativeTerminalSurfaceView();
  const hasNativeSurface = Boolean(NativeTerminalSurfaceView);
  const nativeOutput = useNativeTerminalOutput(props.output, props.replayKey);

  useEffect(() => {
    terminalDebugLog("native:surface", {
      terminalKey: props.terminalKey,
      native: hasNativeSurface,
      hardwareKeyRevision: getNativeTerminalHardwareKeyRevision(),
      outputOffset: props.output.nextOffset,
      isRunning: props.isRunning,
    });
  }, [hasNativeSurface, props.output.nextOffset, props.isRunning, props.terminalKey]);
  const handleNativeInput = useCallback(
    (event: NativeSyntheticEvent<TerminalInputEvent>) => {
      if (!props.isRunning || props.readOnly) {
        return;
      }
      terminalDebugLog("native:onInput", {
        codes: Array.from(event.nativeEvent.data, (char) => char.codePointAt(0)),
      });
      onInput(event.nativeEvent.data);
    },
    [onInput, props.isRunning, props.readOnly],
  );
  const handleNativeResize = useCallback(
    (event: NativeSyntheticEvent<TerminalResizeEvent>) => {
      onResize({
        cols: event.nativeEvent.cols,
        rows: event.nativeEvent.rows,
      });
    },
    [onResize],
  );

  if (NativeTerminalSurfaceView) {
    return (
      <View style={props.style}>
        <NativeTerminalSurfaceView
          appearanceScheme={themeAppearance}
          autoFocus={!props.readOnly && (props.autoFocus ?? true)}
          readOnly={props.readOnly ?? false}
          backgroundColor={theme.background}
          focusRequest={props.isRunning && !props.readOnly ? (props.keyboardFocusRequest ?? 0) : 0}
          foregroundColor={theme.foreground}
          mutedForegroundColor={theme.mutedForeground}
          terminalKey={props.terminalKey}
          output={nativeOutput.write}
          onOutputApplied={nativeOutput.handleOutputApplied}
          onCursorKeysChange={(event) =>
            props.onApplicationCursorKeysChange?.(event.nativeEvent.application)
          }
          {...(Platform.OS === "android"
            ? {
                onFontScaleCommit: (event: {
                  readonly nativeEvent: { readonly scale: number };
                }) => {
                  if (!Number.isFinite(event.nativeEvent.scale)) return;
                  const next = normalizeTerminalFontSize(fontSize * event.nativeEvent.scale);
                  if (next !== fontSize) setTerminalFontSize(next);
                },
              }
            : {})}
          fontSize={fontSize}
          style={{ flex: 1 }}
          themeConfig={buildGhosttyThemeConfig(theme)}
          onInput={handleNativeInput}
          onResize={handleNativeResize}
          captureRequest={props.captureRequest}
          onCapture={(event) => props.onCapture?.(event.nativeEvent.text)}
        />
      </View>
    );
  }

  return <FallbackTerminalSurface {...props} fontSize={fontSize} theme={theme} />;
});
