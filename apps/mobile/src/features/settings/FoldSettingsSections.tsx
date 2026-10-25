import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { Platform } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { SettingsChoiceRow } from "./components/SettingsChoiceRow";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";

function useMobilePreferenceSettings() {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const preferencesReady = AsyncResult.isSuccess(preferencesResult) && !preferencesResult.waiting;
  const preferences = AsyncResult.isSuccess(preferencesResult) ? preferencesResult.value : null;
  return { preferences, preferencesReady, savePreferences };
}

/** Android Vim navigation toggle and key reference, under Settings > Keyboard. */
export function VimNavigationSettings() {
  const { preferences, preferencesReady, savePreferences } = useMobilePreferenceSettings();
  if (Platform.OS !== "android") return null;
  const vimNavigationEnabled = preferences?.vimNavigationEnabled === true;
  return (
    <>
      <SettingsSection title="Navigation">
        <SettingsSwitchRow
          icon="keyboard"
          label="Vim navigation"
          subtitle="Move between panes and threads with Vim keys when no text field is focused."
          disabled={!preferencesReady}
          value={vimNavigationEnabled}
          onValueChange={(enabled) => savePreferences({ vimNavigationEnabled: enabled })}
        />
      </SettingsSection>
      {vimNavigationEnabled ? (
        <Text className="px-2 text-sm text-foreground-muted">
          j/k move · gg/G jump · Enter opens · i writes · Esc leaves the composer · Ctrl-w h/l
          switches pane · Ctrl-w o maximizes · / searches · Space opens commands
        </Text>
      ) : null}
    </>
  );
}

/** Android foldable workspace gestures and pane sizes, under Settings > Project grouping. */
export function WorkspaceGestureSettings() {
  const { preferences, preferencesReady, savePreferences } = useMobilePreferenceSettings();
  if (Platform.OS !== "android") return null;
  return (
    <SettingsSection title="Workspace gestures">
      <SettingsSwitchRow
        icon="sidebar.left"
        label="Thumb navigation"
        subtitle="Use the bottom handle: swipe sideways through recent threads, up for the sidebar, down for the inspector."
        disabled={!preferencesReady}
        value={preferences?.workspaceThumbGesturesEnabled === true}
        onValueChange={(enabled) => savePreferences({ workspaceThumbGesturesEnabled: enabled })}
      />
      <SettingsChoiceRow
        label="Reset pane sizes"
        description="Return remembered workspace splits to the fold or default width."
        selected={false}
        separated
        disabled={!preferencesReady}
        onPress={() =>
          savePreferences({
            workspaceInspectorRatios: {},
            workspaceInspectorWidth: undefined,
          })
        }
      />
    </SettingsSection>
  );
}
