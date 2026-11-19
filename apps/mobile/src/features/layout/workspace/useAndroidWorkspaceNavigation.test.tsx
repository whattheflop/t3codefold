import { act, useCallback, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
const state = vi.hoisted(() => ({ listeners: [] as Array<() => boolean>, navigate: vi.fn() }));
vi.mock("@react-navigation/native", async () => {
  return {
    StackActions: {},
    useNavigation: () => ({}),
    useIsFocused: () => true,
  };
});
vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  Keyboard: { isVisible: () => false },
  BackHandler: {
    addEventListener: (_: string, listener: () => boolean) => {
      state.listeners.push(listener);
      return {
        remove: () => {
          state.listeners.splice(state.listeners.indexOf(listener), 1);
        },
      };
    },
  },
}));
vi.mock("../../../lib/android-workspace-navigation", () => ({
  returnToAndroidWorkspaceList: () => state.navigate(),
}));
import { useAndroidWorkspaceBack } from "./useAndroidWorkspaceNavigation";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("keeps route Back below a stable pane owner after ordinary rerenders", () => {
  state.listeners = [];
  state.navigate.mockReset();
  let paneOpen = true;
  function Probe({ revision }: { revision: number }) {
    useAndroidWorkspaceBack();
    const paneBack = useCallback(() => {
      const listener = () => {
        if (!paneOpen) return false;
        paneOpen = false;
        return true;
      };
      state.listeners.push(listener);
      return () => {
        state.listeners.splice(state.listeners.indexOf(listener), 1);
      };
    }, []);
    useEffect(paneBack, [paneBack]);
    return revision;
  }
  const root = createRoot(document.createElement("div"));
  try {
    act(() => root.render(<Probe revision={0} />));
    act(() => root.render(<Probe revision={1} />));
    const press = () => [...state.listeners].reverse().some((listener) => listener());
    expect(press()).toBe(true);
    expect(paneOpen).toBe(false);
    expect(state.navigate).not.toHaveBeenCalled();
    expect(press()).toBe(true);
    expect(state.navigate).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
  }
});
