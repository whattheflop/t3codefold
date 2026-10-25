import type { ThemeBackdropScope } from "@t3tools/contracts";
import {
  MAX_THEME_BACKDROP_AMOUNT,
  MAX_THEME_BACKDROP_INTENSITY,
  MAX_THEME_BACKDROP_SEED,
  MIN_THEME_BACKDROP_AMOUNT,
  MIN_THEME_BACKDROP_INTENSITY,
} from "@t3tools/contracts";
import { isSplatterHexColor } from "@t3tools/shared/splatterBackdrop";

/** Fold's device-local preferences, merged into mobile `Preferences`. */
export interface FoldPreferences {
  readonly notificationsEnabled?: boolean;
  /** Device-local mirror of the web `themeBackdropEnabled` client setting. */
  readonly themeBackdropEnabled?: boolean;
  /** Device-local mirrors of the web splatter backdrop client settings. */
  readonly themeBackdropScope?: ThemeBackdropScope;
  readonly themeBackdropIntensity?: number;
  readonly themeBackdropAmount?: number;
  readonly themeBackdropGlow?: boolean;
  readonly themeBackdropDynamic?: boolean;
  readonly themeBackdropSeed?: number;
  /** Lead, second and accent paint; absent follows the theme. */
  readonly themeBackdropColors?: readonly [string, string, string];
  /** Split-view thread sidebar shown beside threads; absent shows it. */
  readonly workspaceSidebarVisible?: boolean;
  /** Last resting width of the split-view inspector pane, in dp. */
  readonly workspaceInspectorWidth?: number;
  /** Vim-style hardware keyboard navigation. Android only, like web's `vimModeEnabled`. */
  readonly vimNavigationEnabled?: boolean;
  readonly workspaceThumbGesturesEnabled?: boolean;
  readonly workspaceInspectorRatios?: Readonly<Record<string, number>>;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** Keeps only well-formed Fold preference values from a stored payload. */
export function sanitizeFoldPreferences(parsed: FoldPreferences): FoldPreferences {
  const preferences: Mutable<FoldPreferences> = {};

  if (typeof parsed.notificationsEnabled === "boolean") {
    preferences.notificationsEnabled = parsed.notificationsEnabled;
  }
  if (typeof parsed.themeBackdropEnabled === "boolean")
    preferences.themeBackdropEnabled = parsed.themeBackdropEnabled;
  if (parsed.themeBackdropScope === "featured" || parsed.themeBackdropScope === "all")
    preferences.themeBackdropScope = parsed.themeBackdropScope;
  if (
    typeof parsed.themeBackdropIntensity === "number" &&
    Number.isInteger(parsed.themeBackdropIntensity) &&
    parsed.themeBackdropIntensity >= MIN_THEME_BACKDROP_INTENSITY &&
    parsed.themeBackdropIntensity <= MAX_THEME_BACKDROP_INTENSITY
  )
    preferences.themeBackdropIntensity = parsed.themeBackdropIntensity;
  if (
    typeof parsed.themeBackdropAmount === "number" &&
    Number.isInteger(parsed.themeBackdropAmount) &&
    parsed.themeBackdropAmount >= MIN_THEME_BACKDROP_AMOUNT &&
    parsed.themeBackdropAmount <= MAX_THEME_BACKDROP_AMOUNT
  )
    preferences.themeBackdropAmount = parsed.themeBackdropAmount;
  if (typeof parsed.themeBackdropGlow === "boolean")
    preferences.themeBackdropGlow = parsed.themeBackdropGlow;
  if (typeof parsed.themeBackdropDynamic === "boolean")
    preferences.themeBackdropDynamic = parsed.themeBackdropDynamic;
  if (
    typeof parsed.themeBackdropSeed === "number" &&
    Number.isInteger(parsed.themeBackdropSeed) &&
    parsed.themeBackdropSeed >= 0 &&
    parsed.themeBackdropSeed <= MAX_THEME_BACKDROP_SEED
  )
    preferences.themeBackdropSeed = parsed.themeBackdropSeed;
  if (
    Array.isArray(parsed.themeBackdropColors) &&
    parsed.themeBackdropColors.length === 3 &&
    parsed.themeBackdropColors.every(isSplatterHexColor)
  ) {
    const [lead, second, accent] = parsed.themeBackdropColors;
    preferences.themeBackdropColors = [lead, second, accent];
  }
  if (typeof parsed.vimNavigationEnabled === "boolean") {
    preferences.vimNavigationEnabled = parsed.vimNavigationEnabled;
  }
  if (typeof parsed.workspaceSidebarVisible === "boolean") {
    preferences.workspaceSidebarVisible = parsed.workspaceSidebarVisible;
  }
  if (
    typeof parsed.workspaceInspectorWidth === "number" &&
    Number.isFinite(parsed.workspaceInspectorWidth) &&
    parsed.workspaceInspectorWidth > 0
  ) {
    preferences.workspaceInspectorWidth = Math.round(parsed.workspaceInspectorWidth);
  }
  if (typeof parsed.workspaceThumbGesturesEnabled === "boolean") {
    preferences.workspaceThumbGesturesEnabled = parsed.workspaceThumbGesturesEnabled;
  }
  if (
    typeof parsed.workspaceInspectorRatios === "object" &&
    parsed.workspaceInspectorRatios !== null
  ) {
    preferences.workspaceInspectorRatios = Object.fromEntries(
      Object.entries(parsed.workspaceInspectorRatios).filter(
        ([key, ratio]) =>
          key.length < 80 &&
          typeof ratio === "number" &&
          Number.isFinite(ratio) &&
          ratio > 0 &&
          ratio < 1,
      ),
    );
  }
  return preferences;
}
