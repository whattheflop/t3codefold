import { WindowHingeContext } from "../../native/window-hinge-context";
import { useGT } from "gt-react-native";
import {
  WorkspaceColumnsRendererContext,
  WorkspacePresentationHostContext,
} from "./workspace-presentation-context";
import { useAndroidFloatingTabs } from "../settings/appearance/AppearancePreferencesProvider";
import { useSoftKeyboardShowing } from "../keyboard/useSoftKeyboardShowing";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  AdaptiveWorkspaceContext,
  WorkspacePaneStateContext,
  useAdaptiveWorkspaceLayout,
  useWorkspacePaneState,
  type AdaptiveWorkspaceActions,
} from "./adaptive-workspace-context";
import { threadSelectionDeferral } from "./deferred-navigation";
import { uuidv4 } from "../../lib/uuid";
import { EnvironmentId, ThreadId, type SidebarProjectGroupingMode } from "@t3tools/contracts";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { NavigationContext, NavigationRouteContext, useNavigation } from "@react-navigation/native";
import {
  use,
  useCallback,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Keyboard, Platform, View } from "react-native";
import { KeyboardController } from "react-native-keyboard-controller";
import { AsyncResult } from "effect/reactivity";

import {
  isPrimarySidebarPinned,
  isWorkspaceListPath,
  nativeInspectorColumnWidth,
  type FileInspectorPaneLayout,
} from "../../lib/layout";
import {
  deriveFoldWorkspacePaneLayout,
  type PaneDividerRelease,
} from "../../lib/foldable-pane-layout";
import { shouldRestorePrimarySidebar } from "../../lib/fold-workspace-navigation";
import { scopedThreadKey } from "../../lib/scopedEntities";
import type { Preferences } from "../../persistence/mobile-preferences";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { appAtomRegistry } from "../../state/atom-registry";
import { useProjects } from "../../state/entities";
import { withKnownPullRequestSummary } from "../../state/use-thread-pr";
import { environmentThreadShells } from "../../state/threads";
import { savedConnectionsByIdAtom } from "../../state/use-remote-environment-registry";
import { workspaceConnections } from "../../state/workspace";
import {
  DEFAULT_MOBILE_PROJECT_GROUPING_SETTINGS,
  resolveMobileProjectGroupingSettings,
} from "../../state/project-grouping";
import {
  parseActiveThreadPath,
  useHardwareKeyboardCommand,
} from "../keyboard/hardwareKeyboardCommands";
import {
  useWorkspaceVimNavigation,
  VimPaneFocusMarker,
} from "../keyboard/useWorkspaceVimNavigation";
import { useAndroidControlSizing } from "../../components/ui/useAndroidControlSizing";
import { useEnabledNavigationTabs } from "./workspace/navigation-tabs";
import { FLOATING_TABS, floatingTabsMetrics } from "./workspace/floating-workspace-tabs";
import {
  AndroidWorkspaceNavigation,
  FloatingWorkspaceTabs,
} from "./workspace/AndroidWorkspaceNavigation";
import {
  selectWorkspaceDetail,
  type WorkspaceDetail,
  type WorkspaceDetailSheet,
} from "./workspace/workspace-detail-selection";
import { startOpeningDetail } from "./workspace/useSelectWorkspaceDetail";
import { useWorkspaceTabs } from "./workspace/WorkspaceTabsContext";
import { HomeListOptionsProvider } from "../home/home-list-options";
import { buildHomeProjectScopes, resolveHomeProjectFilterScope } from "../home/homeThreadList";
import { newTaskDestination, newTaskFilteredProject } from "../threads/new-task-project-selection";
import { RenderErrorBoundary, RenderFailureView } from "../../components/RenderErrorBoundary";
import { PaneContext } from "../../components/ui/Pane";
import { useWorkspaceThumbActions, WorkspaceThumbNavigation } from "./workspace-thumb-navigation";
import { FoldWorkspaceInspectorPane } from "./fold-workspace-inspector-pane";
import { WorkspaceSidebarColumn } from "./fold-workspace-sidebar-column";
import { InspectorPanes } from "./inspector-host";
import type { InspectorContent } from "./inspector-panes";
import { WorkspaceInspectorSheet } from "./workspace-inspector-sheet";
import { WorkspaceThreadSidebar } from "./workspace/WorkspaceThreadSidebar";
import {
  NativeWorkspaceModeContext,
  NativeWorkspaceInspectorContext,
} from "../../native/v5-workspace-context";
import { useFoldWorkspaceGeometry } from "./fold-workspace-geometry";

import { useAndroidWorkspaceRoot } from "./workspace/AndroidWorkspaceTabsProvider";
import { dispatchRootStackReset, rootStackState } from "../../lib/root-stack-reset";
import {
  currentWorkspaceSelections,
  workspaceSelectionCheck,
} from "./workspace/workspace-selection-store";
import {
  workspaceTabColumns,
  workspaceTabNavigationState,
} from "./workspace/workspace-tab-navigation";
import { workspaceTabOf, type WorkspaceTab } from "./workspace/workspace-tabs-state";
import { workspaceRoutesOf } from "./workspace-overlay-routes";
import { SettingsWorkspaceLayout } from "../settings/SettingsWorkspaceLayout";

export { useAdaptiveWorkspaceLayout, useWorkspacePaneState };

/**
 * Shows these panes in the workspace's inspector while this screen is focused. Register on focus
 * events because frozen blurred screens may never clean up.
 */
