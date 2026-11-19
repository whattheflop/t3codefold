import { useEffect } from "react";
import { BackHandler, Keyboard, Platform } from "react-native";

import { dismissAndroidKeyboard } from "../lib/android-back";

/** Give the IME priority over React Navigation even on screens without a custom handler. */
export function AndroidKeyboardBackCoordinator() {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to keyboard and BackHandler events so Back closes the IME first
  useEffect(() => {
    if (Platform.OS !== "android") return;
    let backSubscription: ReturnType<typeof BackHandler.addEventListener> | undefined;
    const remove = () => {
      backSubscription?.remove();
      backSubscription = undefined;
    };
    const register = () => {
      remove();
      // BackHandler runs listeners newest first. Register when the IME opens,
      // after the navigator; local handlers also guard against later overlays.
      backSubscription = BackHandler.addEventListener("hardwareBackPress", dismissAndroidKeyboard);
    };
    const show = Keyboard.addListener("keyboardDidShow", register);
    const hide = Keyboard.addListener("keyboardDidHide", remove);
    if (Keyboard.isVisible()) register();
    return () => {
      remove();
      show.remove();
      hide.remove();
    };
  }, []);

  return null;
}
