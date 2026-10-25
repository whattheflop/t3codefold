import {
  MAX_THEME_BACKDROP_AMOUNT,
  MAX_THEME_BACKDROP_INTENSITY,
  MAX_THEME_BACKDROP_SEED,
  MIN_THEME_BACKDROP_AMOUNT,
  MIN_THEME_BACKDROP_INTENSITY,
} from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@t3tools/contracts/settings";
import { ShuffleIcon } from "lucide-react";
import { type CSSProperties, useMemo } from "react";

import { useTheme } from "../../hooks/useTheme";
import { useThemeDerivedBackdropColors } from "../../themeBackdrop";
import { Button } from "../ui/button";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../ui/number-field";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { VoiceSettings } from "../voice/VoiceWorkspaceProvider";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { SplatterPatternGallery } from "./SplatterPatternGallery";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

// Fold's settings rows and their part in "Restore defaults". SettingsPanels
// mounts each component where the row belongs and spreads the restore pieces.

const THEME_BACKDROP_COLOR_ROLES = ["Lead", "Second", "Accent"] as const;

const THEME_BACKDROP_DEFAULTS = {
  themeBackdropEnabled: DEFAULT_UNIFIED_SETTINGS.themeBackdropEnabled,
  themeBackdropScope: DEFAULT_UNIFIED_SETTINGS.themeBackdropScope,
  themeBackdropColors: DEFAULT_UNIFIED_SETTINGS.themeBackdropColors,
  themeBackdropIntensity: DEFAULT_UNIFIED_SETTINGS.themeBackdropIntensity,
  themeBackdropAmount: DEFAULT_UNIFIED_SETTINGS.themeBackdropAmount,
  themeBackdropGlow: DEFAULT_UNIFIED_SETTINGS.themeBackdropGlow,
  themeBackdropDynamic: DEFAULT_UNIFIED_SETTINGS.themeBackdropDynamic,
  themeBackdropSeed: DEFAULT_UNIFIED_SETTINGS.themeBackdropSeed,
};

function isThemeBackdropCustomized(settings: UnifiedSettings): boolean {
  return (Object.keys(THEME_BACKDROP_DEFAULTS) as Array<keyof typeof THEME_BACKDROP_DEFAULTS>).some(
    (key) => settings[key] !== THEME_BACKDROP_DEFAULTS[key],
  );
}

/** Fold settings that "Restore defaults" resets. */
export const FOLD_SETTINGS_DEFAULTS = {
  threadWrapEnabled: DEFAULT_UNIFIED_SETTINGS.threadWrapEnabled,
  threadWrapPortalsEnabled: DEFAULT_UNIFIED_SETTINGS.threadWrapPortalsEnabled,
  threadWrapMaxColumns: DEFAULT_UNIFIED_SETTINGS.threadWrapMaxColumns,
  citeSelectionEnabled: DEFAULT_UNIFIED_SETTINGS.citeSelectionEnabled,
  vimModeEnabled: DEFAULT_UNIFIED_SETTINGS.vimModeEnabled,
  vimThreadPreviewEnabled: DEFAULT_UNIFIED_SETTINGS.vimThreadPreviewEnabled,
  ...THEME_BACKDROP_DEFAULTS,
};

/** Labels for the Fold settings that differ from their defaults, for the restore dialog. */
export function useFoldChangedSettingLabels(settings: UnifiedSettings): ReadonlyArray<string> {
  const backdropCustomized = isThemeBackdropCustomized(settings);
  return useMemo(
    () => [
      ...(backdropCustomized ? ["Splatter backdrop"] : []),
      ...(settings.threadWrapEnabled !== DEFAULT_UNIFIED_SETTINGS.threadWrapEnabled ||
      settings.threadWrapPortalsEnabled !== DEFAULT_UNIFIED_SETTINGS.threadWrapPortalsEnabled ||
      settings.threadWrapMaxColumns !== DEFAULT_UNIFIED_SETTINGS.threadWrapMaxColumns
        ? ["Thread wrapping"]
        : []),
      ...(settings.citeSelectionEnabled !== DEFAULT_UNIFIED_SETTINGS.citeSelectionEnabled
        ? ["Show Cite on text selection"]
        : []),
      ...(settings.vimModeEnabled !== DEFAULT_UNIFIED_SETTINGS.vimModeEnabled
        ? ["Vim keyboard mode"]
        : []),
      ...(settings.vimThreadPreviewEnabled !== DEFAULT_UNIFIED_SETTINGS.vimThreadPreviewEnabled
        ? ["Preview threads while navigating"]
        : []),
    ],
    [
      backdropCustomized,
      settings.threadWrapEnabled,
      settings.threadWrapPortalsEnabled,
      settings.threadWrapMaxColumns,
      settings.citeSelectionEnabled,
      settings.vimModeEnabled,
      settings.vimThreadPreviewEnabled,
    ],
  );
}

