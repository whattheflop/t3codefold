import type { Layout, WorkspacePaneLayout } from "./layout";

export const FOLDABLE_PANE_COMPACT_WIDTH = 72;
/** How far past either end of its range the divider must travel to maximize or close the pane. */
export const PANE_DIVIDER_OVERSHOOT = 56;
/** Release within this distance of a snap width (e.g. the hinge) lands on it. */
export const PANE_DIVIDER_SNAP_DISTANCE = 32;

/** Allows either side of an unfolded workspace to collapse to a usable sliver. */
export function constrainFoldablePaneWidth(input: {
  readonly preferredWidth: number;
  readonly availableWidth: number;
}): number {
  const availableWidth = Number.isFinite(input.availableWidth)
    ? Math.max(0, input.availableWidth)
    : 0;
  const preferredWidth = Number.isFinite(input.preferredWidth)
    ? input.preferredWidth
    : FOLDABLE_PANE_COMPACT_WIDTH;
  const maximumWidth = Math.max(
    FOLDABLE_PANE_COMPACT_WIDTH,
    availableWidth - FOLDABLE_PANE_COMPACT_WIDTH,
  );
  return Math.min(maximumWidth, Math.max(FOLDABLE_PANE_COMPACT_WIDTH, Math.round(preferredWidth)));
}

export type PaneDividerRelease =
  | { readonly kind: "resize"; readonly width: number }
  | { readonly kind: "maximize" }
  | { readonly kind: "close" };

/**
 * Resolves where a trailing pane lands when its divider is released. Dragging
 * past the far end of the range maximizes the pane, past the near end closes
 * it, and anything between rests at a width, snapping to nearby `snapWidths`.
 */
export function resolvePaneDividerRelease(input: {
  /** The pane's rendered width when the drag began. */
  readonly startWidth: number;
  /** Horizontal finger travel; negative (leftward) grows a trailing pane. */
  readonly translationX: number;
  readonly range: { readonly min: number; readonly max: number };
  readonly snapWidths?: ReadonlyArray<number>;
}): PaneDividerRelease {
  const target = input.startWidth - input.translationX;
  if (target > input.range.max + PANE_DIVIDER_OVERSHOOT) return { kind: "maximize" };
  if (target < input.range.min - PANE_DIVIDER_OVERSHOOT) return { kind: "close" };
  const width = Math.round(Math.min(input.range.max, Math.max(input.range.min, target)));
  const snap = input.snapWidths
    ?.filter((snapWidth) => snapWidth >= input.range.min && snapWidth <= input.range.max)
    .reduce<number | null>(
      (nearest, snapWidth) =>
        Math.abs(snapWidth - width) <= PANE_DIVIDER_SNAP_DISTANCE &&
        (nearest === null || Math.abs(snapWidth - width) < Math.abs(nearest - width))
          ? snapWidth
          : nearest,
      null,
    );
  return { kind: "resize", width: snap ?? width };
}

/**
 * Trailing-pane widths that put the divider on a vertical fold, so chat and
 * the inspector each own one half of an unfolded display.
 */
export function deriveHingeSnapWidths(input: {
  readonly hinges: ReadonlyArray<{
    readonly left: number;
    readonly right: number;
    readonly orientation: "vertical" | "horizontal";
  }>;
  readonly windowWidth: number;
  readonly trailingInset: number;
}): ReadonlyArray<number> {
  return input.hinges
    .filter((hinge) => hinge.orientation === "vertical")
    .map((hinge) =>
      Math.round(input.windowWidth - input.trailingInset - (hinge.left + hinge.right) / 2),
    )
    .filter((width) => width > 0);
}

/** Geometry is window-relative; horizontal half-open folds reserve the crease for controls. */
export function deriveWorkspaceFoldRegions(input: {
  readonly hinges: ReadonlyArray<{
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
    readonly orientation: "vertical" | "horizontal";
    readonly state: "flat" | "halfOpened";
    readonly separating: boolean;
  }>;
  readonly width: number;
  readonly height: number;
  readonly leadingInset: number;
  readonly trailingInset: number;
}) {
  const vertical = input.hinges.find(
    (hinge) =>
      hinge.orientation === "vertical" &&
      hinge.separating &&
      hinge.right > hinge.left &&
      hinge.left > input.leadingInset &&
      hinge.right < input.width - input.trailingInset,
  );
  const tabletop = input.hinges.find(
    (hinge) =>
      hinge.orientation === "horizontal" &&
      hinge.state === "halfOpened" &&
      hinge.top >= 160 &&
      input.height - hinge.bottom >= 160,
  );
  return {
    vertical: vertical
      ? {
          leadingWidth: vertical.left - input.leadingInset,
          gap: vertical.right - vertical.left,
          trailingWidth: input.width - input.trailingInset - vertical.right,
        }
      : null,
    tabletop: tabletop
      ? { top: tabletop.top, gap: Math.max(0, tabletop.bottom - tabletop.top) }
      : null,
    presetKey: `${tabletop ? "tabletop" : vertical ? "separating" : input.hinges.some((hinge) => hinge.orientation === "vertical") ? "book" : "flat"}:${input.width >= input.height ? "landscape" : "portrait"}:${input.width >= 1200 ? "wide" : input.width >= 720 ? "medium" : "compact"}`,
  };
}

