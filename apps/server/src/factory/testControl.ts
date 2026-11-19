import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Control from "./FactoryControl.ts";

export const enabledControl = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* (yield* Control.FactoryControl).setEnabled(true);
  }),
).pipe(Layer.provideMerge(Control.layer));
