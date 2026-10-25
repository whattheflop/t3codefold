import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AdaptiveWorkspaceContext } from "./adaptive-workspace-context";
import { createDeferredNavigation } from "./deferred-navigation";
import { uuidv4 } from "../../lib/uuid";
import { appAtomRegistry } from "../../state/atom-registry";
import { useProjects } from "../../state/entities";
import { environmentThreadShells } from "../../state/threads";
import {
  selectWorkspaceDetail,
  type WorkspaceDetail,
  type WorkspaceDetailSheet,
} from "../workspace/workspace-detail-selection";
import { startOpeningDetail } from "../workspace/useSelectWorkspaceDetail";
import { newTaskDestination } from "../threads/new-task-project-selection";
import { useAndroidWorkspaceRoot } from "../workspace/AndroidWorkspaceTabsProvider";
import {
  AndroidWorkspaceNavigation,
  WorkspaceTabSwitcher,
} from "../workspace/AndroidWorkspaceNavigation";
import { openSettings } from "../settings/settings-navigation";
import { dispatchRootStackReset, rootStackState } from "../../lib/root-stack-reset";
import {
  currentWorkspaceSelections,
  workspaceSelectionCheck,
} from "../workspace/workspace-selection-store";
import { workspaceTabNavigationState } from "../workspace/workspace-tab-navigation";
import type { WorkspaceTab } from "../workspace/workspace-tabs-state";
import { workspaceRoutesOf } from "./workspace-overlay-routes";
import { WindowHingeContext } from "../../native/window-hinge-context";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ThreadId, type SidebarProjectGroupingMode } from "@t3tools/contracts";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import {
  use,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Keyboard, Platform, View } from "react-native";
import { KeyboardController, useKeyboardState } from "react-native-keyboard-controller";
import { AsyncResult } from "effect/reactivity";

import { type FileInspectorPaneLayout } from "../../lib/layout";
import {
  deriveFoldWorkspacePaneLayout,
  type PaneDividerRelease,
} from "../../lib/foldable-pane-layout";
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
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";
import { HomeListOptionsProvider } from "../home/home-list-options";
import { usePendingTaskListActions } from "../home/usePendingTaskListActions";
import { ThreadNavigationSidebar } from "../threads/ThreadNavigationSidebar";
import { useOpenThreadPullRequests } from "../threads/use-open-thread-pull-requests";
import { RenderErrorBoundary, RenderFailureView } from "../../components/RenderErrorBoundary";
import { useWorkspaceThumbActions, WorkspaceThumbNavigation } from "./workspace-thumb-navigation";
import { FoldWorkspaceInspectorPane } from "./fold-workspace-inspector-pane";
import { WorkspaceSidebarColumn } from "./fold-workspace-sidebar-column";
import {
  NativeWorkspaceModeContext,
  NativeWorkspaceInspectorContext,
} from "../../native/v5-workspace-context";
import { useFoldWorkspaceGeometry } from "./fold-workspace-geometry";

const activateAuxiliaryPaneRole = () => () => undefined;

