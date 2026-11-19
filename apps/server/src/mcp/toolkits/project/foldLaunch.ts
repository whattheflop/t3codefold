import type { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { routeIfRemote } from "../../fleet/route.ts";
import { requireLedgerDelegation } from "../work/ledgerGuard.ts";
import { ThreadLaunchResult } from "./tools.ts";

/**
 * Fold's wrapper around t3_thread_launch's local handler, used data-last at its end: a
 * launch naming another environment runs there, which applies the caller's limits again.
 */
export const foldThreadLaunch =
  (input: { readonly environmentId?: EnvironmentId | undefined }) =>
  <A, E, R>(local: Effect.Effect<A, E, R>) =>
    requireLedgerDelegation("t3_thread_launch").pipe(
      Effect.andThen(local.pipe(routeIfRemote("t3_thread_launch", input, ThreadLaunchResult))),
    );
