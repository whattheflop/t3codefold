import { expect, it } from "vite-plus/test";
import traces from "../../../formal/controller/Traces.json";
import { createControllerNavigation, type ControllerScene } from "./controllerNavigation";

type Owner = { scope: number; surface: number; available: boolean; focused: boolean };
type TraceEvent = { action: string; available?: boolean; scope?: number; surface?: number };

it("matches the executable Lean model on exported navigation traces", async () => {
  for (const trace of traces) {
    const navigation = createControllerNavigation();
    const owners: Owner[] = [{ scope: 0, surface: trace.surface, available: true, focused: false }];
    const dismiss: (() => void)[] = [];
    let voiceOwner: Owner | null = null;
    let activations = 0;
    const id = (owner: Owner) => `scope-${owner.scope}`;
    const surface = (owner: Owner) => `surface-${owner.surface}`;
    const scene = (owner: Owner): ControllerScene => ({
      regions: [
        {
          id: "body",
          kind: owner.scope === 0 ? "conversation" : "content",
          surfaceId: surface(owner),
          viewportHeight: 600,
          canScrollUp: false,
          canScrollDown: false,
        },
        {
          id: "reply",
          kind: "composer",
          surfaceId: surface(owner),
          viewportHeight: 100,
          canScrollUp: false,
          canScrollDown: false,
        },
      ],
      targets: [
        { id: "action", regionId: "body", kind: "action", registered: true, selected: false },
        ...(owner.available
          ? [
              {
                id: "field",
                regionId: "reply",
                kind: "reply" as const,
                registered: true,
                selected: false,
              },
            ]
          : []),
      ],
      editorFocused: owner.focused,
      focusedTargetId: owner.focused ? "field" : null,
    });
    const present = (owner: Owner, parent: Owner | null) =>
      navigation.present({
        id: id(owner),
        parentId: parent ? id(parent) : null,
        modal: parent !== null,
        initialRegion: parent ? "content" : "conversation",
        native: async (effect) => {
          if (effect.kind === "blur") owner.focused = false;
          if (effect.kind === "edit") owner.focused = true;
          return scene(owner);
        },
        invoke: (target, action) => {
          if (target === "field" && action === "dictate") voiceOwner = owner;
          if (target === "field" && action === "activate") owner.focused = true;
          if (target === "action" && action === "activate") activations++;
          return true;
        },
        voice: (_action, destination) => {
          if (voiceOwner !== owner || destination !== surface(owner)) return false;
          voiceOwner = null;
          return true;
        },
        back: () => {
          if (owners.length > 1) {
            owners.pop();
            dismiss.pop()?.();
          }
        },
        command: () => {
          throw new Error("Route commands are outside this model.");
        },
        failed: (error) => {
          throw error;
        },
      });
    const root = owners[0]!;
    dismiss.push(present(root, null));
    navigation.dispatch(id(root), { action: "enabled", targetId: "", scene: scene(root) });
    await navigation.settled();
    const observe = () => {
      const state = navigation.snapshot();
      const region = state.scene.regions.find((r) => r.id === state.position?.regionId);
      const target = state.scene.targets.find((t) => t.id === state.position?.targetId);
      const mode = state.suspended
        ? "suspended"
        : voiceOwner !== null && id(voiceOwner) === state.scopeId
          ? "recording"
          : state.editing
            ? "editing"
            : state.inspecting
              ? "inspecting"
              : region?.kind === "composer"
                ? "reply"
                : region?.kind === "conversation"
                  ? "reading"
                  : "navigation";
      return {
        mode,
        scope: Number(state.scopeId?.replace("scope-", "")),
        surface: Number(region?.surfaceId.replace("surface-", "")),
        replySelected: target?.kind === "reply",
        activations,
      };
    };
    expect(observe(), `${trace.name}: initial`).toEqual(trace.initial);
    try {
      for (const [index, row] of trace.steps.entries()) {
        const event: TraceEvent = row.event;
        const owner = owners.at(-1)!;
        if (event.action === "push") {
          if (event.scope === undefined || event.surface === undefined)
            throw new Error("Invalid Lean overlay.");
          const child = {
            scope: event.scope,
            surface: event.surface,
            available: false,
            focused: false,
          };
          owners.push(child);
          dismiss.push(present(child, owner));
          await navigation.settled();
        } else {
          if (event.action === "scene") {
            if (event.available === undefined) throw new Error("Invalid Lean scene.");
            owner.available = event.available;
            if (!owner.available) owner.focused = false;
          }
          navigation.dispatch(id(owner), {
            action: event.action,
            targetId: "",
            scene: scene(owner),
          });
          await navigation.settled();
          const current = owners.at(-1)!;
          navigation.dispatch(id(current), {
            action: "scene",
            targetId: "",
            scene: scene(current),
          });
          await navigation.settled();
        }
        expect(observe(), `${trace.name}, step ${index}: ${event.action}`).toEqual(row.expected);
      }
    } finally {
      for (const dispose of dismiss.reverse()) dispose();
      await navigation.settled();
    }
  }
});
