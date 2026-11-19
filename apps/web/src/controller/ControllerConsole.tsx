import { T, msg, useGT } from "gt-react";
import { m } from "~/i18n/messages";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useRightPanelStore } from "../rightPanelStore";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { focusWorkspaceArea, requestWorkspaceFocus } from "../lib/workspaceFocus";
import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Button } from "../components/ui/button";
import { isPreviewFocused } from "../lib/previewFocus";
import { createDomController, controllerVisible } from "./domController";
import { createGamepadReader } from "./gamepad";
import { setControllerEnabled, useControllerSettings } from "./controllerStore";
import "./controller.css";

export function ControllerConsoleSettings() {
  const gt = useGT();
  const enabled = useControllerSettings((state) => state.enabled);
  return (
    <section aria-label={gt("Controller console")} className="space-y-2 px-4 py-3">
      <h3 className="text-sm font-medium">
        <T>Controller console</T>
      </h3>
      <p className="text-sm text-muted-foreground">
        <T>
          PlayStation or standard-mapped controllers, in this window only. Enable, then release all
          controls before navigating.
        </T>
      </p>
      <Button
        variant="outline"
        aria-pressed={enabled}
        onClick={() => setControllerEnabled(!enabled)}
      >
        {enabled ? gt("Disable controller mode") : gt("Enable controller mode")}
      </Button>
      <p className="text-sm text-muted-foreground">
        <T>
          D-pad / left stick: focus · ×: activate · ○: back · □: dictate · △: focus send (× sends).
          L1 / R1: threads · L2 / R2: panes · L3: read chat · R3: reply · right stick: scroll ·
          Options: commands · Share: thread chooser. Voice uses your configured microphone and never
          sends automatically. Editors, terminals and browser guests may need keyboard or touch.
        </T>
      </p>
    </section>
  );
}

