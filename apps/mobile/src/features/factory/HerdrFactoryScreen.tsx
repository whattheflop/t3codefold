import { useGT } from "gt-react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { View } from "react-native";

export function HerdrFactoryScreen() {
  const gt = useGT();
  return (
    <SettingsScreen title={gt("Herdr Core")}>
      <View className="gap-3 p-4">
        <Text>{gt("Native Herdr connections currently require the T3 desktop client.")}</Text>
        <Text>
          {gt(
            "Unmodified Core exposes local sockets and SSH stdio. It does not provide a browser or mobile WebSocket endpoint. Your factory continues running independently.",
          )}
        </Text>
      </View>
    </SettingsScreen>
  );
}
