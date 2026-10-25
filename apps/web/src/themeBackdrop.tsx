import type { ClientSettings } from "@t3tools/contracts";
import {
  mergeDayStart,
  mergeSplats,
  mergesSince,
  nextMergeDayStart,
} from "@t3tools/shared/mergeSplatters";
import type { ThemeAppearance } from "@t3tools/shared/themePalettes";
import {
  deriveSplatterColors,
  parseOklch,
  renderMergeSplatters,
  renderSplatterCluster,
  renderSplatterField,
  type SplatterRenderOptions,
} from "@t3tools/shared/splatterBackdrop";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";

import { useMediaQuery } from "./hooks/useMediaQuery";
import { useClientSettings } from "./hooks/useSettings";
import { useTheme } from "./hooks/useTheme";
import { useMergedPullRequests } from "./state/foldMergedPullRequests";
import {
  getStandardThemeColors,
  getThemeColorsForMode,
  getThemeDefinition,
  resolveThemeHalf,
  toCanonicalThemeColor,
} from "./themePalette";

/** Themes that show the backdrop without the "every theme" scope. */
const FEATURED_THEME_IDS: ReadonlySet<string> = new Set(["cyberpunk", "codex"]);

type BackdropSettings = Pick<
  ClientSettings,
  | "themeBackdropEnabled"
  | "themeBackdropScope"
  | "themeBackdropColors"
  | "themeBackdropIntensity"
  | "themeBackdropAmount"
  | "themeBackdropGlow"
  | "themeBackdropSeed"
>;

const colorOf = (value: string | undefined) => parseOklch(toCanonicalThemeColor(value));

/**
 * What the canvas should paint for this theme and these settings, or null for
 * nothing. Theme colours come from the palette's accent and action roles, so
 * a custom or published theme gets matching paint with no art of its own.
 */
function resolveThemeBackdrop(input: {
  readonly settings: BackdropSettings;
  readonly themeId: string | null;
  readonly accent: string | undefined;
  readonly action: string | undefined;
  readonly appearance: ThemeAppearance;
}): SplatterRenderOptions | null {
  const { settings, themeId, accent, action, appearance } = input;
  if (!settings.themeBackdropEnabled) return null;
  if (settings.themeBackdropScope !== "all" && !FEATURED_THEME_IDS.has(themeId ?? "")) {
    return null;
  }
  return {
    colors:
      settings.themeBackdropColors ??
      deriveSplatterColors(colorOf(accent), colorOf(action), appearance),
    appearance,
    intensity: settings.themeBackdropIntensity / 100,
    amount: settings.themeBackdropAmount / 100,
    glow: settings.themeBackdropGlow,
    seed: settings.themeBackdropSeed,
  };
}

const BACKDROP_LAYERS = ["a", "b", "field"] as const;

const selectBackdropSettings = (settings: ClientSettings): BackdropSettings => settings;
const selectBackdropDynamic = (settings: ClientSettings) => settings.themeBackdropDynamic;

/** The active theme's id and the two roles the paint colours derive from. */
function useActiveBackdropSource() {
  const { theme, themeHalves, resolvedTheme } = useTheme();
  const definition = getThemeDefinition(resolveThemeHalf(theme, themeHalves, resolvedTheme));
  const colors = definition
    ? (getThemeColorsForMode(definition, resolvedTheme) ?? definition.colors)
    : getStandardThemeColors(resolvedTheme);
  return {
    themeId: definition?.id ?? null,
    accent: colors.accent,
    action: colors.messageAction,
    appearance: resolvedTheme,
  };
}

/** Paint colours the active theme would get, for seeding the custom pickers. */
export function useThemeDerivedBackdropColors(): readonly [string, string, string] {
  const { accent, action, appearance } = useActiveBackdropSource();
  return useMemo(
    () => deriveSplatterColors(colorOf(accent), colorOf(action), appearance),
    [accent, action, appearance],
  );
}