export function FoldAdaptiveWorkspaceLayout(props: {
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
  const safeAreaInsets = useSafeAreaInsets();
  const nativeWorkspace = use(NativeWorkspaceModeContext);
  const pathname = props.pathname;
  // Android's Settings tab takes the full workspace, hiding the sidebar and auxiliary panes.
  const workspace = useWorkspaceTabs();
  const androidSettingsOpen = useAndroidWorkspaceRoot()?.settingsOpen ?? false;
  const workspacePage = androidSettingsOpen || workspace?.state.selectedTab === "usage";
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
  const [composerEditing, setComposerEditing] = useState(false);
  const softKeyboardVisible = useKeyboardState((state) => state.isVisible);
  // Hardware keyboard focus leaves room for the sidebar; Android Back hides the soft keyboard
  // without blurring the editor. Keep the saved sidebar choice through both transitions.
  const composerKeyboardActive = useDeferredValue(
    Platform.OS === "android" && layout.usesSplitView && composerEditing && softKeyboardVisible,
  );
  const showPrimarySidebar =
    !workspacePage && (pathname === "/" || (sidebarPreferredVisible && !composerKeyboardActive));
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
      auxiliaryPanePreferredVisible: !workspacePage && inspectorPreferredVisible,
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
    workspacePage,
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
    if (composerKeyboardActive) {
      void KeyboardController.dismiss();
      if (sidebarPreferredVisible) return;
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
    composerKeyboardActive,
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
    if (composerKeyboardActive) void KeyboardController.dismiss();
    setInspectorMaximized(false);
    if (panes.primarySidebarSuppressedByAuxiliary) {
      setInspectorPreferredVisible(false);
    }
    setSidebarPreferredVisible(true);
  }, [
    composerKeyboardActive,
    panes.primarySidebarSuppressedByAuxiliary,
    setSidebarPreferredVisible,
  ]);
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
  const openWorkspaceTab = useCallback(
    (tab: WorkspaceTab | "settings", options?: { readonly columns?: boolean }) => {
      const state = rootStackState(navigation);
      if (!state) return;
      const { workspace, overlays } = workspaceRoutesOf(state.routes.slice(0, state.index + 1));
      const next = workspaceTabNavigationState(
        { ...state, routes: workspace },
        tab,
        currentWorkspaceSelections(),
        {
          columns: Platform.OS === "ios" && (options?.columns ?? layout.usesSplitView),
          check: workspaceSelectionCheck,
          overlays,
        },
      );
      dispatchRootStackReset(navigation, state, next);
    },
    [layout.usesSplitView, navigation],
  );
  const handleOpenSettings = () => openWorkspaceTab("settings");

  const deferredThreadSelection = useMemo(() => createDeferredNavigation(), []);
  /** The one way to show a page in the detail column; see `selectWorkspaceDetail`. */
  const handleSelectDetail = useCallback(
    (detail: WorkspaceDetail, sheet?: WorkspaceDetailSheet) => {
      deferredThreadSelection.run(() => {
        if (Platform.OS === "android") Keyboard.dismiss();
        if (
          detail.name !== "Thread" ||
          detail.params.threadId !== threadId ||
          detail.params.environmentId !== environmentId
        ) {
          hideAuxiliaryPane();
        }
        if (layout.primarySidebarOverlaysContent) setSidebarPreferredVisible(false);
        workspace?.dispatch({
          type: "select",
          tab: detail.name === "Thread" ? "threads" : "pullRequests",
        });
        startOpeningDetail(detail);
        navigation.dispatch(selectWorkspaceDetail(detail, sheet));
      });
    },
    [
      deferredThreadSelection,
      environmentId,
      hideAuxiliaryPane,
      layout.primarySidebarOverlaysContent,
      navigation,
      setSidebarPreferredVisible,
      threadId,
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
    const thread = appAtomRegistry
      .get(environmentThreadShells.navigationThreadShellsAtom)
      .find(
        (candidate) =>
          candidate.environmentId === first(params?.environmentId) &&
          candidate.id === first(params?.threadId),
      );
    const draft = params?.draft;
    const draftEnvironmentId = first(draft?.environmentId);
    const draftProjectId = first(draft?.projectId);
    const currentProject = thread
      ? { environmentId: thread.environmentId, id: thread.projectId }
      : projects.find(
          (project) =>
            project.environmentId === draftEnvironmentId && project.id === draftProjectId,
        );
    handleSelectThreadRoute(
      newTaskDestination(layout.usesSplitView, projects, currentProject, uuidv4()),
    );
  }, [handleSelectThreadRoute, layout.usesSplitView, navigation, projects]);

  useHardwareKeyboardCommand("newTask", () => {
    handleStartNewTask();
    return true;
  });

  // Create at root: the iOS sidebar renders in an independent navigation tree.
  const handleOpenEnvironmentSettings = () => {
    openSettings(navigation, "SettingsEnvironments");
  };

  const handleOpenThreadPullRequests = useOpenThreadPullRequests();
  const { openPendingTask: handleOpenPendingTask } =
    usePendingTaskListActions(handleSelectThreadRoute);

  const handleNewThreadOnBranch = (thread: EnvironmentThreadShell) => {
    handleSelectThreadRoute({
      draft: {
        requestId: uuidv4(),
        environmentId: String(thread.environmentId),
        projectId: String(thread.projectId),
        branch: thread.branch,
        worktreePath: thread.worktreePath,
      },
    });
  };

  const handleNewThreadInProject = (project: EnvironmentProject) => {
    handleSelectThreadRoute({
      draft: {
        requestId: uuidv4(),
        environmentId: String(project.environmentId),
        projectId: String(project.id),
        title: project.title,
      },
    });
  };

  const handleSelectThread = useCallback(
    (thread: EnvironmentThreadShell) =>
      handleSelectThreadRoute({
        environmentId: String(thread.environmentId),
        threadId: String(thread.id),
      }),
    [handleSelectThreadRoute],
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
      startNewTask: handleStartNewTask,
      deferThreadSelectionUntil: deferredThreadSelection.waitFor,
      selectDetail: handleSelectDetail,
      setPrimarySidebarVisible: setSidebarPreferredVisible,
      openWorkspaceTab,
      setAuxiliaryPaneWidth: (width: number) => handleDividerRelease({ kind: "resize", width }),
      activateAuxiliaryPaneRole,
      registerWorkspaceInspector,
      setPrimarySidebarSearchQuery,
      showAuxiliaryPane,
      hideAuxiliaryPane,
      toggleAuxiliaryPane,
      setAuxiliaryPaneMaximized,
      toggleAuxiliaryPaneMaximized,
      togglePrimarySidebar,
      composerKeyboardActive,
      setComposerEditing,
    }),
    [
      composerKeyboardActive,
      tabletopTopHeight,
      foldRegions.tabletop?.top,
      foldRegions.tabletop?.gap,
      fileInspector,
      handleSelectThread,
      handleStartNewTask,
      deferredThreadSelection.waitFor,
      handleSelectDetail,
      setSidebarPreferredVisible,
      openWorkspaceTab,
      handleDividerRelease,
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
                  <AndroidHomeFabLayout sidebar onStartNewTask={handleStartNewTask}>
                    <AndroidWorkspaceSidebar
                      onRequestVisibility={revealPrimarySidebar}
                      selectedPullRequestKey={props.selectedPullRequestKey ?? null}
                    >
                      <ThreadNavigationSidebar
                        width={listPaneWidth}
                        visible={panes.primarySidebarVisible}
                        onRequestVisibility={revealPrimarySidebar}
                        selectedThreadKey={selectedThreadKey}
                        onOpenSettings={handleOpenSettings}
                        onOpenEnvironmentSettings={handleOpenEnvironmentSettings}
                        onOpenThreadPullRequests={handleOpenThreadPullRequests}
                        onNewThreadInProject={handleNewThreadInProject}
                        onNewThreadOnBranch={handleNewThreadOnBranch}
                        onOpenPendingTask={handleOpenPendingTask}
                        onSelectThread={handleSelectThread}
                        onSearchQueryChange={setPrimarySidebarSearchQuery}
                        searchQuery={primarySidebarSearchQuery}
                      />
                    </AndroidWorkspaceSidebar>
                  </AndroidHomeFabLayout>
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
                  : !workspacePage &&
                      foldRegions.vertical &&
                      !panes.primarySidebarVisible &&
                      !panes.auxiliaryPaneVisible
                    ? { width: foldRegions.vertical.leadingWidth }
                    : { flex: 1 }
              }
            >
              {workspacePage && layout.usesSplitView ? (
                <View style={{ paddingTop: safeAreaInsets.top }}>
                  <WorkspaceTabSwitcher className="px-4 py-2" />
                </View>
              ) : null}
              {props.children}
              {compactAndroidSettings ? (
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
