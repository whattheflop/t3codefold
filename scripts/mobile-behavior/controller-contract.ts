export interface ControllerCapture {
  route: { name: string | null; columns: boolean } | null;
  feed: { scroll?: number; atEnd?: boolean } | null;
  keyboard: boolean;
  controller: {
    enabled: boolean;
    scopeId: string | null;
    suspended: boolean;
    editing: boolean;
    inspecting: boolean;
    position: { regionId: string; targetId: string | null } | null;
    scene: {
      regions: readonly {
        id: string;
        kind: string;
        surfaceId: string;
        pane?: string;
        canScrollUp: boolean;
        canScrollDown: boolean;
      }[];
      editorFocused: boolean;
      targets: readonly { id: string; regionId: string; kind: string; label?: string }[];
    };
  };
}

export function controllerFacts(value: ControllerCapture) {
  const controller = value.controller;
  const region = controller.scene.regions.find(
    (entry) => entry.id === controller.position?.regionId,
  );
  const target = controller.scene.targets.find(
    (entry) => entry.id === controller.position?.targetId,
  );
  const suffix = controller.scopeId?.slice(controller.scopeId.indexOf(":") + 1) ?? "";
  const scope =
    suffix === "palette"
      ? "palette"
      : suffix === "controller-help"
        ? "guide"
        : suffix.startsWith("/")
          ? "workspace"
          : "overlay";
  const voice = controller.scene.targets.some((entry) => entry.label === "Cancel dictation");
  const mode = !controller.enabled
    ? "disabled"
    : controller.suspended
      ? "suspended"
      : voice
        ? "voice-ui"
        : controller.editing
          ? "editing"
          : controller.inspecting
            ? "inspection"
            : region?.kind === "conversation"
              ? "reading"
              : "navigation";
  return {
    page: value.route?.name ?? "unknown",
    layout: value.route?.columns ? "split" : "compact",
    scope,
    mode,
    region: region?.kind ?? null,
    pane: region?.pane ?? null,
    targetKind: target?.kind ?? null,
    target: target?.id ?? null,
    surface: region?.surfaceId ?? null,
    nativeEditorFocused: controller.scene.editorFocused,
    path: suffix.startsWith("/") ? suffix : "",
    ready: controller.scene.targets.length > 0,
    keyboard: value.keyboard,
    scrollOffset: value.feed?.scroll ?? null,
  };
}

export interface ControllerExpectation {
  page?: string;
  layout?: string;
  scope?: string;
  mode?: string;
  region?: string;
  pane?: string;
  targetKind?: string;
  keyboard?: boolean;
  ready?: boolean;
  path?: string;
  changed?: "selection" | "scroll";
  restoreFromStep?: number;
  ordered?: "next";
  sameSurface?: boolean;
  nativeEditorFocused?: boolean;
}

export function controllerFailures(
  value: ControllerCapture,
  before: ControllerCapture,
  expected: ControllerExpectation,
) {
  const facts = controllerFacts(value);
  const prior = controllerFacts(before);
  const failures: string[] = [];
  for (const key of [
    "page",
    "layout",
    "scope",
    "mode",
    "region",
    "pane",
    "targetKind",
    "keyboard",
    "ready",
    "nativeEditorFocused",
  ] as const) {
    if (expected[key] !== undefined && facts[key] !== expected[key])
      failures.push(`${key}: wanted ${String(expected[key])}, observed ${String(facts[key])}`);
  }
  if (expected.path !== undefined && facts.path !== expected.path)
    failures.push("Owning route scope has not reached the requested page.");
  if (expected.changed === "selection" && facts.target === prior.target)
    failures.push("Selection did not move.");
  if (expected.changed === "scroll" && facts.scrollOffset === prior.scrollOffset)
    failures.push("Conversation did not scroll.");
  if (
    expected.restoreFromStep !== undefined &&
    (value.controller.scopeId !== before.controller.scopeId ||
      JSON.stringify(value.controller.position) !== JSON.stringify(before.controller.position))
  )
    failures.push("Invoking scope/selection was not restored.");
  if (expected.sameSurface && facts.surface !== prior.surface)
    failures.push("Text destination changed surfaces.");
  if (expected.ordered === "next") {
    const targets = before.controller.scene.targets.filter(
      (target) => target.regionId === before.controller.position?.regionId,
    );
    const index = targets.findIndex((target) => target.id === prior.target);
    const next = targets[index + 1];
    if (!next || facts.target !== next.id)
      failures.push("Did not select the next declared control.");
  }
  return failures;
}

