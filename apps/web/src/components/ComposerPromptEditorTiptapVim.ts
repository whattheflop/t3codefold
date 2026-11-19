import { Extension } from "@tiptap/core";
import { redo, undo } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode, Slice } from "@tiptap/pm/model";
import {
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";

import { serializeEditorDoc } from "~/composer-rich-text-doc";
import {
  currentLineRange,
  currentWordRange,
  findCharacter,
  lineEnd,
  lineStart,
  moveTextCursor,
  orderedRange,
  type TextRange,
  type VimMotion,
} from "~/vim/vimText";

// Composer Vim mode: NORMAL, INSERT and VISUAL editing over the Tiptap doc.
// Motions run on a plain-text projection of the doc (one character per text
// character, one placeholder per inline chip, a newline between blocks), so
// the pure `~/vim/vimText` motions apply unchanged and every offset maps back
// to a ProseMirror position.

export type ComposerVimMode = "NORMAL" | "INSERT" | "VISUAL" | "VISUAL LINE";
export type ComposerVimModeDisplay = { mode: ComposerVimMode; pending: string };

type ComposerVimOperator = "c" | "d" | "y";

export interface ComposerVimState {
  mode: ComposerVimMode;
  count: string;
  pending: string;
  visualAnchor: number;
  visualFocus: number;
  /** The last yanked or deleted content, chips and marks included. */
  register: Slice | null;
  lastFind: { character: string; direction: -1 | 1; till: boolean } | null;
}

export function initialComposerVimState(): ComposerVimState {
  return {
    mode: "NORMAL",
    count: "",
    pending: "",
    visualAnchor: 0,
    visualFocus: 0,
    register: null,
    lastFind: null,
  };
}

export function composerVimDisplay(state: ComposerVimState): ComposerVimModeDisplay {
  return { mode: state.mode, pending: `${state.count}${state.pending}` };
}

/** Stands in for an inline chip: neither a word character nor whitespace. */
const ATOM_PLACEHOLDER = "￼";

export interface ComposerVimProjection {
  text: string;
  /** ProseMirror position before each character; the last entry is the doc end. */
  positions: number[];
}

export function projectComposerDoc(doc: ProseMirrorNode): ComposerVimProjection {
  let text = "";
  const positions: number[] = [];
  let previousBlockEnd: number | null = null;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (previousBlockEnd !== null) {
      positions.push(previousBlockEnd);
      text += "\n";
    }
    node.forEach((child, offset) => {
      const start = pos + 1 + offset;
      if (child.isText) {
        const value = child.text ?? "";
        for (let index = 0; index < value.length; index += 1) positions.push(start + index);
        text += value;
        return;
      }
      positions.push(start);
      text += child.type.name === "hardBreak" ? "\n" : ATOM_PLACEHOLDER;
    });
    previousBlockEnd = pos + 1 + node.content.size;
    return false;
  });
  positions.push(previousBlockEnd ?? doc.content.size);
  return { text, positions };
}