export function Inspector(props: {
  readonly content: InspectorContent;
  /** Opens the column the first time this key registers while its route stays on the stack. */
  readonly revealKey?: string;
}) {
  const { registerWorkspaceInspector } = useAdaptiveWorkspaceLayout();
  const navigation = use(NavigationContext);
  const route = use(NavigationRouteContext);
  const content: InspectorContent = {
    ...props.content,
    resetKeys: [route?.key, ...(props.content.resetKeys ?? [])],
    panes: props.content.panes.map((pane) => ({
      ...pane,
      render: () => (
        <NavigationContext.Provider value={navigation}>
          <NavigationRouteContext.Provider value={route}>
            {pane.render()}
          </NavigationRouteContext.Provider>
        </NavigationContext.Provider>
      ),
    })),
  };
  const focusedRef = useRef(false);
  const deactivateRef = useRef<(() => void) | null>(null);

  const syncRegistration = useEffectEvent(() => {
    if (!focusedRef.current) {
      deactivateRef.current?.();
      return;
    }
    deactivateRef.current = registerWorkspaceInspector(content, route?.key, props.revealKey);
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Navigation focus events own the inspector registration lifetime.
  useEffect(() => {
    if (navigation === undefined) return;
    const focus = () => {
      if (focusedRef.current) return;
      focusedRef.current = true;
      syncRegistration();
    };
    const blur = () => {
      focusedRef.current = false;
      syncRegistration();
    };
    if (navigation.isFocused()) focus();
    const unsubscribeFocus = navigation.addListener("focus", focus);
    const unsubscribeBlur = navigation.addListener("blur", blur);
    return () => {
      unsubscribeFocus();
      unsubscribeBlur();
      focusedRef.current = false;
      deactivateRef.current?.();
      deactivateRef.current = null;
    };
  }, [navigation]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Changed column content replaces the focused inspector registration.
  useEffect(() => {
    if (focusedRef.current) {
      syncRegistration();
    }
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Changed column content replaces its existing native workspace registration.
  }, [props.content, props.revealKey]);
  return null;
}

/**
 * Actions whose identities never change, so a pane toggle doesn't re-render every screen that
 * holds one. Each call runs the latest render's handler.
 */
function useStableActions(actions: Required<AdaptiveWorkspaceActions>): AdaptiveWorkspaceActions {
  const latest = useRef(actions);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- points the stable actions at the handlers this commit rendered
  useLayoutEffect(() => {
    latest.current = actions;
  });
  const [stable] = useState((): AdaptiveWorkspaceActions => ({
    startNewTask: () => latest.current.startNewTask(),
    selectDetail: (detail, sheet) => latest.current.selectDetail(detail, sheet),
    registerWorkspaceInspector: (content, routeKey, revealKey) =>
      latest.current.registerWorkspaceInspector(content, routeKey, revealKey),
    setPrimarySidebarSearchQuery: (query) => latest.current.setPrimarySidebarSearchQuery(query),
    showInspector: () => latest.current.showInspector(),
    toggleAuxiliaryPane: () => latest.current.toggleAuxiliaryPane(),
    togglePrimarySidebar: () => latest.current.togglePrimarySidebar(),
    revealPrimarySidebar: () => latest.current.revealPrimarySidebar(),
    setPrimarySidebarVisible: (visible) => latest.current.setPrimarySidebarVisible(visible),
    openWorkspaceTab: (tab, options) => latest.current.openWorkspaceTab(tab, options),
    setAuxiliaryPaneWidth: (width) => latest.current.setAuxiliaryPaneWidth(width),
    setNativeInspectorWidth: (width) => latest.current.setNativeInspectorWidth(width),
    setComposerEditing: (editing) => latest.current.setComposerEditing(editing),
    hideAuxiliaryPane: () => latest.current.hideAuxiliaryPane(),
    setAuxiliaryPaneMaximized: (maximized) => latest.current.setAuxiliaryPaneMaximized(maximized),
    toggleAuxiliaryPaneMaximized: () => latest.current.toggleAuxiliaryPaneMaximized(),
  }));
  return stable;
}

export function AdaptiveWorkspaceLayout(props: {
  readonly children: ReactNode;
  readonly pathname: string;
  readonly workspaceRouteKey: string | undefined;
  readonly workspaceRouteName: string | undefined;
}) {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  if (!AsyncResult.isSuccess(preferencesResult)) {
    return AsyncResult.isFailure(preferencesResult) ? (
      <AdaptiveWorkspaceLayoutContent
        {...props}
        projectGroupingMode={DEFAULT_MOBILE_PROJECT_GROUPING_SETTINGS.sidebarProjectGroupingMode}
        initialPreferences={{}}
      />
    ) : null;
  }
  const groupingSettings = resolveMobileProjectGroupingSettings(preferencesResult.value);
  return (
    <AdaptiveWorkspaceLayoutContent
      {...props}
      projectGroupingMode={groupingSettings.sidebarProjectGroupingMode}
      initialPreferences={preferencesResult.value}
    />
  );
}

function AdaptiveWorkspaceLayoutContent(props: {
  readonly children: ReactNode;
  readonly pathname: string;
  readonly workspaceRouteKey: string | undefined;
  readonly workspaceRouteName: string | undefined;
  readonly projectGroupingMode: SidebarProjectGroupingMode;
  /** Pane preferences are read once; the workspace owns them while mounted. */
  readonly initialPreferences: Preferences;
}) {
  const gt = useGT();
  const floatingTabsEnabled = useAndroidFloatingTabs();
  const projectGroupingMode = props.projectGroupingMode;
  const nativeWorkspace = use(NativeWorkspaceModeContext);
  const usesPresentationHost = use(WorkspacePresentationHostContext);
  const pathname = props.pathname;
  const workspace = useWorkspaceTabs();
  // Settings and Usage occupy the workspace rather than a list/detail pair.
  const androidSettingsOpen = useAndroidWorkspaceRoot()?.settingsOpen ?? false;
  const safeAreaInsets = useSafeAreaInsets();
  const workspacePage =
    Platform.OS === "android" && (androidSettingsOpen || workspace?.state.selectedTab === "usage");
  const navigation = useNavigation();
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const {
    layout,
    width,
    leadingInset,
    trailingInset,
    foldRegions,
    windowHinge,
    tabletopTopHeight,
    hingeSnapWidths,
    workspaceView,
    onWorkspaceLayout,
  } = useFoldWorkspaceGeometry();
  // Fold's geometry has no medium windows, so this sidebar never overlays the content; the
  // overlay bookkeeping stays so upstream's medium variant keeps its page-closes-sidebar rule.
  const sidebarOverlaysContent = layout.variant === "medium";
  const primarySidebarPinned = isPrimarySidebarPinned({
    pathname,
    nativeWorkspace,
    usesSplitView: layout.usesSplitView,
  });

  const [primarySidebarPreferredVisible, setPrimarySidebarPreferredVisibleState] = useState(
    props.initialPreferences.workspaceSidebarVisible ?? true,
  );
  const setPrimarySidebarPreferredVisible = useCallback(
    (visible: boolean) => {
      setPrimarySidebarPreferredVisibleState(visible);
      savePreferences({ workspaceSidebarVisible: visible });
    },
    [savePreferences],
  );
  // Pull request review keeps its own sidebar choice, hidden by default: a list beside a PR
  // (or a diff beside its files) needs the whole width. The sidebar button still reveals it.
  const onPullRequestRoute = /^\/pull-requests(?:\/|$)/.test(pathname);
  const [pullRequestSidebarPreferredVisible, setPullRequestSidebarPreferredVisible] =
    useState(false);
  const sidebarPreferredVisible = onPullRequestRoute
    ? pullRequestSidebarPreferredVisible
    : primarySidebarPreferredVisible;
  const setSidebarPreferredVisible = onPullRequestRoute
    ? setPullRequestSidebarPreferredVisible
    : setPrimarySidebarPreferredVisible;
  // The overlay sidebar closes when a page opens from it, and stays open on a list or on the
  // page a tab switch opened (`keepOpenFor`, set by that switch).
  const [overlaySidebar, setOverlaySidebar] = useState({
    active: sidebarOverlaysContent,
    pathname,
    visible: isWorkspaceListPath(pathname),
    keepOpenFor: null as string | null,
  });
  if (
    overlaySidebar.active !== sidebarOverlaysContent ||
    (overlaySidebar.active && overlaySidebar.pathname !== pathname)
  ) {
    setOverlaySidebar({
      active: sidebarOverlaysContent,
      pathname,
      visible:
        isWorkspaceListPath(pathname) ||
        (overlaySidebar.keepOpenFor !== null &&
          overlaySidebar.keepOpenFor === props.workspaceRouteKey),
      keepOpenFor: null,
    });
  }
  const preferredSidebarVisible = sidebarOverlaysContent
    ? overlaySidebar.visible
    : sidebarPreferredVisible;
  const [composerEditing, setComposerEditing] = useState(false);
  const softKeyboardVisible = useSoftKeyboardShowing();
  // Hardware keyboard focus leaves room for the sidebar; Android Back hides the soft keyboard
  // without blurring the editor. Keep the saved sidebar choice through both transitions.
  const composerKeyboardActive = useDeferredValue(
    Platform.OS === "android" && layout.usesSplitView && composerEditing && softKeyboardVisible,
  );
  const showPrimarySidebar =
    !workspacePage &&
    (primarySidebarPinned || (preferredSidebarVisible && !composerKeyboardActive));
  const [inspectorPreferredVisible, setInspectorPreferredVisible] = useState(true);
  const [inspectorMaximized, setInspectorMaximized] = useState(false);
  const inspectorRatios = props.initialPreferences.workspaceInspectorRatios ?? {};
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- migrates the persisted legacy inspector width into the per-fold ratio store once
  useEffect(() => {
    const previousWidth = props.initialPreferences.workspaceInspectorWidth;
    if (!layout.usesSplitView || previousWidth === undefined) return;
    savePreferences({
      transform: (current) => ({
        workspaceInspectorWidth: undefined,
        workspaceInspectorRatios: {
          [foldRegions.presetKey]: Math.min(0.95, Math.max(0.05, previousWidth / width)),
          ...current.workspaceInspectorRatios,
        },
      }),
    });
  }, [
    props.initialPreferences.workspaceInspectorWidth,
    layout.usesSplitView,
    foldRegions.presetKey,
    savePreferences,
    width,
  ]);
  const [primarySidebarSearchQuery, setPrimarySidebarSearchQuery] = useState("");
  const nativeMetricsWidth = width + leadingInset + trailingInset;
  const [nativeInspectorWidthFraction, setNativeInspectorWidthFraction] = useState(0.4);
  const inspectorWidthFor = (fraction: number) =>
    nativeInspectorColumnWidth({
      viewportWidth: nativeMetricsWidth,
      horizontalSafeArea: leadingInset + trailingInset,
      fraction,
    });
  const nativeInspectorWidth = inspectorWidthFor(nativeInspectorWidthFraction);
  const setNativeInspectorWidth = useCallback(
    (nextWidth: number) =>
      setNativeInspectorWidthFraction(
        nativeInspectorColumnWidth({
          viewportWidth: nativeMetricsWidth,
          horizontalSafeArea: leadingInset + trailingInset,
          fraction: nextWidth / Math.max(1, nativeMetricsWidth),
        }) / Math.max(1, nativeMetricsWidth),
      ),
    [leadingInset, nativeMetricsWidth, trailingInset],
  );
  const sidebarRoute = `${layout.usesSplitView}:${pathname}`;
  const [restoredSidebarRoute, setRestoredSidebarRoute] = useState<string | null>(null);
  if (restoredSidebarRoute !== sidebarRoute) {
    setRestoredSidebarRoute(sidebarRoute);
    if (shouldRestorePrimarySidebar({ usesSplitView: layout.usesSplitView, pathname })) {
      setPrimarySidebarPreferredVisibleState(true);
      setInspectorPreferredVisible(false);
      setInspectorMaximized(false);
    }
  }

  const [workspaceInspector, setWorkspaceInspector] = useState<{
    readonly content: InspectorContent;
    readonly routeKey: string | undefined;
  } | null>(null);
  const workspaceInspectorOwner = useRef<symbol | null>(null);
  // Routes still on the stack remember their reveal, so going back to one keeps the user's choice.
  const revealedInspectors = useRef<ReadonlyMap<string, string>>(new Map());
  const registerWorkspaceInspector = useCallback(
    (content: InspectorContent, routeKey: string | undefined, revealKey?: string) => {
      const owner = Symbol("workspace-inspector");
      workspaceInspectorOwner.current = owner;
      setWorkspaceInspector({ content, routeKey });
      if (
        routeKey !== undefined &&
        revealKey !== undefined &&
        revealedInspectors.current.get(routeKey) !== revealKey
      ) {
        const state = rootStackState(navigation);
        const live = new Set(state?.routes.slice(0, state.index + 1).map((route) => route.key));
        revealedInspectors.current = new Map(
          [...revealedInspectors.current, [routeKey, revealKey] as const].filter(
            ([key]) => live.has(key) || key === routeKey,
          ),
        );
        setInspectorPreferredVisible(true);
      }

      return () => {
        // During a push/replace the outgoing screen deactivates AFTER the
        // incoming screen registered — only the current owner may deactivate.
        if (workspaceInspectorOwner.current !== owner) {
          return;
        }
        workspaceInspectorOwner.current = null;
        setWorkspaceInspector(null);
        // A maximized pane belongs to the route that filled it.
        setInspectorMaximized(false);
      };
    },
    [navigation],
  );
  // Without a column the inspector is a sheet, opened only on request for the route on top, and
  // shown again when that route returns to the top.
  const [inspectorSheetRoute, setInspectorSheetRoute] = useState<string | null>(null);

  // Until the user picks a width, an unfolded display splits at its fold.
  const inspectorPreferredRatio = inspectorRatios[foldRegions.presetKey];
  const inspectorRestingWidth =
    foldRegions.vertical?.trailingWidth ??
    (inspectorPreferredRatio !== undefined ? inspectorPreferredRatio * width : hingeSnapWidths[0]);
  const effectiveLayout = useMemo(
    () =>
      foldRegions.vertical
        ? { ...layout, listPaneWidth: foldRegions.vertical.leadingWidth }
        : layout,
    [foldRegions.vertical, layout],
  );
  // A boolean, not the registration: a re-registering screen must not re-derive the panes.
  const inspectorRegistered = workspaceInspector !== null;
  const panes = useMemo(() => {
    const derived = deriveFoldWorkspacePaneLayout({
      layout: effectiveLayout,
      viewportWidth: width - (foldRegions.vertical?.gap ?? 0),
      primarySidebarPreferredVisible:
        showPrimarySidebar &&
        tabletopTopHeight === null &&
        !(foldRegions.vertical && inspectorPreferredVisible && inspectorRegistered),
      auxiliaryPanePreferredVisible: !workspacePage && inspectorPreferredVisible,
      auxiliaryPaneRegistered: inspectorRegistered,
      auxiliaryPaneMaximized: inspectorMaximized,
      ...(inspectorRestingWidth !== undefined
        ? { auxiliaryPanePreferredWidth: inspectorRestingWidth }
        : {}),
    });
    return foldRegions.vertical && derived.auxiliaryPaneMaximized
      ? { ...derived, auxiliaryPaneWidth: foldRegions.vertical.trailingWidth }
      : derived;
  }, [
    inspectorMaximized,
    workspacePage,
    inspectorPreferredVisible,
    inspectorRestingWidth,
    effectiveLayout,
    foldRegions.vertical,
    tabletopTopHeight,
    showPrimarySidebar,
    width,
    inspectorRegistered,
  ]);
  const fileInspector = useMemo<FileInspectorPaneLayout>(
    () => ({ supported: panes.supportsAuxiliaryPane, width: panes.auxiliaryPaneWidth }),
    [panes.auxiliaryPaneWidth, panes.supportsAuxiliaryPane],
  );
  const inspectorSheetOpen =
    !fileInspector.supported &&
    !workspacePage &&
    inspectorSheetRoute !== null &&
    workspaceInspector !== null &&
    workspaceInspector.routeKey === inspectorSheetRoute;
  const inspectorContent = workspaceInspector?.content;

  const activeThread = useMemo(() => parseActiveThreadPath(pathname), [pathname]);
  const environmentId = activeThread?.environmentId ?? null;
  const threadId = activeThread?.threadId ?? null;
  const selectedThreadRef = (() => {
    if (environmentId === null || threadId === null) {
      return null;
    }
    try {
      return {
        environmentId: EnvironmentId.make(environmentId),
        threadId: ThreadId.make(threadId),
      };
    } catch {
      return null;
    }
  })();
  const selectedThreadKey =
    selectedThreadRef === null
      ? null
      : scopedThreadKey(selectedThreadRef.environmentId, selectedThreadRef.threadId);
  const setPrimarySidebarVisible = useCallback(
    (visible: boolean) => {
      if (sidebarOverlaysContent) {
        setOverlaySidebar((current) => ({ ...current, visible }));
      } else {
        setSidebarPreferredVisible(visible);
      }
    },
    [sidebarOverlaysContent, setSidebarPreferredVisible],
  );
  const togglePrimarySidebar = useCallback(() => {
    if (composerKeyboardActive) {
      void KeyboardController.dismiss();
      if (preferredSidebarVisible) return;
    }
    if (tabletopTopHeight !== null && pathname !== "/") {
      navigation.navigate("Home");
      return;
    }
    if (foldRegions.vertical && panes.auxiliaryPaneVisible) {
      setInspectorPreferredVisible(false);
      setInspectorMaximized(false);
      setSidebarPreferredVisible(true);
      return;
    }
    if (primarySidebarPinned) {
      return;
    }
    if (panes.auxiliaryPaneMaximized) {
      setInspectorMaximized(false);
      setSidebarPreferredVisible(true);
      return;
    }
    if (!panes.primarySidebarVisible && panes.primarySidebarSuppressedByAuxiliary) {
      setInspectorPreferredVisible(false);
      setSidebarPreferredVisible(true);
      return;
    }
    setPrimarySidebarVisible(!preferredSidebarVisible);
  }, [
    composerKeyboardActive,
    tabletopTopHeight,
    foldRegions.vertical,
    panes.auxiliaryPaneVisible,
    navigation,
    panes.auxiliaryPaneMaximized,
    panes.primarySidebarSuppressedByAuxiliary,
    panes.primarySidebarVisible,
    pathname,
    preferredSidebarVisible,
    primarySidebarPinned,
    setPrimarySidebarVisible,
    setSidebarPreferredVisible,
  ]);
  const revealPrimarySidebar = useCallback(() => {
    if (composerKeyboardActive) void KeyboardController.dismiss();
    setInspectorMaximized(false);
    if (panes.primarySidebarSuppressedByAuxiliary) {
      setInspectorPreferredVisible(false);
    }
    setPrimarySidebarVisible(true);
  }, [composerKeyboardActive, panes.primarySidebarSuppressedByAuxiliary, setPrimarySidebarVisible]);
  const handleToggleSidebarCommand = useCallback(() => {
    togglePrimarySidebar();
    return true;
  }, [togglePrimarySidebar]);
  const sidebarCommands = useMemo(
    () => (primarySidebarPinned ? [] : (["toggleSidebar"] as const)),
    [primarySidebarPinned],
  );
  useHardwareKeyboardCommand(sidebarCommands, handleToggleSidebarCommand);
  const showInspector = useCallback(() => {
    setInspectorPreferredVisible(true);
    if (fileInspector.supported) {
      setInspectorSheetRoute(null);
      return;
    }
    const state = rootStackState(navigation);
    const top = workspaceRoutesOf(state?.routes.slice(0, state.index + 1) ?? []).workspace.at(-1);
    setInspectorSheetRoute(top?.key ?? null);
  }, [fileInspector.supported, navigation]);
  const hideAuxiliaryPane = useCallback(() => {
    setInspectorPreferredVisible(false);
    setInspectorMaximized(false);
    setInspectorSheetRoute(null);
  }, []);
  const renderInspector = useMemo(
    () =>
      inspectorContent === undefined
        ? undefined
        : () => <InspectorPanes content={inspectorContent} onClose={hideAuxiliaryPane} />,
    [hideAuxiliaryPane, inspectorContent],
  );
  const toggleAuxiliaryPane = useCallback(() => {
    if (fileInspector.supported) {
      if (panes.auxiliaryPaneVisible) hideAuxiliaryPane();
      else showInspector();
    } else if (inspectorSheetOpen) hideAuxiliaryPane();
    else showInspector();
  }, [
    fileInspector.supported,
    hideAuxiliaryPane,
    inspectorSheetOpen,
    panes.auxiliaryPaneVisible,
    showInspector,
  ]);
  const setAuxiliaryPaneMaximized = useCallback((maximized: boolean) => {
    setInspectorMaximized(maximized);
    if (maximized) setInspectorPreferredVisible(true);
  }, []);
  const toggleAuxiliaryPaneMaximized = useCallback(() => {
    setAuxiliaryPaneMaximized(!panes.auxiliaryPaneMaximized);
  }, [panes.auxiliaryPaneMaximized, setAuxiliaryPaneMaximized]);
  const handleDividerRelease = useCallback(
    (release: PaneDividerRelease) => {
      switch (release.kind) {
        case "maximize":
          setAuxiliaryPaneMaximized(true);
          return;
        case "close":
          hideAuxiliaryPane();
          return;
        case "resize":
          setInspectorMaximized(false);
          const ratio = release.width / Math.max(1, width);
          savePreferences({
            transform: (current) => ({
              workspaceInspectorRatios: {
                ...current.workspaceInspectorRatios,
                [foldRegions.presetKey]: ratio,
              },
            }),
          });
          return;
      }
    },
    [foldRegions.presetKey, hideAuxiliaryPane, savePreferences, setAuxiliaryPaneMaximized, width],
  );
  const setAuxiliaryPaneWidth = useCallback(
    (nextWidth: number) => handleDividerRelease({ kind: "resize", width: nextWidth }),
    [handleDividerRelease],
  );
  const handleOpenFilesCommand = useCallback(() => {
    const activeThread = parseActiveThreadPath(pathname);
    if (!panes.supportsAuxiliaryPane || activeThread === null) {
      return false;
    }
    showInspector();
    if (/\/files(?:\/|$)/.test(pathname)) {
      return true;
    }
    navigation.navigate("ThreadFiles", activeThread);
    return true;
  }, [panes.supportsAuxiliaryPane, pathname, navigation, showInspector]);
  useHardwareKeyboardCommand("files", handleOpenFilesCommand);
  useWorkspaceVimNavigation({
    usesSplitView: layout.usesSplitView,
    panes,
    togglePrimarySidebar,
    toggleAuxiliaryPaneMaximized,
  });
  /**
   * The one way to open a workspace tab: replaces the workspace with the tab's list and, when the
   * window has columns, the page it last showed, keeping any sheet on top. An overlay sidebar
   * stays open over that page.
   */
  const openWorkspaceTab = useCallback(
    (tab: WorkspaceTab | "settings", options?: { readonly columns?: boolean }) => {
      const state = rootStackState(navigation);
      if (!state) return;
      const { workspace: routes, overlays } = workspaceRoutesOf(
        state.routes.slice(0, state.index + 1),
      );
      const next = workspaceTabNavigationState(
        { ...state, routes },
        tab,
        currentWorkspaceSelections(),
        {
          columns: workspaceTabColumns(Platform.OS, tab, options?.columns ?? layout.usesSplitView),
          check: workspaceSelectionCheck,
          overlays,
          seedPullRequest: withKnownPullRequestSummary,
        },
      );
      if (sidebarOverlaysContent) {
        const opened = next.routes.at(-1 - overlays.length)?.key ?? null;
        setOverlaySidebar((current) => ({ ...current, visible: true, keepOpenFor: opened }));
      }
      dispatchRootStackReset(navigation, state, next);
    },
    [sidebarOverlaysContent, layout.usesSplitView, navigation],
  );
  const handleOpenSettings = useCallback(() => openWorkspaceTab("settings"), [openWorkspaceTab]);

  /** The one way to show a page in the detail column; see `selectWorkspaceDetail`. */
  const handleSelectDetail = useCallback(
    (detail: WorkspaceDetail, sheet?: WorkspaceDetailSheet) => {
      threadSelectionDeferral.run(() => {
        if (Platform.OS === "android") Keyboard.dismiss();
        // Re-selecting the open thread keeps Fold's inspector pane beside it.
        const params = detail.params as { environmentId?: unknown; threadId?: unknown } | undefined;
        const reselecting =
          detail.name === "Thread" &&
          selectedThreadKey !== null &&
          typeof params?.environmentId === "string" &&
          typeof params.threadId === "string" &&
          scopedThreadKey(
            EnvironmentId.make(params.environmentId),
            ThreadId.make(params.threadId),
          ) === selectedThreadKey;
        if (!reselecting) hideAuxiliaryPane();
        else setInspectorSheetRoute(null);
        if (sidebarOverlaysContent) setPrimarySidebarVisible(false);
        workspace?.dispatch({
          type: "select",
          tab: workspaceTabOf(detail.name),
        });
        startOpeningDetail(detail);
        navigation.dispatch(selectWorkspaceDetail(detail, sheet));
      });
    },
    [
      hideAuxiliaryPane,
      sidebarOverlaysContent,
      navigation,
      selectedThreadKey,
      setPrimarySidebarVisible,
      workspace,
    ],
  );
  const handleSelectThreadRoute = useCallback(
    (params: ReactNavigation.RootParamList["Thread"]) =>
      handleSelectDetail({ name: "Thread", params }),
    [handleSelectDetail],
  );

  const projects = useProjects();
  const compactAndroidSettings =
    Platform.OS === "android" && androidSettingsOpen && !layout.usesSplitView;
  // Fold's split view keeps its sidebar navigation, so floating tabs only replace the compact bar.
  const compactFloatingTabs = floatingTabsEnabled && compactAndroidSettings;
  const enabledTabs = useEnabledNavigationTabs();
  const { scale, fabSize } = useAndroidControlSizing();
  const floatingTabs = floatingTabsMetrics(enabledTabs.length + 1, scale, fabSize);
  // Reads the open page when pressed, so the layout context doesn't change on every navigation.
  const handleStartNewTask = useCallback(() => {
    const state = rootStackState(navigation);
    const currentRoute = workspaceRoutesOf(
      state?.routes.slice(0, state.index + 1) ?? [],
    ).workspace.at(-1);
    const params =
      currentRoute?.name === "Thread"
        ? (currentRoute.params as ReactNavigation.RootParamList["Thread"])
        : undefined;
    const first = (value: string | string[] | undefined) =>
      Array.isArray(value) ? value[0] : value;
    const environmentId = first(params?.environmentId);
    const threadId = first(params?.threadId);
    // The full index, not the sidebar list: subagent and archived threads are current threads too.
    const projectId =
      environmentId && threadId
        ? appAtomRegistry
            .get(
              environmentThreadShells.environmentThreadIndexAtom(EnvironmentId.make(environmentId)),
            )
            .get(ThreadId.make(threadId))?.projectId
        : undefined;
    const preferences = appAtomRegistry.get(mobilePreferencesAtom);
    const saved = AsyncResult.isSuccess(preferences) ? preferences.value : undefined;
    // Resolve the thread list's filter as useHomeListOptions does: a removed connection's filter reads as all.
    const listFilters = saved?.threadListFilters;
    const listEnvironmentId =
      listFilters?.environmentId != null &&
      appAtomRegistry.get(savedConnectionsByIdAtom)[listFilters.environmentId] !== undefined
        ? listFilters.environmentId
        : null;
    const filteredScope = resolveHomeProjectFilterScope(
      buildHomeProjectScopes({ projects, environmentId: listEnvironmentId, projectGroupingMode }),
      projects,
      { selectedProjectKey: listFilters?.projectKey ?? null, projectGroupingMode },
    );
    const connectedEnvironmentIds = new Set(
      appAtomRegistry
        .get(workspaceConnections.environmentsAtom)
        .filter((environment) => environment.connectionState === "connected")
        .map((environment) => environment.environmentId),
    );
    handleSelectThreadRoute(
      newTaskDestination({
        projects,
        requestId: uuidv4(),
        useLastProject: saved?.useLastProjectForNewThreads,
        currentProject: environmentId && projectId ? { environmentId, projectId } : undefined,
        filteredProject: filteredScope
          ? newTaskFilteredProject(
              filteredScope,
              listEnvironmentId,
              connectedEnvironmentIds,
              saved?.lastThreadProject,
            )
          : undefined,
        lastProject: saved?.lastThreadProject,
      }),
    );
  }, [handleSelectThreadRoute, navigation, projects, projectGroupingMode]);

  useHardwareKeyboardCommand("newTask", () => {
    handleStartNewTask();
    return true;
  });

  const handleThumbAction = useWorkspaceThumbActions({
    activeThread,
    usesSplitView: layout.usesSplitView,
    supportsAuxiliaryPane: panes.supportsAuxiliaryPane,
    togglePrimarySidebar,
    toggleAuxiliaryPane,
    hideAuxiliaryPane,
  });

  const actions = useStableActions({
    startNewTask: handleStartNewTask,
    selectDetail: handleSelectDetail,
    registerWorkspaceInspector,
    setPrimarySidebarSearchQuery,
    showInspector,
    hideAuxiliaryPane,
    toggleAuxiliaryPane,
    setAuxiliaryPaneMaximized,
    toggleAuxiliaryPaneMaximized,
    togglePrimarySidebar,
    revealPrimarySidebar,
    setPrimarySidebarVisible,
    openWorkspaceTab,
    // Fold's inspector resizes through its divider and remembers a ratio per fold preset.
    setAuxiliaryPaneWidth,
    setNativeInspectorWidth,
    setComposerEditing,
  });
  const tabletopHingeTop = foldRegions.tabletop?.top ?? null;
  const tabletopHingeHeight = foldRegions.tabletop?.gap ?? 0;
  const contextValue = useMemo(
    () => ({
      ...actions,
      tabletopTopHeight,
      tabletopHingeTop,
      tabletopHingeHeight,
      layout: effectiveLayout,
      nativeInspectorWidth,
      // Workspace pages lay out in the content pane at its own width.
      workspacePageWidth: null,
    }),
    [
      actions,
      tabletopTopHeight,
      tabletopHingeTop,
      tabletopHingeHeight,
      effectiveLayout,
      nativeInspectorWidth,
    ],
  );
  const sidebarToggleable = layout.usesSplitView && !primarySidebarPinned && !workspacePage;
  const paneState = useMemo(
    () => ({
      panes,
      fileInspector,
      primarySidebarSearchQuery,
      sidebarToggleable,
      composerKeyboardActive,
      // Fold never runs the native iOS split that rotates the sidebar overlay.
      sidebarByOrientation: null,
    }),
    [panes, fileInspector, primarySidebarSearchQuery, sidebarToggleable, composerKeyboardActive],
  );

  // A fold or Duo division separates the sidebar from the chat.
  const sidebarGap = foldRegions.vertical?.gap ?? effectiveLayout.listPaneGap ?? 0;

  const inspectorSheet = (
    <WorkspaceInspectorSheet
      open={inspectorSheetOpen}
      onClose={hideAuxiliaryPane}
      content={inspectorContent}
    />
  );
  if (nativeWorkspace) {
    return (
      <HomeListOptionsProvider
        projectGroupingMode={projectGroupingMode}
        savedFilters={props.initialPreferences.threadListFilters}
      >
        <AdaptiveWorkspaceContext value={contextValue}>
          <WorkspacePaneStateContext value={paneState}>
            <NativeWorkspaceInspectorContext
              value={{
                // Without a column the sheet shows it; the hidden native column must not mount it too.
                content: fileInspector.supported ? inspectorContent : undefined,
                visible: panes.auxiliaryPaneVisible,
              }}
            >
              {props.children}
              {inspectorSheet}
            </NativeWorkspaceInspectorContext>
          </WorkspacePaneStateContext>
        </AdaptiveWorkspaceContext>
      </HomeListOptionsProvider>
    );
  }
  const renderColumns = (children: ReactNode, sidebar?: ReactNode) => (
    <View
      ref={workspaceView}
      onLayout={onWorkspaceLayout}
      testID="adaptive-workspace-layout"
      className={Platform.OS === "android" ? "flex-1 flex-row bg-header" : "flex-1 flex-row"}
      style={{ paddingLeft: leadingInset, paddingRight: trailingInset }}
    >
      <WorkspaceSidebarColumn layout={effectiveLayout} visible={panes.primarySidebarVisible}>
        {() => (
          <PaneContext value="sidebar">
            <RenderErrorBoundary
              renderFallback={(fallback) => (
                <RenderFailureView
                  {...fallback}
                  title={gt("The sidebar couldn't be displayed")}
                  exit={{ label: gt("Open settings"), onPress: handleOpenSettings }}
                />
              )}
            >
              {/* Android draws the Home route here: the Chats/PRs switcher and the tab's list. */}
              {sidebar ?? <WorkspaceThreadSidebar />}
            </RenderErrorBoundary>
          </PaneContext>
        )}
      </WorkspaceSidebarColumn>
      {sidebarGap > 0 && panes.primarySidebarVisible ? (
        <View style={{ width: sidebarGap }} />
      ) : null}
      <View
        className={
          Platform.OS === "android" ? "overflow-hidden bg-header" : "overflow-hidden bg-screen"
        }
        collapsable={false}
        accessibilityElementsHidden={panes.auxiliaryPaneMaximized}
        importantForAccessibility={panes.auxiliaryPaneMaximized ? "no-hide-descendants" : "auto"}
        // A maximized inspector collapses the chat without unmounting it.
        style={
          panes.auxiliaryPaneMaximized
            ? { width: 0 }
            : foldRegions.vertical && !panes.primarySidebarVisible && !panes.auxiliaryPaneVisible
              ? { width: foldRegions.vertical.leadingWidth }
              : { flex: 1 }
        }
      >
        {/* Compact Settings keeps the bottom navigation under all of its pages. */}
        <SafeAreaInsetsContext
          value={
            compactFloatingTabs
              ? {
                  ...safeAreaInsets,
                  bottom:
                    safeAreaInsets.bottom +
                    FLOATING_TABS.bottom +
                    FLOATING_TABS.edge +
                    floatingTabs.height,
                }
              : compactAndroidSettings
                ? { ...safeAreaInsets, bottom: 0 }
                : safeAreaInsets
          }
        >
          <View nativeID="t3-controller-pane:content" collapsable={false} className="flex-1">
            <PaneContext value="content">
              <SettingsWorkspaceLayout>{children}</SettingsWorkspaceLayout>
            </PaneContext>
          </View>
        </SafeAreaInsetsContext>
        {compactFloatingTabs ? (
          <FloatingWorkspaceTabs fillWidth onNewThread={handleStartNewTask} />
        ) : compactAndroidSettings ? (
          <AndroidWorkspaceNavigation onNewThread={handleStartNewTask} />
        ) : null}
        {Platform.OS === "android" &&
        props.initialPreferences.workspaceThumbGesturesEnabled === true ? (
          <WorkspaceThumbNavigation onAction={handleThumbAction} />
        ) : null}
        <VimPaneFocusMarker region="chat" />
      </View>
      {foldRegions.vertical && panes.auxiliaryPaneVisible ? (
        <View
          style={{
            width:
              foldRegions.vertical.gap +
              (panes.auxiliaryPaneMaximized ? foldRegions.vertical.leadingWidth : 0),
          }}
        />
      ) : null}
      <FoldWorkspaceInspectorPane
        topRegionHeight={tabletopTopHeight}
        fixedDivider={foldRegions.vertical !== null}
        pathname={props.pathname}
        panes={panes}
        renderInspector={renderInspector}
        snapWidths={hingeSnapWidths}
        onDividerRelease={handleDividerRelease}
        onToggleMaximized={toggleAuxiliaryPaneMaximized}
      />
      {inspectorSheet}
    </View>
  );

  return (
    <HomeListOptionsProvider
      projectGroupingMode={projectGroupingMode}
      savedFilters={props.initialPreferences.threadListFilters}
    >
      <AdaptiveWorkspaceContext value={contextValue}>
        <WorkspacePaneStateContext value={paneState}>
          <WindowHingeContext value={windowHinge}>
            {usesPresentationHost ? (
              <WorkspaceColumnsRendererContext value={renderColumns}>
                {props.children}
              </WorkspaceColumnsRendererContext>
            ) : (
              renderColumns(props.children)
            )}
          </WindowHingeContext>
        </WorkspacePaneStateContext>
      </AdaptiveWorkspaceContext>
    </HomeListOptionsProvider>
  );
}
