export interface GraphState {
  page: string;
  layout: "compact" | "split";
  scope: string;
  region: string | null;
  pane: string | null;
  target: string | null;
  mode: string;
  scroll: string;
  surface: string | null;
  controls: readonly string[];
}

export interface GraphStep {
  input: string;
  from: GraphState;
  to: GraphState;
  pass: boolean;
  error?: string;
  durationMs?: number;
}

export interface GraphCase {
  id: string;
  maxPresses: number;
  steps: readonly GraphStep[];
  error?: string;
}

export interface GraphRoute {
  name: string;
  developmentOnly?: boolean;
}

const primaryButtons = [
  "A",
  "B",
  "X",
  "Y",
  "LB",
  "RB",
  "LT",
  "RT",
  "UP",
  "DOWN",
  "LEFT",
  "RIGHT",
  "START",
  "VIEW",
];
const layouts = ["compact", "split"] as const;

const stateKey = (state: GraphState) =>
  JSON.stringify([
    state.page,
    state.layout,
    state.scope,
    state.region,
    state.pane,
    state.target,
    state.mode,
    state.scroll,
    state.surface,
  ]);

export function buildControllerGraph(routes: readonly GraphRoute[], cases: readonly GraphCase[]) {
  const states = new Map<string, { id: string; state: GraphState }>();
  const nodeFor = (state: GraphState) => {
    const key = stateKey(state);
    const existing = states.get(key);
    if (existing) {
      existing.state.controls = [...new Set([...existing.state.controls, ...state.controls])];
      return existing.id;
    }
    const id = `n${states.size}`;
    states.set(key, { id, state: { ...state, controls: [...new Set(state.controls)] } });
    return id;
  };
  const edges = cases.flatMap((testCase) =>
    testCase.steps.map((step) => ({
      from: nodeFor(step.from),
      to: nodeFor(step.to),
      input: step.input,
      pass: step.pass,
      caseId: testCase.id,
    })),
  );
  const nodes = [...states.values()];
  const caseResults = cases.map((testCase) => {
    const presses = testCase.steps.length;
    const failedExpectations = testCase.steps.filter((step) => !step.pass).length;
    const overBudget = presses > testCase.maxPresses;
    const status =
      failedExpectations > 0 || overBudget
        ? "failed"
        : presses === 0 ||
            testCase.error !== undefined ||
            testCase.steps.some((step) => step.error !== undefined)
          ? "blocked"
          : "passed";
    return {
      id: testCase.id,
      status,
      presses,
      maxPresses: testCase.maxPresses,
      overBudget,
      failedExpectations,
      errors: [
        ...(testCase.error === undefined ? [] : [testCase.error]),
        ...testCase.steps.flatMap((step) => (step.error === undefined ? [] : [step.error])),
      ],
    };
  });
  const expectedRoutes = [
    ...new Set(routes.filter((route) => !route.developmentOnly).map((r) => r.name)),
  ]
    .flatMap((page) => layouts.map((layout) => ({ page, layout })))
    .map((entry) => ({
      ...entry,
      visited: nodes.some(
        ({ state }) => state.page === entry.page && state.layout === entry.layout,
      ),
    }));
  const exercised = primaryButtons.filter((button) =>
    edges.some((e) => e.input === button && e.pass),
  );
  const controls = new Map<string, { control: string; selected: boolean }>();
  for (const { state } of nodes) {
    for (const control of state.controls) {
      const key = JSON.stringify([state.page, state.layout, state.scope, control]);
      const previous = controls.get(key);
      controls.set(key, {
        control,
        selected: previous?.selected === true || state.target === control,
      });
    }
  }
  const discovered = [...controls.values()];
  const backEdges = edges.filter((edge) => edge.input === "B");
  const successfulBack = backEdges.filter((edge) => edge.pass);
  const starts = new Set(
    cases.flatMap((testCase) => {
      const first = testCase.steps[0];
      return first ? [states.get(stateKey(first.from))!.id] : [];
    }),
  );
  const predecessors = new Map<string, string[]>();
  for (const edge of successfulBack) {
    const entries = predecessors.get(edge.to) ?? [];
    entries.push(edge.from);
    predecessors.set(edge.to, entries);
  }
  const reachesStart = new Set(starts);
  const pending = [...starts];
  for (let index = 0; index < pending.length; index++) {
    for (const predecessor of predecessors.get(pending[index]!) ?? []) {
      if (reachesStart.has(predecessor)) continue;
      reachesStart.add(predecessor);
      pending.push(predecessor);
    }
  }
  const backNodes = nodes.map(({ id }) => {
    const exits = successfulBack.filter((edge) => edge.from === id && edge.to !== id);
    const failed = backEdges.filter((edge) => edge.from === id && !edge.pass).length;
    return {
      nodeId: id,
      status: failed > 0 ? "FAILED" : exits.length > 0 ? "OBSERVED" : "UNKNOWN",
      successfulExits: exits.length,
      failedAttempts: failed,
      // A case start is an observed anchor, not a declaration that it is an app root.
      reachesCaseStart: exits.some((edge) => reachesStart.has(edge.to)) ? true : null,
    };
  });
  return {
    evidenceLevel: "native-probe",
    evidence:
      "Supplied native-probe samples do not certify physical hardware or all-page control coverage.",
    nodes,
    edges,
    coverage: {
      routeLayouts: {
        visited: expectedRoutes.filter((entry) => entry.visited).length,
        expected: expectedRoutes.length,
        entries: expectedRoutes,
        untested: expectedRoutes
          .filter((entry) => !entry.visited)
          .map(({ page, layout }) => ({ page, layout })),
      },
      primaryButtons: {
        exercised: exercised.length,
        expected: primaryButtons.length,
        exercisedInputs: exercised,
        untested: primaryButtons.filter((button) => !exercised.includes(button)),
      },
      discoveredControls: {
        selected: discovered.filter((entry) => entry.selected).length,
        total: discovered.length,
        basis:
          "Unique discovered controls per page/layout/scope only; not all-page control coverage.",
        entries: discovered,
      },
    },
    cases: caseResults,
    back: {
      basis: "Only observed successful B edges establish reverse reachability to case starts.",
      successfulEdges: successfulBack.length,
      confirmedFailedExits: backEdges.filter((edge) => !edge.pass).length,
      unknown: backNodes.filter((entry) => entry.status === "UNKNOWN").length,
      nodes: backNodes,
    },
  };
}