/** Projection offset of a ProseMirror position (the first offset at or after it). */
function projectionOffsetAt(projection: ComposerVimProjection, pos: number): number {
  const { positions } = projection;
  let low = 0;
  let high = positions.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (positions[middle]! < pos) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Markdown for a doc range, the same text a copy of that range puts on the clipboard. */
function sliceMarkdown(doc: ProseMirrorNode, from: number, to: number): string {
  const slice = doc.slice(from, to);
  const schema = doc.type.schema;
  const first = slice.content.firstChild;
  const content = first?.isInline
    ? schema.nodes.paragraph!.create(null, slice.content)
    : first?.type.name === "taskItem"
      ? schema.nodes.taskList!.create(null, slice.content)
      : slice.content;
  return serializeEditorDoc(doc.type.create(null, content)).value;
}

export interface ComposerVimKeyInput {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly isComposing?: boolean;
  readonly keyCode?: number;
}

export interface ComposerVimKeyResult {
  /** The key belongs to Vim: the editor and the app must not see it. */
  consumed: boolean;
  transaction: Transaction | null;
  /** Escape in NORMAL mode hands focus back to the page. */
  blur: boolean;
  /** Text to put on the system clipboard after a yank. */
  yanked: string | null;
}

const PASS: ComposerVimKeyResult = {
  consumed: false,
  transaction: null,
  blur: false,
  yanked: null,
};

const COMPOSER_VIM_MOTIONS = new Set(["h", "j", "k", "l", "w", "b", "e", "0", "^", "$", "{", "}"]);

function motionFromKey(key: string): VimMotion | null {
  if (key === "W") return "w";
  if (key === "B") return "b";
  if (key === "E") return "e";
  if (key === "G") return "G";
  return COMPOSER_VIM_MOTIONS.has(key) ? (key as VimMotion) : null;
}

const isVisual = (mode: ComposerVimMode) => mode === "VISUAL" || mode === "VISUAL LINE";

/** Moves the composer into INSERT mode, as the timeline's `i` does. */
export function enterComposerVimInsert(vim: ComposerVimState): void {
  vim.mode = "INSERT";
  vim.count = "";
  vim.pending = "";
}

/**
 * Applies one keydown to the Vim state. Mutates `vim` and returns the
 * transaction to dispatch; it never touches the view, so it runs on a bare
 * EditorState in tests.
 */
export function handleComposerVimKey(
  editorState: EditorState,
  vim: ComposerVimState,
  event: ComposerVimKeyInput,
): ComposerVimKeyResult {
  if (event.isComposing || event.keyCode === 229) return PASS;
  const escape = event.key === "Escape" || (event.ctrlKey && event.key === "[");
  if (vim.mode === "INSERT") {
    if (!escape) return PASS;
    vim.mode = "NORMAL";
    vim.count = "";
    vim.pending = "";
    return { ...PASS, consumed: true };
  }
  if (event.metaKey || event.altKey || (event.ctrlKey && event.key !== "r" && !escape)) {
    return PASS;
  }

  const doc = editorState.doc;
  const projection = projectComposerDoc(doc);
  const { text } = projection;
  const clampOffset = (offset: number) => Math.max(0, Math.min(text.length, offset));
  const posOf = (offset: number) => projection.positions[clampOffset(offset)]!;
  const selection = editorState.selection;
  const cursor = isVisual(vim.mode)
    ? clampOffset(vim.visualFocus)
    : projectionOffsetAt(projection, selection.head);
  const selectedRange: TextRange = {
    start: projectionOffsetAt(projection, selection.from),
    end: projectionOffsetAt(projection, selection.to),
  };
  const repetitions = Math.max(1, Number.parseInt(vim.count || "1", 10));

  let transaction: Transaction | null = null;
  let blur = false;
  let yanked: string | null = null;
  const tr = () => (transaction ??= editorState.tr);
  const done = (): ComposerVimKeyResult => ({ consumed: true, transaction, blur, yanked });
  const clearPending = () => {
    vim.count = "";
    vim.pending = "";
  };
  const collapseAt = (offset: number) => {
    tr().setSelection(TextSelection.create(doc, posOf(offset)));
  };
  const selectRange = (range: TextRange) => {
    tr().setSelection(TextSelection.create(doc, posOf(range.start), posOf(range.end)));
  };
  const enterMode = (mode: ComposerVimMode, at?: number) => {
    vim.mode = mode;
    clearPending();
    if (at !== undefined) {
      vim.visualFocus = at;
      collapseAt(at);
    }
  };
  const visualRange = (focus: number): TextRange =>
    vim.mode === "VISUAL LINE"
      ? {
          start: lineStart(text, Math.min(vim.visualAnchor, focus)),
          end: currentLineRange(text, Math.max(vim.visualAnchor, focus)).end,
        }
      : orderedRange(vim.visualAnchor, focus, true);
  const moveTo = (next: number) => {
    if (isVisual(vim.mode)) {
      vim.visualFocus = next;
      selectRange(visualRange(next));
    } else {
      collapseAt(next);
    }
    clearPending();
  };
  const applyOperator = (operator: ComposerVimOperator, range: TextRange) => {
    const start = clampOffset(Math.min(range.start, range.end));
    const end = clampOffset(Math.max(range.start, range.end));
    const from = posOf(start);
    const to = posOf(end);
    if (from < to) vim.register = doc.slice(from, to);
    if (operator === "y") {
      if (from < to) yanked = sliceMarkdown(doc, from, to);
      enterMode("NORMAL", start);
      return;
    }
    vim.mode = operator === "c" ? "INSERT" : "NORMAL";
    vim.visualFocus = start;
    clearPending();
    const change = tr().delete(from, to);
    change.setSelection(TextSelection.near(change.doc.resolve(change.mapping.map(from, -1))));
  };
  const runHistory = (command: typeof undo) => {
    command(editorState, (historyTransaction) => {
      transaction = historyTransaction;
    });
    clearPending();
  };
  // Splits the block at `offset`, keeping task items task items.
  const openLine = (offset: number, below: boolean) => {
    const pos = posOf(offset);
    const change = tr();
    const $pos = change.doc.resolve(pos);
    const item = $pos.depth >= 2 ? $pos.node(-1) : null;
    if (item?.type.name === "taskItem") {
      change.split(pos, 2, [
        { type: item.type, attrs: below ? { ...item.attrs, checked: false } : item.attrs },
        null,
      ]);
    } else {
      change.split(pos);
    }
    const caret = below ? change.mapping.map(pos, 1) : pos;
    change.setSelection(TextSelection.near(change.doc.resolve(caret)));
    vim.mode = "INSERT";
    clearPending();
  };
  const put = (before: boolean) => {
    const register = vim.register;
    clearPending();
    if (!register) return;
    const offset = before ? cursor : Math.min(lineEnd(text, cursor), cursor + 1);
    let at = posOf(offset);
    const change = tr();
    for (let index = 0; index < repetitions; index += 1) {
      const sizeBefore = change.doc.content.size;
      change.replace(at, at, register);
      at += change.doc.content.size - sizeBefore;
    }
    change.setSelection(TextSelection.near(change.doc.resolve(at)));
  };

  if (escape) {
    if (isVisual(vim.mode) || vim.pending || vim.count) enterMode("NORMAL", cursor);
    else blur = true;
    return done();
  }
  if (event.ctrlKey && event.key === "r") {
    runHistory(redo);
    return done();
  }

  const key = event.key;
  if (/^[1-9]$/u.test(key) || (key === "0" && vim.count.length > 0)) {
    vim.count += key;
    return done();
  }
  if (vim.pending.startsWith("find:")) {
    if (key.length !== 1) {
      clearPending();
      return done();
    }
    const command = vim.pending.slice(5);
    const direction = command === "f" || command === "t" ? 1 : -1;
    const till = command === "t" || command === "T";
    vim.lastFind = { character: key, direction, till };
    moveTo(findCharacter(text, cursor, key, direction, till, repetitions));
    return done();
  }
  if (vim.pending === "g") {
    if (key === "g") moveTo(moveTextCursor(text, cursor, "gg"));
    else clearPending();
    return done();
  }

  const operator = vim.pending[0];
  if (operator === "c" || operator === "d" || operator === "y") {
    if (vim.pending.length === 2) {
      if (key === "w") {
        applyOperator(operator, currentWordRange(text, cursor, vim.pending[1] === "a"));
      } else clearPending();
      return done();
    }
    if (key === operator) {
      let range = currentLineRange(text, cursor);
      for (let index = 1; index < repetitions; index += 1) {
        range = { start: range.start, end: currentLineRange(text, range.end).end };
      }
      applyOperator(operator, range);
      return done();
    }
    if (key === "i" || key === "a") {
      vim.pending += key;
      return done();
    }
    const motion = motionFromKey(key);
    if (!motion) {
      clearPending();
      return done();
    }
    const target = moveTextCursor(text, cursor, motion, repetitions);
    applyOperator(operator, orderedRange(cursor, target, motion === "e"));
    return done();
  }

  if (key === "g") {
    vim.pending = "g";
    return done();
  }
  if (key === "f" || key === "F" || key === "t" || key === "T") {
    vim.pending = `find:${key}`;
    return done();
  }
  if ((key === ";" || key === ",") && vim.lastFind) {
    const last = vim.lastFind;
    const direction = key === ";" ? last.direction : last.direction === 1 ? -1 : 1;
    moveTo(findCharacter(text, cursor, last.character, direction, last.till, repetitions));
    return done();
  }
  const motion = motionFromKey(key);
  if (motion) {
    moveTo(moveTextCursor(text, cursor, motion, repetitions));
    return done();
  }

  if (isVisual(vim.mode)) {
    if (key === "o") {
      const anchor = vim.visualAnchor;
      vim.visualAnchor = cursor;
      moveTo(anchor);
      return done();
    }
    if (key === "y" || key === "d" || key === "c" || key === "x") {
      applyOperator(key === "x" ? "d" : key, selectedRange);
      return done();
    }
  } else {
    if (key === "v" || key === "V") {
      vim.mode = key === "v" ? "VISUAL" : "VISUAL LINE";
      vim.visualAnchor = cursor;
      moveTo(cursor);
      return done();
    }
    if (key === "c" || key === "d" || key === "y") {
      vim.pending = key;
      return done();
    }
    if (key === "u") {
      runHistory(undo);
      return done();
    }
    if (key === "x") {
      applyOperator("d", {
        start: cursor,
        end: Math.min(lineEnd(text, cursor), cursor + repetitions),
      });
      return done();
    }
    if (key === "p" || key === "P") {
      put(key === "P");
      return done();
    }
    switch (key) {
      case "i":
        enterMode("INSERT", cursor);
        return done();
      case "a":
        enterMode("INSERT", Math.min(lineEnd(text, cursor), cursor + 1));
        return done();
      case "I":
        enterMode("INSERT", moveTextCursor(text, cursor, "^"));
        return done();
      case "A":
        enterMode("INSERT", lineEnd(text, cursor));
        return done();
      case "o":
        openLine(lineEnd(text, cursor), true);
        return done();
      case "O":
        openLine(lineStart(text, cursor), false);
        return done();
      default:
        break;
    }
  }

  // Swallow the keys that would otherwise edit the text or send the prompt.
  if (key === "Enter" || key === "Backspace" || key === "Delete" || key.length === 1) {
    clearPending();
    return done();
  }
  return PASS;
}

/**
 * Tiptap extension for the composer's Vim mode. The handler listens in the
 * capture phase so it runs before the editor's own key handling (Enter to
 * send, suggestion menus, prompt history) and before the app's shortcuts.
 */
export const ComposerVimExtension = Extension.create<{
  onDisplayChange: (display: ComposerVimModeDisplay) => void;
}>({
  name: "composer-vim",
  addOptions() {
    return { onDisplayChange: () => {} };
  },
  addProseMirrorPlugins() {
    const { onDisplayChange } = this.options;
    return [
      new Plugin({
        key: new PluginKey("composer-vim"),
        view: (view) => {
          const vim = initialComposerVimState();
          const publish = () => onDisplayChange(composerVimDisplay(vim));
          const handleKeyDown = (event: KeyboardEvent) => {
            if (!view.editable) return;
            const result = handleComposerVimKey(view.state, vim, event);
            if (!result.consumed) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            if (result.transaction) view.dispatch(result.transaction.scrollIntoView());
            if (result.yanked !== null) {
              void navigator.clipboard?.writeText(result.yanked).catch(() => undefined);
            }
            if (result.blur) view.dom.blur();
            publish();
          };
          // The timeline's `i` focuses the composer and asks for INSERT mode.
          const handleEnterInsert = () => {
            enterComposerVimInsert(vim);
            publish();
          };
          view.dom.addEventListener("keydown", handleKeyDown, true);
          view.dom.addEventListener("t3-vim-insert", handleEnterInsert);
          publish();
          return {
            destroy: () => {
              view.dom.removeEventListener("keydown", handleKeyDown, true);
              view.dom.removeEventListener("t3-vim-insert", handleEnterInsert);
            },
          };
        },
      }),
    ];
  },
});
