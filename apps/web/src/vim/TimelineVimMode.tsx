import { useEffect, useRef, useState } from "react";
import { openCommandPalette } from "~/commandPaletteBus";
import { redirectDropdownNavigationKey } from "~/lib/dropdownNavigationKey";
import { isPreviewFocused } from "~/lib/previewFocus";
import { isTerminalFocused } from "~/lib/terminalFocus";
import { focusWorkspaceArea } from "~/lib/workspaceFocus";
import { subscribeVimConversation, vimConversation } from "./vimConversation";
import { createVimScrollController } from "./vimScroll";
import { currentLineRange, moveTextCursor, type VimMotion } from "./vimText";

const HINT_ALPHABET = "asdfghjklqwertyuiopzxcvbnm";
const HINT_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  "[contenteditable=true]",
  "[role=button]:not([aria-disabled=true])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");
const EDITABLE_SELECTOR = "input, textarea, select, [contenteditable=true]";
const COMPOSER_SELECTOR = '[data-chat-composer-form="true"], [data-testid="composer-editor"]';
// Terminals need every unmodified key, Escape included.
const TERMINAL_SELECTOR = "[data-terminal-owner], [data-herdr-terminal]";
const AREA_SELECTOR = "[data-workspace-area]";
// Areas with dedicated Vim handling; every other workspace area gets the generic list model.
const SPECIAL_AREAS = new Set(["sidebar", "conversation", "composer"]);
// Rows j/k step through in a generic area. Without any, j/k scroll the area instead.
const LIST_ITEM_SELECTOR = [
  "[data-vim-list-item]",
  "[data-sidebar='menu-button']",
  "[data-sidebar='menu-sub-button']",
].join(",");
const ACTIVE_ITEM_SELECTOR =
  "[aria-current]:not([aria-current=false]), [aria-selected=true], [aria-pressed=true], [data-active=true], [data-vim-active=true]";
const FLOATING_SELECTOR = [
  '[role="dialog"]',
  '[data-slot="menu-popup"]',
  '[data-slot="select-popup"]',
  '[data-slot="popover-popup"]',
  '[data-slot="combobox-popup"]',
  '[data-slot="autocomplete-popup"]',
].join(",");
const SIDEBAR_ITEM_SELECTOR = [
  "[data-app-sidebar] [data-thread-item] [role=button]",
  "[data-app-sidebar] [data-thread-item] [data-sidebar='menu-sub-button']",
  "[data-app-sidebar] [data-sidebar='menu-button']",
  "[data-app-sidebar] [data-sidebar='menu-sub-button']",
].join(",");
// User-navigation state can remount the timeline. Keep the animator alive long enough to
// finish a tap while the next timeline instance takes over its keyup and blur listeners.
const timelineVimScroller = createVimScrollController();

type HintPosition = { label: string; left: number; top: number };
type ControlHint = HintPosition & { kind: "control"; element: HTMLElement };
type TextHint = HintPosition & { kind: "text"; offset: number };
type Hint = ControlHint | TextHint;
type ConversationSelectionState = {
  root: HTMLElement;
  chunks: Array<{ node: Text; start: number; end: number }>;
  text: string;
  anchor: number;
  focus: number;
};
type TimelineVimModeName = "NORMAL" | "PASS" | "CARET" | "VISUAL" | "HINT" | "TEXT HINT";
type CaretRect = { left: number; top: number; height: number };
type Mark = { rowId: string | null; rowOffset: number; scrollTop: number };
export type VimFocusDirection = "h" | "j" | "k" | "l";
/** `sidebar`, `conversation`, `composer`, `right-panel`, or `area:<name>` for any other workspace area. */
export type VimFocusRegionId = string;
export type VimFocusRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

type VimFocusRegion = {
  id: VimFocusRegionId;
  rect: VimFocusRect;
};

export function buildVimHintLabels(length: number): string[] {
  if (length <= HINT_ALPHABET.length) return HINT_ALPHABET.slice(0, length).split("");
  const width = Math.ceil(Math.log(length) / Math.log(HINT_ALPHABET.length));
  return Array.from({ length }, (_, index) => {
    let value = index;
    let label = "";
    for (let position = 0; position < width; position += 1) {
      label = HINT_ALPHABET[value % HINT_ALPHABET.length]! + label;
      value = Math.floor(value / HINT_ALPHABET.length);
    }
    return label;
  });
}

export function nextVimListIndex(
  length: number,
  current: number,
  direction: -1 | 1,
  count: number,
): number {
  if (length <= 0) return -1;
  if (current < 0) return direction > 0 ? 0 : length - 1;
  return Math.max(0, Math.min(length - 1, current + direction * Math.max(1, count)));
}

export function nextDirectionalVimRegion(
  regions: ReadonlyArray<VimFocusRegion>,
  currentId: VimFocusRegionId,
  direction: VimFocusDirection,
  sourceRect?: VimFocusRect,
): VimFocusRegionId | null {
  const current = regions.find((region) => region.id === currentId);
  const source = sourceRect ?? current?.rect;
  if (!source) return null;

  const sourceX = (source.left + source.right) / 2;
  const sourceY = (source.top + source.bottom) / 2;
  const horizontal = direction === "h" || direction === "l";
  const sign = direction === "h" || direction === "k" ? -1 : 1;

  return (
    regions
      .filter((region) => region.id !== currentId)
      .map((region) => {
        const candidateX = (region.rect.left + region.rect.right) / 2;
        const candidateY = (region.rect.top + region.rect.bottom) / 2;
        const primaryDelta = sign * (horizontal ? candidateX - sourceX : candidateY - sourceY);
        const perpendicularOverlap = horizontal
          ? Math.min(region.rect.bottom, source.bottom) - Math.max(region.rect.top, source.top)
          : Math.min(region.rect.right, source.right) - Math.max(region.rect.left, source.left);
        if (primaryDelta <= 1 || perpendicularOverlap <= 1) return null;
        const perpendicularDelta = Math.abs(
          horizontal ? candidateY - sourceY : candidateX - sourceX,
        );
        return { id: region.id, score: primaryDelta + perpendicularDelta / 4 };
      })
      .filter((candidate) => candidate !== null)
      .sort((left, right) => left.score - right.score)[0]?.id ?? null
  );
}

function visible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < window.innerHeight &&
    rect.left < window.innerWidth &&
    style.visibility !== "hidden" &&
    style.display !== "none"
  );
}

/** Whether a scrolling or clipping ancestor hides the element, as in a long sidebar list. */
function clippedAway(element: HTMLElement, clips: Map<HTMLElement, DOMRect | null>): boolean {
  const rect = element.getBoundingClientRect();
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    let box = clips.get(parent);
    if (box === undefined) {
      const style = window.getComputedStyle(parent);
      box =
        style.overflowX === "visible" && style.overflowY === "visible"
          ? null
          : parent.getBoundingClientRect();
      clips.set(parent, box);
    }
    if (
      box &&
      (rect.bottom <= box.top ||
        rect.top >= box.bottom ||
        rect.right <= box.left ||
        rect.left >= box.right)
    )
      return true;
  }
  return false;
}

