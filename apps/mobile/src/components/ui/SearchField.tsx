import type { RefObject } from "react";
import { type TextInputInstance, View } from "react-native";
import { ControllerPressable } from "../../features/controller/ControllerPressable";

import { ControllerTextInput } from "./ControllerTextInput";
import { SymbolView } from "./AppSymbol";
import { useAndroidControlSizing } from "./useAndroidControlSizing";

export interface SearchFieldProps {
  readonly autoFocus?: boolean;
  readonly inputRef: RefObject<TextInputInstance | null>;
  readonly accessibilityLabel: string;
  readonly clearAccessibilityLabel: string;
  readonly placeholder: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
}

export function SearchField({
  inputRef,
  autoFocus = true,
  accessibilityLabel,
  clearAccessibilityLabel,
  placeholder,
  value,
  onChangeText,
}: SearchFieldProps) {
  const { scale, mediumIconSize } = useAndroidControlSizing();
  return (
    <View
      className="min-w-0 flex-1 flex-row items-center rounded-full border border-input-border bg-input"
      style={{
        minHeight: Math.max(48, 42 * scale),
        gap: 7 * scale,
        paddingHorizontal: 10.5 * scale,
      }}
    >
      <SymbolView
        name="magnifyingglass"
        size={mediumIconSize}
        tintColorClassName="accent-foreground-muted"
      />
      <ControllerTextInput
        containerStyle={{ flex: 1, minWidth: 0 }}
        ref={inputRef}
        accessibilityLabel={accessibilityLabel}
        autoFocus={autoFocus}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        placeholder={placeholder}
        placeholderTextColorClassName="accent-placeholder"
        selectionColorClassName="accent-focus/32"
        cursorColorClassName="accent-focus"
        selectionHandleColorClassName="accent-focus"
        className="min-h-0 w-full min-w-0 rounded-none border-0 bg-transparent px-0 font-sans text-base text-foreground"
        style={{ paddingVertical: 7 * scale }}
        value={value}
        onChangeText={onChangeText}
      />
      {value.length > 0 ? (
        <ControllerPressable
          accessibilityLabel={clearAccessibilityLabel}
          accessibilityRole="button"
          hitSlop={10}
          onActivate={() => {
            onChangeText("");
            inputRef.current?.focus();
          }}
          onPress={() => {
            onChangeText("");
            inputRef.current?.focus();
          }}
        >
          <SymbolView
            name="xmark.circle.fill"
            size={mediumIconSize}
            tintColorClassName="accent-foreground-muted"
          />
        </ControllerPressable>
      ) : null}
    </View>
  );
}