/** Appearance: splatter backdrop and its options. */
export function ThemeBackdropSettingsRows() {
  const { resolvedTheme } = useTheme();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const themeBackdropColors = useThemeDerivedBackdropColors();
  const themeBackdropIntensityRatio =
    (settings.themeBackdropIntensity - MIN_THEME_BACKDROP_INTENSITY) /
    (MAX_THEME_BACKDROP_INTENSITY - MIN_THEME_BACKDROP_INTENSITY);
  const themeBackdropIntensitySliderStyle = {
    "--settings-slider-progress": `${themeBackdropIntensityRatio * 100}%`,
    "--settings-slider-fill-offset": `${0.5 - themeBackdropIntensityRatio}rem`,
  } as CSSProperties;
  const themeBackdropAmountRatio =
    (settings.themeBackdropAmount - MIN_THEME_BACKDROP_AMOUNT) /
    (MAX_THEME_BACKDROP_AMOUNT - MIN_THEME_BACKDROP_AMOUNT);
  const themeBackdropAmountSliderStyle = {
    "--settings-slider-progress": `${themeBackdropAmountRatio * 100}%`,
    "--settings-slider-fill-offset": `${0.5 - themeBackdropAmountRatio}rem`,
  } as CSSProperties;

  return (
    <>
      <SettingsRow
        {...searchableSetting("theme-backdrop")}
        description="Paint splatter and grain behind the conversation, in your theme's colors."
        resetAction={
          isThemeBackdropCustomized(settings) ? (
            <SettingResetButton
              label="splatter backdrop"
              onClick={() => updateSettings(THEME_BACKDROP_DEFAULTS)}
            />
          ) : null
        }
        control={
          <Switch
            checked={settings.themeBackdropEnabled}
            onCheckedChange={(checked) =>
              updateSettings({ themeBackdropEnabled: Boolean(checked) })
            }
            aria-label="Show the splatter backdrop"
          />
        }
      />

      {settings.themeBackdropEnabled ? (
        <>
          <SettingsRow
            {...searchableSetting("theme-backdrop-scope")}
            description="Cyberpunk and Codex ship with it; turn it on for every theme, custom ones included."
            control={
              <div className="w-full sm:w-44">
                <Select
                  value={settings.themeBackdropScope}
                  onValueChange={(value) => {
                    if (value === "featured" || value === "all")
                      updateSettings({ themeBackdropScope: value });
                  }}
                >
                  <SelectTrigger size="sm" className="w-full min-w-0" aria-label="Show splatter on">
                    <SelectValue>
                      {settings.themeBackdropScope === "all" ? "Every theme" : "Cyberpunk & Codex"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    <SelectItem value="featured">Cyberpunk & Codex (default)</SelectItem>
                    <SelectItem value="all">Every theme</SelectItem>
                  </SelectPopup>
                </Select>
              </div>
            }
          />

          <SettingsRow
            {...searchableSetting("theme-backdrop-colors")}
            description="Match the active theme's accent colors, or pick your own paint."
            control={
              <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
                {settings.themeBackdropColors
                  ? settings.themeBackdropColors.map((color, index) => (
                      <input
                        key={THEME_BACKDROP_COLOR_ROLES[index]}
                        aria-label={`${THEME_BACKDROP_COLOR_ROLES[index]} splatter color`}
                        className="size-7 cursor-pointer rounded-md border border-border bg-transparent p-0.5"
                        type="color"
                        value={color}
                        onChange={(event) => {
                          const next = [...settings.themeBackdropColors!] as [
                            string,
                            string,
                            string,
                          ];
                          next[index] = event.currentTarget.value;
                          updateSettings({ themeBackdropColors: next });
                        }}
                      />
                    ))
                  : null}
                <div className="w-full sm:w-36">
                  <Select
                    value={settings.themeBackdropColors ? "custom" : "theme"}
                    onValueChange={(value) => {
                      if (value === "theme") updateSettings({ themeBackdropColors: null });
                      // Start from what is on screen, not an arbitrary palette.
                      if (value === "custom" && !settings.themeBackdropColors)
                        updateSettings({ themeBackdropColors: [...themeBackdropColors] });
                    }}
                  >
                    <SelectTrigger
                      size="sm"
                      className="w-full min-w-0"
                      aria-label="Splatter colors"
                    >
                      <SelectValue>
                        {settings.themeBackdropColors ? "Custom" : "Match theme"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end" alignItemWithTrigger={false}>
                      <SelectItem value="theme">Match theme (default)</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectPopup>
                  </Select>
                </div>
              </div>
            }
          />

          <SettingsRow
            {...searchableSetting("theme-backdrop-intensity")}
            description="How strongly the paint shows through."
            control={
              <div className="flex w-full items-center gap-3 sm:w-52">
                <output
                  className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
                  htmlFor="theme-backdrop-intensity-input"
                >
                  {settings.themeBackdropIntensity}%
                </output>
                <input
                  aria-label="Splatter intensity"
                  className="settings-slider min-w-0 flex-1"
                  id="theme-backdrop-intensity-input"
                  max={MAX_THEME_BACKDROP_INTENSITY}
                  min={MIN_THEME_BACKDROP_INTENSITY}
                  onChange={(event) => {
                    const themeBackdropIntensity = Number(event.currentTarget.value);
                    if (
                      Number.isInteger(themeBackdropIntensity) &&
                      themeBackdropIntensity >= MIN_THEME_BACKDROP_INTENSITY &&
                      themeBackdropIntensity <= MAX_THEME_BACKDROP_INTENSITY
                    ) {
                      updateSettings({ themeBackdropIntensity });
                    }
                  }}
                  step={5}
                  style={themeBackdropIntensitySliderStyle}
                  type="range"
                  value={settings.themeBackdropIntensity}
                />
              </div>
            }
          />

          <SettingsRow
            {...searchableSetting("theme-backdrop-amount")}
            description="How much paint is scattered across the canvas, beyond the corners."
            control={
              <div className="flex w-full items-center gap-3 sm:w-52">
                <output
                  className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
                  htmlFor="theme-backdrop-amount-input"
                >
                  {settings.themeBackdropAmount}%
                </output>
                <input
                  aria-label="Splatter amount"
                  className="settings-slider min-w-0 flex-1"
                  id="theme-backdrop-amount-input"
                  max={MAX_THEME_BACKDROP_AMOUNT}
                  min={MIN_THEME_BACKDROP_AMOUNT}
                  onChange={(event) => {
                    const themeBackdropAmount = Number(event.currentTarget.value);
                    if (
                      Number.isInteger(themeBackdropAmount) &&
                      themeBackdropAmount >= MIN_THEME_BACKDROP_AMOUNT &&
                      themeBackdropAmount <= MAX_THEME_BACKDROP_AMOUNT
                    ) {
                      updateSettings({ themeBackdropAmount });
                    }
                  }}
                  step={10}
                  style={themeBackdropAmountSliderStyle}
                  type="range"
                  value={settings.themeBackdropAmount}
                />
              </div>
            }
          />

          <SettingsRow
            {...searchableSetting("theme-backdrop-seed")}
            description="Grows a different splatter pattern. 0 is the original; scroll the previews to browse."
            control={
              <div className="flex items-center gap-2">
                <NumberField
                  value={settings.themeBackdropSeed}
                  min={0}
                  max={MAX_THEME_BACKDROP_SEED}
                  step={1}
                  size="sm"
                  className="w-36"
                  onValueChange={(value) => {
                    if (
                      value !== null &&
                      Number.isInteger(value) &&
                      value >= 0 &&
                      value <= MAX_THEME_BACKDROP_SEED
                    )
                      updateSettings({ themeBackdropSeed: value });
                  }}
                >
                  <NumberFieldGroup>
                    <NumberFieldDecrement aria-label="Previous splatter pattern" />
                    <NumberFieldInput aria-label="Splatter pattern seed" />
                    <NumberFieldIncrement aria-label="Next splatter pattern" />
                  </NumberFieldGroup>
                </NumberField>
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label="Shuffle splatter pattern"
                  onClick={() =>
                    updateSettings({
                      themeBackdropSeed: 1 + Math.floor(Math.random() * MAX_THEME_BACKDROP_SEED),
                    })
                  }
                >
                  <ShuffleIcon />
                </Button>
              </div>
            }
          >
            <SplatterPatternGallery
              options={{
                colors: settings.themeBackdropColors ?? themeBackdropColors,
                appearance: resolvedTheme,
                intensity: settings.themeBackdropIntensity / 100,
                amount: settings.themeBackdropAmount / 100,
                glow: settings.themeBackdropGlow,
              }}
              selectedSeed={settings.themeBackdropSeed}
              onSelect={(themeBackdropSeed) => updateSettings({ themeBackdropSeed })}
            />
          </SettingsRow>

          <SettingsRow
            {...searchableSetting("theme-backdrop-glow")}
            description="Brighter bloom and a soft halo around every splat."
            control={
              <Switch
                checked={settings.themeBackdropGlow}
                onCheckedChange={(checked) =>
                  updateSettings({ themeBackdropGlow: Boolean(checked) })
                }
                aria-label="Neon glow"
              />
            }
          />

          <SettingsRow
            {...searchableSetting("theme-backdrop-dynamic")}
            description="Every merged pull request adds a splat in its project's color. Wipes clean at 6am."
            control={
              <Switch
                checked={settings.themeBackdropDynamic}
                onCheckedChange={(checked) =>
                  updateSettings({ themeBackdropDynamic: Boolean(checked) })
                }
                aria-label="Dynamic splatter"
              />
            }
          />
        </>
      ) : null}
    </>
  );
}

/** Appearance: connected columns for long threads on wide screens. */
export function ThreadWrapSettingsRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <>
      <SettingsRow
        {...searchableSetting("thread-wrap")}
        description="On wide screens, scroll threads through linked columns, from the bottom of one into the top of the next."
        resetAction={
          settings.threadWrapEnabled !== DEFAULT_UNIFIED_SETTINGS.threadWrapEnabled ||
          settings.threadWrapPortalsEnabled !== DEFAULT_UNIFIED_SETTINGS.threadWrapPortalsEnabled ||
          settings.threadWrapMaxColumns !== DEFAULT_UNIFIED_SETTINGS.threadWrapMaxColumns ? (
            <SettingResetButton
              label="thread wrapping"
              onClick={() =>
                updateSettings({
                  threadWrapEnabled: DEFAULT_UNIFIED_SETTINGS.threadWrapEnabled,
                  threadWrapPortalsEnabled: DEFAULT_UNIFIED_SETTINGS.threadWrapPortalsEnabled,
                  threadWrapMaxColumns: DEFAULT_UNIFIED_SETTINGS.threadWrapMaxColumns,
                })
              }
            />
          ) : null
        }
        control={
          <div className="flex w-full items-center justify-end gap-3 sm:w-auto">
            {settings.threadWrapEnabled ? (
              <div className="w-full sm:w-36">
                <Select
                  value={String(settings.threadWrapMaxColumns)}
                  onValueChange={(value) => {
                    const threadWrapMaxColumns = Number(value);
                    if (threadWrapMaxColumns >= 2 && threadWrapMaxColumns <= 4)
                      updateSettings({ threadWrapMaxColumns });
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-full min-w-0"
                    aria-label="Maximum thread columns"
                  >
                    <SelectValue>Up to {settings.threadWrapMaxColumns} columns</SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    <SelectItem value="2">Up to 2 columns</SelectItem>
                    <SelectItem value="3">Up to 3 columns (default)</SelectItem>
                    <SelectItem value="4">Up to 4 columns</SelectItem>
                  </SelectPopup>
                </Select>
              </div>
            ) : null}
            <Switch
              checked={settings.threadWrapEnabled}
              onCheckedChange={(checked) => updateSettings({ threadWrapEnabled: Boolean(checked) })}
              aria-label="Wrap long threads into columns on wide screens"
            />
          </div>
        }
      />
      {settings.threadWrapEnabled ? (
        <div className="pl-6">
          <SettingsRow
            title="Portals"
            description="Show orange and blue markers where the columns connect."
            control={
              <Switch
                checked={settings.threadWrapPortalsEnabled}
                onCheckedChange={(checked) =>
                  updateSettings({ threadWrapPortalsEnabled: Boolean(checked) })
                }
                aria-label="Show portals between thread columns"
              />
            }
          />
        </div>
      ) : null}
    </>
  );
}

/** General: the optional Cite bubble on assistant text selection. */
export function CiteSelectionSettingsRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      {...searchableSetting("cite-selection")}
      description="Show a Cite bubble when selecting assistant text to quote it in the composer."
      resetAction={
        settings.citeSelectionEnabled !== DEFAULT_UNIFIED_SETTINGS.citeSelectionEnabled ? (
          <SettingResetButton
            label="Cite on text selection"
            onClick={() =>
              updateSettings({
                citeSelectionEnabled: DEFAULT_UNIFIED_SETTINGS.citeSelectionEnabled,
              })
            }
          />
        ) : null
      }
      control={
        <Switch
          checked={settings.citeSelectionEnabled}
          onCheckedChange={(checked) => updateSettings({ citeSelectionEnabled: Boolean(checked) })}
          aria-label="Show Cite on text selection"
        />
      }
    />
  );
}

