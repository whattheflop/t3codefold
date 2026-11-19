import { StackActions, useNavigation } from "@react-navigation/native";
import { useEffect, useEffectEvent, useRef } from "react";

export interface TerminalInspectorNavigation {
  readonly active: boolean;
  readonly close: () => void;
  readonly selectTerminal: (terminalId: string) => void;
}

/**
 * Leaves a terminal screen whose shell exited: to another live terminal of the
 * thread, else back. Screen navigation acts on the top route of the stack, so
 * a shell that exits while another screen is on top waits until its own screen
 * is focused again.
 */
export function useTerminalExitNavigation(target: {
  readonly environmentId: string;
  readonly threadId: string;
  readonly readFallbackTerminalId: () => string | null;
  readonly inspectorNavigation?: TerminalInspectorNavigation;
}) {
  const navigation = useNavigation();
  const pendingRef = useRef(false);

  const selectTerminal = (terminalId: string) => {
    if (target.inspectorNavigation) {
      target.inspectorNavigation.selectTerminal(terminalId);
      return;
    }
    navigation.dispatch(
      StackActions.replace("ThreadTerminal", {
        environmentId: target.environmentId,
        threadId: target.threadId,
        terminalId,
      }),
    );
  };

  const close = () => {
    if (target.inspectorNavigation) {
      target.inspectorNavigation.close();
      return;
    }
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.dispatch(
      StackActions.replace("Thread", {
        environmentId: target.environmentId,
        threadId: target.threadId,
      }),
    );
  };

  const navigateAway = useEffectEvent(() => {
    const fallbackTerminalId = target.readFallbackTerminalId();
    if (fallbackTerminalId === null) close();
    else selectTerminal(fallbackTerminalId);
  });

  const resume = useEffectEvent(() => {
    if (
      !pendingRef.current ||
      !navigation.isFocused() ||
      target.inspectorNavigation?.active === false
    )
      return;
    pendingRef.current = false;
    navigateAway();
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- focus subscription for the screen's lifetime; an exit behind another screen navigates when the user returns
  useEffect(() => navigation.addListener("focus", () => resume()), [navigation]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- A retained terminal resumes its pending exit when its inspector pane becomes active again.
  useEffect(() => {
    if (target.inspectorNavigation?.active) resume();
  }, [target.inspectorNavigation?.active]);

  return {
    close,
    selectTerminal,
    exited: () => {
      if (navigation.isFocused() && target.inspectorNavigation?.active !== false) {
        navigateAway();
        return;
      }
      pendingRef.current = true;
    },
    /** A shell that runs again before the screen regains focus keeps the screen. */
    restarted: () => {
      pendingRef.current = false;
    },
  };
}
