import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

const FactorySettings = Schema.Struct({
  heavyConcurrency: Schema.Number.check(Schema.isBetween({ minimum: 1, maximum: 32 })),
  checkCommands: Schema.Array(TrimmedNonEmptyString),
  quietHours: Schema.Struct({
    enabled: Schema.Boolean,
    startHour: Schema.Number,
    endHour: Schema.Number,
    timeZone: Schema.String,
  }),
  usageBindings: Schema.Record(
    Schema.String,
    Schema.Struct({ sourceId: Schema.String, accountIds: Schema.Array(Schema.String) }),
  ),
});
const defaults = {
  heavyConcurrency: 2,
  checkCommands: ["git", "gh"],
  quietHours: { enabled: true, startHour: 23, endHour: 7, timeZone: "UTC" },
  usageBindings: {},
};
export const FoldServerSettingsFields = {
  factory: FactorySettings.pipe(Schema.withDecodingDefault(Effect.succeed(defaults))),
};
export const FoldServerSettingsPatchFields = { factory: Schema.optionalKey(FactorySettings) };
