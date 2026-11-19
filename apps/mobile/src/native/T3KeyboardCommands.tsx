import type { PropsWithChildren } from "react";
import { View } from "react-native";

import type {
  ControllerNativeEffect,
  ControllerNativeEvent,
  ControllerScene,
} from "../features/controller/controllerNavigation";
import type { HardwareKeyboardCommand } from "../features/keyboard/hardwareKeyboardCommands";

/** A key forwarded for Vim navigation (see features/keyboard/vimNavigation). */
type VimKey = { readonly key: string; readonly ctrl?: boolean };

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
  return <View className="flex-1">{props.children}</View>;
}

export function controllerNativeEffect(
  _scopeId: string,
  _effect: ControllerNativeEffect,
): Promise<ControllerScene | null> {
  return Promise.resolve(null);
}
