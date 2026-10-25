import type { ThemeBackdropScope } from "@t3tools/contracts";
import { useCallback, useMemo } from "react";

import type { Preferences } from "../../../persistence/mobile-preferences";

/** Fold's splatter backdrop settings, exposed through the appearance preferences context. */
export interface ThemeBackdropPreferences {
  /** Splatter backdrop on every theme; on unless turned off. */
  readonly themeBackdropEnabled: boolean;
  readonly setThemeBackdropEnabled: (value: boolean) => void;
  readonly themeBackdropScope: ThemeBackdropScope;
  readonly setThemeBackdropScope: (value: ThemeBackdropScope) => void;
  /** Percent of the tuned default alpha. */
  readonly themeBackdropIntensity: number;
  readonly setThemeBackdropIntensity: (value: number) => void;
  /** Percent of the tuned default number of marks across the canvas. */
  readonly themeBackdropAmount: number;
  readonly setThemeBackdropAmount: (value: number) => void;
  readonly themeBackdropGlow: boolean;
  readonly setThemeBackdropGlow: (value: boolean) => void;
  /** A splat per PR merged since 6am, in its project's colour. */
  readonly themeBackdropDynamic: boolean;
  readonly setThemeBackdropDynamic: (value: boolean) => void;
  /** Splatter pattern variant; 0 is the original art. */
  readonly themeBackdropSeed: number;
  readonly setThemeBackdropSeed: (value: number) => void;
  /** Custom paint colours, or null to follow the theme. */
  readonly themeBackdropColors: readonly [string, string, string] | null;
  readonly setThemeBackdropColors: (value: readonly [string, string, string] | null) => void;
}

export function useThemeBackdropPreferences(
  storedPreferences: Preferences | null,
  updatePreferences: (patch: Partial<Preferences>) => void,
): ThemeBackdropPreferences {
  const themeBackdropEnabled = storedPreferences?.themeBackdropEnabled ?? true;
  const setThemeBackdropEnabled = useCallback(
    (value: boolean) => {
      updatePreferences({ themeBackdropEnabled: value });
    },
    [updatePreferences],
  );
  const themeBackdropScope = storedPreferences?.themeBackdropScope ?? "all";
  const setThemeBackdropScope = useCallback(
    (value: ThemeBackdropScope) => {
      updatePreferences({ themeBackdropScope: value });
    },
    [updatePreferences],
  );
  const themeBackdropIntensity = storedPreferences?.themeBackdropIntensity ?? 100;
  const setThemeBackdropIntensity = useCallback(
    (value: number) => {
      updatePreferences({ themeBackdropIntensity: value });
    },
    [updatePreferences],
  );
  const themeBackdropAmount = storedPreferences?.themeBackdropAmount ?? 100;
  const setThemeBackdropAmount = useCallback(
    (value: number) => {
      updatePreferences({ themeBackdropAmount: value });
    },
    [updatePreferences],
  );
  const themeBackdropGlow = storedPreferences?.themeBackdropGlow ?? false;
  const setThemeBackdropGlow = useCallback(
    (value: boolean) => {
      updatePreferences({ themeBackdropGlow: value });
    },
    [updatePreferences],
  );
  const themeBackdropDynamic = storedPreferences?.themeBackdropDynamic ?? false;
  const setThemeBackdropDynamic = useCallback(
    (value: boolean) => {
      updatePreferences({ themeBackdropDynamic: value });
    },
    [updatePreferences],
  );
  const themeBackdropSeed = storedPreferences?.themeBackdropSeed ?? 0;
  const setThemeBackdropSeed = useCallback(
    (value: number) => {
      updatePreferences({ themeBackdropSeed: value });
    },
    [updatePreferences],
  );
  const themeBackdropColors = storedPreferences?.themeBackdropColors ?? null;
  const setThemeBackdropColors = useCallback(
    (value: readonly [string, string, string] | null) => {
      // undefined drops the key, so "follow the theme" is the absence of one.
      updatePreferences({ themeBackdropColors: value ?? undefined });
    },
    [updatePreferences],
  );

  return useMemo(
    () => ({
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
    }),
    [
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
    ],
  );
}
