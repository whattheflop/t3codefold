import { AppText as Text } from "../../components/ui/AppText";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { View } from "react-native";

export function HerdrFactoryScreen() {
  return (
    <SettingsScreen title="Herdr Core">
      <View className="gap-3 p-4">
        <Text>Native Herdr connections currently require the T3 desktop client.</Text>
        <Text>
          Unmodified Core exposes local sockets and SSH stdio. It does not provide a browser or
          mobile WebSocket endpoint. Your factory continues running independently.
        </Text>
      </View>
    </SettingsScreen>
  );
}
