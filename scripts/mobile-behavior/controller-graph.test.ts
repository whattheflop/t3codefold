import { expect, it } from "@effect/vitest";

import {
  buildControllerGraph,
  type GraphCase,
  type GraphState,
  type GraphStep,
} from "./controller-graph.ts";

const state = (overrides: Partial<GraphState> = {}): GraphState => ({
  page: "threads",
  layout: "compact",
  scope: "workspace",
  region: "threads",
  pane: "sidebar",
  target: null,
  mode: "navigation",
  scroll: "top",
  surface: "main",
  controls: [],
  ...overrides,
});
const step = (from: GraphState, to: GraphState, input = "A", pass = true): GraphStep => ({
  from,
  to,
  input,
  pass,
});
const run = (steps: readonly GraphStep[], overrides: Partial<GraphCase> = {}): GraphCase => ({
  id: "navigation",
  maxPresses: 20,
  steps,
  ...overrides,
});

it("keeps every production page and both layouts in the denominator even when every supplied case passes", () => {
  const report = buildControllerGraph(
    [
      { name: "threads" },
      { name: "settings" },
      { name: "settings" },
      { name: "probe", developmentOnly: true },
    ],
    [run([step(state(), state({ page: "probe", layout: "split" }))])],
  );
  expect(report.cases[0]?.status).toBe("passed");
  expect(report.coverage.routeLayouts).toMatchObject({
    visited: 1,
    expected: 4,
    untested: [
      { page: "threads", layout: "split" },
      { page: "settings", layout: "compact" },
      { page: "settings", layout: "split" },
    ],
  });
  expect(buildControllerGraph([{ name: "threads" }], []).coverage.routeLayouts).toMatchObject({
    visited: 0,
    expected: 2,
  });
  expect(report.evidenceLevel).toBe("native-probe");
  expect(report.evidence).toContain("do not certify physical hardware");
});

it("fails bad buttons and over-budget cases while preserving blocked and exactly-at-budget results", () => {
  const current = state();
  const report = buildControllerGraph(
    [],
    [
      run([step(current, current, "A", false)], { id: "bad", error: "capture ended" }),
      run([step(current, current), step(current, current)], { id: "budget", maxPresses: 1 }),
      run([], { id: "missing" }),
      run([step(current, current)], { id: "error", error: "probe unavailable" }),
      run([step(current, current, "RT")], { id: "boundary", maxPresses: 1 }),
      run([{ ...step(current, current), error: "snapshot unavailable" }], { id: "step-error" }),
    ],
  );
  expect(report.cases.map(({ id, status }) => [id, status])).toEqual([
    ["bad", "failed"],
    ["budget", "failed"],
    ["missing", "blocked"],
    ["error", "blocked"],
    ["boundary", "passed"],
    ["step-error", "blocked"],
  ]);
  expect(report.cases[1]).toMatchObject({ presses: 2, maxPresses: 1, overBudget: true });
  expect(report.coverage.primaryButtons).toMatchObject({
    exercised: 2,
    expected: 14,
    exercisedInputs: ["A", "RT"],
  });
  const badOnly = buildControllerGraph([], [run([step(current, current, "A", false)])]);
  expect(badOnly.coverage.primaryButtons.exercised).toBe(0);
});

it("distinguishes every navigation dimension, including editing, overlays, scroll boundaries and layouts", () => {
  const base = state();
  const variants: Partial<GraphState>[] = [
    { page: "settings" },
    { layout: "split" },
    { scope: "dialog" },
    { region: null },
    { pane: null },
    { target: "send" },
    { mode: "editing" },
    { scroll: "bottom" },
    { surface: "side-chat" },
  ];
  const report = buildControllerGraph(
    [],
    [run(variants.map((variant) => step(base, state(variant))))],
  );
  expect(report.nodes).toHaveLength(10);
  expect(new Set(report.edges.map((edge) => edge.to)).size).toBe(9);
  expect(new Set(report.edges.map((edge) => edge.from)).size).toBe(1);
});

