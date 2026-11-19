import { requireNativeModule } from "expo";
import { dismissAndroidKeyboard } from "../lib/android-back";

export function requestAndroidBack() {
  if (dismissAndroidKeyboard()) return;
  void requireNativeModule<{ requestBack: () => Promise<void> }>("T3NativeControls").requestBack();
}

export function disableAndroidController() {
  return requireNativeModule<{ disableController: () => Promise<void> }>(
    "T3NativeControls",
  ).disableController();
}
