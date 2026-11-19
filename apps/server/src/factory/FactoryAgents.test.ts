import { enabledControl } from "./testControl.ts";
import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type FactoryAgent,
  type FactorySpawn,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as Config from "../config.ts";
import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import { ProjectService } from "../project/ProjectService.ts";
import { ProviderRegistry } from "../provider/ProviderRegistry.ts";
import { ThreadLaunchService } from "../orchestration-v2/ThreadLaunchService.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import * as Store from "./FactoryStore.ts";
import * as Queue from "./WakeQueue.ts";
import * as Agents from "./FactoryAgents.ts";

const persistence = Queue.layer.pipe(
  Layer.provideMerge(enabledControl),
  Layer.provideMerge(Store.layer),
  Layer.provideMerge(Sqlite.layerMemory),
);
const dependencies = Layer.mergeAll(
  NodeServices.layer,
  Config.layerTest(process.cwd(), { prefix: "factory-agent-close-" }).pipe(
    Layer.provide(NodeServices.layer),
  ),
  Layer.mock(ServerEnvironment)({ getEnvironmentId: Effect.succeed(EnvironmentId.make("test")) }),
  Layer.mock(ProjectService)({}),
  Layer.mock(ProviderRegistry)({}),
  Layer.mock(ThreadLaunchService)({}),
  Layer.mock(ThreadManagementService)({}),
);
const TestLayer = Agents.layer.pipe(Layer.provideMerge(persistence), Layer.provide(dependencies));
const owner: FactoryAgent = {
  id: "parent",
  version: 0,
  createdAt: 0,
  updatedAt: 0,
  environmentId: EnvironmentId.make("test"),
  projectId: ProjectId.make("project"),
  threadId: ThreadId.make("parent-thread"),
  role: "subcommander",
  parentId: "commander",
  generation: 1,
  lifecycle: "active",
  capsule: "Work",
  capsuleRevision: 1,
  needs: null,
  next: "",
};
const spawn: FactorySpawn = {
  id: "pending",
  version: 0,
  createdAt: 0,
  updatedAt: 0,
  parentId: owner.id,
  agentId: "future-child",
  threadId: ThreadId.make("future-thread"),
  projectId: owner.projectId,
  role: "worker",
  generation: 1,
  title: "Pending work",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6.1-sol" },
  prompt: "Work",
  capsule: "Work",
  workspace: "worktree",
  baseRef: "HEAD",
  state: "held",
  retryAt: 0,
  reservedAt: null,
};

it.layer(TestLayer)("Factory agent cleanup", (it) => {
  it.effect(
    "closing a subtree revokes wakes, cancels pending children and retains live job custody",
    () =>
      Effect.gen(function* () {
        const store = yield* Store.FactoryStore;
        const agents = yield* Agents.FactoryAgents;
        const queue = yield* Queue.WakeQueue;
        yield* store.transaction(
          Effect.gen(function* () {
            yield* store.put("agents", owner);
            yield* store.put("agents", {
              ...owner,
              id: "child",
              role: "worker",
              parentId: owner.id,
              threadId: ThreadId.make("child-thread"),
            });
            yield* store.put("spawns", spawn);
            yield* queue.enqueue({
              id: "child-wake",
              targetId: "child",
              text: "Work",
              refKind: "watch",
              refId: "pr",
              sourceId: "watch:pr",
            });
            yield* store.put("jobs", {
              id: "live-job",
              version: 0,
              createdAt: 0,
              updatedAt: 0,
              ownerId: "child",
              cwd: "/fixture",
              gitRoot: "/fixture/.git",
              argv: ["fixture"],
              lane: "heavy",
              priority: 0,
              timeoutMs: 60_000,
              frozenHead: null,
              startedAt: 0,
              state: "running",
              status: null,
              rc: null,
              outputPath: "/fixture/job",
              supervisor: "nonce",
            });
          }),
        );
        yield* agents.lifecycle({ kind: "user" }, owner.id, "closed");
        assert.equal((yield* store.get("agents", "child"))?.lifecycle, "closed");
        assert.equal((yield* store.get("spawns", spawn.id))?.state, "cancelled");
        assert.equal((yield* store.get("sources", "watch:pr"))?.state, "revoked");
        assert.equal((yield* store.get("wakes", "child-wake"))?.state, "cancelled");
        assert.equal((yield* store.get("jobs", "live-job"))?.state, "running");
        assert.isTrue((yield* store.get("jobs", "live-job"))?.cancelRequested);
        assert.equal((yield* agents.resume(spawn)).state, "cancelled");
      }),
  );
  it.effect("closing one target leaves a shared source authorised for other targets", () =>
    Effect.gen(function* () {
      const store = yield* Store.FactoryStore;
      const agents = yield* Agents.FactoryAgents;
      const queue = yield* Queue.WakeQueue;
      yield* store.transaction(
        Effect.gen(function* () {
          yield* store.put("agents", {
            ...owner,
            id: "shared-parent",
            threadId: ThreadId.make("shared-parent-thread"),
          });
          yield* store.put("agents", {
            ...owner,
            id: "outside",
            role: "worker",
            threadId: ThreadId.make("outside-thread"),
          });
          yield* queue.enqueue({
            id: "shared-a",
            targetId: "shared-parent",
            text: "A",
            refKind: "watch",
            refId: "shared",
            sourceId: "shared-source",
          });
          yield* queue.enqueue({
            id: "shared-b",
            targetId: "outside",
            text: "B",
            refKind: "watch",
            refId: "shared",
            sourceId: "shared-source",
          });
        }),
      );
      yield* agents.lifecycle({ kind: "user" }, "shared-parent", "closed");
      assert.equal((yield* store.get("sources", "shared-source"))?.state, "active");
      assert.equal((yield* store.get("wakes", "shared-a"))?.state, "cancelled");
      assert.equal((yield* store.get("wakes", "shared-b"))?.state, "queued");
      assert.equal((yield* store.get("wakes", "shared-b"))?.attempts, 0);
    }),
  );
});
