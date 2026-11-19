import { useEffect, useRef, useState, type RefObject } from "react";
import type { TextInputInstance } from "react-native";

export function useQuestionDraftText(
  value: string,
  input: RefObject<Pick<TextInputInstance, "setNativeProps"> | null>,
) {
  const [initialText] = useState(value);
  const nativeText = useRef(value);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- applies external drafts without replacing local keystrokes and autocorrection
  useEffect(() => {
    if (value === nativeText.current) return;
    nativeText.current = value;
    input.current?.setNativeProps({ text: value });
  }, [input, value]);
  return {
    initialText,
    readNativeText: () => nativeText.current,
    onNativeTextChange: (text: string) => {
      nativeText.current = text;
    },
  };
}
