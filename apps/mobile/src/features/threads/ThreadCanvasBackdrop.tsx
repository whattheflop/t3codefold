import {
  mergeDayStart,
  mergeSplats,
  mergesSince,
  nextMergeDayStart,
} from "@t3tools/shared/mergeSplatters";
import {
  renderSplatterPreview,
  type MergeSplat,
  type SplatterGrain,
  type SplatterRenderOptions,
} from "@t3tools/shared/splatterBackdrop";
import { Image } from "expo-image";
import { memo, useEffect, useMemo, useState } from "react";
import { AppState, useWindowDimensions } from "react-native";

import { useBakedSvg } from "../../lib/bakedSvg";
import { CANVAS_GRAIN_PNG_BASE64, CANVAS_GRAIN_TILE } from "../../lib/canvasGrain";
import { themeSplatterColors } from "../../lib/splatterColors";
import { useMergedPullRequests } from "../../state/merged-pull-requests";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";

/**
 * The splatter backdrop behind the thread canvas, rendered in the active
 * theme's colours by the same renderer the web app uses
 * (packages/shared/src/splatterBackdrop.ts).
 *
 * The field, today's merges, both corner clusters and the grain compose into
 * one SVG, baked to a PNG once (lib/bakedSvg.ts): painted as vectors, its
 * thousands of paths re-rasterized on every frame the feed scrolled, and the
 * grain was another full-screen layer blended over it.
 *
 * The bake is a square at least BAKE_SIDE across, and each window shows its
 * centre with `cover`, so folding, unfolding and rotating reuse one bitmap
 * instead of re-baking. Clusters and merges lay out in the phone-shaped column
 * a phone sees, with the compact branch of splatterLayout(), which the web
 * rule in apps/web/src/index.css mirrors; the field fills the rest of the
 * square for wider screens.
 */
const FEATURED_THEME_IDS: ReadonlySet<string> = new Set(["cyberpunk", "codex"]);

const GRAIN_HREF = `data:image/png;base64,${CANVAS_GRAIN_PNG_BASE64}`;

/** Matches the per-appearance grain alpha the web canvas uses. */
const GRAIN: Record<"dark" | "light", SplatterGrain> = {
  dark: { href: GRAIN_HREF, size: CANVAS_GRAIN_TILE, opacity: 0.12 },
  light: { href: GRAIN_HREF, size: CANVAS_GRAIN_TILE, opacity: 0.07 },
};

const NO_MERGES: ReadonlyArray<MergeSplat> = [];

/** Points; covers a tall phone (~1000 pt) and an unfolded foldable (~930x775 pt). */
const BAKE_SIDE = 1000;
/** Width over height of the column a portrait phone shows of the square. */
const PHONE_ASPECT = 0.45;

export const ThreadCanvasBackdrop = memo(function ThreadCanvasBackdrop() {
  const {
    themeId,
    themeAppearance,
    themeBackdropEnabled,
    themeBackdropScope,
    themeBackdropIntensity,
    themeBackdropAmount,
    themeBackdropGlow,
    themeBackdropDynamic,
    themeBackdropSeed,
    themeBackdropColors,
  } = useAppearancePreferences();
  const { width, height } = useWindowDimensions();
  const appearance = themeAppearance === "dark" ? "dark" : "light";
  const shown =
    themeBackdropEnabled && (themeBackdropScope === "all" || FEATURED_THEME_IDS.has(themeId));

  const options = useMemo((): SplatterRenderOptions | null => {
    if (!shown) return null;
    return {
      colors: themeBackdropColors ?? themeSplatterColors(themeId, appearance),
      appearance,
      intensity: themeBackdropIntensity / 100,
      amount: themeBackdropAmount / 100,
      glow: themeBackdropGlow,
      seed: themeBackdropSeed,
    };
  }, [
    shown,
    themeId,
    appearance,
    themeBackdropIntensity,
    themeBackdropAmount,
    themeBackdropGlow,
    themeBackdropSeed,
    themeBackdropColors,
  ]);

  if (!options) return null;

  return themeBackdropDynamic ? (
    <MergeSplatterCanvas options={options} width={width} height={height} />
  ) : (
    <SplatterCanvas options={options} width={width} height={height} merges={NO_MERGES} />
  );
});

type CanvasProps = {
  readonly options: SplatterRenderOptions;
  readonly width: number;
  readonly height: number;
};

const SplatterCanvas = memo(function SplatterCanvas({
  options,
  width,
  height,
  merges,
}: CanvasProps & { readonly merges: ReadonlyArray<MergeSplat> }) {
  // Tablets outgrow BAKE_SIDE; squaring their longest edge keeps rotation free.
  const side = Math.max(BAKE_SIDE, Math.ceil(Math.max(width, height)));
  const svg = useMemo(
    () =>
      renderSplatterPreview(options, side, side, {
        frame: {
          x: (side * (1 - PHONE_ASPECT)) / 2,
          y: 0,
          width: side * PHONE_ASPECT,
          height: side,
        },
        compact: true,
        merges,
        grain: GRAIN[options.appearance],
      }),
    [options, side, merges],
  );
  const uri = useBakedSvg(svg, side, side);
  if (uri === null) return null;
  return (
    <Image
      source={{ uri }}
      cachePolicy="memory"
      contentFit="cover"
      style={{ position: "absolute", top: 0, left: 0, width, height }}
    />
  );
});

/**
 * Epoch ms of the last 6am. One timer wakes at the next rollover; coming back
 * to the foreground re-reads the clock, since a suspended app holds timers.
 */
function useMergeDayStart(): number {
  const [since, setSince] = useState(() => mergeDayStart(new Date()).getTime());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, nextMergeDayStart(new Date()) - Date.now());
    };
    const refresh = () => {
      setSince(mergeDayStart(new Date()).getTime());
      schedule();
    };
    schedule();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, []);
  return since;
}

/** Dynamic mode: a splat per PR merged since 6am, in its project's colour. */
const MergeSplatterCanvas = memo(function MergeSplatterCanvas(props: CanvasProps) {
  const allMerges = useMergedPullRequests();
  const since = useMergeDayStart();
  const appearance = props.options.appearance;
  const merges = useMemo(
    () => mergeSplats(mergesSince(allMerges, since), appearance),
    [allMerges, since, appearance],
  );
  return <SplatterCanvas {...props} merges={merges} />;
});
