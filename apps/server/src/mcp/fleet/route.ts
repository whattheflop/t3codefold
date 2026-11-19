import {
  type EnvironmentId,
  type FleetOperation,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { FleetRouter } from "../FleetRouter.ts";
import { McpInvocationContext } from "../McpInvocationContext.ts";
import { assertLiveCaller, readCaller } from "../threadAccess.ts";

/** Operations that change the destination; their source must be allowed to mutate. */
const MUTATIONS: ReadonlySet<FleetOperation> = new Set([
  "t3_thread_launch",
  "t3_thread_start",
  "t3_thread_send",
]);

const invalidResult = (error: Schema.SchemaError) =>
  new OrchestratorMcpFailure({
    code: "orchestration_error",
    message: `Destination returned an invalid result: ${error.message}`,
  });

/**
 * Runs a fleet tool on the environment its explicit `environmentId` names, else the local
 * handler untouched; a `projectId` alone is always local. Use it data-last at a handler's end.
 * The destination enforces the caller's limits: a thread's own modes, a client's ceiling.
 */
export const routeIfRemote =
  <S extends Schema.Top>(
    operation: FleetOperation,
    input: { readonly environmentId?: EnvironmentId | undefined },
    success: S,
  ) =>
  <A, E, R>(local: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext;
      const environmentId = input.environmentId;
      if (environmentId === undefined || environmentId === scope.environmentId) return yield* local;
      const caller = yield* readCaller();
      if (MUTATIONS.has(operation)) yield* assertLiveCaller(caller);
      const { limits } = caller;
      // Optional so toolkits register without fleet; server.ts provides it (fleet/layer.ts).
      const router = yield* Effect.serviceOption(FleetRouter);
      if (Option.isNone(router))
        return yield* new OrchestratorMcpFailure({
          code: "orchestration_error",
          message: "This environment cannot reach other environments through connected clients.",
        });
      const value = yield* router.value.invoke(
        { scope, limits },
        { environmentId, operation, input },
      );
      return yield* Schema.decodeUnknownEffect(success)(value).pipe(Effect.mapError(invalidResult));
    }).pipe(Effect.withSpan("mcp.fleet.routeIfRemote", { attributes: { operation } }));
