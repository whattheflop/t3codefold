import { useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  reportAtomCommandResult,
  settleAsyncResult,
  settlePromise,
} from "@t3tools/client-runtime/state/runtime";
import * as Notifications from "expo-notifications";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useState } from "react";
import { Alert, AppState, Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { runtime } from "../../lib/runtime";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { requestAgentNotificationPermission } from "../agent-awareness/notificationPermissions";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";

/**
 * Fold's Android notification settings for builds without T3 Connect: agent activity is
 * delivered as local notifications while the app stays connected in the background.
 */
export function LocalNotificationSettingsScreen() {
  const insets = useSafeAreaInsets();
  return (
    <SettingsScreen title="Notifications">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <LocalNotificationSettingsSection />
      </ScrollView>
    </SettingsScreen>
  );
}

function LocalNotificationSettingsSection() {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const [granted, setGranted] = useState(false);
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    const refresh = async () => {
      const result = await settlePromise(() => Notifications.getPermissionsAsync());
      if (result._tag === "Success") setGranted(result.value.granted);
      else reportAtomCommandResult(result, { label: "notification permission refresh" });
      setBusy(false);
    };
    void refresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => subscription.remove();
  }, []);
  const changeEnabled = async (enabled: boolean) => {
    if (!enabled) {
      savePreferences({ notificationsEnabled: false });
      return;
    }
    setBusy(true);
    const result = await settleAsyncResult(() =>
      runtime.runPromiseExit(requestAgentNotificationPermission),
    );
    setBusy(false);
    if (result._tag === "Failure") {
      reportAtomCommandResult(result, { label: "notification permission request" });
      return;
    }
    const allowed = result.value.type === "granted";
    setGranted(allowed);
    if (allowed) savePreferences({ notificationsEnabled: true });
    else if (result.value.type === "denied" && !result.value.canAskAgain) {
      Alert.alert("Notifications disabled", "Open system Settings to enable notifications.", [
        { text: "Cancel", style: "cancel" },
        { text: "Open Settings", onPress: () => void Linking.openSettings() },
      ]);
    }
  };
  return (
    <SettingsSection title="Agent activity">
      <SettingsSwitchRow
        icon="bell.badge"
        label="Device Notifications"
        subtitle="While connected in the background"
        disabled={busy || !AsyncResult.isSuccess(preferences)}
        value={
          granted &&
          AsyncResult.isSuccess(preferences) &&
          preferences.value.notificationsEnabled === true
        }
        onValueChange={(enabled) => void changeEnabled(enabled)}
      />
    </SettingsSection>
  );
}
