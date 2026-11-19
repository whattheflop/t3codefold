import { expect, it } from "@effect/vitest";
import {
  controllerFailures,
  controllerFacts,
  type ControllerCapture,
} from "./controller-contract.ts";

const capture = (): ControllerCapture => ({
  route: { name: "Thread", columns: false },
  feed: { scroll: 20 },
  keyboard: false,
  controller: {
    enabled: true,
    scopeId: "id:/threads/e/t",
    suspended: false,
    editing: false,
    inspecting: false,
    position: { regionId: "reply", targetId: "field" },
    scene: {
      regions: [
        {
          id: "reply",
          kind: "composer",
          pane: "content",
          surfaceId: "draft-a",
          canScrollUp: false,
          canScrollDown: false,
        },
      ],
      editorFocused: false,
      targets: [{ id: "field", kind: "reply", regionId: "reply" }],
    },
  },
});

it("checks actual mode, destination, selection and scroll rather than accepting a consumed button", () => {
  const value = capture();
  expect(controllerFailures(value, value, { mode: "editing", changed: "selection" })).toEqual([
    "mode: wanted editing, observed navigation",
    "Selection did not move.",
  ]);
  expect(controllerFailures(value, value, { changed: "scroll" })).toEqual([
    "Conversation did not scroll.",
  ]);
  expect(controllerFailures(value, value, { ordered: "next", nativeEditorFocused: true })).toEqual([
    "nativeEditorFocused: wanted true, observed false",
    "Did not select the next declared control.",
  ]);
  const edited = { ...value, controller: { ...value.controller, editing: true } };
  expect(
    controllerFailures(edited, value, { mode: "editing", region: "composer", targetKind: "reply" }),
  ).toEqual([]);
  expect(controllerFailures(value, value, { path: "/settings/voice" })).toEqual([
    "Owning route scope has not reached the requested page.",
  ]);
  expect(controllerFailures(value, value, { restoreFromStep: 0 })).toEqual([]);
  expect(
    controllerFailures({ ...value, controller: { ...value.controller, position: null } }, value, {
      restoreFromStep: 0,
    }),
  ).toEqual(["Invoking scope/selection was not restored."]);
  expect(
    controllerFacts({ ...value, controller: { ...value.controller, scopeId: "id:palette" } }).scope,
  ).toBe("palette");
});
