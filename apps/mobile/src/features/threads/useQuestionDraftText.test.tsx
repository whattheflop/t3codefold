import { act, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import { useQuestionDraftText } from "./useQuestionDraftText";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("applies full-screen and dictated nonempty drafts while preserving local keystrokes", () => {
  const setNativeProps = vi.fn();
  let editor: ReturnType<typeof useQuestionDraftText> | undefined;
  function Probe({ value }: { value: string }) {
    const input = useRef({ setNativeProps });
    const draft = useQuestionDraftText(value, input);
    useEffect(() => {
      editor = draft;
    }, [draft]);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    act(() => root.render(<Probe value="original" />));
    editor!.onNativeTextChange("local typing");
    act(() => root.render(<Probe value="local typing" />));
    expect(setNativeProps).not.toHaveBeenCalled();
    act(() => root.render(<Probe value="full-screen edit" />));
    expect(setNativeProps).toHaveBeenLastCalledWith({ text: "full-screen edit" });
    expect(editor!.readNativeText()).toBe("full-screen edit");
    act(() => root.render(<Probe value="" />));
    expect(setNativeProps).toHaveBeenLastCalledWith({ text: "" });
  } finally {
    act(() => root.unmount());
  }
});
