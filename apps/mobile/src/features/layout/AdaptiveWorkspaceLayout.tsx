import { WindowHingeContext } from "../../native/window-hinge-context";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ThreadId, type SidebarProjectGroupingMode } from "@t3tools/contracts";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useFocusEffect } from "@react-navigation/native";
import {
  CommonActions,
  NavigationContext,
  NavigationRouteContext,
  StackActions,
  useNavigation,
} from "@react-navigation/native";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Platform, View } from "react-native";
import { AsyncResult } from "effect/reactivity";

import {
  deriveFileInspectorPaneLayout,
  deriveLayout,
  type FileInspectorPaneLayout,
  type Layout,
  type WorkspaceAuxiliaryPaneRole,
} from "../../lib/layout";
import {
  deriveFoldWorkspacePaneLayout,
  type FoldWorkspacePaneLayout,
  type PaneDividerRelease,
} from "../../lib/foldable-pane-layout";
import {
  resolveThreadSelectionNavigationAction,
  resolveThreadSelectionOverlayState,
} from "../../lib/adaptive-navigation";
import { shouldRestorePrimarySidebar } from "../../lib/fold-workspace-navigation";
import { scopedThreadKey } from "../../lib/scopedEntities";
import type { Preferences } from "../../persistence/mobile-preferences";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
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
import { AndroidHomeFabLayout } from "../home/AndroidHomeFab";
import { AndroidWorkspaceSidebar } from "../workspace/AndroidWorkspaceSidebar";
import { useAndroidWorkspaceSelection } from "../workspace/useAndroidWorkspaceSelection";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";
import { HomeListOptionsProvider } from "../home/home-list-options";
import { ThreadNavigationSidebar } from "../threads/ThreadNavigationSidebar";
import { RenderErrorBoundary, RenderFailureView } from "../../components/RenderErrorBoundary";
import { useWorkspaceThumbActions, WorkspaceThumbNavigation } from "./workspace-thumb-navigation";
import { FoldWorkspaceInspectorPane } from "./fold-workspace-inspector-pane";
import { WorkspaceSidebarColumn } from "./fold-workspace-sidebar-column";
import {
  NativeWorkspaceModeContext,
  NativeWorkspaceInspectorContext,
} from "../../native/v5-workspace-context";
import { useFoldWorkspaceGeometry } from "./fold-workspace-geometry";

interface AdaptiveWorkspaceContextValue {
  readonly tabletopTopHeight: number | null;
  readonly tabletopHingeTop: number | null;
  readonly tabletopHingeHeight: number;
  readonly layout: Layout;
  readonly panes: FoldWorkspacePaneLayout;
  readonly fileInspector: FileInspectorPaneLayout;
  readonly primarySidebarSearchQuery: string;
  readonly selectThread: (thread: EnvironmentThreadShell) => void;
  readonly activateAuxiliaryPaneRole: (role: WorkspaceAuxiliaryPaneRole) => () => void;
  /**
   * Route screens hand their inspector pane content to the workspace so it
   * renders BESIDE the navigator (outside the native stack header) instead of
   * inside the route. Returns a deactivate callback: the pane animates closed
   * (content kept mounted for the exit transition) unless a newer
   * registration already took over — stale deactivates never clobber it.
   * Prefer useRegisterWorkspaceInspector over calling this directly.
   */
  readonly registerWorkspaceInspector: (render: () => ReactNode) => () => void;
  readonly setPrimarySidebarSearchQuery: (query: string) => void;
  readonly showAuxiliaryPane: (role?: WorkspaceAuxiliaryPaneRole) => void;
  readonly hideAuxiliaryPane: () => void;
  readonly toggleAuxiliaryPane: () => void;
  /** Gives the inspector the whole workspace, or returns it beside the chat. */
  readonly setAuxiliaryPaneMaximized: (maximized: boolean) => void;
  readonly toggleAuxiliaryPaneMaximized: () => void;
  readonly togglePrimarySidebar: () => void;
}

