import { View } from "react-native";

import { FoldBrandLogo } from "./FoldBrandLogo";
import { MOBILE_APP_NAME } from "../lib/mobileBranding";
import { useAndroidControlSizing } from "./ui/useAndroidControlSizing";

/** The wordmark scales inside its slot so header actions always keep their space. */
export function FoldAndroidBrandTitle(props: {
  readonly allowFontScaling?: boolean | undefined;
  readonly accessibilityLabel?: string | undefined;
}) {
  const { scale } = useAndroidControlSizing();
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={props.accessibilityLabel ?? `${MOBILE_APP_NAME}, Threads`}
      style={{
        width: 180 * scale,
        maxWidth: "100%",
        aspectRatio: 300 / 56,
        flexShrink: 1,
        overflow: "hidden",
      }}
    >
      <FoldBrandLogo />
    </View>
  );
}