/** The open dialog or popup that owns the keyboard. Settings and Usage pages are not one. */
function floatingLayer(): HTMLElement | null {
  return (
    [...document.querySelectorAll<HTMLElement>(FLOATING_SELECTOR)]
      .filter((element) => !element.closest("[data-app-modal]") && visible(element))
      .at(-1) ?? null
  );
}

/** Settings and Usage open over the workspace; their areas replace the workspace's. */
function appModal(): HTMLElement | null {
  const modal = document.querySelector<HTMLElement>("[data-app-modal]");
  return modal && visible(modal) ? modal : null;
}

function liveAreas(): HTMLElement[] {
  const areas = [...(appModal() ?? document).querySelectorAll<HTMLElement>(AREA_SELECTOR)].filter(
    (area) =>
      !SPECIAL_AREAS.has(area.dataset.workspaceArea ?? "") &&
      !area.closest("[inert]") &&
      area.querySelector("[data-right-panel-surface-content]") === null &&
      area.closest("[data-right-panel-surface-content]") === null &&
      visible(area),
  );
  // A page area that holds smaller ones (Factory around its decision list) yields to them.
  return areas.filter((area) => !areas.some((other) => other !== area && area.contains(other)));
}

/** The generic area holding `element`, if it is not a sidebar, conversation, or panel. */
function genericAreaOf(element: Element | null): HTMLElement | null {
  if (!(element instanceof HTMLElement)) return null;
  const area = element.closest<HTMLElement>(AREA_SELECTOR);
  return area && liveAreas().includes(area) ? area : null;
}

/**
 * Where keys go when nothing in particular is focused and no conversation is shown: the page's
 * main content, which is its largest area (Factory's conversation, not its fleet list).
 */
function primaryArea(): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestSize = 0;
  for (const area of liveAreas()) {
    const rect = area.getBoundingClientRect();
    const size = rect.width * rect.height;
    if (size > bestSize) {
      best = area;
      bestSize = size;
    }
  }
  return best;
}

function listItems(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(LIST_ITEM_SELECTOR)].filter(
    (element) => rendered(element) && !element.matches(":disabled, [aria-disabled=true]"),
  );
}

function focusArea(area: HTMLElement): void {
  const items = listItems(area);
  const item = items.find((element) => element.matches(ACTIVE_ITEM_SELECTOR)) ?? items[0];
  if (item) {
    item.focus({ preventScroll: false });
    return;
  }
  const name = area.dataset.workspaceArea;
  if (name && focusWorkspaceArea(name) && area.contains(document.activeElement)) return;
  area.tabIndex = -1;
  area.focus({ preventScroll: true });
}

/** The area's own scroller: the tallest overflowing element inside it, or the area itself. */
function areaScrollNode(area: HTMLElement): HTMLElement {
  let best: HTMLElement = area;
  let bestHeight = area.scrollHeight > area.clientHeight ? area.clientHeight : 0;
  for (const element of area.querySelectorAll<HTMLElement>("*")) {
    if (element.scrollHeight <= element.clientHeight || element.clientHeight <= bestHeight)
      continue;
    const { overflowY } = window.getComputedStyle(element);
    if (overflowY !== "auto" && overflowY !== "scroll") continue;
    best = element;
    bestHeight = element.clientHeight;
  }
  return best;
}

function rendered(element: HTMLElement): boolean {
  return (
    element.getClientRects().length > 0 && element.closest("[hidden], [aria-hidden=true]") === null
  );
}

function vimScrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

function collectHints(scope: ParentNode): Hint[] {
  const clips = new Map<HTMLElement, DOMRect | null>();
  const elements = [...scope.querySelectorAll<HTMLElement>(HINT_SELECTOR)].filter(
    (element) =>
      visible(element) &&
      !element.closest(
        `[data-vim-hint-ignore], ${TERMINAL_SELECTOR}, webview, [inert], [aria-hidden=true]`,
      ) &&
      !clippedAway(element, clips),
  );
  const labels = buildVimHintLabels(elements.length);
  return elements.map((element, index) => {
    const rect = element.getBoundingClientRect();
    return { kind: "control", element, label: labels[index]!, left: rect.left, top: rect.top };
  });
}

function collectConversationText(
  root: HTMLElement,
): Omit<ConversationSelectionState, "root" | "anchor" | "focus"> {
  const chunks: ConversationSelectionState["chunks"] = [];
  let text = "";
  const messages = [...root.querySelectorAll<HTMLElement>("[data-vim-conversation-text]")];
  for (const message of messages) {
    const rowChunks: Array<{ node: Text; value: string }> = [];
    const walker = document.createTreeWalker(message, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        return parent?.closest("button, input, textarea, select, [aria-hidden=true], script, style")
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT;
      },
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = node.textContent ?? "";
      if (value.length > 0) rowChunks.push({ node: node as Text, value });
    }
    if (rowChunks.length === 0) continue;
    if (text.length > 0) text += "\n\n";
    for (const chunk of rowChunks) {
      const start = text.length;
      text += chunk.value;
      chunks.push({ node: chunk.node, start, end: text.length });
    }
  }
  return { chunks, text };
}

function pointAt(chunks: ConversationSelectionState["chunks"], offset: number) {
  const last = chunks.at(-1);
  if (!last) return null;
  const bounded = Math.max(0, Math.min(last.end, offset));
  const chunk = chunks.find((entry) => bounded < entry.end) ?? last;
  return {
    node: chunk.node,
    offset: Math.max(0, Math.min(chunk.node.length, bounded - chunk.start)),
  };
}

function caretRectAt(point: { node: Text; offset: number }): CaretRect | null {
  const range = document.createRange();
  const atEnd = point.offset >= point.node.length;
  range.setStart(point.node, atEnd ? Math.max(0, point.offset - 1) : point.offset);
  range.setEnd(point.node, atEnd ? point.offset : Math.min(point.node.length, point.offset + 1));
  const rect = range.getClientRects().item(0) ?? range.getBoundingClientRect();
  if (rect.height <= 0) return null;
  return { left: atEnd ? rect.right : rect.left, top: rect.top, height: rect.height };
}

function conversationVisualRange(state: ConversationSelectionState) {
  return {
    start: Math.min(state.anchor, state.focus),
    end: Math.min(state.text.length, Math.max(state.anchor, state.focus) + 1),
  };
}

function renderConversationSelection(
  state: ConversationSelectionState,
  visual: boolean,
): CaretRect | null {
  if (!state.root.isConnected) return null;
  const range = visual ? conversationVisualRange(state) : { start: state.focus, end: state.focus };
  const start = pointAt(state.chunks, range.start);
  const end = pointAt(state.chunks, range.end);
  if (!start || !end) return null;
  const domRange = document.createRange();
  domRange.setStart(start.node, start.offset);
  domRange.setEnd(end.node, end.offset);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(domRange);
  document.dispatchEvent(new Event("selectionchange"));
  return caretRectAt(pointAt(state.chunks, state.focus) ?? end);
}