const INSPECTOR_DEFAULT_MIN_WIDTH = 260;
const INSPECTOR_DEFAULT_MAX_WIDTH = 320;
/** Below this, the chat beside an open inspector yields the thread sidebar's space. */
const CHAT_MIN_WIDTH_BESIDE_SIDEBAR = 560;

export interface FoldWorkspacePaneLayout extends WorkspacePaneLayout {
  readonly auxiliaryPaneMaximized: boolean;
  /** Resting widths the divider may drag the inspector between. */
  readonly auxiliaryPaneWidthRange: { readonly min: number; readonly max: number } | null;
}

/**
 * Fold's replacement for upstream's `deriveWorkspacePaneLayout`. Splits a split-view workspace
 * into thread sidebar, chat, and the trailing inspector (files, git, terminal, review). The
 * inspector only takes space while a route has registered content for it. When it would squeeze
 * the chat below a readable width, the sidebar yields (`primarySidebarSuppressedByAuxiliary`:
 * showing it closes the inspector); maximizing gives the inspector the whole workspace.
 * `contentPaneWidth` is the chat column between the sidebar and the inspector.
 */
export function deriveFoldWorkspacePaneLayout(input: {
  readonly layout: Layout;
  readonly viewportWidth: number;
  readonly primarySidebarPreferredVisible: boolean;
  readonly auxiliaryPanePreferredVisible: boolean;
  /** Whether the focused route has inspector content to show. */
  readonly auxiliaryPaneRegistered?: boolean;
  readonly auxiliaryPaneMaximized?: boolean;
  readonly auxiliaryPanePreferredWidth?: number;
}): FoldWorkspacePaneLayout {
  const viewportWidth = Math.max(0, input.viewportWidth);
  const supportsAuxiliaryPane = input.layout.usesSplitView;
  const auxiliaryPaneVisible =
    supportsAuxiliaryPane &&
    input.auxiliaryPanePreferredVisible &&
    (input.auxiliaryPaneRegistered ?? true);
  const sidebarPreferred = input.layout.usesSplitView && input.primarySidebarPreferredVisible;
  // A Duo hinge gap sits between the sidebar and chat, so it counts as sidebar width.
  const listPaneWidth = (input.layout.listPaneWidth ?? 0) + (input.layout.listPaneGap ?? 0);
  const restingInspectorWidth = (availableWidth: number) =>
    constrainFoldablePaneWidth({
      preferredWidth:
        input.auxiliaryPanePreferredWidth ??
        Math.min(
          Math.max(Math.round(availableWidth * 0.28), INSPECTOR_DEFAULT_MIN_WIDTH),
          INSPECTOR_DEFAULT_MAX_WIDTH,
        ),
      availableWidth,
    });
  const widthRange = (availableWidth: number) => ({
    min: FOLDABLE_PANE_COMPACT_WIDTH,
    max: Math.max(FOLDABLE_PANE_COMPACT_WIDTH, availableWidth - FOLDABLE_PANE_COMPACT_WIDTH),
  });

  if (!supportsAuxiliaryPane) {
    return {
      primarySidebarWhenExpanded: input.primarySidebarPreferredVisible,
      primarySidebarVisible: false,
      primarySidebarSuppressedByAuxiliary: false,
      contentPaneWidth: viewportWidth,
      supportsAuxiliaryPane: false,
      auxiliaryPaneVisible: false,
      auxiliaryPaneMaximized: false,
      auxiliaryPaneWidth: null,
      auxiliaryPaneWidthRange: null,
    };
  }

  if (auxiliaryPaneVisible && input.auxiliaryPaneMaximized === true) {
    return {
      primarySidebarWhenExpanded: input.primarySidebarPreferredVisible,
      primarySidebarVisible: false,
      primarySidebarSuppressedByAuxiliary: sidebarPreferred,
      contentPaneWidth: 0,
      supportsAuxiliaryPane,
      auxiliaryPaneVisible,
      auxiliaryPaneMaximized: true,
      auxiliaryPaneWidth: viewportWidth,
      auxiliaryPaneWidthRange: widthRange(viewportWidth),
    };
  }

  const sidebarWidth = sidebarPreferred ? listPaneWidth : 0;
  const besideSidebarWidth = restingInspectorWidth(viewportWidth - sidebarWidth);
  const primarySidebarSuppressedByAuxiliary =
    sidebarPreferred &&
    auxiliaryPaneVisible &&
    viewportWidth - listPaneWidth - besideSidebarWidth < CHAT_MIN_WIDTH_BESIDE_SIDEBAR;
  const primarySidebarVisible = sidebarPreferred && !primarySidebarSuppressedByAuxiliary;
  const availableWidth = viewportWidth - (primarySidebarVisible ? listPaneWidth : 0);
  const auxiliaryPaneWidth = primarySidebarSuppressedByAuxiliary
    ? restingInspectorWidth(availableWidth)
    : besideSidebarWidth;

  return {
    primarySidebarWhenExpanded: input.primarySidebarPreferredVisible,
    primarySidebarVisible,
    primarySidebarSuppressedByAuxiliary,
    contentPaneWidth: Math.max(0, availableWidth - (auxiliaryPaneVisible ? auxiliaryPaneWidth : 0)),
    supportsAuxiliaryPane,
    auxiliaryPaneVisible,
    auxiliaryPaneMaximized: false,
    auxiliaryPaneWidth,
    auxiliaryPaneWidthRange: widthRange(availableWidth),
  };
}
