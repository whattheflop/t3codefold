import { View } from "react-native";

import {
  MAX_THEME_BACKDROP_AMOUNT,
  MAX_THEME_BACKDROP_INTENSITY,
  MAX_THEME_BACKDROP_SEED,
  MIN_THEME_BACKDROP_AMOUNT,
  MIN_THEME_BACKDROP_INTENSITY,
  type ThemeBackdropScope,
} from "@t3tools/contracts";
import { SettingsActionRow } from "../../components/SettingsActionRow";
import { SettingsChoiceRow } from "../../components/SettingsChoiceRow";
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

const BACKDROP_SCOPE_CHOICES: ReadonlyArray<{
  readonly scope: ThemeBackdropScope;
  readonly label: string;
  readonly description: string;
}> = [
  {
    scope: "featured",
    label: "Cyberpunk & Codex",
    description: "The themes that ship with it.",
  },
  { scope: "all", label: "Every theme", description: "In each theme's own colors." },
];

const SPLATTER_COLOR_ROLES = ["Lead", "Second", "Accent"] as const;

/** Fold's splatter backdrop settings, shown under the theme picker. */
export function SplatterBackdropSection() {
  const {
    isReady,
    themeBackdropEnabled,
    setThemeBackdropEnabled,
    themeBackdropScope,
    setThemeBackdropScope,
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
  } = useAppearancePreferences();

  return (
    <SettingsSection title="Splatter backdrop">
      <SettingsSwitchRow
        disabled={!isReady}
        icon="paintbrush"
        label="Show splatter"
        onValueChange={setThemeBackdropEnabled}
        value={themeBackdropEnabled}
      />
      {themeBackdropEnabled ? (
        <>
          {BACKDROP_SCOPE_CHOICES.map((choice) => (
            <SettingsChoiceRow
              key={choice.scope}
              label={choice.label}
              description={choice.description}
              selected={themeBackdropScope === choice.scope}
              separated
              disabled={!isReady}
              onPress={() => setThemeBackdropScope(choice.scope)}
            />
          ))}
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
            icon="arrow.triangle.merge"
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
              setThemeBackdropColors(custom ? themeSplatterColors(themeId, themeAppearance) : null)
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
              colors: themeBackdropColors ?? themeSplatterColors(themeId, themeAppearance),
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
