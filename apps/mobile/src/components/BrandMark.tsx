import { useMobileStageLabel } from "./useMobileStageLabel";
import { Image } from "expo-image";
import { T } from "gt-react-native";
import { View } from "react-native";

import { AppText as Text } from "./ui/AppText";
import { T3_CODE_BRAND_MARK_SOURCE } from "./brandAssets";
import { MOBILE_APP_NAME } from "../lib/mobileBranding";

export function BrandMark(props: { readonly compact?: boolean; readonly stageLabel?: string }) {
  const defaultStageLabel = useMobileStageLabel();
  const compact = props.compact ?? false;
  const iconSize = compact ? 32 : 44;
  const stageLabel = props.stageLabel ?? defaultStageLabel;

  return (
    <View className="flex-row items-center gap-3">
      <Image
        source={T3_CODE_BRAND_MARK_SOURCE}
        accessibilityIgnoresInvertColors
        style={{
          width: iconSize,
          height: iconSize,
          borderRadius: compact ? 10 : 14,
        }}
      />
      <View className="gap-1">
        <View className="flex-row items-center gap-2">
          <Text className="text-lg font-t3-bold tracking-[-0.4px] text-foreground">
            {MOBILE_APP_NAME}
          </Text>
          {stageLabel ? (
            <View className="rounded-full bg-subtle px-2 py-1">
              <Text className="text-3xs font-t3-bold tracking-[1.1px] uppercase text-foreground-muted">
                {stageLabel}
              </Text>
            </View>
          ) : null}
        </View>
        {!compact ? (
          <Text className="text-xs font-medium text-foreground-muted">
            <T>Mobile control surface for your live coding environments</T>
          </Text>
        ) : null}
      </View>
    </View>
  );
}
