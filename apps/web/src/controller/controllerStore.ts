import { create } from "zustand";
import { persist } from "zustand/middleware";

export const useControllerSettings = create(
  persist(() => ({ enabled: false }), { name: "t3-controller-console" }),
);
export function setControllerEnabled(enabled: boolean) {
  useControllerSettings.setState({ enabled });
}

let threadNavigation: ((direction: "previous" | "next") => void) | undefined;
export function registerControllerThreads(handler: NonNullable<typeof threadNavigation>) {
  threadNavigation = handler;
  return () => {
    if (threadNavigation === handler) threadNavigation = undefined;
  };
}
export function navigateControllerThread(direction: "previous" | "next") {
  threadNavigation?.(direction);
}

export function toggleControllerEnabled() {
  setControllerEnabled(!useControllerSettings.getState().enabled);
}
