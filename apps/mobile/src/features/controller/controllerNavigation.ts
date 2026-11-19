export type ControllerRegionKind =
  | "content"
  | "header"
  | "threads"
  | "conversation"
  | "composer"
  | "inspector"
  | "navigation";

export type ControllerScene = {
  readonly width?: number;
  readonly regions: ReadonlyArray<{
    readonly id: string;
    readonly kind: ControllerRegionKind;
    readonly surfaceId: string;
    readonly pane?: "sidebar" | "content" | "inspector";
    readonly viewportHeight: number;
    readonly canScrollUp: boolean;
    readonly canScrollDown: boolean;
  }>;
  readonly targets: ReadonlyArray<{
    readonly id: string;
    readonly regionId: string;
    readonly kind: "action" | "editor" | "reply" | "thread" | "footer" | "adjustable";
    readonly registered: boolean;
    readonly selected: boolean;
    readonly label?: string;
  }>;
  readonly focusedTargetId: string | null;
  readonly editorFocused: boolean;
};

export type ControllerNativeEvent = {
  readonly action: string;
  readonly scopeId?: string;
  readonly targetId: string;
  readonly amount?: number;
  readonly scene?: ControllerScene;
};

export type ControllerNativeEffect = {
  readonly kind: "snapshot" | "focus" | "activate" | "edit" | "blur" | "scroll";
  readonly targetId: string;
  readonly regionId: string;
  readonly amount: number;
};

export type ControllerTargetAction = "activate" | "dictate" | "decrement" | "increment";

type ScopeHost = {
  readonly id: string;
  readonly parentId: string | null;
  readonly modal: boolean;
  readonly initialRegion?: ControllerRegionKind;
  readonly native: (effect: ControllerNativeEffect) => Promise<ControllerScene | null>;
  readonly invoke: (targetId: string, action: ControllerTargetAction) => boolean;
  readonly available?: (targetId: string) => boolean;
  readonly command: (
    command: "commandPalette" | "controllerHelp" | "thread.previous" | "thread.next",
  ) => void;
  readonly back: () => void;
  readonly voice: (action: "toggle" | "cancel", surfaceId: string) => boolean;
  readonly selectionInput?: (event: ControllerNativeEvent) => void;
  readonly failed: (error: unknown) => void;
};

type Position = { regionId: string; targetId: string | null };
type Frame = {
  host: ScopeHost;
  scene: ControllerScene;
  position: Position | null;
  editing: boolean;
  inspecting: boolean;
  engaged: boolean;
  sceneRevision: number;
  suspended: boolean;
  request: number;
  pendingScroll: boolean;
  scroll: { direction: "up" | "down"; previous: ReadonlySet<string> } | null;
  positions: Map<string, Position>;
  pendingReply: { kind: "focus" | "dictate"; surfaceId: string | null } | null;
  editorPosition: Position | null;
  pendingEditor: Position | null;
};
const EMPTY_SCENE: ControllerScene = {
  regions: [],
  targets: [],
  focusedTargetId: null,
  editorFocused: false,
};
const REGION_ORDER: Record<ControllerRegionKind, number> = {
  navigation: 0,
  threads: 1,
  header: 2,
  content: 3,
  conversation: 4,
  composer: 5,
  inspector: 6,
};