export function ControllerConsole() {
  const gt = useGT();
  const enabled = useControllerSettings((state) => state.enabled);
  const router = useRouter();
  const [hint, setHint] = useState("");
  const [usingController, setUsingController] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns foreground gamepad polling and its DOM focus adapter
  useEffect(() => {
    if (!enabled || !navigator.getGamepads) return;
    const reader = createGamepadReader();
    const dom = createDomController(
      document,
      setHint,
      () => {
        if (router.history.canGoBack()) router.history.back();
      },
      (scope) => {
        if (!scope.closest('[data-workspace-area="panel"]')) return false;
        const route = resolveThreadRouteTarget(router.state.matches.at(-1)?.params ?? {});
        if (route?.kind !== "server") return false;
        const store = useRightPanelStore.getState();
        const panel = store.byThreadKey[scopedThreadKey(route.threadRef)];
        if (!panel?.isOpen) return false;
        if (panel.maximized) store.setMaximized(route.threadRef, false);
        else {
          store.close(route.threadRef);
          focusWorkspaceArea("content");
        }
        return true;
      },
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    let padIndex: number | undefined;
    let lastScope: HTMLElement | undefined;
    let lastScopeKey = "";
    let generation = 0;
    let visibleHints = false;
    const foreground = () =>
      document.visibilityState === "visible" && document.hasFocus() && !isPreviewFocused();
    const stop = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      reader.reset();
      dom.reset();
      dom.clear();
      visibleHints = false;
      setUsingController(false);
    };
    const tick = () => {
      timer = undefined;
      if (!foreground()) {
        stop();
        return;
      }
      const pads = [...navigator.getGamepads()].filter((pad): pad is Gamepad => !!pad?.connected);
      const pad =
        padIndex === undefined
          ? (pads.find((entry) => entry.mapping === "standard") ?? pads[0])
          : pads.find((entry) => entry.index === padIndex);
      if (!pad) {
        padIndex = undefined;
        stop();
        if (pads.length) timer = setTimeout(tick, 33);
        return;
      }
      padIndex = pad.index;
      if (pad.mapping !== "standard") {
        setHint(
          m(
            msg(
              "This controller needs standard Gamepad mapping. Use keyboard or touch to configure another controller.",
            ),
          ),
        );
        setUsingController(true);
        reader.reset();
        padIndex = undefined;
        return;
      }
      timer = setTimeout(tick, 33);
      const scope = dom.scope();
      const requestKey = [...scope.querySelectorAll<HTMLElement>("[data-controller-request]")]
        .filter(controllerVisible)
        .map(
          (element) =>
            `${element.dataset.controllerRequest}:${element.getAttribute("disabled")}:${element.getAttribute("aria-disabled")}`,
        )
        .join("|");
      const scopeKey = `${router.state.location.href}|${requestKey}`;
      if (lastScope !== scope || lastScopeKey !== scopeKey) {
        const popupSelector =
          '[role="dialog"], [role="alertdialog"], [role="menu"], [aria-modal="true"], [data-slot$="-popup"]';
        if (
          lastScopeKey !== scopeKey ||
          scope.matches(popupSelector) ||
          lastScope?.matches(popupSelector)
        )
          dom.reset();
        generation += 1;
        lastScope = scope;
        lastScopeKey = scopeKey;
      }
      const { actions, scroll } = reader.read(pad, generation, performance.now());
      if (actions.length || scroll.some(Boolean)) {
        if (!visibleHints) {
          visibleHints = true;
          setUsingController(true);
          setHint("");
        }
        // One discrete action per snapshot prevents simultaneous buttons crossing a new scope.
        if (actions[0]) dom.dispatch(actions[0]);
        else dom.scroll(scroll[0] * 24, scroll[1] * 24);
      }
    };
    const wake = () => {
      if (timer === undefined && foreground()) tick();
    };
    const stopRoute = router.subscribe("onResolved", ({ fromLocation, toLocation }) => {
      if (visibleHints && fromLocation?.pathname !== toLocation.pathname)
        requestWorkspaceFocus({ area: "conversation", restore: false });
    });
    const ordinaryInput = (event: Event) => {
      if (!event.isTrusted) return;
      dom.editTarget(event.target);
      visibleHints = false;
      setUsingController(false);
      dom.clear();
      reader.reset();
    };
    const disconnected = () => {
      stop();
      padIndex = undefined;
      wake();
    };
    window.addEventListener("gamepadconnected", wake);
    window.addEventListener("gamepaddisconnected", disconnected);
    window.addEventListener("blur", stop);
    window.addEventListener("focus", wake);
    document.addEventListener("focusin", wake);
    document.addEventListener("visibilitychange", wake);
    document.addEventListener("visibilitychange", stopHidden);
    document.addEventListener("pointerdown", ordinaryInput, true);
    document.addEventListener("keydown", ordinaryInput, true);
    const composition = (event: CompositionEvent) => dom.editTarget(event.target);
    document.addEventListener("compositionstart", composition, true);
    function stopHidden() {
      if (!foreground()) stop();
    }
    wake();
    return () => {
      stopRoute();
      stop();
      window.removeEventListener("gamepadconnected", wake);
      window.removeEventListener("gamepaddisconnected", disconnected);
      window.removeEventListener("blur", stop);
      window.removeEventListener("focus", wake);
      document.removeEventListener("focusin", wake);
      document.removeEventListener("visibilitychange", wake);
      document.removeEventListener("visibilitychange", stopHidden);
      document.removeEventListener("pointerdown", ordinaryInput, true);
      document.removeEventListener("keydown", ordinaryInput, true);
      document.removeEventListener("compositionstart", composition, true);
    };
  }, [enabled, router]);
  if (!enabled || !usingController) return null;
  return (
    <div
      data-controller-hints
      role="status"
      className="pointer-events-none fixed bottom-2 left-1/2 z-[200] max-w-[95vw] -translate-x-1/2 rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg"
    >
      {hint ||
        gt("× Activate · ○ Back · □ Dictate · △ Focus send · L1/R1 Threads · Options Commands")}
    </div>
  );
}