function initialConversationCaret(state: ConversationSelectionState): number {
  const viewport = state.root.getBoundingClientRect();
  const middle = (viewport.top + viewport.bottom) / 2;
  const candidates = state.chunks
    .map((chunk) => ({ chunk, rect: chunk.node.parentElement?.getBoundingClientRect() }))
    .filter(
      (entry) => entry.rect && entry.rect.bottom > viewport.top && entry.rect.top < viewport.bottom,
    )
    .sort(
      (left, right) =>
        Math.abs((left.rect!.top + left.rect!.bottom) / 2 - middle) -
        Math.abs((right.rect!.top + right.rect!.bottom) / 2 - middle),
    );
  const chunk = candidates[0]?.chunk ?? state.chunks[0];
  if (!chunk) return 0;
  const firstContent = chunk.node.data.search(/\S/u);
  return chunk.start + Math.max(0, firstContent);
}

function collectTextHints(state: ConversationSelectionState): TextHint[] {
  const viewport = state.root.getBoundingClientRect();
  const targets: Array<{ offset: number; left: number; top: number }> = [];
  const occupied = new Set<string>();
  for (const chunk of state.chunks) {
    for (const match of chunk.node.data.matchAll(
      /(?<![\p{Letter}\p{Number}_])[\p{Letter}\p{Number}_]/gu,
    )) {
      const offset = chunk.start + match.index;
      const point = pointAt(state.chunks, offset);
      const rect = point ? caretRectAt(point) : null;
      if (!rect || rect.top < viewport.top || rect.top > viewport.bottom) continue;
      const cell = `${Math.round(rect.left / 48)}:${Math.round(rect.top / 18)}`;
      if (occupied.has(cell)) continue;
      occupied.add(cell);
      targets.push({ offset, left: rect.left, top: rect.top });
      if (targets.length >= 120) break;
    }
    if (targets.length >= 120) break;
  }
  const labels = buildVimHintLabels(targets.length);
  return targets.map((target, index) => ({
    kind: "text",
    ...target,
    label: labels[index]!,
  }));
}

function sidebarItems(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(SIDEBAR_ITEM_SELECTOR)].filter(
    (element) => rendered(element) && !element.matches(":disabled, [aria-disabled=true]"),
  );
}

function focusSidebar(): void {
  const focusTarget = () => {
    const items = sidebarItems();
    const target =
      items.find((item) => item.matches('[aria-current="page"], [data-active=true]')) ??
      items.find((item) => item.closest("[data-thread-item]")) ??
      items[0];
    target?.focus({ preventScroll: false });
  };
  const sidebar = document.querySelector<HTMLElement>("[data-app-sidebar]");
  if (!sidebar || !visible(sidebar)) {
    document.querySelector<HTMLElement>('[aria-label="Toggle main sidebar"]')?.click();
    requestAnimationFrame(() => requestAnimationFrame(focusTarget));
    return;
  }
  focusTarget();
}

function focusConversation(scrollNode: HTMLElement | null): void {
  if (!scrollNode) return;
  scrollNode.tabIndex = -1;
  scrollNode.focus({ preventScroll: true });
}

function focusComposerRegion(focusComposer: () => void): void {
  const editor = document.querySelector<HTMLElement>('[data-testid="composer-editor"]');
  if (editor && visible(editor)) editor.focus({ preventScroll: true });
  else focusComposer();
}

const RIGHT_PANEL_ITEM_SELECTOR = [
  "[data-vim-list-item]",
  "[role=tab]",
  "a[href]",
  "button:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function rightPanelRoot(): HTMLElement | null {
  const root = document.querySelector<HTMLElement>("[data-right-panel-surface-content]");
  return root && visible(root) ? root : null;
}

function fileTreeKeyboardTarget(root: HTMLElement): HTMLElement | null {
  const host = root.querySelector<HTMLElement>("[data-file-browser-panel] pierre-file-tree");
  const shadow = host?.shadowRoot;
  if (!shadow) return null;
  const active = shadow.activeElement;
  if (active instanceof HTMLElement) return active;
  return shadow.querySelector<HTMLElement>(
    "button[data-item-focused='true']:not([data-item-parked='true']), button[data-item-selected='true']:not([data-item-parked='true']), [role=tree]",
  );
}

function rightPanelItems(root: HTMLElement): HTMLElement[] {
  const items = [...root.querySelectorAll<HTMLElement>(RIGHT_PANEL_ITEM_SELECTOR)].filter(
    (element) => rendered(element) && !element.matches(":disabled, [aria-disabled=true]"),
  );
  const primary = items.filter((element) => element.hasAttribute("data-vim-list-item"));
  return primary.length > 0
    ? [...primary, ...items.filter((element) => !primary.includes(element))]
    : items;
}

function focusRightPanel(): void {
  const root = rightPanelRoot();
  if (!root) {
    const toggle = document.querySelector<HTMLButtonElement>('[aria-label^="Toggle right panel"]');
    if (!toggle || toggle.disabled) return;
    toggle.click();
    requestAnimationFrame(() => requestAnimationFrame(focusRightPanel));
    return;
  }
  const treeTarget = fileTreeKeyboardTarget(root);
  if (treeTarget) {
    treeTarget.focus({ preventScroll: true });
    return;
  }
  const items = rightPanelItems(root);
  const target =
    items.find((item) =>
      item.matches(
        "[aria-selected=true], [aria-current], [data-active=true], [data-vim-active=true]",
      ),
    ) ?? items[0];
  (target ?? root).focus({ preventScroll: true });
}

function moveRightPanelFocus(root: HTMLElement, direction: -1 | 1, repetitions: number): boolean {
  const items = rightPanelItems(root);
  if (items.length === 0) return false;
  const active = document.activeElement;
  const current = active instanceof HTMLElement ? items.indexOf(active) : -1;
  const next = nextVimListIndex(items.length, current, direction, repetitions);
  items[next]?.focus({ preventScroll: false });
  return true;
}

function dispatchFileTreeKey(root: HTMLElement, key: string, repetitions = 1): boolean {
  for (let count = 0; count < repetitions; count += 1) {
    const target = fileTreeKeyboardTarget(root);
    if (!target) return count > 0;
    target.focus({ preventScroll: true });
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, composed: true }));
  }
  return true;
}

function rightPanelScrollNode(root: HTMLElement): HTMLElement {
  return (
    [...root.querySelectorAll<HTMLElement>("[data-slot='scroll-area-viewport']")].find(
      (element) => element.scrollHeight > element.clientHeight,
    ) ?? root
  );
}

function activateAdjacentRightPanelTab(direction: -1 | 1): void {
  const tabs = [
    ...document.querySelectorAll<HTMLButtonElement>("[data-right-panel-tab-activate]"),
  ].filter(rendered);
  const active = tabs.findIndex(
    (tab) => tab.closest<HTMLElement>("[data-active-tab]")?.dataset.activeTab === "true",
  );
  if (tabs.length === 0) return;
  tabs[Math.max(0, Math.min(tabs.length - 1, (active < 0 ? 0 : active) + direction))]?.click();
}