export function createControllerNavigation() {
  const frames = new Map<string, Frame>();
  const listeners = new Set<() => void>();
  const pending = new Set<Promise<void>>();
  const inputs = new Map<string, () => void>();
  let enabled = false;
  const publish = () => listeners.forEach((listener) => listener());
  const depth = (frame: Frame, seen = new Set<string>()): number => {
    if (seen.has(frame.host.id)) return -1;
    seen.add(frame.host.id);
    const parent = frame.host.parentId ? frames.get(frame.host.parentId) : undefined;
    if (frame.host.parentId && !parent) return -1;
    return (parent ? depth(parent, seen) : 0) + (frame.host.modal ? 1 : 0);
  };
  const active = () =>
    [...frames.values()]
      .filter((frame) => depth(frame) >= 0)
      .sort((a, b) => depth(a) - depth(b))
      .at(-1);
  const regions = (frame: Frame) =>
    [...frame.scene.regions]
      .filter(
        (region) =>
          region.canScrollUp ||
          region.canScrollDown ||
          region.kind === "conversation" ||
          region.kind === "composer" ||
          frame.scene.targets.some((target) => target.regionId === region.id),
      )
      .sort((a, b) => REGION_ORDER[a.kind] - REGION_ORDER[b.kind]);
  const selected = (frame: Frame) =>
    frame.scene.targets.find((target) => target.id === frame.position?.targetId);
  const currentRegion = (frame: Frame) =>
    frame.scene.regions.find((region) => region.id === frame.position?.regionId);
  const paneOf = (region: ControllerScene["regions"][number]) =>
    region.pane ??
    (region.kind === "inspector" ? "inspector" : region.kind === "threads" ? "sidebar" : "content");
  const entryTarget = (
    targets: ControllerScene["targets"],
    region: ControllerScene["regions"][number],
  ) =>
    (region.kind === "threads" || region.kind === "navigation"
      ? targets.find((target) => target.selected)
      : undefined) ?? targets[0];
  const defaultPosition = (frame: Frame, region: ControllerScene["regions"][number]): Position => ({
    regionId: region.id,
    targetId:
      region.kind === "conversation"
        ? null
        : (entryTarget(
            frame.scene.targets.filter((target) => target.regionId === region.id),
            region,
          )?.id ?? null),
  });
  const localTargets = (frame: Frame) =>
    frame.scene.targets.filter((target) => target.regionId === frame.position?.regionId);
  const relatedRegions = (frame: Frame, region: ControllerScene["regions"][number]) => {
    const candidates = regions(frame).filter((candidate) => paneOf(candidate) === paneOf(region));
    const surfaces = new Set(candidates.map((candidate) => candidate.surfaceId).filter(Boolean));
    const surface = region.surfaceId || (surfaces.size === 1 ? [...surfaces][0] : "");
    return candidates.filter(
      (candidate) => !candidate.surfaceId || candidate.surfaceId === surface,
    );
  };

  function updateScene(frame: Frame, scene: ControllerScene, restoreEditor = true) {
    if (restoreEditor && frame.scene.width && scene.width && frame.scene.width !== scene.width) {
      frame.pendingEditor = frame.editorPosition;
    }
    frame.scene = {
      ...scene,
      targets: scene.targets.filter(
        (target) => !target.registered || frame.host.available?.(target.id) !== false,
      ),
    };
  }

  function reconcile(frame: Frame) {
    if (frame.pendingEditor && enabled && !frame.suspended) {
      const field = frame.scene.targets.find(
        (candidate) =>
          candidate.id === frame.pendingEditor?.targetId &&
          candidate.regionId === frame.pendingEditor?.regionId &&
          (candidate.kind === "editor" || candidate.kind === "reply"),
      );
      if (field) {
        frame.position = frame.pendingEditor;
        frame.editorPosition = frame.pendingEditor;
        frame.pendingEditor = null;
        frame.editing = true;
        frame.engaged = true;
        if (!frame.scene.editorFocused || frame.scene.focusedTargetId !== field.id) {
          if (field.registered) frame.host.invoke(field.id, "activate");
          else effect(frame, "edit");
        }
        return;
      }
    }
    if (frame.pendingReply && enabled && !frame.suspended) {
      const destination =
        frame.pendingReply.surfaceId === null
          ? sameSurface(frame, "composer")
          : frame.scene.regions.find(
              (candidate) =>
                candidate.kind === "composer" &&
                candidate.surfaceId === frame.pendingReply?.surfaceId,
            );
      const field = frame.scene.targets.find(
        (candidate) => candidate.regionId === destination?.id && candidate.kind === "reply",
      );
      if (field) {
        const intent = frame.pendingReply.kind;
        frame.pendingReply = null;
        frame.engaged = true;
        focus(frame, { regionId: field.regionId, targetId: field.id });
        if (intent === "dictate") frame.host.invoke(field.id, "dictate");
        return;
      }
    }
    const region = currentRegion(frame);
    if (region && frame.engaged) {
      if (frame.position?.targetId && !selected(frame)) {
        frame.position = { regionId: region.id, targetId: null };
        frame.editing = false;
      }
      if (region.kind === "composer" && frame.position?.targetId === null) {
        requestReply(frame, "focus");
        const field = frame.scene.targets.find(
          (candidate) => candidate.regionId === region.id && candidate.kind === "reply",
        );
        if (field) {
          frame.pendingReply = null;
          focus(frame, { regionId: region.id, targetId: field.id });
        }
      }
      return;
    }
    const preferred = frame.host.initialRegion;
    const available = regions(frame);
    const preferredPane =
      preferred === "threads" || preferred === "navigation" ? "sidebar" : "content";
    const destination = preferred
      ? (available.find(
          (candidate) =>
            candidate.kind === preferred &&
            paneOf(candidate) === preferredPane &&
            candidate.id !== "",
        ) ??
        available.find((candidate) => candidate.kind === preferred && candidate.id !== "") ??
        available.find((candidate) => candidate.kind === preferred) ??
        (preferred === "conversation"
          ? undefined
          : (available.find((candidate) => candidate.kind === "navigation") ?? available[0])))
      : (available.find((candidate) => candidate.kind === "conversation") ??
        available.find((candidate) => candidate.kind === "threads") ??
        available[0]);
    frame.position = destination ? defaultPosition(frame, destination) : null;
    frame.editing = false;
    frame.inspecting = false;
  }

  function effect(
    frame: Frame,
    kind: ControllerNativeEffect["kind"],
    amount = 0,
    position = frame.position,
  ) {
    const request = ++frame.request;
    const sceneRevision = frame.sceneRevision;
    const operation = frame.host
      .native({
        kind,
        targetId: position?.targetId ?? "",
        regionId: position?.regionId ?? "",
        amount,
      })
      .then((scene) => {
        if (frames.get(frame.host.id) !== frame || frame.request !== request || active() !== frame)
          return;
        frame.pendingScroll = false;
        if (scene === null || sceneRevision !== frame.sceneRevision) return;
        updateScene(frame, scene);
        reconcile(frame);
        publish();
      })
      .catch((error: unknown) => {
        if (frames.get(frame.host.id) !== frame || frame.request !== request) return;
        frame.pendingScroll = false;
        frame.host.failed(error);
      });
    pending.add(operation);
    void operation.finally(() => pending.delete(operation));
  }

  function focus(frame: Frame, position: Position) {
    const previous = currentRegion(frame);
    if (previous && frame.position) frame.positions.set(paneOf(previous), frame.position);
    frame.position = position;
    frame.editing = false;
    frame.editorPosition = null;
    frame.pendingEditor = null;
    frame.inspecting = currentRegion(frame)?.kind === "conversation" && position.targetId !== null;
    frame.scroll = null;
    frame.pendingScroll = false;
    publish();
    effect(frame, "focus");
  }

  function focusRegion(
    frame: Frame,
    region: ControllerScene["regions"][number],
    preferReply = false,
  ) {
    const targets = frame.scene.targets.filter((target) => target.regionId === region.id);
    const target = preferReply
      ? targets.find((candidate) => candidate.kind === "reply")
      : region.kind === "conversation"
        ? undefined
        : entryTarget(targets, region);
    focus(frame, { regionId: region.id, targetId: target?.id ?? null });
  }

  function adjacentPane(frame: Frame, direction: -1 | 1) {
    if (frame.host.modal) return false;
    const region = currentRegion(frame);
    if (!region) return false;
    const order = ["sidebar", "content", "inspector"];
    const available = order.filter((pane) =>
      regions(frame).some((candidate) => paneOf(candidate) === pane),
    );
    const destinationPane = available[available.indexOf(paneOf(region)) + direction];
    if (!destinationPane) return false;
    const candidates = regions(frame).filter((candidate) => paneOf(candidate) === destinationPane);
    const remembered = frame.positions.get(destinationPane);
    if (
      remembered &&
      candidates.some((candidate) => candidate.id === remembered.regionId) &&
      (remembered.targetId === null ||
        frame.scene.targets.some(
          (target) => target.id === remembered.targetId && target.regionId === remembered.regionId,
        ))
    ) {
      focus(frame, remembered);
    } else {
      const destination =
        candidates.find(
          (candidate) =>
            candidate.kind === "conversation" ||
            candidate.kind === "threads" ||
            candidate.kind === "inspector",
        ) ??
        candidates.find((candidate) => candidate.kind === "content" && candidate.id !== "") ??
        candidates[0];
      if (destination) focusRegion(frame, destination);
    }
    return true;
  }

  function sameSurface(frame: Frame, kind: ControllerRegionKind) {
    const surface = currentRegion(frame)?.surfaceId;
    const candidates = frame.scene.regions.filter((region) => region.kind === kind);
    return (
      candidates.find((region) => region.surfaceId === surface) ??
      (!surface && candidates.length === 1 ? candidates[0] : undefined)
    );
  }

  function requestReply(frame: Frame, kind: "focus" | "dictate") {
    const surface = sameSurface(frame, "composer")?.surfaceId || currentRegion(frame)?.surfaceId;
    frame.pendingReply = { kind, surfaceId: surface || null };
  }

  function invoke(
    frame: Frame,
    target: ControllerScene["targets"][number],
    action: ControllerTargetAction,
  ) {
    if (target.registered) frame.host.invoke(target.id, action);
    else if (action === "activate") effect(frame, "activate");
  }

  function vertical(frame: Frame, direction: "up" | "down") {
    if (frame.pendingScroll) return;
    const region = currentRegion(frame);
    if (!region) return;
    if (region.kind === "conversation" && !frame.inspecting) {
      if (direction === "down" ? region.canScrollDown : region.canScrollUp) {
        frame.pendingScroll = true;
        effect(frame, "scroll", region.viewportHeight * 0.3 * (direction === "up" ? -1 : 1));
      } else if (direction === "up") {
        const header = relatedRegions(frame, region).find(
          (candidate) => candidate.kind === "header",
        );
        if (header) focusRegion(frame, header);
      }
      return;
    }
    const targets = localTargets(frame);
    const index = targets.findIndex((target) => target.id === frame.position?.targetId);
    const continuing = frame.scroll?.direction === direction;
    const next = continuing
      ? (direction === "down" ? targets : [...targets].reverse()).find(
          (target) => !frame.scroll?.previous.has(target.id),
        )
      : index < 0
        ? direction === "down"
          ? targets[0]
          : targets.at(-1)
        : targets[index + (direction === "down" ? 1 : -1)];
    if (next) {
      focus(frame, { regionId: region.id, targetId: next.id });
      return;
    }
    if (direction === "down" ? region.canScrollDown : region.canScrollUp) {
      frame.position = { regionId: region.id, targetId: null };
      frame.scroll = { direction, previous: new Set(targets.map((target) => target.id)) };
      frame.pendingScroll = true;
      publish();
      effect(frame, "scroll", region.viewportHeight * 0.65 * (direction === "up" ? -1 : 1));
      return;
    }
    frame.scroll = null;
    if (region.kind === "conversation") return;
    const order = (candidate: ControllerScene["regions"][number]) =>
      candidate.id === "" ? 100 : candidate.kind === "header" ? -1 : REGION_ORDER[candidate.kind];
    const local = relatedRegions(frame, region).sort((a, b) => order(a) - order(b));
    const nextRegion =
      local[
        local.findIndex((candidate) => candidate.id === region.id) + (direction === "up" ? -1 : 1)
      ];
    if (nextRegion && nextRegion.kind !== "composer") {
      const last =
        direction === "up" && nextRegion.kind !== "conversation"
          ? frame.scene.targets.filter((candidate) => candidate.regionId === nextRegion.id).at(-1)
          : undefined;
      if (last) focus(frame, { regionId: nextRegion.id, targetId: last.id });
      else focusRegion(frame, nextRegion);
    }
  }

  function dispatch(id: string, event: ControllerNativeEvent) {
    if (event.action === "testComplete") {
      inputs.get(event.targetId)?.();
      inputs.delete(event.targetId);
      return;
    }
    if (event.scopeId && event.scopeId !== id) return;
    const frame = frames.get(id);
    if (!frame) return;
    if (event.action === "reset") {
      enabled = false;
      for (const entry of frames.values()) {
        entry.request++;
        entry.pendingScroll = false;
        entry.pendingReply = null;
        entry.editorPosition = null;
        entry.pendingEditor = null;
      }
      frame.host.selectionInput?.(event);
      publish();
      return;
    }
    if (active() !== frame) return;
    const passive = ["scene", "enabled", "resumed", "suspended", "editorBlurred"].includes(
      event.action,
    );
    if (!passive) {
      frame.pendingReply = null;
      frame.editorPosition = null;
      frame.pendingEditor = null;
    }
    if (event.action === "suspended") {
      frame.suspended = true;
      if (frame.pendingReply?.kind === "dictate") frame.pendingReply.kind = "focus";
    }
    if (event.scene) {
      frame.sceneRevision++;
      updateScene(frame, event.scene, passive);
      reconcile(frame);
    }
    if (event.action === "suspended") {
      frame.suspended = true;
      frame.request++;
      frame.pendingScroll = false;
      publish();
      return;
    }
    if (event.action === "enabled" || event.action === "resumed") {
      if (event.action === "enabled") enabled = true;
      frame.suspended = false;
      reconcile(frame);
      if ((event.action === "enabled" || !frame.engaged) && frame.scene.editorFocused) {
        const field = frame.scene.targets.find(
          (candidate) => candidate.id === frame.scene.focusedTargetId,
        );
        if (field) {
          frame.engaged = true;
          frame.position = { regionId: field.regionId, targetId: field.id };
          frame.editing = true;
          frame.editorPosition = frame.position;
          frame.inspecting = false;
        }
      }
      if (enabled && !frame.host.selectionInput) effect(frame, frame.editing ? "edit" : "focus");
      publish();
      return;
    }
    if (event.action === "editorBlurred") {
      if (!frame.suspended) {
        frame.editing = false;
        publish();
      }
      return;
    }
    if (event.action === "scene") {
      publish();
      return;
    }
    if (event.action === "pointer" || event.action === "editorFocused") {
      const target = frame.scene.targets.find((candidate) => candidate.id === event.targetId);
      const region = frame.scene.regions.find((candidate) => candidate.id === event.targetId);
      if (target || region) {
        frame.engaged = true;
        frame.position = target
          ? { regionId: target.regionId, targetId: target.id }
          : { regionId: region!.id, targetId: null };
        frame.editing = frame.scene.editorFocused;
        frame.editorPosition = frame.editing ? frame.position : null;
        frame.inspecting =
          target !== undefined &&
          frame.scene.regions.some(
            (candidate) => candidate.id === target.regionId && candidate.kind === "conversation",
          );
        frame.scroll = null;
        frame.request++;
        frame.pendingScroll = false;
        publish();
      }
      return;
    }
    if (!enabled || frame.suspended) return;
    if (event.action === "chooser") {
      frame.host.command("controllerHelp");
      return;
    }
    if (frame.host.selectionInput) {
      frame.host.selectionInput(event);
      return;
    }
    frame.engaged = true;
    const region = currentRegion(frame);
    const target = selected(frame);
    const voiceSurface = region?.surfaceId || sameSurface(frame, "composer")?.surfaceId || "";
    if (event.action === "back") {
      frame.pendingScroll = false;
      frame.request++;
      if (frame.host.voice("cancel", voiceSurface)) {
        requestReply(frame, "focus");
        reconcile(frame);
        publish();
        return;
      }
      if (frame.editing || frame.scene.editorFocused) {
        frame.editing = false;
        const field = frame.scene.targets.find(
          (candidate) => candidate.id === frame.scene.focusedTargetId,
        );
        if (field) frame.position = { regionId: field.regionId, targetId: field.id };
        effect(frame, "blur");
        publish();
        return;
      }
      if (
        !frame.host.modal &&
        frame.scene.regions.some((candidate) => paneOf(candidate) === "inspector")
      ) {
        frame.host.back();
        return;
      }
      if (region?.kind === "conversation" && frame.inspecting) {
        focusRegion(frame, region);
        return;
      }
      const destination =
        region?.kind === "composer" || region?.kind === "header"
          ? sameSurface(frame, "conversation")
          : region?.kind === "conversation"
            ? frame.scene.regions.find((candidate) => candidate.kind === "threads")
            : undefined;
      if (destination) focusRegion(frame, destination);
      else frame.host.back();
      return;
    }
    if (event.action === "menu") {
      frame.host.command("commandPalette");
      return;
    }
    if (event.action === "previous" || event.action === "next") {
      if (frame.host.modal) vertical(frame, event.action === "previous" ? "up" : "down");
      else frame.host.command(event.action === "previous" ? "thread.previous" : "thread.next");
      return;
    }
    if (event.action === "dictate") {
      if (frame.host.voice("toggle", voiceSurface)) return;
      const replyRegion = sameSurface(frame, "composer");
      const field =
        target?.registered && (target.kind === "reply" || target.kind === "editor")
          ? target
          : frame.scene.targets.find(
              (candidate) => candidate.regionId === replyRegion?.id && candidate.kind === "reply",
            );
      if (field) {
        frame.position = { regionId: field.regionId, targetId: field.id };
        frame.inspecting = false;
        frame.host.invoke(field.id, "dictate");
        publish();
      } else {
        requestReply(frame, "dictate");
      }
      return;
    }
    if (event.action === "conversation" || event.action === "reply") {
      if (event.action === "reply") {
        requestReply(frame, "focus");
        reconcile(frame);
        publish();
        return;
      }
      const destination = sameSurface(frame, "conversation");
      if (destination) focusRegion(frame, destination);
      return;
    }
    if (event.action === "footer") {
      const footer = frame.scene.targets.find(
        (candidate) =>
          candidate.kind === "footer" &&
          (candidate.regionId === region?.id ||
            candidate.regionId === sameSurface(frame, "composer")?.id),
      );
      if (footer) focus(frame, { regionId: footer.regionId, targetId: footer.id });
      return;
    }
    if (event.action === "activate") {
      if (!target) {
        const first = localTargets(frame)[0];
        if (first && region) focus(frame, { regionId: region.id, targetId: first.id });
        return;
      }
      if (target.kind === "editor" || target.kind === "reply") {
        frame.editing = true;
        frame.editorPosition = frame.position;
        if (target.registered) invoke(frame, target, "activate");
        else effect(frame, "edit");
        publish();
      } else invoke(frame, target, "activate");
      return;
    }
    if (event.action === "pageUp" || event.action === "pageDown" || event.action === "scroll") {
      const destination =
        region?.kind === "composer"
          ? (sameSurface(frame, "conversation") ?? region)
          : region?.kind === "header"
            ? (sameSurface(frame, "content") ?? region)
            : region;
      if (!frame.pendingScroll && destination) {
        frame.pendingScroll = true;
        frame.scroll = null;
        effect(
          frame,
          "scroll",
          event.amount ?? destination.viewportHeight * 0.8 * (event.action === "pageUp" ? -1 : 1),
          { regionId: destination.id, targetId: null },
        );
      }
      return;
    }
    if (frame.editing || frame.scene.editorFocused) return;
    if (event.action === "up" || event.action === "down") {
      vertical(frame, event.action);
      return;
    }
    if (event.action !== "left" && event.action !== "right") return;
    if (target?.kind === "adjustable") {
      invoke(frame, target, event.action === "left" ? "decrement" : "increment");
      return;
    }
    if (
      frame.host.modal ||
      region?.kind === "header" ||
      region?.kind === "navigation" ||
      region?.kind === "composer"
    ) {
      const targets = localTargets(frame);
      const index = targets.findIndex((candidate) => candidate.id === target?.id);
      const next = targets[index + (event.action === "left" ? -1 : 1)];
      if (next && region) focus(frame, { regionId: region.id, targetId: next.id });
      return;
    }
    if (adjacentPane(frame, event.action === "left" ? -1 : 1)) return;
    if (
      region?.kind === "conversation" &&
      event.action === "left" &&
      !frame.scene.regions.some((candidate) => candidate.kind === "threads")
    ) {
      frame.host.back();
      return;
    }
    if (region?.kind === "conversation" || region?.kind === "inspector") return;
    const targets = localTargets(frame);
    const index = targets.findIndex((candidate) => candidate.id === target?.id);
    const next = targets[index + (event.action === "left" ? -1 : 1)];
    if (next && region) focus(frame, { regionId: region.id, targetId: next.id });
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isActive(id: string) {
      return active()?.host.id === id;
    },
    snapshot() {
      const frame = active();
      return {
        enabled,
        scopeId: frame?.host.id ?? null,
        suspended: frame?.suspended ?? false,
        editing: frame?.editing ?? false,
        inspecting: frame?.inspecting ?? false,
        position: frame?.position ?? null,
        scene: frame?.scene ?? EMPTY_SCENE,
      };
    },
    expectInput(sequence: string) {
      const done = new Promise<void>((resolve) => inputs.set(sequence, resolve));
      return { done, dispose: () => inputs.delete(sequence) };
    },
    settled: () => Promise.all(pending),
    refresh(id: string) {
      const frame = frames.get(id);
      if (frame && active() === frame) effect(frame, "snapshot");
    },
    present(host: ScopeHost) {
      const previous = active();
      if (previous?.pendingReply?.kind === "dictate") previous.pendingReply.kind = "focus";
      const frame: Frame = {
        host,
        scene: EMPTY_SCENE,
        position: null,
        editing: false,
        inspecting: false,
        engaged: false,
        sceneRevision: 0,
        suspended: false,
        request: 0,
        pendingScroll: false,
        scroll: null,
        positions: new Map(),
        pendingReply: null,
        editorPosition: null,
        pendingEditor: null,
      };
      frames.set(host.id, frame);
      publish();
      if (active() === frame) effect(frame, "snapshot");
      return () => {
        if (frames.get(host.id) !== frame) return;
        frame.request++;
        frames.delete(host.id);
        publish();
        const destination = active();
        if (destination && enabled) {
          destination.suspended = false;
          reconcile(destination);
          effect(destination, destination.editing ? "edit" : "focus");
        }
      };
    },
    dispatch,
  };
}

export const controllerNavigation = createControllerNavigation();