/**
 * Renders the splatter for the active theme and hands it to fold.css as
 * blob URLs on the root: two corner clusters and the field beneath them. Blob URLs rather than data URIs keep a ~100 kB SVG
 * out of every style recalculation that reads the custom property.
 */
export function ThemeBackdropSync() {
  const settings = useClientSettings(selectBackdropSettings);
  const { themeId, accent, action, appearance: resolvedTheme } = useActiveBackdropSource();

  const {
    themeBackdropEnabled,
    themeBackdropScope,
    themeBackdropColors,
    themeBackdropIntensity,
    themeBackdropAmount,
    themeBackdropGlow,
    themeBackdropSeed,
  } = settings;
  const themeBackdropDynamic = useClientSettings(selectBackdropDynamic);
  // Keyed on the colour strings rather than object identity: custom theme
  // definitions can be rebuilt per render, and every new result here means a
  // fresh blob URL and a re-rasterized backdrop.
  const [lead, second, third] = themeBackdropColors ?? [];
  const options = useMemo(
    () =>
      resolveThemeBackdrop({
        settings: {
          themeBackdropEnabled,
          themeBackdropScope,
          themeBackdropColors: lead && second && third ? [lead, second, third] : null,
          themeBackdropIntensity,
          themeBackdropAmount,
          themeBackdropGlow,
          themeBackdropSeed,
        },
        themeId,
        accent,
        action,
        appearance: resolvedTheme,
      }),
    [
      themeBackdropEnabled,
      themeBackdropScope,
      lead,
      second,
      third,
      themeBackdropIntensity,
      themeBackdropAmount,
      themeBackdropGlow,
      themeBackdropSeed,
      themeId,
      accent,
      action,
      resolvedTheme,
    ],
  );

  // Layout effect: the canvas mounts in the same commit, so the art is on it
  // before the first paint rather than popping in a frame later.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!options) {
      delete root.dataset.themeBackdrop;
      for (const layer of BACKDROP_LAYERS) root.style.removeProperty(`--backdrop-${layer}`);
      return;
    }
    const urls = BACKDROP_LAYERS.map((layer) => {
      const svg =
        layer === "field" ? renderSplatterField(options) : renderSplatterCluster(layer, options);
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      root.style.setProperty(`--backdrop-${layer}`, `url("${url}")`);
      return url;
    });
    root.dataset.themeBackdrop = "on";
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [options]);

  return options && themeBackdropDynamic ? <MergeSplatterSync options={options} /> : null;
}

/**
 * Epoch ms of the last 6am. One timer wakes at the next rollover; returning
 * to the tab re-reads the clock, since a sleeping machine can hold a timer
 * past it. An unchanged reading sets the same number, which React skips.
 */
function useMergeDayStart(): number {
  const [since, setSince] = useState(() => mergeDayStart(new Date()).getTime());
  useEffect(() => {
    let timer = 0;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(refresh, nextMergeDayStart(new Date()) - Date.now());
    };
    const refresh = () => {
      setSince(mergeDayStart(new Date()).getTime());
      schedule();
    };
    schedule();
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return since;
}

/**
 * Dynamic mode: paints a splat for each PR merged since 6am, as its own
 * layer so a merge redraws only that layer. Mounted only while the mode is
 * on, so nothing is derived otherwise.
 */
function MergeSplatterSync({ options }: { readonly options: SplatterRenderOptions }) {
  const allMerges = useMergedPullRequests();
  const since = useMergeDayStart();
  const compact = useMediaQuery("(max-width: 640px)");
  const merges = useMemo(() => mergesSince(allMerges, since), [allMerges, since]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (merges.length === 0) {
      root.style.removeProperty("--backdrop-merges");
      return;
    }
    const svg = renderMergeSplatters(mergeSplats(merges, options.appearance), options, compact);
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    root.style.setProperty("--backdrop-merges", `url("${url}")`);
    return () => {
      root.style.removeProperty("--backdrop-merges");
      URL.revokeObjectURL(url);
    };
  }, [merges, options, compact]);

  return null;
}
