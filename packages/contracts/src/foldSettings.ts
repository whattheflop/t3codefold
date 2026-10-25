/**
 * Fold-only client settings. Spread into upstream's `ClientSettingsSchema` and
 * `ClientSettingsPatch` in `settings.ts`, so upstream syncs touch two lines
 * there instead of every field.
 */
import { GamingHudPosition } from "./gamingHud.ts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/** Where the splatter backdrop shows: the themes that ship with it, or every theme. */
export const ThemeBackdropScope = Schema.Literals(["featured", "all"]);
export type ThemeBackdropScope = typeof ThemeBackdropScope.Type;

const HexColor = Schema.String.check(Schema.isPattern(/^#[0-9a-f]{6}$/i));

/** Lead, second and rare accent paint colours, overriding the theme-derived ones. */
export const ThemeBackdropColors = Schema.Tuple([HexColor, HexColor, HexColor]);
export type ThemeBackdropColors = typeof ThemeBackdropColors.Type;

export const MIN_THEME_BACKDROP_INTENSITY = 25;
export const MAX_THEME_BACKDROP_INTENSITY = 250;
/** Percent of the tuned default alpha. */
export const ThemeBackdropIntensity = Schema.Int.check(
  Schema.isBetween({
    minimum: MIN_THEME_BACKDROP_INTENSITY,
    maximum: MAX_THEME_BACKDROP_INTENSITY,
  }),
);
export type ThemeBackdropIntensity = typeof ThemeBackdropIntensity.Type;

export const MIN_THEME_BACKDROP_AMOUNT = 0;
export const MAX_THEME_BACKDROP_AMOUNT = 200;
/** Percent of the tuned default number of marks scattered across the canvas. */
export const ThemeBackdropAmount = Schema.Int.check(
  Schema.isBetween({ minimum: MIN_THEME_BACKDROP_AMOUNT, maximum: MAX_THEME_BACKDROP_AMOUNT }),
);
export type ThemeBackdropAmount = typeof ThemeBackdropAmount.Type;

export const MAX_THEME_BACKDROP_SEED = 999_999;
/** Splatter pattern variant; 0 is the original art. */
export const ThemeBackdropSeed = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: MAX_THEME_BACKDROP_SEED }),
);
export type ThemeBackdropSeed = typeof ThemeBackdropSeed.Type;

/** Most columns thread wrapping may split a long reply into on very wide screens. */
export const ThreadWrapMaxColumns = Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 4 }));
export const DEFAULT_THREAD_WRAP_MAX_COLUMNS = 3;

export const FoldClientSettingsFields = {
  gamingHudEnabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  gamingHudPosition: GamingHudPosition.pipe(
    Schema.withDecodingDefault(Effect.succeed("top-right" as const)),
  ),
  threadWrapEnabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  threadWrapPortalsEnabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  threadWrapMaxColumns: ThreadWrapMaxColumns.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_THREAD_WRAP_MAX_COLUMNS)),
  ),
  /** Paint-splatter backdrop behind the conversation, on themes that ship one. */
  themeBackdropEnabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  themeBackdropScope: ThemeBackdropScope.pipe(
    Schema.withDecodingDefault(Effect.succeed("featured" as const)),
  ),
  /** Null follows the active theme's accent colours. */
  themeBackdropColors: Schema.NullOr(ThemeBackdropColors).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  themeBackdropIntensity: ThemeBackdropIntensity.pipe(
    Schema.withDecodingDefault(Effect.succeed(100)),
  ),
  themeBackdropAmount: ThemeBackdropAmount.pipe(Schema.withDecodingDefault(Effect.succeed(100))),
  themeBackdropGlow: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  /** Adds a splat in the project's colour for each PR merged since 6am local. */
  themeBackdropDynamic: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  themeBackdropSeed: ThemeBackdropSeed.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  citeSelectionEnabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  vimModeEnabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  vimThreadPreviewEnabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
};

export const FoldClientSettingsPatchFields = {
  gamingHudEnabled: Schema.optionalKey(Schema.Boolean),
  gamingHudPosition: Schema.optionalKey(GamingHudPosition),
  threadWrapEnabled: Schema.optionalKey(Schema.Boolean),
  threadWrapPortalsEnabled: Schema.optionalKey(Schema.Boolean),
  threadWrapMaxColumns: Schema.optionalKey(ThreadWrapMaxColumns),
  themeBackdropEnabled: Schema.optionalKey(Schema.Boolean),
  themeBackdropScope: Schema.optionalKey(ThemeBackdropScope),
  themeBackdropColors: Schema.optionalKey(Schema.NullOr(ThemeBackdropColors)),
  themeBackdropIntensity: Schema.optionalKey(ThemeBackdropIntensity),
  themeBackdropAmount: Schema.optionalKey(ThemeBackdropAmount),
  themeBackdropGlow: Schema.optionalKey(Schema.Boolean),
  themeBackdropDynamic: Schema.optionalKey(Schema.Boolean),
  themeBackdropSeed: Schema.optionalKey(ThemeBackdropSeed),
  citeSelectionEnabled: Schema.optionalKey(Schema.Boolean),
  vimModeEnabled: Schema.optionalKey(Schema.Boolean),
  vimThreadPreviewEnabled: Schema.optionalKey(Schema.Boolean),
};
