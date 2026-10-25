import type { OrchestrationV2ServerCommand } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  ThreadRetentionGuard,
  ThreadRetentionGuardError,
} from "../orchestration-v2/ThreadRetentionGuard.ts";
import { TurnPreamble } from "../orchestration-v2/TurnPreamble.ts";
import { WorkStore } from "./WorkStore.ts";

/** Commands that would hide, unpin or remove a thread. */
const HIDING_COMMANDS: ReadonlySet<OrchestrationV2ServerCommand["type"]> = new Set([
  "thread.archive",
  "thread.delete",
  "thread.unpin",
  "thread.settle",
  "thread.snooze",
]);

export const ELECTED_THREAD_RETENTION_REASON =
  "Dismiss or replace the elected pitboss before hiding, unpinning or deleting its thread.";

/**
 * Keeps the elected coordinator thread visible. The orchestrator calls the guard on every
 * dispatch, so it filters by command type before reading the work store, and fails closed when
 * the store cannot be read.
 */
export const threadRetentionGuardLayer = Layer.effect(
  ThreadRetentionGuard,
  Effect.gen(function* () {
    const store = yield* WorkStore;
    return {
      check: (command) => {
        if (!HIDING_COMMANDS.has(command.type) || !("threadId" in command)) return Effect.void;
        return store.read().pipe(
          Effect.mapError(
            (cause) =>
              new ThreadRetentionGuardError({
                reason: "Could not confirm this thread is not the elected pitboss.",
                cause,
              }),
          ),
          Effect.flatMap((work) =>
            work.role?.threadId === command.threadId
              ? Effect.fail(
                  new ThreadRetentionGuardError({ reason: ELECTED_THREAD_RETENTION_REASON }),
                )
              : Effect.void,
          ),
        );
      },
    };
  }),
);

/**
 * Leads coordinator, lead and worker turns with their managed-work packet. Packets are keyed by
 * attempt, so a retried attempt reuses the text it first saw.
 */
export const turnPreambleLayer = Layer.effect(
  TurnPreamble,
  Effect.gen(function* () {
    const store = yield* WorkStore;
    return {
      // An unreadable packet must not block the turn; it starts without one.
      forAttempt: (threadId, attemptId) =>
        store.context(threadId, attemptId).pipe(
          Effect.tapError((error) =>
            Effect.logWarning("pitboss turn preamble unavailable", { threadId, attemptId, error }),
          ),
          Effect.orElseSucceed(() => null),
        ),
    };
  }),
);

/** Both orchestration seams, backed by the work store. */
export const orchestrationSeamsLayer = Layer.mergeAll(threadRetentionGuardLayer, turnPreambleLayer);
