import { View, type StyleProp, type ViewStyle } from "react-native";
import { AppTextInput, type AppTextInputProps } from "./AppText";

export type ControllerTextInputProps = AppTextInputProps & {
  readonly containerStyle?: StyleProp<ViewStyle>;
};

export function ControllerTextInput({ containerStyle, ...props }: ControllerTextInputProps) {
  return containerStyle ? (
    <View style={containerStyle}>
      <AppTextInput {...props} />
    </View>
  ) : (
    <AppTextInput {...props} />
  );
}
