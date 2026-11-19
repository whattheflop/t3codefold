import { useGT } from "gt-react-native";
import { useEffectEvent, useId, useRef, useState } from "react";
import { type TextInputInstance } from "react-native";

import { ControllerPressable } from "../../features/controller/ControllerPressable";
import { useVoiceInputController } from "../../features/voice-input/useVoiceInputController";
import { AppTextInput } from "./AppText";

import type { ControllerTextInputProps } from "./ControllerTextInput";

export function ControllerTextInput({ ref, containerStyle, ...props }: ControllerTextInputProps) {
  const gt = useGT();
  const inputRef = useRef<TextInputInstance>(null);
  const id = useId();
  const [nativeSelection, setSelection] = useState({ start: 0, end: 0 });
  const selection = props.selection
    ? { start: props.selection.start, end: props.selection.end ?? props.selection.start }
    : nativeSelection;
  const readDraftMessage = useEffectEvent(() => props.value ?? "");
  const voice = useVoiceInputController({
    ownerKey: `controller-input:${id}`,
    label: props.accessibilityLabel ?? props.placeholder ?? gt("Text input"),
    readDraftMessage,
    selection,
    disabled: props.editable === false,
    onChangeDraftMessage: (value) => props.onChangeText?.(value),
    onChangeSelection: setSelection,
  });
  const input = (
    <AppTextInput
      {...props}
      ref={(instance) => {
        inputRef.current = instance;
        if (typeof ref === "function") return ref(instance);
        if (ref) ref.current = instance;
      }}
      editable={props.editable !== false && !voice.freezesEditor}
      selection={selection}
      onSelectionChange={(event) => {
        setSelection(event.nativeEvent.selection);
        props.onSelectionChange?.(event);
      }}
    />
  );
  return (
    <ControllerPressable
      touchPassthrough
      style={containerStyle}
      accessibilityLabel={props.accessibilityLabel ?? props.placeholder}
      disabled={props.editable === false}
      onActivate={() => inputRef.current?.focus()}
      onDictate={() => {
        if (voice.isBusy) voice.stop();
        else if (voice.isAvailable) voice.start();
      }}
    >
      {input}
    </ControllerPressable>
  );
}
