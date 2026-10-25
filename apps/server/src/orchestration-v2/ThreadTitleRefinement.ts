import {
  CommandId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ServerCommand,
  type ThreadId,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { forkParked } from "../serverActivation.ts";
import type { ProjectionRecords } from "./ProjectionStore.ts";
import { ThreadManagementService } from "./ThreadManagementService.ts";

/**
 * The server's title-completion command. `needsRefinement` marks an initial
 * generated title as provisional, so ThreadTitleRefinement regenerates it once
 * the first run completes. It is server-only and never crosses the wire.
 */
export type ThreadTitleRegenerationCompleteCommand = Extract<
  OrchestrationV2ServerCommand,
  { readonly type: "thread.title.regeneration.complete" }
> & { readonly needsRefinement?: boolean };

/**
 * The regeneration that replaces a provisional generated title, or null when
 * the thread has nothing to refine yet. The command carries the title version
 * it saw, so the orchestrator drops it if the title changed in the meantime.
 */
export function refinementCommand(
  records: ProjectionRecords<"runs">,
): Extract<OrchestrationV2ServerCommand, { readonly type: "thread.metadata.update" }> | null {
  const thread = records.thread;
  const state = thread.titleState;
  if (
    thread.deletedAt !== null ||
    thread.archivedAt !== null ||
    state?.source !== "generated" ||
    !state.needsRefinement ||
    thread.titleRegeneration != null
  ) {
    return null;
  }
  const latest = records.runs.reduce<(typeof records.runs)[number] | undefined>(
    (newest, run) => (newest === undefined || run.ordinal > newest.ordinal ? run : newest),
    undefined,
  );
  if (latest?.status !== "completed") return null;
  return {
    type: "thread.metadata.update",
    commandId: CommandId.make(`title-refine:${thread.id}:${state.version}`),
    threadId: thread.id,
    expectedTitleVersion: state.version,
    regenerateTitle: true,
  };
}

/** Events after which a thread may have a provisional title ready to refine. */
export function mayNeedRefinement(event: OrchestrationV2DomainEvent): boolean {
  return (
    (event.type === "run.updated" && event.payload.status === "completed") ||
    (event.type === "thread.metadata-updated" && event.payload.titleState?.needsRefinement === true)
  );
}

/**
 * Refines a provisional generated title once the first answer supplies enough
 * context. Runs for the server's lifetime; recovers threads left provisional
 * by a restart from the shell snapshot.
 */
export const start = Effect.gen(function* () {
  const threads = yield* ThreadManagementService;
  const worker = yield* makeDrainableWorker((threadId: ThreadId) =>
    threads.getThreadRecords(threadId, ["runs"]).pipe(
      Effect.flatMap((records) => {
        const command = refinementCommand(records);
        return command === null ? Effect.void : threads.dispatch(command);
      }),
      Effect.catch((error) =>
        Effect.logWarning("Thread title refinement failed", { threadId, error }),
      ),
    ),
  );
  yield* forkParked(
    Stream.runForEach(threads.streamDomainEvents, (event) =>
      mayNeedRefinement(event) ? worker.enqueue(event.threadId) : Effect.void,
    ),
  );
  yield* forkParked(
    threads.getShellSnapshot().pipe(
      Effect.flatMap((snapshot) =>
        Effect.forEach(
          snapshot.threads.filter((thread) => thread.titleState?.needsRefinement === true),
          (thread) => worker.enqueue(thread.id),
          { discard: true },
        ),
      ),
      Effect.catch((error) =>
        Effect.logWarning("Thread title refinement recovery failed", { error }),
      ),
    ),
  );
});
