import { type EnvironmentId, FleetOperation } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as PeerLinks from "../../peer/PeerLinks.ts";
import { FleetRouter } from "../FleetRouter.ts";

const isFleetOperation = Schema.is(FleetOperation);

/**
 * Fold: a fleet tool naming an environment fleet reaches and no link covers skips link
 * forwarding; its handler's `routeIfRemote` carries it through a connected client.
 * `t3_thread_start` always runs its handler, which reissues it as a routed t3_thread_launch.
 */
export const fleetTakesTarget = Effect.gen(function* () {
  const links = yield* Effect.serviceOption(PeerLinks.PeerLinks);
  const router = yield* Effect.serviceOption(FleetRouter);
  const linked = (environmentId: EnvironmentId) =>
    Option.isNone(links)
      ? Effect.succeed(false)
      : links.value.get(environmentId).pipe(
          Effect.map(Option.isSome),
          Effect.orElseSucceed(() => false),
        );
  return (toolName: string, environmentId: EnvironmentId): Effect.Effect<boolean> => {
    if (toolName === "t3_thread_start") return Effect.succeed(true);
    if (!isFleetOperation(toolName) || Option.isNone(router)) return Effect.succeed(false);
    return router.value.environments.pipe(
      Effect.map(({ environments }) =>
        environments.some((environment) => environment.environmentId === environmentId),
      ),
      Effect.orElseSucceed(() => false),
      Effect.flatMap((reachable) =>
        reachable
          ? Effect.map(linked(environmentId), (isLinked) => !isLinked)
          : Effect.succeed(false),
      ),
    );
  };
});