export interface ControllerJourney {
  id: string;
  path: string;
  page: string;
  maxPresses: number;
  steps: readonly { input: string; expect: ControllerExpectation }[];
}

// These edges come from user tasks, independently of the engine's implementation.
export const controllerStateContract = [
  { from: "reading", input: "RT", to: "reply", limit: 1 },
  { from: "reading", input: "X", to: "voice-ui", limit: 1 },
  { from: "reading", input: "A", to: "inspection", limit: 1 },
  { from: "inspection", input: "B", to: "reading", limit: 1 },
  { from: "reply", input: "A", to: "editing", limit: 1 },
  { from: "editing", input: "B", to: "reply", limit: 1 },
  { from: "voice-ui", input: "B", to: "reply", limit: 1 },
  { from: "reply", input: "LT", to: "reading", limit: 1 },
  { from: "workspace", input: "START", to: "palette", limit: 1 },
  { from: "palette", input: "VIEW", to: "guide", limit: 1 },
  { from: "guide", input: "B", to: "invoking scope", limit: 1 },
] as const;

export function controllerJourneys(threadPath?: string): ControllerJourney[] {
  const pages = [
    ["Home", "/"],
    ["SettingsAppearance", "/settings/appearance"],
    ["SettingsVoice", "/settings/voice"],
    ["SettingsEnvironments", "/settings/environments"],
    ["SettingsNavigation", "/settings/navigation-tabs"],
    ["SettingsAbout", "/settings/about"],
    ["NewTaskProject", "/new"],
    ["AddProject", "/new/add-project"],
  ] as const;
  const journeys: ControllerJourney[] = pages.map(([page, path]) => ({
    id: `${page}:guide-return`,
    path,
    page,
    maxPresses: 2,
    steps: [
      { input: "select", expect: { page, scope: "guide" } },
      { input: "b", expect: { page, scope: "workspace", ready: true, restoreFromStep: 0 } },
    ],
  }));
  journeys.push({
    id: "SettingsAppearance:ordered-controls",
    path: "/settings/appearance",
    page: "SettingsAppearance",
    maxPresses: 3,
    steps: [
      { input: "down", expect: { changed: "selection", ordered: "next" } },
      { input: "down", expect: { changed: "selection", ordered: "next" } },
      { input: "up", expect: { restoreFromStep: 1 } },
    ],
  });
  if (threadPath)
    journeys.push(
      {
        id: "thread:reply-edit-back",
        path: threadPath,
        page: "Thread",
        maxPresses: 4,
        steps: [
          { input: "r2", expect: { region: "composer", targetKind: "reply" } },
          { input: "a", expect: { mode: "editing", nativeEditorFocused: true, sameSurface: true } },
          {
            input: "b",
            expect: {
              mode: "navigation",
              region: "composer",
              targetKind: "reply",
              sameSurface: true,
              nativeEditorFocused: false,
              keyboard: false,
            },
          },
          { input: "l2", expect: { mode: "reading" } },
        ],
      },
      {
        id: "thread:direct-dictate",
        path: threadPath,
        page: "Thread",
        maxPresses: 3,
        steps: [
          { input: "l2", expect: { mode: "reading" } },
          { input: "x", expect: { mode: "voice-ui" } },
          {
            input: "b",
            expect: {
              mode: "navigation",
              region: "composer",
              targetKind: "reply",
              sameSurface: true,
              nativeEditorFocused: false,
              keyboard: false,
            },
          },
        ],
      },
      {
        id: "thread:dictate-cancel",
        path: threadPath,
        page: "Thread",
        maxPresses: 3,
        steps: [
          { input: "r2", expect: { targetKind: "reply" } },
          { input: "x", expect: { mode: "voice-ui" } },
          {
            input: "b",
            expect: {
              mode: "navigation",
              region: "composer",
              targetKind: "reply",
              sameSurface: true,
              nativeEditorFocused: false,
              keyboard: false,
            },
          },
        ],
      },
      {
        id: "thread:inline-back",
        path: threadPath,
        page: "Thread",
        maxPresses: 3,
        steps: [
          { input: "l2", expect: { mode: "reading" } },
          { input: "a", expect: { mode: "inspection" } },
          { input: "b", expect: { mode: "reading" } },
        ],
      },
      {
        id: "thread:palette-guide",
        path: threadPath,
        page: "Thread",
        maxPresses: 3,
        steps: [
          {
            input: "start",
            expect: { scope: "palette", mode: "editing", nativeEditorFocused: true },
          },
          { input: "select", expect: { scope: "guide" } },
          { input: "b", expect: { scope: "palette", restoreFromStep: 1 } },
        ],
      },
    );
  return journeys;
}