function vimFocusRegions(scrollNode: HTMLElement | null): VimFocusRegion[] {
  const regions: VimFocusRegion[] = [];
  if (!appModal()) {
    const sidebar = document.querySelector<HTMLElement>("[data-app-sidebar]");
    const composer = document.querySelector<HTMLElement>('[data-testid="composer-editor"]');
    const composerRect = composer && visible(composer) ? composer.getBoundingClientRect() : null;

    if (sidebar && visible(sidebar))
      regions.push({ id: "sidebar", rect: sidebar.getBoundingClientRect() });
    if (scrollNode && visible(scrollNode)) {
      const rect = scrollNode.getBoundingClientRect();
      const bottom = composerRect ? Math.min(rect.bottom, composerRect.top) : rect.bottom;
      regions.push({
        id: "conversation",
        rect:
          bottom > rect.top ? { left: rect.left, right: rect.right, top: rect.top, bottom } : rect,
      });
    }
    if (composerRect) regions.push({ id: "composer", rect: composerRect });
    const rightPanel = rightPanelRoot();
    if (rightPanel) regions.push({ id: "right-panel", rect: rightPanel.getBoundingClientRect() });
  }
  for (const area of liveAreas())
    regions.push({ id: `area:${area.dataset.workspaceArea}`, rect: area.getBoundingClientRect() });
  return regions;
}

const REGION_ORDER: Record<string, number> = {
  sidebar: 0,
  conversation: 1,
  composer: 2,
  "right-panel": 4,
};

function regionOrder(id: VimFocusRegionId): number {
  if (id in REGION_ORDER) return REGION_ORDER[id]!;
  const area = areaForRegion(id);
  return Number(area?.dataset.workspaceOrder ?? 3);
}

function areaForRegion(id: VimFocusRegionId): HTMLElement | null {
  if (!id.startsWith("area:")) return null;
  const name = id.slice("area:".length);
  return liveAreas().find((area) => area.dataset.workspaceArea === name) ?? null;
}

function activeVimFocusRegion(
  active: Element | null,
  scrollNode: HTMLElement | null,
): VimFocusRegionId {
  if (active instanceof HTMLElement && !appModal()) {
    if (active.closest("[data-app-sidebar]")) return "sidebar";
    if (active.closest(COMPOSER_SELECTOR)) return "composer";
    if (active.closest("[data-right-panel-surface-content]")) return "right-panel";
    if (scrollNode?.contains(active)) return "conversation";
  }
  const area = genericAreaOf(active) ?? (scrollNode && !appModal() ? null : primaryArea());
  return area ? `area:${area.dataset.workspaceArea}` : "conversation";
}

function focusSidebarSearch(): void {
  const focusSearch = () =>
    document.querySelector<HTMLElement>('[aria-label="Search threads"]')?.focus();
  const sidebar = document.querySelector<HTMLElement>("[data-app-sidebar]");
  if (!sidebar || !visible(sidebar)) {
    document.querySelector<HTMLElement>('[aria-label="Toggle main sidebar"]')?.click();
    requestAnimationFrame(() => requestAnimationFrame(focusSearch));
    return;
  }
  focusSearch();
}

function moveSidebarFocus(direction: -1 | 1, repetitions: number): HTMLElement | undefined {
  const items = sidebarItems();
  if (items.length === 0) return;
  const active = document.activeElement;
  const current = active instanceof HTMLElement ? items.indexOf(active) : -1;
  const next = nextVimListIndex(items.length, current, direction, repetitions);
  const target = items[next];
  target?.focus({ preventScroll: false });
  return target;
}

export function activateSidebarThreadLifecycleAction(active: HTMLElement, key: "s" | "u"): boolean {
  const actionLabel = key === "s" ? "Settle thread" : "Un-settle thread";
  const action = active
    .closest("[data-thread-item]")
    ?.querySelector<HTMLButtonElement>(`button[aria-label="${actionLabel}"]`);
  if (!action) return false;
  action.click();
  return true;
}

/**
 * Workspace-wide Vim keys. The shown conversation registers through `registerVimConversation`;
 * every other page and panel is driven through its workspace areas.
 */