const compactLayout = deriveLayout({ width: 0, height: 0 });
const compactPanes = deriveFoldWorkspacePaneLayout({
  layout: compactLayout,
  viewportWidth: 0,
  primarySidebarPreferredVisible: true,
  auxiliaryPanePreferredVisible: true,
});
const compactFileInspector = deriveFileInspectorPaneLayout({
  layout: compactLayout,
  viewportWidth: 0,
});
const AdaptiveWorkspaceContext = createContext<AdaptiveWorkspaceContextValue>({
  tabletopTopHeight: null,
  tabletopHingeTop: null,
  tabletopHingeHeight: 0,
  layout: compactLayout,
  panes: compactPanes,
  fileInspector: compactFileInspector,
  primarySidebarSearchQuery: "",
  selectThread: () => undefined,
  activateAuxiliaryPaneRole: () => () => undefined,
  registerWorkspaceInspector: () => () => undefined,
  setPrimarySidebarSearchQuery: () => undefined,
  showAuxiliaryPane: () => undefined,
  hideAuxiliaryPane: () => undefined,
  toggleAuxiliaryPane: () => undefined,
  setAuxiliaryPaneMaximized: () => undefined,
  toggleAuxiliaryPaneMaximized: () => undefined,
  togglePrimarySidebar: () => undefined,
});

export function useAdaptiveWorkspaceLayout(): AdaptiveWorkspaceContextValue {
  return use(AdaptiveWorkspaceContext);
}

export function useAdaptiveWorkspacePaneRole(role: WorkspaceAuxiliaryPaneRole) {
  const { activateAuxiliaryPaneRole } = useAdaptiveWorkspaceLayout();

  useFocusEffect(
    useCallback(() => activateAuxiliaryPaneRole(role), [activateAuxiliaryPaneRole, role]),
  );
}

// Fold's workspace has one inspector pane whose content each route registers, so upstream's
// auxiliary pane roles are accepted and ignored.
const activateAuxiliaryPaneRole = () => () => undefined;

/**
 * Register this screen's inspector pane content with the workspace column.
 *
 * The column renders BESIDE the navigator — outside any screen — so the
 * registering screen's navigation and route contexts are captured here and
 * re-provided around the portal content. Without them, useNavigation/useRoute
 * inside the pane (e.g. GitOverviewSheet via useThreadSelection) throw
 * "Couldn't find a route object".
 *
 * Registration is FOCUS-scoped, driven by navigation events rather than the
 * screen's own render cycle: react-native-screens freezes blurred screens, so
 * a cleanup that depends on the blurred subtree re-rendering never runs and
 * would leak the pane into the next route. Blur deactivates the pane (it
 * animates closed, or is replaced seamlessly when the next route registers in
 * the same commit); focus re-registers it.
 */
export function useRegisterWorkspaceInspector(render: (() => ReactNode) | undefined) {
  const { registerWorkspaceInspector } = useAdaptiveWorkspaceLayout();
  // Raw context values (not the useNavigation/useRoute wrappers) so the
  // portal re-provides exactly what this screen sees.
  const navigation = use(NavigationContext);
  const route = use(NavigationRouteContext);

  const wrappedRender = useMemo(() => {
    if (render === undefined) {
      return undefined;
    }
    return () => (
      <NavigationContext.Provider value={navigation}>
        <NavigationRouteContext.Provider value={route}>{render()}</NavigationRouteContext.Provider>
      </NavigationContext.Provider>
    );
  }, [navigation, render, route]);

  const wrappedRenderRef = useRef(wrappedRender);
  wrappedRenderRef.current = wrappedRender;
  const focusedRef = useRef(false);
  const deactivateRef = useRef<(() => void) | null>(null);

  const syncRegistration = useCallback(() => {
    if (!focusedRef.current || wrappedRenderRef.current === undefined) {
      deactivateRef.current?.();
      return;
    }
    deactivateRef.current = registerWorkspaceInspector(wrappedRenderRef.current);
  }, [registerWorkspaceInspector]);

  // Focus lifecycle. Blur/focus events fire even when the blurred subtree is
  // frozen (events are navigation-driven, renders are not).
  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      syncRegistration();
      return () => {
        focusedRef.current = false;
        syncRegistration();
      };
    }, [syncRegistration]),
  );

  // Content changes while focused re-register in place.
  useEffect(() => {
    if (focusedRef.current) {
      syncRegistration();
    }
  }, [syncRegistration, wrappedRender]);

  // Unmount: hand the pane back (owner-guarded, so a route that already
  // took over is unaffected).
  useEffect(
    () => () => {
      deactivateRef.current?.();
      deactivateRef.current = null;
    },
    [],
  );
}

