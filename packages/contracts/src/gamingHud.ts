import * as Schema from "effect/Schema";

export const GamingHudPosition = Schema.Literals([
  "top-right",
  "top-left",
  "bottom-right",
  "bottom-left",
]);
export const GamingHudState = Schema.Struct({
  enabled: Schema.Boolean,
  position: GamingHudPosition,
  environments: Schema.Array(
    Schema.Struct({
      connected: Schema.Boolean,
      running: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      waiting: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      attentionCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    }),
  ),
});
export type GamingHudState = typeof GamingHudState.Type;
