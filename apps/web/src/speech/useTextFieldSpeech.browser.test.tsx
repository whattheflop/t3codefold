import { useRef, useState } from "react";
import { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { act, render } from "../../test/render";
import type { useEnvironmentSpeechInput } from "./useEnvironmentSpeechInput";
import { useTextFieldSpeech } from "./useTextFieldSpeech";

type SpeechInput = Parameters<typeof useEnvironmentSpeechInput>[0];
const mocks = vi.hoisted(() => ({ input: undefined as SpeechInput | undefined }));
vi.mock("./useEnvironmentSpeechInput", () => ({
  useEnvironmentSpeechInput: (input: SpeechInput) => {
    mocks.input = input;
    return {};
  },
}));
vi.mock("./useDictationShortcut", () => ({ useDictationShortcut: () => "" }));
vi.mock(import("@effect/atom-react"), async (importOriginal) => ({
  ...(await importOriginal()),
  useAtomValue: () => null,
}));
vi.mock("../components/chat/ComposerSpeechButton", () => ({
  ComposerSpeechButton: () => null,
  ComposerSpeechRecordingPill: () => null,
}));
vi.mock("../components/chat/VoiceInputSetup", () => ({ VoiceInputSetup: () => null }));
vi.mock("../state/server", () => ({ primaryServerKeybindingsAtom: null }));

function setup() {
  mocks.input = undefined;
  return () => {
    if (!mocks.input) throw new Error("Speech target did not mount");
    return mocks.input;
  };
}

function Field({ ownerKey = "comment-a" }: { ownerKey?: string }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("draft");
  useTextFieldSpeech({
    environmentId: EnvironmentId.make("environment"),
    ownerKey,
    text,
    textareaRef,
    onTextChange: setText,
  });
  return (
    <>
      <textarea
        ref={textareaRef}
        aria-label="Comment"
        value={text}
        onChange={(event) => setText(event.currentTarget.value)}
      />
      <button>Other action</button>
    </>
  );
}

it.each(["before commit", "before callback", "never"] as const)(
  "commits to the captured field and preserves later focus when it moves %s",
  async (moveFocus) => {
    const speech = setup();
    await using screen = await render(<Field />);
    const frames: FrameRequestCallback[] = [];
    using _frame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const field = screen.container.querySelector("textarea")!;
    const other = screen.container.querySelector("button")!;
    field.focus();
    field.setSelectionRange(1, 3);
    expect(speech().readDraft()).toEqual({ text: "draft", selection: { start: 1, end: 3 } });
    if (moveFocus === "before commit") other.focus();
    await act(() => speech().commitDraft("dictated draft", { start: 4, end: 7 }));
    expect(field.value).toBe("dictated draft");
    if (moveFocus === "before callback") other.focus();
    expect(frames).toHaveLength(1);
    await act(() => frames[0]!(0));
    expect(document.activeElement).toBe(moveFocus === "never" ? field : other);
    if (moveFocus === "never") {
      expect(field.selectionStart).toBe(4);
      expect(field.selectionEnd).toBe(7);
    }
  },
);
