import {
  EnvironmentId,
  FactoryError,
  ProjectId,
  ThreadId,
  type FactorySource,
  type FactoryAgent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import { assert, it } from "@effect/vitest";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as FactoryStore from "./FactoryStore.ts";

const TestLayer = FactoryStore.layer.pipe(Layer.provide(Sqlite.layerMemory));
const source: FactorySource = {
  id: "source-a",
  version: 0,
  createdAt: 1,
  updatedAt: 1,
  epoch: 1,
  state: "active",
};
const agent: FactoryAgent = {
  id: "commander-1",
  version: 0,
  createdAt: 1,
  updatedAt: 1,
  environmentId: EnvironmentId.make("test"),
  threadId: ThreadId.make("thread-1"),
  projectId: ProjectId.make("project-1"),
  role: "commander",
  parentId: null,
  generation: 1,
  lifecycle: "active",
  capsule: "Lead",
  capsuleRevision: 1,
  needs: null,
  next: "",
};

it.layer(TestLayer)("FactoryStore", (it) => {
  it.effect("rolls back event and projection writes together", () =>
    Effect.gen(function* () {
      const store = yield* FactoryStore.FactoryStore;
      const before = yield* store.sequence;
      const failed = yield* store
        .transaction(
          Effect.gen(function* () {
            yield* store.put("sources", source);
            return yield* new FactoryError({ code: "invalid" });
          }),
        )
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(failed));
      assert.isUndefined(yield* store.get("sources", source.id));
      assert.equal(yield* store.sequence, before);
    }),
  );

  it.effect("rejects stale updates without appending a second mutation", () =>
    Effect.gen(function* () {
      const store = yield* FactoryStore.FactoryStore;
      const saved = yield* store.transaction(store.put("sources", { ...source, id: "source-cas" }));
      yield* store.transaction(store.put("sources", { ...saved, epoch: 2 }));
      const sequence = yield* store.sequence;
      const stale = yield* store
        .transaction(store.put("sources", { ...saved, epoch: 3 }))
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(stale));
      assert.equal((yield* store.get("sources", saved.id))?.epoch, 2);
      assert.equal(yield* store.sequence, sequence);
    }),
  );

  it.effect("permits only one live Commander and preserves an existing election on failure", () =>
    Effect.gen(function* () {
      const store = yield* FactoryStore.FactoryStore;
      const first = yield* store.transaction(store.put("agents", agent));
      const second = yield* store
        .transaction(
          store.put("agents", { ...agent, id: "commander-2", threadId: ThreadId.make("thread-2") }),
        )
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(second));
      assert.deepEqual(yield* store.list("agents"), [first]);
    }),
  );
});
