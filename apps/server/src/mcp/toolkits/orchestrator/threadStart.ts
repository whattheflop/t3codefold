import { OrchestratorMcpFailure, type OrchestratorMcpThreadStartInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { threadStartAsLaunch } from "../../FleetExecutor.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as ProjectHandlers from "../project/handlers.ts";
import { ProjectToolkit, ThreadLaunchResult } from "../project/tools.ts";
import { requireLedgerDelegation } from "../work/ledgerGuard.ts";

const isOrchestratorMcpFailure = Schema.is(OrchestratorMcpFailure);
const isThreadLaunchResult = Schema.is(ThreadLaunchResult);
const failure = (message: string) =>
  new OrchestratorMcpFailure({ code: "orchestration_error", message });

/**
 * `t3_thread_start`, an alias of `t3_thread_launch` kept for existing callers. It runs
 * t3_thread_launch's own handler, which applies the caller's limits ("inherit" means the
 * caller's own modes), keeps GLaDOS inside the work ledger, and routes a launch that
 * names another environment.
 */
export const startThread = (input: OrchestratorMcpThreadStartInput) =>
  threadStartAsLaunch(input).pipe(
    Effect.tap(() => requireLedgerDelegation("t3_thread_start")),
    Effect.flatMap((launch) =>
      ProjectToolkit.pipe(
        Effect.provide(McpToolAccess.HandlersLayer.layer(ProjectHandlers.layer)),
        Effect.flatMap((tools) => tools.handle("t3_thread_launch", launch)),
      ),
    ),
    Stream.unwrap,
    Stream.runLast,
    Effect.mapError((error) => (isOrchestratorMcpFailure(error) ? error : failure(error.message))),
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.fail(failure("The tool returned no result.")),
        onSome: ({ isFailure, result }) =>
          !isFailure && isThreadLaunchResult(result)
            ? Effect.succeed(result)
            : Effect.fail(isOrchestratorMcpFailure(result) ? result : failure("The tool failed.")),
      }),
    ),
  );
