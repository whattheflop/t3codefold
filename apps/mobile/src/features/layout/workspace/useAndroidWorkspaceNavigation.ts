import { StackActions, useIsFocused, useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useEffectEvent } from "react";
import { BackHandler, Keyboard, Platform } from "react-native";
import { returnToAndroidWorkspaceList } from "../../../lib/android-workspace-navigation";

export function useWorkspaceBackNavigation() {
  const navigation = useNavigation();
  return useCallback(() => {
    if (Platform.OS === "android") returnToAndroidWorkspaceList(navigation);
    else if (navigation.canGoBack()) navigation.goBack();
    else navigation.dispatch(StackActions.replace("Home"));
  }, [navigation]);
}

export function useAndroidWorkspaceBack() {
  const goBack = useWorkspaceBackNavigation();
  const onBack = useEffectEvent(() => goBack());
  const isFocused = useIsFocused();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Subscribe to native Back while this route owns focus.
  useEffect(() => {
    if (Platform.OS !== "android" || !isFocused) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (Keyboard.isVisible()) Keyboard.dismiss();
      else onBack();
      return true;
    });
    return () => subscription.remove();
  }, [isFocused]);
  return goBack;
}
