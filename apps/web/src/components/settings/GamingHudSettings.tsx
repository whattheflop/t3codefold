import { useClientSettings, useUpdateClientSettings } from "../../hooks/useSettings";
import { searchableSetting } from "./settingsSearch";
import { SettingsRow } from "./settingsLayout";
import { Switch } from "../ui/switch";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

const positions = {
  "top-right": "Top right",
  "top-left": "Top left",
  "bottom-right": "Bottom right",
  "bottom-left": "Bottom left",
};
export function GamingHudSettings() {
  const enabled = useClientSettings((settings) => settings.gamingHudEnabled);
  const position = useClientSettings((settings) => settings.gamingHudPosition);
  const update = useUpdateClientSettings();
  if (!window.desktopBridge?.setGamingHud) return null;
  return (
    <>
      <SettingsRow
        {...searchableSetting("gaming-hud")}
        description="Keep agent activity above other apps without capturing clicks or keyboard input. Use borderless or windowed games. Turn this off here to hide the HUD."
        control={
          <Switch
            checked={enabled}
            onCheckedChange={(checked) => update({ gamingHudEnabled: checked })}
            aria-label="Gaming HUD"
          />
        }
      />
      {enabled ? (
        <SettingsRow
          {...searchableSetting("gaming-hud-corner")}
          description="Shown on the display containing the T3 Code window."
          control={
            <Select
              value={position}
              onValueChange={(value) => {
                if (
                  value === "top-right" ||
                  value === "top-left" ||
                  value === "bottom-right" ||
                  value === "bottom-left"
                )
                  update({ gamingHudPosition: value });
              }}
            >
              <SelectTrigger size="sm" aria-label="HUD corner">
                <SelectValue>{positions[position]}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {Object.entries(positions).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
      ) : null}
    </>
  );
}
