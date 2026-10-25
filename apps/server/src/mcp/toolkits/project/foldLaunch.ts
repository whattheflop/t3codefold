import { CommandId, type EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { routeIfRemote } from "../../fleet/route.ts";
import type * as McpInvocationContext from "../../McpInvocationContext.ts";
import { newCommandId } from "../../threadAccess.ts";
import { requireLedgerDelegation } from "../work/ledgerGuard.ts";
import { ThreadLaunchResult } from "./tools.ts";

/**
 * A command id that repeats for the same caller, operation and clientRequestId,
 * so a retried request replays its original command instead of acting twice.
 * Matches OrchestratorMcpService's stable ids.
 */
const retryCommandId = (
  scope: McpInvocationContext.McpInvocationScope,
  operation: string,
  clientRequestId: string,
) =>
  CommandId.make(
    ["command", "mcp", scope.requestNamespace, operation, clientRequestId]
      .map(encodeURIComponent)
      .join(":"),
  );

/**
 * The command id of a t3_thread_launch. A clientRequestId keys the command, thread and
 * message ids, so a retry replays the original launch (ThreadLaunchService treats a
 * repeated commandId as a resume).
 */
export const launchCommandId = (
  scope: McpInvocationContext.McpInvocationScope,
  clientRequestId: string | undefined,
) =>
  clientRequestId === undefined
    ? newCommandId()
    : Effect.succeed(retryCommandId(scope, "launch", clientRequestId));

/**
 * Fold's wrapper around t3_thread_launch's local handler, used data-last at its end:
 * GLaDOS and project leads stay inside the work ledger, and a launch naming another
 * environment runs there, which applies the caller's limits again.
 */
export const foldThreadLaunch =
  (input: { readonly environmentId?: EnvironmentId | undefined }) =>
  <A, E, R>(local: Effect.Effect<A, E, R>) =>
    requireLedgerDelegation("t3_thread_launch").pipe(
      Effect.andThen(local.pipe(routeIfRemote("t3_thread_launch", input, ThreadLaunchResult))),
    );