/** General: Vim keyboard mode and sidebar thread previews. */
export function VimKeyboardSettingsRows() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <>
      <SettingsRow
        {...searchableSetting("vim-keyboard-mode")}
        description="Use Vim-style navigation in conversations and modal editing in the composer. Press ? in conversation Normal mode for help."
        resetAction={
          settings.vimModeEnabled !== DEFAULT_UNIFIED_SETTINGS.vimModeEnabled ? (
            <SettingResetButton
              label="Vim keyboard mode"
              onClick={() =>
                updateSettings({
                  vimModeEnabled: DEFAULT_UNIFIED_SETTINGS.vimModeEnabled,
                })
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={settings.vimModeEnabled}
            onCheckedChange={(checked) => updateSettings({ vimModeEnabled: Boolean(checked) })}
            aria-label="Vim keyboard mode"
          />
        }
      />

      <SettingsRow
        {...searchableSetting("vim-thread-preview")}
        description="In Vim mode, preview threads as you move through the sidebar with j / k. Focus stays in the sidebar; press i to open the selection."
        resetAction={
          settings.vimThreadPreviewEnabled !== DEFAULT_UNIFIED_SETTINGS.vimThreadPreviewEnabled ? (
            <SettingResetButton
              label="Preview threads while navigating"
              onClick={() =>
                updateSettings({
                  vimThreadPreviewEnabled: DEFAULT_UNIFIED_SETTINGS.vimThreadPreviewEnabled,
                })
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={settings.vimThreadPreviewEnabled}
            disabled={!settings.vimModeEnabled}
            onCheckedChange={(checked) =>
              updateSettings({ vimThreadPreviewEnabled: Boolean(checked) })
            }
            aria-label="Preview threads while navigating"
          />
        }
      />
    </>
  );
}

/** General: live voice settings, anchored for settings search. */
export function LiveVoiceSettingsSection() {
  return (
    <div id={searchableSetting("live-voice").id}>
      <VoiceSettings />
    </div>
  );
}