it("accepts an expected self-loop, but never infers success from consumed input or changed state", () => {
  const current = state();
  const report = buildControllerGraph(
    [],
    [
      run([step(current, current, "DOWN")], { id: "boundary" }),
      run([step(current, state({ target: "wrong" }), "A", false)], { id: "wrong" }),
      run([step(current, current, "B", false)], { id: "consumed" }),
    ],
  );
  expect(report.edges[0]?.from).toBe(report.edges[0]?.to);
  expect(report.cases.map((entry) => entry.status)).toEqual(["passed", "failed", "failed"]);
  expect(report.back.confirmedFailedExits).toBe(1);
});

it("counts unique discovered controls per owner and does not equate discovery, focus or selection with activation", () => {
  const focused = state({ target: "open", controls: ["open", "delete", "open"] });
  const report = buildControllerGraph(
    [],
    [
      run([
        step(focused, state({ ...focused, controls: ["open", "refresh"] }), "RIGHT"),
        step(
          state({ page: "settings", target: "save", controls: ["save"] }),
          state({ page: "settings", target: "save", controls: ["save"] }),
          "A",
          false,
        ),
      ]),
    ],
  );
  expect(report.nodes).toHaveLength(2);
  expect(report.coverage.discoveredControls).toMatchObject({ selected: 2, total: 4 });
  expect(report.coverage.discoveredControls.basis).toContain("not all-page control coverage");
  expect(report.coverage.primaryButtons.exercisedInputs).toEqual(["RIGHT"]);
  expect(focused.controls).toEqual(["open", "delete", "open"]);
  expect(JSON.parse(JSON.stringify(report))).toEqual(report);
});

it("uses only successful B paths for reverse reachability and leaves unobserved exits unknown", () => {
  const root = state();
  const editor = state({ mode: "editing" });
  const dialog = state({ scope: "dialog" });
  const orphan = state({ page: "settings" });
  const report = buildControllerGraph(
    [],
    [
      run([
        step(root, editor),
        step(editor, dialog),
        step(dialog, editor, "B"),
        step(editor, root, "B"),
        step(root, orphan),
        step(orphan, root, "LEFT"),
        step(root, root, "B"),
      ]),
    ],
  );
  const backFor = (snapshot: GraphState) => {
    const node = report.nodes.find(
      ({ state: value }) =>
        value.page === snapshot.page &&
        value.mode === snapshot.mode &&
        value.scope === snapshot.scope,
    );
    return report.back.nodes.find((entry) => entry.nodeId === node?.id);
  };
  expect(backFor(dialog)).toMatchObject({ status: "OBSERVED", reachesCaseStart: true });
  expect(backFor(editor)).toMatchObject({ status: "OBSERVED", reachesCaseStart: true });
  expect(backFor(root)).toMatchObject({ status: "UNKNOWN", reachesCaseStart: null });
  expect(backFor(orphan)).toMatchObject({ status: "UNKNOWN", reachesCaseStart: null });
  expect(report.back).toMatchObject({ successfulEdges: 3, confirmedFailedExits: 0, unknown: 2 });
});

it("does not call successful Back cycles traps or claim they reach a case start; records explicit failures", () => {
  const root = state();
  const one = state({ scope: "one" });
  const two = state({ scope: "two" });
  const failed = state({ scope: "failed" });
  const report = buildControllerGraph(
    [],
    [
      run([
        step(root, one),
        step(one, two, "B"),
        step(two, one, "B"),
        step(one, failed),
        step(failed, failed, "B", false),
      ]),
    ],
  );
  expect(
    report.back.nodes.map(({ status, reachesCaseStart }) => [status, reachesCaseStart]),
  ).toEqual([
    ["UNKNOWN", null],
    ["OBSERVED", null],
    ["OBSERVED", null],
    ["FAILED", null],
  ]);
  expect(report.back.confirmedFailedExits).toBe(1);
});

it("does not inflate discovery when selection or its surface changes", () => {
  const first = state({ target: "a", controls: ["a", "b"], surface: "chat" });
  const second = state({ target: "b", controls: ["a", "b"], surface: "sidebar" });
  const report = buildControllerGraph([], [run([step(first, second, "DOWN")])]);
  expect(report.coverage.discoveredControls).toMatchObject({ selected: 2, total: 2 });
});
