import { assert, it } from "@effect/vitest";
import {
  RunId,
  ThreadId,
  type OrchestrationV2ThreadShell,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import * as Store from "./FactoryStore.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import { stopFactoryThreads } from "./FactoryQuiescence.ts";

const TestLayer = Store.layer.pipe(Layer.provideMerge(Sqlite.layerMemory));
it.effect("shutdown cancels queued turns and retains stop custody across runtime retries", () =>
  Effect.gen(function* () {
    const store = yield* Store.FactoryStore;
    const threadId = ThreadId.make("factory-thread");
    const running = yield* Ref.make(true);
    const queued = yield* Ref.make(true);
    const dispatched = yield* Ref.make<ReadonlyArray<string>>([]);
    yield* store.transaction(
      store.put("control", {
        id: "factory",
        version: 0,
        createdAt: 0,
        updatedAt: 0,
        enabled: false,
        pendingThreadStops: [threadId],
      }),
    );
    const threads = Layer.mock(ThreadManagementService)({
      getThreadShell: () =>
        Effect.map(
          Ref.get(running),
          (active) =>
            ({
              activeRunId: active ? RunId.make("running") : null,
              pendingRuntimeRequest: null,
              pendingBackgroundTasks: [],
            }) as unknown as OrchestrationV2ThreadShell,
        ),
      getThreadProjection: () =>
        Effect.map(
          Ref.get(queued),
          (pending) =>
            ({
              runs: pending ? [{ id: RunId.make("queued"), status: "queued" }] : [],
            }) as unknown as OrchestrationV2ThreadProjection,
        ),
      dispatch: (command) =>
        Effect.gen(function* () {
          if (!("threadId" in command))
            return yield* Effect.die("Unexpected command without a thread");
          assert.equal(command.threadId, threadId);
          yield* Ref.update(dispatched, (all) => [...all, command.type]);
          if (command.type === "queued-run.cancel") yield* Ref.set(queued, false);
          if (command.type === "thread.stop") yield* Ref.set(running, false);
          return { sequence: 1, storedEvents: [] };
        }),
    });
    yield* stopFactoryThreads.pipe(Effect.provide(threads));
    assert.deepEqual((yield* store.get("control", "factory"))?.pendingThreadStops, [threadId]);
    assert.deepEqual(yield* Ref.get(dispatched), ["queued-run.cancel", "thread.stop"]);
    yield* stopFactoryThreads.pipe(Effect.provide(Layer.fresh(threads)));
    assert.deepEqual((yield* store.get("control", "factory"))?.pendingThreadStops, []);
    assert.deepEqual(yield* Ref.get(dispatched), ["queued-run.cancel", "thread.stop"]);
  }).pipe(Effect.provide(TestLayer)),
);
