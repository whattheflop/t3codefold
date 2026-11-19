import { CommandId, FactoryError } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { FactoryStore } from "./FactoryStore.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";

export const stopFactoryThreads = Effect.gen(function* () {
  const store = yield* FactoryStore;
  const threads = yield* ThreadManagementService;
  const control = yield* store.get("control", "factory");
  if (control?.enabled || !control?.pendingThreadStops.length) return;
  for (const threadId of control.pendingThreadStops) {
    const shell = yield* threads
      .getThreadShell(threadId)
      .pipe(Effect.mapError((cause) => new FactoryError({ code: "unavailable", cause })));
    if (shell) {
      const projection = yield* threads
        .getThreadProjection(threadId)
        .pipe(Effect.mapError((cause) => new FactoryError({ code: "unavailable", cause })));
      for (const run of projection.runs.filter((run) => run.status === "queued"))
        yield* threads
          .dispatch({
            type: "queued-run.cancel",
            threadId,
            runId: run.id,
            commandId: CommandId.make(`factory:off:queued:${control.version}:${run.id}`),
          })
          .pipe(Effect.mapError((cause) => new FactoryError({ code: "unavailable", cause })));
    }
    if (
      shell?.activeRunId ||
      shell?.pendingRuntimeRequest ||
      shell?.pendingBackgroundTasks?.length
    ) {
      yield* threads
        .dispatch({
          type: "thread.stop",
          threadId,
          commandId: CommandId.make(`factory:off:${control.version}:${threadId}`),
          stopDelegatedTasks: true,
        })
        .pipe(Effect.mapError((cause) => new FactoryError({ code: "unavailable", cause })));
    } else {
      yield* store.transaction(
        Effect.gen(function* () {
          const latest = yield* store.get("control", "factory");
          if (!latest || latest.enabled) return;
          yield* store.put("control", {
            ...latest,
            pendingThreadStops: latest.pendingThreadStops.filter((id) => id !== threadId),
            updatedAt: DateTime.toEpochMillis(yield* DateTime.now),
          });
        }),
      );
    }
  }
});
