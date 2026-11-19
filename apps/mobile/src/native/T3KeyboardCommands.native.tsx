import { requireNativeModule, requireNativeView } from "expo";
import type { PropsWithChildren } from "react";
import { Platform, type NativeSyntheticEvent, type ViewProps } from "react-native";

import type {
  ControllerNativeEffect,
  ControllerNativeEvent,
  ControllerScene,
} from "../features/controller/controllerNavigation";
import type { HardwareKeyboardCommand } from "../features/keyboard/hardwareKeyboardCommands";

/** A key forwarded for Vim navigation (see features/keyboard/vimNavigation). */
type VimKey = { readonly key: string; readonly ctrl?: boolean };

interface NativeKeyboardCommandsProps extends ViewProps {
  readonly controllerScope?: string;
  readonly controllerActive?: boolean;
  readonly controllerModal?: boolean;
  readonly controllerSelection?: boolean;
  readonly controllerEvents?: boolean;
  readonly enabledCommands: ReadonlyArray<HardwareKeyboardCommand>;
  readonly onCommand: (
    event: NativeSyntheticEvent<{ readonly command: HardwareKeyboardCommand }>,
  ) => void;
  readonly onController?: (event: NativeSyntheticEvent<ControllerNativeEvent>) => void;
  readonly vimKeysEnabled?: boolean;
  readonly onVimKey?: (event: NativeSyntheticEvent<VimKey>) => void;
}

const NativeKeyboardCommands = requireNativeView<NativeKeyboardCommandsProps>("T3KeyboardCommands");

export function T3KeyboardCommands(
  props: PropsWithChildren<{
    readonly enabledCommands: ReadonlyArray<HardwareKeyboardCommand>;
    readonly onCommand: (command: HardwareKeyboardCommand) => void;
    readonly controllerScope?: string;
    readonly controllerActive?: boolean;
    readonly controllerModal?: boolean;
    readonly controllerSelection?: boolean;
    readonly onController?: (event: ControllerNativeEvent) => void;
    readonly vimKeysEnabled?: boolean;
    readonly onVimKey?: (key: VimKey) => void;
  }>,
) {
  return (
    <NativeKeyboardCommands
      onCommand={(event) => props.onCommand(event.nativeEvent.command)}
      {...(Platform.OS === "android"
        ? {
            controllerScope: props.controllerScope ?? "",
            controllerActive: props.controllerActive ?? true,
            controllerModal: props.controllerModal ?? false,
            controllerSelection: props.controllerSelection ?? false,
            controllerEvents: props.onController !== undefined,
            onController: (event: NativeSyntheticEvent<ControllerNativeEvent>) =>
              props.onController?.(event.nativeEvent),
          }
        : {})}
      enabledCommands={props.enabledCommands}
      vimKeysEnabled={props.vimKeysEnabled ?? false}
      onVimKey={(event) => props.onVimKey?.(event.nativeEvent)}
      style={{ flex: 1 }}
    >
      {props.children}
    </NativeKeyboardCommands>
  );
}

export function controllerNativeEffect(
  scopeId: string,
  effect: ControllerNativeEffect,
): Promise<ControllerScene | null> {
  if (Platform.OS !== "android") return Promise.resolve(null);
  return requireNativeModule<{
    controllerEffect(
      scopeId: string,
      kind: string,
      targetId: string,
      regionId: string,
      amount: number,
    ): Promise<ControllerScene | null>;
  }>("T3KeyboardCommands").controllerEffect(
    scopeId,
    effect.kind,
    effect.targetId,
    effect.regionId,
    effect.amount,
  );
}
