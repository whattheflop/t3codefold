import { Platform, View } from "react-native";

import { cn } from "../../lib/cn";

/** Outlines the row under Vim navigation's cursor, following the row's corner radius. */
export function KeyboardFocusRing() {
  return (
    <View
      pointerEvents="none"
      className={cn(
        "absolute inset-0 border-2 border-primary",
        Platform.OS === "android" ? "rounded-[20px]" : "rounded-xl",
      )}
    />
  );
}
