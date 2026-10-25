import { View } from "react-native";
import { PullRequestGlyph } from "../../../pull-requests/pullRequestGlyphs";

import {
  MAX_THEME_BACKDROP_AMOUNT,
  MAX_THEME_BACKDROP_INTENSITY,
  MAX_THEME_BACKDROP_SEED,
  MIN_THEME_BACKDROP_AMOUNT,
  MIN_THEME_BACKDROP_INTENSITY,
} from "@t3tools/contracts";
import { SettingsActionRow } from "../../components/SettingsActionRow";
import { SettingsSection } from "../../components/SettingsSection";
import { SettingsSwitchRow } from "../../components/SettingsSwitchRow";
import { FontSizeSliderRow } from "../components/FontSizeSliderRow";
import { SplatterPatternStrip } from "../components/SplatterPatternStrip";
import {
  splatterHexToHue,
  splatterHueToHex,
  themeSplatterColors,
} from "../../../../lib/splatterColors";
import { useAppearancePreferences } from "../AppearancePreferencesProvider";

const SPLATTER_COLOR_ROLES = ["Lead", "Second", "Accent"] as const;

/** Fold's splatter backdrop settings, shown under the theme picker. */
export function SplatterBackdropSection() {
  const {
    isReady,
    themeBackdropEnabled,
    setThemeBackdropEnabled,
    themeBackdropIntensity,
    setThemeBackdropIntensity,
    themeBackdropAmount,
    setThemeBackdropAmount,
    themeBackdropGlow,
    setThemeBackdropGlow,
    themeBackdropDynamic,
    setThemeBackdropDynamic,
    themeBackdropSeed,
    setThemeBackdropSeed,
    themeBackdropColors,
    setThemeBackdropColors,
    themeId,
    themeAppearance,
    themeVariables,
  } = useAppearancePreferences();

  return (
    <SettingsSection title="Splatter backdrop">
      <SettingsSwitchRow
        disabled={!isReady}
        icon="paintbrush"
        label="Show splatter"
        subtitle="Use the active theme's colors on every theme."
        onValueChange={setThemeBackdropEnabled}
        value={themeBackdropEnabled}
      />
      {themeBackdropEnabled ? (
        <>
          <FontSizeSliderRow
            disabled={!isReady}
            icon="slider.horizontal.3"
            label="Intensity"
            max={MAX_THEME_BACKDROP_INTENSITY}
            min={MIN_THEME_BACKDROP_INTENSITY}
            onChange={setThemeBackdropIntensity}
            step={5}
            value={themeBackdropIntensity}
            valueLabel={`${themeBackdropIntensity}%`}
          />
          <FontSizeSliderRow
            disabled={!isReady}
            icon={{ ios: "sparkles", android: "auto_awesome" }}
            label="Amount"
            max={MAX_THEME_BACKDROP_AMOUNT}
            min={MIN_THEME_BACKDROP_AMOUNT}
            onChange={setThemeBackdropAmount}
            step={10}
            value={themeBackdropAmount}
            valueLabel={`${themeBackdropAmount}%`}
          />
          <SettingsSwitchRow
            disabled={!isReady}
            icon="sun.max"
            label="Neon glow"
            onValueChange={setThemeBackdropGlow}
            value={themeBackdropGlow}
          />
          <SettingsSwitchRow
            disabled={!isReady}
            icon={PullRequestGlyph.merged}
            label="Dynamic splatter"
            subtitle="A splat per merged PR, in its project's color. Wipes clean at 6am."
            onValueChange={setThemeBackdropDynamic}
            value={themeBackdropDynamic}
          />
          <SettingsSwitchRow
            disabled={!isReady}
            icon="paintbrush"
            label="Custom colors"
            // Start from what is on screen, not an arbitrary palette.
            onValueChange={(custom) =>
              setThemeBackdropColors(
                custom ? themeSplatterColors(themeId, themeAppearance, themeVariables) : null,
              )
            }
            value={themeBackdropColors !== null}
          />
          {themeBackdropColors ? (
            <>
              <View className="flex-row justify-center gap-3 py-2">
                {themeBackdropColors.map((color, index) => (
                  <View
                    key={SPLATTER_COLOR_ROLES[index]}
                    accessibilityLabel={`${SPLATTER_COLOR_ROLES[index]} color ${color}`}
                    className="size-8 rounded-full border border-border"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </View>
              {themeBackdropColors.map((color, index) => {
                const hue = splatterHexToHue(color);
                return (
                  <FontSizeSliderRow
                    key={SPLATTER_COLOR_ROLES[index]}
                    disabled={!isReady}
                    icon="paintbrush"
                    label={`${SPLATTER_COLOR_ROLES[index]} hue`}
                    max={355}
                    min={0}
                    onChange={(next) => {
                      const colors = [...themeBackdropColors] as [string, string, string];
                      colors[index] = splatterHueToHex(next);
                      setThemeBackdropColors(colors);
                    }}
                    step={5}
                    value={hue}
                    valueLabel={`${hue}°`}
                  />
                );
              })}
            </>
          ) : null}
          <SplatterPatternStrip
            disabled={!isReady}
            options={{
              colors:
                themeBackdropColors ??
                themeSplatterColors(themeId, themeAppearance, themeVariables),
              appearance: themeAppearance,
              intensity: themeBackdropIntensity / 100,
              amount: themeBackdropAmount / 100,
              glow: themeBackdropGlow,
            }}
            selectedSeed={themeBackdropSeed}
            onSelect={setThemeBackdropSeed}
          />
          <SettingsActionRow
            disabled={!isReady}
            icon="arrow.clockwise"
            label={
              themeBackdropSeed === 0
                ? "Shuffle pattern"
                : `Shuffle pattern (#${themeBackdropSeed})`
            }
            onPress={() =>
              setThemeBackdropSeed(1 + Math.floor(Math.random() * MAX_THEME_BACKDROP_SEED))
            }
          />
          {themeBackdropSeed !== 0 ? (
            <SettingsActionRow
              disabled={!isReady}
              icon="paintbrush"
              label="Original pattern"
              onPress={() => setThemeBackdropSeed(0)}
            />
          ) : null}
        </>
      ) : null}
    </SettingsSection>
  );
}
