import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { activeLeads } from "../../../pitboss/Leads.ts";
import { WorkStore } from "../../../pitboss/WorkStore.ts";
import { McpInvocationContext } from "../../McpInvocationContext.ts";

// Coordinator launches need a ledger task so their evidence and acceptance can be tracked.
export const requireLedgerDelegation = Effect.fn("mcp.requireLedgerDelegation")(function* (
  tool: string,
) {
  const scope = yield* McpInvocationContext;
  const threadId = scope.thread?.threadId;
  if (threadId === undefined) return;
  // An unavailable work store must not strip delegation from ordinary threads. The store is
  // optional so the guarded tools keep UP's dependencies; McpHttpServer's work toolkit
  // requires it, so production always has it.
  const store = yield* Effect.serviceOption(WorkStore);
  if (Option.isNone(store)) return;
  const state = yield* store.value.read().pipe(Effect.orElseSucceed(() => undefined));
  if (state === undefined) return;
  const coordinator = state.role?.threadId === threadId;
  if (!coordinator && !activeLeads(state).some((lead) => lead.threadId === threadId)) return;
  return yield* new OrchestratorMcpFailure({
    code: "orchestration_error",
    message: `${tool} is not available to ${coordinator ? "GLaDOS" : "a project lead"}. Delegate through work_command so the work keeps a durable task identity, evidence and acceptance: create the task, then assign it.`,
  });
});
