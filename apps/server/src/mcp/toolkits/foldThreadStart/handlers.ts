import * as McpToolAccess from "../../McpToolAccess.ts";
import { startThread } from "../orchestrator/threadStart.ts";
import { FoldThreadStartToolkit } from "./tools.ts";

export const layer = McpToolAccess.toLayer(FoldThreadStartToolkit, {
  // An alias of t3_thread_launch, declared like it; "inherit" means the caller's own modes.
  t3_thread_start: McpToolAccess.startsThreads(
    (input) => ({
      runtimeMode: input.runtimeMode === "inherit" ? undefined : input.runtimeMode,
      interactionMode: input.interactionMode === "inherit" ? undefined : input.interactionMode,
    }),
    (input) => startThread(input),
    // t3_thread_launch, which this runs, stamps the caller's link.
    "stamped",
  ),
});
