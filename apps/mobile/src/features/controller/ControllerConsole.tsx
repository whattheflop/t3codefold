import {
  use,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from "react";
import { Modal, Platform, View } from "react-native";
import { controllerNativeEffect, T3KeyboardCommands } from "../../native/T3KeyboardCommands";
import { requestAndroidBack } from "../../native/controllerBack";
import type { HardwareKeyboardCommand } from "../keyboard/hardwareKeyboardCommands";
import { useGlobalVoiceInput } from "../voice-input/VoiceInputProvider";
import { controllerDictation } from "./controllerDictation";
import { ControllerGuide } from "./ControllerGuide";
import {
  controllerNavigation,
  type ControllerNativeEvent,
  type ControllerRegionKind,
  type ControllerTargetAction,
} from "./controllerNavigation";
import { ControllerScope } from "./controllerScope";
import { controllerTargets } from "./controllerTargets";

export function ControllerConsole({
  children,
  onCommand,
  onBack,
  onHelp,
  scopeKey,
  modal = true,
  initialRegion,
  selection = false,
  onSelectionInput,
  enabledCommands = [],
}: PropsWithChildren<{
  readonly scopeKey?: string;
  readonly modal?: boolean;
  readonly initialRegion?: ControllerRegionKind;
  readonly selection?: boolean;
  readonly onSelectionInput?: (event: ControllerNativeEvent) => void;
  readonly enabledCommands?: ReadonlyArray<HardwareKeyboardCommand>;
  readonly onCommand?: (command: HardwareKeyboardCommand) => void;
  readonly onBack?: () => void;
  readonly onHelp?: () => void;
}>) {
  const [helpVisible, setHelpVisible] = useState(false);
  const surfaceId = useId();
  const parentId = use(ControllerScope);
  const scope = `${surfaceId}:${scopeKey ?? "modal"}`;
  const voice = useGlobalVoiceInput();
  const active = useSyncExternalStore(
    controllerNavigation.subscribe,
    () => controllerNavigation.isActive(scope),
    () => false,
  );
  const invoke = useEffectEvent((targetId: string, action: ControllerTargetAction) => {
    let performed = false;
    const run = () => {
      performed = controllerTargets.dispatch(targetId, action, scope);
    };
    if (action === "dictate" || (action === "activate" && !voice.isBusy)) {
      const snapshot = controllerNavigation.snapshot();
      const target = snapshot.scene.targets.find((candidate) => candidate.id === targetId);
      const targetSurfaceId =
        snapshot.scopeId === scope
          ? (snapshot.scene.regions.find((region) => region.id === target?.regionId)?.surfaceId ??
            "")
          : "";
      controllerDictation.start(scope, voice.session, run, targetSurfaceId);
    } else run();
    return performed;
  });
  const command = useEffectEvent(
    (value: "commandPalette" | "controllerHelp" | "thread.previous" | "thread.next") => {
      if (value === "controllerHelp") (onHelp ?? (() => setHelpVisible(true)))();
      else onCommand?.(value);
    },
  );
  const back = useEffectEvent(() => (onBack ?? requestAndroidBack)());
  const selectionInput = useEffectEvent((event: ControllerNativeEvent) =>
    onSelectionInput?.(event),
  );
  const controlVoice = useEffectEvent((action: "toggle" | "cancel", ownerSurfaceId: string) => {
    if (!voice.isBusy || !controllerDictation.owns(scope, ownerSurfaceId)) return false;
    if (action === "cancel") voice.cancel();
    else voice.stop();
    return true;
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- presents one explicit input scope and restores its parent when the overlay or route leaves
  useLayoutEffect(() => {
    if (Platform.OS !== "android") return;
    let scheduled = false;
    let disposed = false;
    const unsubscribe = controllerTargets.subscribe((changedScope) => {
      if (changedScope !== scope || scheduled) return;
      scheduled = true;
      void Promise.resolve().then(() => {
        scheduled = false;
        if (!disposed) controllerNavigation.refresh(scope);
      });
    });
    const dismiss = controllerNavigation.present({
      id: scope,
      parentId: parentId || null,
      modal,
      initialRegion,
      native: (effect) => controllerNativeEffect(scope, effect),
      invoke,
      available: (targetId) => controllerTargets.has(targetId, scope),
      command,
      back,
      voice: controlVoice,
      ...(selection ? { selectionInput } : {}),
      failed: (error) => console.warn("Controller host effect failed", error),
    });
    return () => {
      disposed = true;
      unsubscribe();
      dismiss();
    };
  }, [scope, parentId, modal, selection, initialRegion]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- controller recordings belong to the lifetime of this exact route or overlay
  useEffect(() => () => controllerDictation.cancel(scope), [scope]);
  if (Platform.OS !== "android") return children;
  return (
    <T3KeyboardCommands
      controllerScope={scope}
      controllerActive={active}
      controllerModal={modal}
      controllerSelection={selection}
      enabledCommands={enabledCommands}
      onCommand={(value) => onCommand?.(value)}
      onController={(event) => {
        if (event.action === "reset") controllerDictation.cancel(scope);
        controllerNavigation.dispatch(scope, event);
      }}
    >
      <ControllerScope value={scope}>
        <View className="flex-1">{children}</View>
        {helpVisible ? (
          <Modal transparent visible onRequestClose={() => setHelpVisible(false)}>
            <ControllerConsole
              scopeKey="controller-help"
              onBack={() => setHelpVisible(false)}
              onHelp={() => setHelpVisible(false)}
            >
              <ControllerGuide onClose={() => setHelpVisible(false)} />
            </ControllerConsole>
          </Modal>
        ) : null}
      </ControllerScope>
    </T3KeyboardCommands>
  );
}
