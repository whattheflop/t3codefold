import Constants from "expo-constants";
import { useGT } from "gt-react-native";
import { resolveMobileStageLabel } from "../lib/mobileBranding";

export function useMobileStageLabel() {
  const gt = useGT();
  switch (resolveMobileStageLabel(Constants.expoConfig?.extra?.appVariant)) {
    case "Dev":
      return gt("Dev", { $context: "app release stage badge" });
    case "Nightly":
      return gt("Nightly", { $context: "app release stage badge" });
    default:
      return null;
  }
}