export function TimelineVimMode({ previewThreads = false }: { previewThreads?: boolean }) {
  const [view, setView] = useState({
    mode: "NORMAL" as TimelineVimModeName,
    count: "",
    pending: "",
    hintInput: "",
    hints: [] as Hint[],
    helpOpen: false,
    caretRect: null as CaretRect | null,
  });
  const stateRef = useRef({
    mode: "NORMAL" as TimelineVimModeName,
    count: "",
    pending: "",
    hintInput: "",
    hints: [] as Hint[],
    hintFocusOnly: false,
    helpOpen: false,
    selection: null as ConversationSelectionState | null,
    caretRect: null as CaretRect | null,
    marks: new Map<string, Mark>(),
    previousJump: null as Mark | null,
  });
  const update = () => {
    const state = stateRef.current;
    setView({
      mode: state.mode,
      count: state.count,
      pending: state.pending,
      hintInput: state.hintInput,
      hints: state.hints,
      helpOpen: state.helpOpen,
      caretRect: state.caretRect,
    });
  };
  const clear = () => {
    const state = stateRef.current;
    state.count = "";
    state.pending = "";
    state.hintInput = "";
    state.hints = [];
    state.helpOpen = false;
    state.selection = null;
    state.caretRect = null;
    if (state.mode !== "PASS") state.mode = "NORMAL";
    update();
  };

  // A different thread, or none, starts from Normal mode like a fresh view.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- follows the externally registered conversation
  useEffect(() => subscribeVimConversation(clear), [clear]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- window key listeners that drive Vim mode across the workspace
  useEffect(() => {
    const vimScroller = timelineVimScroller;
    // An empty thread has no message list yet; its area still stands in for the conversation.
    const getScrollNode = () => {
      const conversation = vimConversation();
      if (!conversation) return null;
      return (
        conversation.getScrollNode() ??
        document.querySelector<HTMLElement>('[data-workspace-area="conversation"]')
      );
    };
    const focusComposer = () => vimConversation()?.focusComposer();
    const onUserNavigation = () => vimConversation()?.onUserNavigation();
    const onScrollToEnd = () => vimConversation()?.onScrollToEnd();
    const markKey = (letter: string) =>
      `${vimConversation()?.routeKey ?? window.location.pathname}:${letter}`;
    let previewTimer: ReturnType<typeof setTimeout> | undefined;
    const currentMark = (): Mark | null => {
      const scrollNode = getScrollNode();
      if (!scrollNode) return null;
      const viewport = scrollNode.getBoundingClientRect();
      const rows = [...scrollNode.querySelectorAll<HTMLElement>("[data-timeline-row-id]")];
      const row = rows.find((candidate) => candidate.getBoundingClientRect().bottom > viewport.top);
      return {
        rowId: row?.dataset.timelineRowId ?? null,
        rowOffset: row ? viewport.top - row.getBoundingClientRect().top : 0,
        scrollTop: scrollNode.scrollTop,
      };
    };
    const jumpToMark = (mark: Mark) => {
      const scrollNode = getScrollNode();
      if (!scrollNode) return;
      stateRef.current.previousJump = currentMark();
      const row = [...scrollNode.querySelectorAll<HTMLElement>("[data-timeline-row-id]")].find(
        (candidate) => candidate.dataset.timelineRowId === mark.rowId,
      );
      onUserNavigation();
      scrollNode.scrollTop = row
        ? scrollNode.scrollTop +
          row.getBoundingClientRect().top -
          scrollNode.getBoundingClientRect().top +
          mark.rowOffset
        : mark.scrollTop;
    };
    const moveMessage = (direction: -1 | 1, repetitions: number) => {
      const scrollNode = getScrollNode();
      if (!scrollNode) return;
      onUserNavigation();
      for (let index = 0; index < repetitions; index += 1) {
        const viewport = scrollNode.getBoundingClientRect();
        const rows = [...scrollNode.querySelectorAll<HTMLElement>("[data-timeline-row-id]")].filter(
          (row) => row.dataset.messageId,
        );
        const target =
          direction > 0
            ? rows.find((row) => row.getBoundingClientRect().top > viewport.top + 12)
            : rows.toReversed().find((row) => row.getBoundingClientRect().top < viewport.top - 12);
        if (target) target.scrollIntoView({ block: "start", behavior: vimScrollBehavior() });
        else {
          vimScroller.press(scrollNode, direction * scrollNode.clientHeight * 0.8, {
            code: "message-jump",
            continuous: false,
            repeat: false,
          });
        }
      }
    };
    const beginCaret = () => {
      const root = getScrollNode();
      if (!root) return;
      const collected = collectConversationText(root);
      if (!collected.text) return;
      const selection: ConversationSelectionState = {
        root,
        ...collected,
        anchor: 0,
        focus: 0,
      };
      selection.focus = initialConversationCaret(selection);
      selection.anchor = selection.focus;
      stateRef.current.selection = selection;
      stateRef.current.mode = "CARET";
      stateRef.current.caretRect = renderConversationSelection(selection, false);
      update();
    };
    const beginVisual = (linewise: boolean) => {
      const selection = stateRef.current.selection;
      if (!selection) return;
      if (linewise) {
        const range = currentLineRange(selection.text, selection.focus);
        selection.anchor = range.start;
        selection.focus = Math.max(range.start, range.end - 1);
      } else {
        selection.anchor = selection.focus;
      }
      stateRef.current.mode = "VISUAL";
      stateRef.current.caretRect = renderConversationSelection(selection, true);
      update();
    };
    const finishHints = (hint: Hint) => {
      if (hint.kind === "text") {
        const selection = stateRef.current.selection;
        if (!selection) {
          clear();
          return;
        }
        selection.anchor = hint.offset;
        selection.focus = hint.offset;
        stateRef.current.mode = "CARET";
        stateRef.current.count = "";
        stateRef.current.pending = "";
        stateRef.current.hintInput = "";
        stateRef.current.hints = [];
        stateRef.current.caretRect = renderConversationSelection(selection, false);
        update();
        return;
      }
      if (stateRef.current.hintFocusOnly || hint.element.matches(EDITABLE_SELECTOR)) {
        hint.element.focus({ preventScroll: false });
      } else {
        hint.element.click();
      }
      stateRef.current.mode = "NORMAL";
      clear();
    };
    const openHints = (focusOnly: boolean, scope?: ParentNode) => {
      const hints = collectHints(scope ?? appModal() ?? document);
      if (hints.length === 0) return;
      stateRef.current.mode = "HINT";
      stateRef.current.hints = hints;
      stateRef.current.hintInput = "";
      stateRef.current.hintFocusOnly = focusOnly;
      update();
    };
    const openTextHints = () => {
      const selection = stateRef.current.selection;
      if (!selection) return;
      const hints = collectTextHints(selection);
      if (hints.length === 0) return;
      stateRef.current.mode = "TEXT HINT";
      stateRef.current.hints = hints;
      stateRef.current.hintInput = "";
      update();
    };
    const focusRegion = (region: VimFocusRegionId) => {
      const area = areaForRegion(region);
      if (area) focusArea(area);
      else if (region === "sidebar") focusSidebar();
      else if (region === "composer") focusComposerRegion(focusComposer);
      else if (region === "right-panel") focusRightPanel();
      else focusConversation(getScrollNode());
    };
    const moveWindowFocus = (direction: VimFocusDirection, active: Element | null) => {
      const scrollNode = getScrollNode();
      const current = activeVimFocusRegion(active, scrollNode);
      if (direction === "h" && current !== "sidebar" && !appModal()) {
        const sidebar = document.querySelector<HTMLElement>("[data-app-sidebar]");
        if (!sidebar || !visible(sidebar)) {
          focusSidebar();
          return;
        }
      }
      if (
        direction === "l" &&
        (current === "conversation" || current === "composer") &&
        !rightPanelRoot() &&
        document.querySelector('[aria-label^="Toggle right panel"]:not(:disabled)')
      ) {
        focusRightPanel();
        return;
      }
      const regions = vimFocusRegions(scrollNode);
      const currentRect = regions.find((region) => region.id === current)?.rect;
      const activeRect =
        active instanceof HTMLElement &&
        current !== "conversation" &&
        active !== document.body &&
        rendered(active)
          ? active.getBoundingClientRect()
          : currentRect;
      const next = nextDirectionalVimRegion(regions, current, direction, activeRect);
      if (next) focusRegion(next);
    };
    const cycleWindowFocus = (active: Element | null) => {
      const scrollNode = getScrollNode();
      const order = vimFocusRegions(scrollNode)
        .map((region) => region.id)
        .sort((left, right) => regionOrder(left) - regionOrder(right));
      if (order.length === 0) return;
      const current = activeVimFocusRegion(active, scrollNode);
      focusRegion(order[(order.indexOf(current) + 1) % order.length]!);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      clearTimeout(previewTimer);
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      const state = stateRef.current;
      const consume = () => {
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      if (state.mode === "PASS") {
        if (event.key === "Escape") {
          event.preventDefault();
          state.mode = "NORMAL";
          clear();
        }
        return;
      }
      const active = document.activeElement;
      const activeRightPanel =
        active instanceof HTMLElement && !appModal()
          ? active.closest<HTMLElement>("[data-right-panel-surface-content]")
          : null;
      const floating = floatingLayer();
      if (floating && state.mode !== "HINT") {
        // Dialogs keep their native keys, but f still labels their controls. Menus and lists
        // are left alone: a typed letter jumps to a matching item there.
        if (
          (event.key === "f" || event.key === "F") &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          floating.matches('[role="dialog"], [role="alertdialog"]') &&
          !active?.closest(`${EDITABLE_SELECTOR}, [role="menu"], [role="listbox"]`)
        ) {
          consume();
          openHints(event.key === "F", floating);
        }
        return;
      }
      const sidebarSearch =
        active instanceof HTMLElement && active.matches('[aria-label="Search threads"]')
          ? active
          : null;
      if (event.ctrlKey && event.key.toLowerCase() === "w") {
        consume();
        state.pending = "CTRL-W";
        update();
        return;
      }
      if (state.pending === "CTRL-W") {
        consume();
        state.pending = "";
        if (["h", "j", "k", "l"].includes(event.key))
          moveWindowFocus(event.key as VimFocusDirection, active);
        else if (event.key === "w") cycleWindowFocus(active);
        update();
        return;
      }
      if (isTerminalFocused() || isPreviewFocused() || active?.closest(TERMINAL_SELECTOR)) return;
      if (
        event.key === "Escape" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        active instanceof HTMLElement &&
        active.closest(`${EDITABLE_SELECTOR}, [role="searchbox"]`) &&
        !active.closest(COMPOSER_SELECTOR)
      ) {
        // Any field hands the keyboard back to its region, so a stray focus never traps Vim keys.
        const region = active.closest<HTMLElement>(
          `[data-app-sidebar], [data-right-panel-surface-content], ${AREA_SELECTOR}`,
        );
        active.blur();
        focusConversation(region ?? getScrollNode());
        clear();
        // Keep propagating so the field can still clear its query or cancel an edit.
        return;
      }
      if (sidebarSearch && redirectDropdownNavigationKey(event, sidebarSearch)) return;
      if (active?.closest(EDITABLE_SELECTOR)) return;
      if (
        event.metaKey ||
        event.altKey ||
        (event.ctrlKey && event.key !== "d" && event.key !== "u")
      ) {
        return;
      }
      if (event.key === "Escape") {
        const selected = !(window.getSelection()?.isCollapsed ?? true);
        // With nothing to cancel, Escape belongs to whatever else listens: find, panels, Settings.
        if (
          state.mode === "NORMAL" &&
          !state.count &&
          !state.pending &&
          !state.helpOpen &&
          !selected
        )
          return;
        consume();
        if ((state.mode === "VISUAL" || state.mode === "TEXT HINT") && state.selection) {
          state.selection.anchor = state.selection.focus;
          state.mode = "CARET";
          state.count = "";
          state.pending = "";
          state.hintInput = "";
          state.hints = [];
          state.caretRect = renderConversationSelection(state.selection, false);
          update();
          return;
        }
        window.getSelection()?.removeAllRanges();
        state.mode = "NORMAL";
        clear();
        return;
      }
      if (state.helpOpen) {
        consume();
        state.helpOpen = false;
        update();
        return;
      }
      if (state.mode === "HINT" || state.mode === "TEXT HINT") {
        consume();
        if (event.key === "Backspace") state.hintInput = state.hintInput.slice(0, -1);
        else if (event.key.length === 1) state.hintInput += event.key.toLowerCase();
        const matches = state.hints.filter((hint) => hint.label.startsWith(state.hintInput));
        if (matches.length === 1 && matches[0]!.label === state.hintInput) finishHints(matches[0]!);
        else if (matches.length === 0 && state.mode === "TEXT HINT" && state.selection) {
          state.mode = "CARET";
          state.hintInput = "";
          state.hints = [];
          state.caretRect = renderConversationSelection(state.selection, false);
          update();
        } else if (matches.length === 0) clear();
        else update();
        return;
      }
      const repetitions = Math.max(1, Number.parseInt(state.count || "1", 10));
      if ((state.mode === "CARET" || state.mode === "VISUAL") && state.selection) {
        const selection = state.selection;
        if (state.mode === "CARET" && (event.key === "v" || event.key === "V")) {
          consume();
          beginVisual(event.key === "V");
          return;
        }
        if (state.mode === "CARET" && (event.key === "f" || event.key === "F")) {
          consume();
          openTextHints();
          return;
        }
        if (event.key === "y" || event.key === "Enter") {
          if (state.mode !== "VISUAL") return;
          consume();
          const range = conversationVisualRange(selection);
          void navigator.clipboard
            ?.writeText(selection.text.slice(range.start, range.end))
            .catch(() => undefined);
          window.getSelection()?.removeAllRanges();
          state.mode = "NORMAL";
          clear();
          return;
        }
        if (event.key === "c") {
          if (state.mode !== "VISUAL") return;
          consume();
          document.dispatchEvent(new Event("selectionchange"));
          requestAnimationFrame(() => {
            document
              .querySelector<HTMLButtonElement>('[aria-label="Cite selection in composer"]')
              ?.click();
          });
          state.mode = "NORMAL";
          clear();
          return;
        }
        if (event.key === "o") {
          if (state.mode !== "VISUAL") return;
          consume();
          [selection.anchor, selection.focus] = [selection.focus, selection.anchor];
          state.caretRect = renderConversationSelection(selection, true);
          update();
          return;
        }
        const motion =
          event.key === "G"
            ? "G"
            : event.key === "$" ||
                event.key === "0" ||
                event.key === "^" ||
                ["h", "j", "k", "l", "w", "b", "e", "{", "}"].includes(event.key)
              ? (event.key as VimMotion)
              : null;
        if (motion) {
          consume();
          selection.focus = moveTextCursor(selection.text, selection.focus, motion, repetitions);
          state.count = "";
          if (state.mode === "CARET") selection.anchor = selection.focus;
          state.caretRect = renderConversationSelection(selection, state.mode === "VISUAL");
          update();
          return;
        }
      }
      const scrollNode = getScrollNode();
      const sidebarActive =
        active instanceof HTMLElement && !appModal() && active.closest("[data-app-sidebar]");
      // Focus on the page itself goes to the conversation when one is shown, else the main area.
      const activeArea =
        sidebarActive || activeRightPanel
          ? null
          : (genericAreaOf(active) ??
            ((!vimConversation() || appModal()) && !active?.closest(COMPOSER_SELECTOR)
              ? primaryArea()
              : null));
      if (/^[1-9]$/u.test(event.key) || (event.key === "0" && state.count)) {
        consume();
        state.count += event.key;
        update();
        return;
      }
      if (state.pending === "g") {
        consume();
        state.pending = "";
        state.count = "";
        if (event.key === "g") {
          if ((state.mode === "CARET" || state.mode === "VISUAL") && state.selection) {
            state.selection.focus = 0;
            if (state.mode === "CARET") state.selection.anchor = 0;
            state.caretRect = renderConversationSelection(state.selection, state.mode === "VISUAL");
          } else if (activeRightPanel) {
            if (!dispatchFileTreeKey(activeRightPanel, "Home")) {
              rightPanelScrollNode(activeRightPanel).scrollTop = 0;
            }
          } else if (activeArea) {
            const first = listItems(activeArea)[0];
            if (first) first.focus({ preventScroll: false });
            else areaScrollNode(activeArea).scrollTop = 0;
          } else {
            const scrollNode = getScrollNode();
            if (scrollNode) {
              state.previousJump = currentMark();
              onUserNavigation();
              scrollNode.scrollTop = 0;
            }
          }
        } else if (event.key === "i") {
          focusComposer();
        }
        update();
        return;
      }
      if (state.pending === "SPACE") {
        consume();
        state.pending = "";
        if (event.key === "f") openCommandPalette({ mode: "files" });
        else if (event.key === "/") openCommandPalette({ mode: "content" });
        else if (event.key === "b") openCommandPalette({ mode: "command" });
        else if (event.key === "s") focusSidebar();
        update();
        return;
      }
      if (state.pending === "m" || state.pending === "`") {
        consume();
        const pending = state.pending;
        state.pending = "";
        if (event.key === "`" && pending === "`" && state.previousJump)
          jumpToMark(state.previousJump);
        else if (/^[a-z]$/iu.test(event.key)) {
          if (pending === "m") {
            const mark = currentMark();
            if (mark) state.marks.set(markKey(event.key.toLowerCase()), mark);
          } else {
            const mark = state.marks.get(markKey(event.key.toLowerCase()));
            if (mark) jumpToMark(mark);
          }
        }
        update();
        return;
      }
      if (sidebarActive) {
        if (event.key === "j" || event.key === "k") {
          consume();
          const target = moveSidebarFocus(event.key === "j" ? 1 : -1, repetitions);
          if (previewThreads && target?.closest("[data-thread-item]")) {
            // Let held keys pass over rows without loading every conversation.
            previewTimer = setTimeout(() => {
              if (
                target.isConnected &&
                document.activeElement === target &&
                !target.matches('[aria-current="page"], [data-active=true]')
              )
                target.click();
            }, 100);
          }
        } else if (event.key === "/") {
          consume();
          focusSidebarSearch();
        } else if (
          event.key === "Enter" ||
          event.key === "o" ||
          event.key === "l" ||
          event.key === "i"
        ) {
          consume();
          if (
            event.key !== "l" ||
            !(active instanceof HTMLElement) ||
            active.ariaExpanded !== "true"
          ) {
            if (active instanceof HTMLElement) active.click();
            if (event.key === "i") focusComposer();
          }
        } else if (event.key === "h") {
          consume();
          if (active instanceof HTMLElement && active.ariaExpanded === "true") active.click();
        } else if (event.key === "s" || event.key === "u") {
          consume();
          if (active instanceof HTMLElement) {
            activateSidebarThreadLifecycleAction(active, event.key);
          }
        } else {
          return;
        }
        state.count = "";
        update();
        return;
      }
      if (activeArea) {
        const items = listItems(activeArea);
        if (event.key === "j" || event.key === "k") {
          consume();
          const direction = event.key === "j" ? 1 : -1;
          const current = active instanceof HTMLElement ? items.indexOf(active) : -1;
          if (items.length > 0)
            items[nextVimListIndex(items.length, current, direction, repetitions)]?.focus({
              preventScroll: false,
            });
          else
            vimScroller.press(areaScrollNode(activeArea), direction * 64 * repetitions, {
              code: event.code,
              continuous: repetitions === 1,
              repeat: event.repeat,
            });
        } else if (event.ctrlKey && (event.key === "d" || event.key === "u")) {
          consume();
          const node = areaScrollNode(activeArea);
          node.scrollBy({
            top: (event.key === "d" ? 1 : -1) * node.clientHeight * 0.5,
            behavior: vimScrollBehavior(),
          });
        } else if (event.key === "G") {
          consume();
          const last = items.at(-1);
          if (last) last.focus({ preventScroll: false });
          else {
            const node = areaScrollNode(activeArea);
            node.scrollTop = node.scrollHeight;
          }
        } else if (event.key === "g") {
          consume();
          state.pending = "g";
        } else if (event.key === "Enter" || event.key === "o") {
          if (
            !(active instanceof HTMLElement) ||
            !activeArea.contains(active) ||
            active === activeArea
          )
            return;
          consume();
          active.click();
        } else if (event.key === "/") {
          const search = activeArea.querySelector<HTMLElement>(
            'input[type="search"]:not([disabled]), [role="searchbox"]:not([aria-disabled=true])',
          );
          // Pages such as Settings bind / to their own search.
          if (!search || !visible(search)) return;
          consume();
          search.focus({ preventScroll: true });
        } else if (event.key === "i" || event.key === "a") {
          const field = [...activeArea.querySelectorAll<HTMLElement>("[data-vim-insert]")].find(
            visible,
          );
          if (!field) return;
          consume();
          field.focus({ preventScroll: false });
        } else if (!["f", "F", ":", " ", "?", "z"].includes(event.key)) {
          // Anything else belongs to the page, such as Usage's own shortcuts.
          return;
        }
        if (!["f", "F", ":", " ", "?", "z"].includes(event.key)) {
          state.count = "";
          update();
          return;
        }
      }
      if (activeRightPanel) {
        const fileTreeKeys: Record<string, string> = {
          h: "ArrowLeft",
          j: "ArrowDown",
          k: "ArrowUp",
          l: "ArrowRight",
        };
        const fileTreeKey = fileTreeKeys[event.key];
        if (fileTreeKey && dispatchFileTreeKey(activeRightPanel, fileTreeKey, repetitions)) {
          consume();
        } else if (event.key === "j" || event.key === "k") {
          consume();
          const direction = event.key === "j" ? 1 : -1;
          if (!moveRightPanelFocus(activeRightPanel, direction, repetitions)) {
            vimScroller.press(
              rightPanelScrollNode(activeRightPanel),
              direction * 64 * repetitions,
              {
                code: event.code,
                continuous: repetitions === 1,
                repeat: event.repeat,
              },
            );
          }
        } else if (event.key === "H" || event.key === "L") {
          consume();
          activateAdjacentRightPanelTab(event.key === "H" ? -1 : 1);
        } else if (event.key === "/") {
          const search = activeRightPanel.querySelector<HTMLElement>(
            'input[type="search"]:not([disabled]), [role="searchbox"]:not([aria-disabled=true])',
          );
          if (!search) return;
          consume();
          search.focus({ preventScroll: true });
        } else if (event.key === "Enter" || event.key === "o") {
          if (!(active instanceof HTMLElement) || active === activeRightPanel) return;
          consume();
          active.click();
        } else if (event.key === "G") {
          consume();
          if (!dispatchFileTreeKey(activeRightPanel, "End")) {
            const panelScrollNode = rightPanelScrollNode(activeRightPanel);
            panelScrollNode.scrollTop = panelScrollNode.scrollHeight;
          }
        } else if (event.ctrlKey && (event.key === "d" || event.key === "u")) {
          consume();
          const panelScrollNode = rightPanelScrollNode(activeRightPanel);
          panelScrollNode.scrollBy({
            top: (event.key === "d" ? 1 : -1) * panelScrollNode.clientHeight * 0.5,
            behavior: vimScrollBehavior(),
          });
        } else if (event.key === "f" || event.key === "F") {
          consume();
          openHints(event.key === "F", activeRightPanel);
          return;
        } else if (event.key === "g") {
          consume();
          state.pending = "g";
        } else {
          return;
        }
        state.count = "";
        update();
        return;
      }
      if (
        event.key === "j" ||
        event.key === "k" ||
        (event.ctrlKey && (event.key === "d" || event.key === "u"))
      ) {
        consume();
        if (!scrollNode) return;
        const hadCount = state.count.length > 0;
        const direction = event.key === "j" || event.key === "d" ? 1 : -1;
        const distance = event.ctrlKey ? scrollNode.clientHeight / 2 : 64;
        const started = vimScroller.press(scrollNode, direction * distance * repetitions, {
          code: event.code,
          continuous: repetitions === 1,
          repeat: event.repeat,
        });
        if (started) onUserNavigation();
        state.count = "";
        if (hadCount) update();
        return;
      }
      if (event.key === "{") {
        consume();
        moveMessage(-1, repetitions);
      } else if (event.key === "}") {
        consume();
        moveMessage(1, repetitions);
      } else if (event.key === "G") {
        consume();
        state.previousJump = currentMark();
        onScrollToEnd();
      } else if (event.key === "g" || event.key === "m" || event.key === "`") {
        consume();
        state.pending = event.key;
      } else if (event.key === "f" || event.key === "F") {
        consume();
        openHints(event.key === "F");
        return;
      } else if (event.key === "v" || event.key === "V") {
        consume();
        beginCaret();
        if (event.key === "V") beginVisual(true);
        return;
      } else if (event.key === "i") {
        consume();
        focusComposer();
        queueMicrotask(() => {
          document
            .querySelector<HTMLElement>('[data-testid="composer-editor"]')
            ?.dispatchEvent(new Event("t3-vim-insert"));
        });
      } else if (event.key === "?") {
        consume();
        state.helpOpen = true;
      } else if (event.key === "z") {
        consume();
        state.mode = "PASS";
      } else if (event.key === ":") {
        consume();
        openCommandPalette({ mode: "command" });
      } else if (event.key === "/") {
        consume();
        const search = document.querySelector<HTMLElement>('[aria-label="Search threads"]');
        if (search) focusSidebarSearch();
        else openCommandPalette({ mode: "content" });
      } else if (event.key === " ") {
        consume();
        state.pending = "SPACE";
      } else if (event.key.length === 1 && scrollNode) {
        // Printable keys never type into the page behind the conversation.
        consume();
      } else {
        return;
      }
      state.count = "";
      update();
    };
    const handleKeyUp = (event: KeyboardEvent) => vimScroller.release(event.code);
    const handleBlur = () => vimScroller.cancel();
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("blur", handleBlur);
    return () => {
      clearTimeout(previewTimer);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("blur", handleBlur);
    };
  }, [clear, previewThreads, update]);

  const matchingHints = view.hints.filter((hint) => hint.label.startsWith(view.hintInput));
  // The composer shows its own mode; this says what the rest of the workspace will do with a key.
  const status =
    view.mode === "PASS"
      ? "PASS · Esc to resume"
      : view.mode === "HINT" || view.mode === "TEXT HINT"
        ? `HINT ${view.hintInput}`
        : view.pending || view.count
          ? `${view.count}${view.pending === "CTRL-W" ? "Ctrl-w" : view.pending === "SPACE" ? "Space" : view.pending}`
          : null;
  return (
    <div className="contents" data-timeline-vim-mode="" data-vim-hint-ignore="true">
      {status ? (
        <span
          role="status"
          className="pointer-events-none fixed right-3 bottom-3 z-100 rounded-md bg-popover px-2 py-1 font-mono text-xs text-popover-foreground shadow ring-1 ring-border"
        >
          {status}
        </span>
      ) : null}
      {view.caretRect && (view.mode === "CARET" || view.mode === "VISUAL") ? (
        <span
          aria-hidden="true"
          className="pointer-events-none fixed z-80 w-0.5 bg-primary ring-1 ring-background"
          style={view.caretRect}
        />
      ) : null}
      {view.mode === "HINT" || view.mode === "TEXT HINT"
        ? matchingHints.map((hint) => (
            <span
              key={hint.label}
              className="pointer-events-none fixed z-100 rounded-sm bg-warning px-1 py-0.5 font-mono text-2xs font-bold text-warning-foreground shadow ring-1 ring-border"
              style={{ left: hint.left, top: hint.top }}
            >
              {hint.label.slice(0, view.hintInput.length) ? (
                <span className="text-destructive">
                  {hint.label.slice(0, view.hintInput.length)}
                </span>
              ) : null}
              {hint.label.slice(view.hintInput.length)}
            </span>
          ))
        : null}
      {view.helpOpen ? (
        <div className="fixed inset-0 z-90 flex items-center justify-center bg-black/35 p-4">
          <div className="max-w-xl rounded-xl bg-popover p-5 text-sm text-popover-foreground shadow-xl ring-1 ring-border">
            <h2 className="mb-3 text-base font-semibold">T3 Vim keyboard mode</h2>
            <div className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1 font-mono">
              <kbd>j / k</kbd>
              <span>scroll down / up</span>
              <kbd>Ctrl-d / Ctrl-u</kbd>
              <span>half page down / up</span>
              <kbd>gg / G</kbd>
              <span>conversation start / end</span>
              <kbd>{"{ / }"}</kbd>
              <span>previous / next message</span>
              <kbd>m… / `… / ``</kbd>
              <span>set mark / jump / jump back</span>
              <kbd>f / F</kbd>
              <span>activate / focus a visible control</span>
              <kbd>Ctrl-w h / j / k / l</kbd>
              <span>focus left / down / up / right</span>
              <kbd>Ctrl-w w</kbd>
              <span>cycle threads / conversation / composer / right panel</span>
              <kbd>Sidebar j / k</kbd>
              <span>previous / next project or thread</span>
              <kbd>Sidebar / · Enter / i</kbd>
              <span>filter threads · open selection</span>
              <kbd>Sidebar s / u</kbd>
              <span>settle / un-settle focused thread</span>
              <kbd>Right panel j / k · Enter</kbd>
              <span>previous / next control · open selection</span>
              <kbd>File tree h / l · gg / G</kbd>
              <span>collapse / expand · first / last file</span>
              <kbd>Right panel H / L · /</kbd>
              <span>previous / next tab · focus search</span>
              <kbd>Right panel f / F</kbd>
              <span>activate / focus a visible panel control</span>
              <kbd>Other pages j / k · Enter · /</kbd>
              <span>next / previous row or scroll · open · search</span>
              <kbd>Other pages i</kbd>
              <span>focus the area's message field</span>
              <kbd>Esc in a field</kbd>
              <span>leave it and return to its region</span>
              <kbd>i / gi</kbd>
              <span>composer Insert / Normal mode</span>
              <kbd>v · motions · v / V</kbd>
              <span>place caret · start character / line selection</span>
              <kbd>Caret f</kbd>
              <span>jump to visible conversation text</span>
              <kbd>y / c</kbd>
              <span>copy / cite selected messages</span>
              <kbd>z</kbd>
              <span>pass keys through until Escape</span>
              <kbd>: · Space f / /</kbd>
              <span>commands · files / conversation search</span>
            </div>
            <p className="mt-4 text-muted-foreground">Press any key to close this help.</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
