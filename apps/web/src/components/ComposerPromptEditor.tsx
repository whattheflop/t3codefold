import { ComposerPromptEditorTiptap } from "./ComposerPromptEditorTiptap";
import type { ComposerPromptEditorProps } from "./ComposerPromptEditorTiptap";

export type {
  ComposerCitationCommentRequest,
  ComposerPromptEditorHandle,
  ComposerPromptEditorProps,
} from "./ComposerPromptEditorTiptap";
export type { ComposerVimModeDisplay } from "./ComposerPromptEditorTiptapVim";

/**
 * The composer editor. Tiptap in both modes: the `richTextEnabled` setting
 * toggles Markdown styling, never the engine. Plain mode keeps Markdown
 * markers literal; `literalText` also preserves context-token sources as text.
 * `vimModeEnabled` adds modal Vim editing to the same engine.
 */
export function ComposerPromptEditor(props: ComposerPromptEditorProps) {
  return <ComposerPromptEditorTiptap {...props} />;
}
