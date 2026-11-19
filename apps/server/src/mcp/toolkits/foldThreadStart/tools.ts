import { OrchestratorMcpFailure, OrchestratorMcpThreadStartInput } from "@t3tools/contracts";
import { Tool, Toolkit } from "effect/ai";

import { ThreadLaunchResult, threadLaunchDependencies } from "../project/tools.ts";

/**
 * Fold: kept for agents and fleet sources that learned the old name; it runs
 * t3_thread_launch. A toolkit of its own so upstream's orchestrator toolkit does
 * not carry t3_thread_launch's dependencies.
 */
const ThreadStartTool = Tool.make("t3_thread_start", {
  description:
    "Alias of t3_thread_launch for existing callers: create an ordinary TOP-LEVEL T3 conversation and start its first turn with prompt. title defaults to 'New thread'; target accepts only providerInstanceId with model. Prefer t3_thread_launch, which also chooses the workspace. Pass environmentId to start it in another environment, and clientRequestId to make retries return the original thread.",
  parameters: OrchestratorMcpThreadStartInput,
  success: ThreadLaunchResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: threadLaunchDependencies,
})
  .annotate(Tool.Title, "Start a T3 thread")
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true);

export const FoldThreadStartToolkit = Toolkit.make(ThreadStartTool);
