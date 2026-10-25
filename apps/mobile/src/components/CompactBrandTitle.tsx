import { NATIVE_WORKSPACE_COLUMNS_SUPPORTED } from "../native/NativeWorkspaceColumns";
import Constants from "expo-constants";
import type { NativeStackNavigationOptions } from "@react-navigation/native-stack";
import { Platform, View } from "react-native";

import { AppText as Text } from "./ui/AppText";
import { FoldAndroidBrandTitle } from "./FoldAndroidBrandTitle";
import { T3Wordmark } from "./T3Wordmark";
import { IPAD_HOME_TITLE_OFFSET } from "../lib/layoutMetrics";
import { resolveMobileStageLabel } from "../lib/mobileBranding";
import { useAndroidControlSizing } from "./ui/useAndroidControlSizing";

export function brandTitleOffset(): number {
  if (Platform.OS !== "ios") return 0;
  return Platform.isPad && !NATIVE_WORKSPACE_COLUMNS_SUPPORTED ? IPAD_HOME_TITLE_OFFSET : 0;
}

export function CompactBrandTitle(
  props: {
    readonly allowFontScaling?: boolean;
    readonly accessibilityLabel?: string;
  } = {},
) {
  const stageLabel = resolveMobileStageLabel(Constants.expoConfig?.extra?.appVariant);
  const titleOffset = brandTitleOffset();
  const { scale } = useAndroidControlSizing();

  if (Platform.OS === "android") return <FoldAndroidBrandTitle {...props} />;

  return (
    <View
      aria-level={1}
      accessibilityLabel={props.accessibilityLabel ?? "T3 Code Fold, Threads"}
      accessible
      role="heading"
      className="flex-row items-center gap-1.5"
      style={{ marginLeft: titleOffset, minWidth: 0, flexShrink: 1, overflow: "hidden" }}
    >
      <T3Wordmark colorClassName="accent-icon" height={Math.round(15 * scale)} />
      <Text
        allowFontScaling={props.allowFontScaling}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
        className="font-t3-medium text-foreground-muted"
        style={{ fontSize: 21 * scale, letterSpacing: -0.5 * scale, flexShrink: 1 }}
      >
        Code Fold
      </Text>
      {stageLabel ? (
        <View className="rounded-full bg-subtle px-1.5 py-0.5">
          <Text
            allowFontScaling={props.allowFontScaling}
            className="font-t3-bold text-foreground-muted uppercase"
            style={{ fontSize: 9 * scale, letterSpacing: 0.9 * scale }}
          >
            {stageLabel}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function renderCompactBrandTitle() {
  return <CompactBrandTitle allowFontScaling={Platform.OS === "ios"} />;
}

export function getCompactBrandHeaderOptions(
  fallbackTitleStyle?: NativeStackNavigationOptions["headerTitleStyle"],
): NativeStackNavigationOptions {
  return {
    headerTitle: renderCompactBrandTitle,
    headerTitleStyle: fallbackTitleStyle,
    title: "Threads",
    unstable_headerLeftItems: undefined,
  };
}