export function AdaptiveWorkspaceLayout(props: {
  readonly children: ReactNode;
  readonly pathname: string;
  readonly workspaceRouteKey: string | undefined;
  readonly selectedPullRequestKey?: string | null;
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
  readonly selectedPullRequestKey?: string | null;
  readonly projectGroupingMode: SidebarProjectGroupingMode;
  /** Pane preferences are read once; the workspace owns them while mounted. */
  readonly initialPreferences: Preferences;
}) {
  const projectGroupingMode = props.projectGroupingMode;
  const nativeWorkspace = use(NativeWorkspaceModeContext);
  const pathname = props.pathname;
  const navigation = useNavigation();
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const {
    layout,
    width,
    leadingInset,
    trailingInset,
    foldRegions,
    tabletopTopHeight,
    hingeSnapWidths,
    workspaceView,
    onWorkspaceLayout,
    windowHinge,
  } = useFoldWorkspaceGeometry();

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
  const showPrimarySidebar = pathname === "/" || sidebarPreferredVisible;
  const [inspectorPreferredVisible, setInspectorPreferredVisible] = useState(true);
  const [inspectorMaximized, setInspectorMaximized] = useState(false);
  const inspectorRatios = props.initialPreferences.workspaceInspectorRatios ?? {};
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
  useEffect(() => {
    if (!shouldRestorePrimarySidebar({ usesSplitView: layout.usesSplitView, pathname })) {
      return;
    }
    setPrimarySidebarPreferredVisibleState(true);
    setInspectorPreferredVisible(false);
    setInspectorMaximized(false);
  }, [layout.usesSplitView, pathname]);

  // Wrapped in an object: bare functions in useState would be treated as
  // lazy initializers/updaters.
  const [workspaceInspector, setWorkspaceInspector] = useState<{
    readonly render: () => ReactNode;
  } | null>(null);
  const workspaceInspectorOwner = useRef<symbol | null>(null);
  const registerWorkspaceInspector = useCallback((render: () => ReactNode) => {
    const owner = Symbol("workspace-inspector");
    workspaceInspectorOwner.current = owner;
    setWorkspaceInspector({ render });

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
  }, []);

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
  const panes = useMemo(() => {
    const derived = deriveFoldWorkspacePaneLayout({
      layout: effectiveLayout,
      viewportWidth: width - (foldRegions.vertical?.gap ?? 0),
      primarySidebarPreferredVisible:
        showPrimarySidebar &&
        tabletopTopHeight === null &&
        !(foldRegions.vertical && inspectorPreferredVisible && workspaceInspector !== null),
      auxiliaryPanePreferredVisible: inspectorPreferredVisible,
      auxiliaryPaneRegistered: workspaceInspector !== null,
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
    inspectorPreferredVisible,
    inspectorRestingWidth,
    effectiveLayout,
    foldRegions.vertical,
    tabletopTopHeight,
    showPrimarySidebar,
    width,
    workspaceInspector,
  ]);
  const fileInspector = useMemo<FileInspectorPaneLayout>(
    () => ({ supported: panes.supportsAuxiliaryPane, width: panes.auxiliaryPaneWidth }),
    [panes.auxiliaryPaneWidth, panes.supportsAuxiliaryPane],
  );
  const activeThread = useMemo(() => parseActiveThreadPath(pathname), [pathname]);
  const environmentId = activeThread?.environmentId ?? null;
  const threadId = activeThread?.threadId ?? null;
  const selectedThreadKey = useMemo(() => {
    if (environmentId === null || threadId === null) {
      return null;
    }
    try {
      return scopedThreadKey(EnvironmentId.make(environmentId), ThreadId.make(threadId));
    } catch {
      return null;
    }
  }, [environmentId, threadId]);

  const togglePrimarySidebar = useCallback(() => {
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
    if (pathname === "/") {
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
    setSidebarPreferredVisible(!sidebarPreferredVisible);
  }, [
    tabletopTopHeight,
    foldRegions.vertical,
    panes.auxiliaryPaneVisible,
    navigation,
    panes.auxiliaryPaneMaximized,
    panes.primarySidebarSuppressedByAuxiliary,
    panes.primarySidebarVisible,
    pathname,
    setSidebarPreferredVisible,
    sidebarPreferredVisible,
  ]);
  const revealPrimarySidebar = useCallback(() => {
    setInspectorMaximized(false);
    if (panes.primarySidebarSuppressedByAuxiliary) {
      setInspectorPreferredVisible(false);
    }
    setSidebarPreferredVisible(true);
  }, [panes.primarySidebarSuppressedByAuxiliary, setSidebarPreferredVisible]);
  const handleToggleSidebarCommand = useCallback(() => {
    togglePrimarySidebar();
    return true;
  }, [togglePrimarySidebar]);
  const sidebarCommands = useMemo(
    () => (pathname === "/" ? [] : (["toggleSidebar"] as const)),
    [pathname],
  );
  useHardwareKeyboardCommand(sidebarCommands, handleToggleSidebarCommand);
  const showAuxiliaryPane = useCallback(() => setInspectorPreferredVisible(true), []);
  const hideAuxiliaryPane = useCallback(() => {
    setInspectorPreferredVisible(false);
    setInspectorMaximized(false);
  }, []);
  const toggleAuxiliaryPane = useCallback(() => {
    if (panes.auxiliaryPaneVisible) hideAuxiliaryPane();
    else showAuxiliaryPane();
  }, [hideAuxiliaryPane, panes.auxiliaryPaneVisible, showAuxiliaryPane]);
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
  const handleOpenFilesCommand = useCallback(() => {
    const activeThread = parseActiveThreadPath(pathname);
    if (!panes.supportsAuxiliaryPane || activeThread === null) {
      return false;
    }
    showAuxiliaryPane();
    if (/\/files(?:\/|$)/.test(pathname)) {
      return true;
    }
    navigation.navigate("ThreadFiles", activeThread);
    return true;
  }, [panes.supportsAuxiliaryPane, pathname, navigation, showAuxiliaryPane]);
  useHardwareKeyboardCommand("files", handleOpenFilesCommand);
  useWorkspaceVimNavigation({
    usesSplitView: layout.usesSplitView,
    panes,
    togglePrimarySidebar,
    toggleAuxiliaryPaneMaximized,
  });
  const handleOpenSettings = useCallback(() => {
    navigation.navigate("SettingsSheet", {
      screen: "SettingsContent",
      params: { screen: "Settings" },
    });
  }, [navigation]);

  const workspaceTabs = useWorkspaceTabs();
  const handleOpenPullRequests = useCallback(() => {
    if (workspaceTabs) workspaceTabs.dispatch({ type: "select", tab: "pullRequests" });
    else navigation.navigate("PullRequests");
  }, [navigation, workspaceTabs]);

  const handleStartNewTask = useCallback(() => {
    navigation.navigate("NewTaskSheet", { screen: "NewTask" });
  }, [navigation]);

  // Minted here (root stack navigation) so the sidebar pane stays free of
  // navigation hooks — on iOS it renders inside an independent nav tree.
  const handleOpenEnvironmentSettings = useCallback(() => {
    navigation.navigate("SettingsSheet", {
      screen: "SettingsContent",
      params: { screen: "SettingsEnvironments" },
    });
  }, [navigation]);

  const handleNewThreadOnBranch = useCallback(
    (thread: EnvironmentThreadShell) => {
      navigation.navigate("NewTaskSheet", {
        screen: "NewTaskDraft",
        params: {
          environmentId: String(thread.environmentId),
          projectId: String(thread.projectId),
          branch: thread.branch,
          worktreePath: thread.worktreePath,
        },
      });
    },
    [navigation],
  );

  const handleNewThreadInProject = useCallback(
    (project: EnvironmentProject) => {
      navigation.navigate("NewTaskSheet", {
        screen: "NewTaskDraft",
        params: {
          environmentId: String(project.environmentId),
          projectId: String(project.id),
          title: project.title,
        },
      });
    },
    [navigation],
  );

  const selectAndroidWorkspace = useAndroidWorkspaceSelection();
  const handleSelectThread = useCallback(
    (thread: EnvironmentThreadShell) => {
      const params = {
        environmentId: String(thread.environmentId),
        threadId: String(thread.id),
      };
      if (Platform.OS === "android") {
        // Selecting a sidebar row enters its base chat, including from that chat's nested screens.
        // Re-selecting the open thread keeps Fold's inspector pane beside it.
        if (scopedThreadKey(thread.environmentId, thread.id) !== selectedThreadKey) {
          hideAuxiliaryPane();
        }
        selectAndroidWorkspace({ name: "Thread", params });
        return;
      }
      const navigationAction = resolveThreadSelectionNavigationAction({
        usesSplitView: layout.usesSplitView,
        pathname,
      });
      const overlayState = resolveThreadSelectionOverlayState({
        state: navigation.getState(),
        workspaceRouteKey: props.workspaceRouteKey,
        action: navigationAction,
        params,
      });
      if (overlayState !== null) {
        hideAuxiliaryPane();
        navigation.dispatch(CommonActions.reset(overlayState));
        return;
      }
      if (navigationAction === "set-params") {
        const nextThreadKey = scopedThreadKey(thread.environmentId, thread.id);
        if (nextThreadKey === selectedThreadKey) {
          return;
        }
        hideAuxiliaryPane();
        navigation.navigate("Thread", params);
        return;
      }
      if (navigationAction === "replace") {
        hideAuxiliaryPane();
        navigation.dispatch(StackActions.replace("Thread", params));
        return;
      }
      navigation.navigate("Thread", params);
    },
    [
      hideAuxiliaryPane,
      layout.usesSplitView,
      pathname,
      navigation,
      selectedThreadKey,
      props.workspaceRouteKey,
      selectAndroidWorkspace,
    ],
  );

  const handleThumbAction = useWorkspaceThumbActions({
    activeThread,
    usesSplitView: layout.usesSplitView,
    supportsAuxiliaryPane: panes.supportsAuxiliaryPane,
    togglePrimarySidebar,
    toggleAuxiliaryPane,
    hideAuxiliaryPane,
  });

  const contextValue = useMemo(
    () => ({
      tabletopTopHeight,
      tabletopHingeTop: foldRegions.tabletop?.top ?? null,
      tabletopHingeHeight: foldRegions.tabletop?.gap ?? 0,
      layout,
      panes,
      fileInspector,
      primarySidebarSearchQuery,
      selectThread: handleSelectThread,
      activateAuxiliaryPaneRole,
      registerWorkspaceInspector,
      setPrimarySidebarSearchQuery,
      showAuxiliaryPane,
      hideAuxiliaryPane,
      toggleAuxiliaryPane,
      setAuxiliaryPaneMaximized,
      toggleAuxiliaryPaneMaximized,
      togglePrimarySidebar,
    }),
    [
      tabletopTopHeight,
      foldRegions.tabletop?.top,
      foldRegions.tabletop?.gap,
      fileInspector,
      handleSelectThread,
      hideAuxiliaryPane,
      layout,
      panes,
      primarySidebarSearchQuery,
      registerWorkspaceInspector,
      setAuxiliaryPaneMaximized,
      showAuxiliaryPane,
      toggleAuxiliaryPane,
      toggleAuxiliaryPaneMaximized,
      togglePrimarySidebar,
    ],
  );

  // A fold or Duo division separates the sidebar from the chat.
  const sidebarGap = foldRegions.vertical?.gap ?? effectiveLayout.listPaneGap ?? 0;

  if (nativeWorkspace) {
    return (
      <HomeListOptionsProvider
        projectGroupingMode={projectGroupingMode}
        savedFilters={props.initialPreferences.threadListFilters}
      >
        <AdaptiveWorkspaceContext value={contextValue}>
          <NativeWorkspaceInspectorContext
            value={{ render: workspaceInspector?.render, visible: panes.auxiliaryPaneVisible }}
          >
            {props.children}
          </NativeWorkspaceInspectorContext>
        </AdaptiveWorkspaceContext>
      </HomeListOptionsProvider>
    );
  }
  return (
    <HomeListOptionsProvider
      projectGroupingMode={projectGroupingMode}
      savedFilters={props.initialPreferences.threadListFilters}
    >
      <AdaptiveWorkspaceContext.Provider value={contextValue}>
        <WindowHingeContext value={windowHinge}>
          <View
            ref={workspaceView}
            onLayout={onWorkspaceLayout}
            testID="adaptive-workspace-layout"
            className={Platform.OS === "android" ? "flex-1 flex-row bg-header" : "flex-1 flex-row"}
            style={{ paddingLeft: leadingInset, paddingRight: trailingInset }}
          >
            <WorkspaceSidebarColumn layout={effectiveLayout} visible={panes.primarySidebarVisible}>
              {(listPaneWidth) => (
                <RenderErrorBoundary
                  renderFallback={(fallback) => (
                    <RenderFailureView
                      {...fallback}
                      title="The sidebar couldn't be displayed"
                      exit={{ label: "Open settings", onPress: handleOpenSettings }}
                    />
                  )}
                >
                  <AndroidWorkspaceSidebar
                    onRequestVisibility={revealPrimarySidebar}
                    selectedPullRequestKey={props.selectedPullRequestKey ?? null}
                  >
                    <AndroidHomeFabLayout sidebar onStartNewTask={handleStartNewTask}>
                      <ThreadNavigationSidebar
                        width={listPaneWidth}
                        visible={panes.primarySidebarVisible}
                        onRequestVisibility={revealPrimarySidebar}
                        selectedThreadKey={selectedThreadKey}
                        onOpenSettings={handleOpenSettings}
                        onOpenEnvironmentSettings={handleOpenEnvironmentSettings}
                        onOpenPullRequests={handleOpenPullRequests}
                        onNewThreadInProject={handleNewThreadInProject}
                        onNewThreadOnBranch={handleNewThreadOnBranch}
                        onSelectThread={handleSelectThread}
                        onSearchQueryChange={setPrimarySidebarSearchQuery}
                        searchQuery={primarySidebarSearchQuery}
                      />
                    </AndroidHomeFabLayout>
                  </AndroidWorkspaceSidebar>
                </RenderErrorBoundary>
              )}
            </WorkspaceSidebarColumn>
            {sidebarGap > 0 && panes.primarySidebarVisible ? (
              <View style={{ width: sidebarGap }} />
            ) : null}
            <View
              className={
                Platform.OS === "android"
                  ? "overflow-hidden bg-header"
                  : "overflow-hidden bg-screen"
              }
              collapsable={false}
              accessibilityElementsHidden={panes.auxiliaryPaneMaximized}
              importantForAccessibility={
                panes.auxiliaryPaneMaximized ? "no-hide-descendants" : "auto"
              }
              // A maximized inspector collapses the chat without unmounting it.
              style={
                panes.auxiliaryPaneMaximized
                  ? { width: 0 }
                  : foldRegions.vertical &&
                      !panes.primarySidebarVisible &&
                      !panes.auxiliaryPaneVisible
                    ? { width: foldRegions.vertical.leadingWidth }
                    : { flex: 1 }
              }
            >
              {props.children}
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
              renderInspector={workspaceInspector?.render}
              snapWidths={hingeSnapWidths}
              onDividerRelease={handleDividerRelease}
              onToggleMaximized={toggleAuxiliaryPaneMaximized}
            />
          </View>
        </WindowHingeContext>
      </AdaptiveWorkspaceContext.Provider>
    </HomeListOptionsProvider>
  );
}
