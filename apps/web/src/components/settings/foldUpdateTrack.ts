import { useGT } from "gt-react";
import type { DesktopUpdateChannel } from "@t3tools/contracts";
import { useState } from "react";

import { stackedThreadToast, toastManager } from "../ui/toast";

// Upstream's track switch resolves versions from npm `t3`, which Fold does not publish;
// Fold switches only this app's updater, whose feeds are Fold's GitHub releases.
export function useFoldUpdateTrackChange(selected: DesktopUpdateChannel) {
  const gt = useGT();
  const [isChanging, setIsChanging] = useState(false);
  const change = (channel: DesktopUpdateChannel) => {
    const bridge = window.desktopBridge;
    if (!bridge || typeof bridge.setUpdateChannel !== "function" || channel === selected) return;
    setIsChanging(true);
    void bridge
      .setUpdateChannel(channel)
      .catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: gt("Could not change update track"),
            description: error instanceof Error ? error.message : gt("Update track change failed."),
          }),
        );
      })
      .finally(() => setIsChanging(false));
  };
  return { isChanging, change };
}
