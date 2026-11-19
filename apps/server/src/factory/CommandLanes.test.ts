import { enabledControl } from "./testControl.ts";
import { assert, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { type FactoryLaneJob } from "@t3tools/contracts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as ServerConfig from "../config.ts";
import * as Settings from "../serverSettings.ts";
import { ProcessRunner } from "../processRunner.ts";
import { HostResources } from "../resourceTelemetry/HostResources.ts";
import { LaneSupervisor } from "./LaneSupervisor.ts";
import * as Store from "./FactoryStore.ts";
import * as Queue from "./WakeQueue.ts";
import * as Lanes from "./CommandLanes.ts";

const persistence = Queue.layer.pipe(
  Layer.provideMerge(enabledControl),
  Layer.provideMerge(Store.layer),
  Layer.provideMerge(Sqlite.layerMemory),
);
const infrastructure = Layer.mergeAll(
  NodeServices.layer,
  NodeCrypto.layer,
  Settings.layerTest(),
  ServerConfig.layerTest(process.cwd(), { prefix: "factory-lane-cancel-" }).pipe(
    Layer.provide(NodeServices.layer),
  ),
  Layer.mock(ProcessRunner)({}),
  Layer.mock(HostResources)({}),
);
const TestLayer = persistence.pipe(Layer.provideMerge(infrastructure));
const job: FactoryLaneJob = {
  id: "job",
  version: 0,
  createdAt: 0,
  updatedAt: 0,
  ownerId: "owner",
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
};

it.layer(TestLayer)("Factory lane cancellation", (it) => {
  it.effect(
    "retains a cancellation request across service restart until supervisor termination is proved",
    () =>
      Effect.gen(function* () {
        const store = yield* Store.FactoryStore;
        const requests = yield* Ref.make<ReadonlyArray<boolean>>([]);
        const supervisor = Layer.mock(LaneSupervisor)({
          status: (_job, cancel) =>
            Ref.update(requests, (all) => [...all, !!cancel]).pipe(
              Effect.as({
                nonce: "nonce",
                phase: "terminal" as const,
                status: "cancelled" as const,
                rc: null,
              }),
            ),
        });
        const layer = Lanes.layer.pipe(
          Layer.provide(supervisor),
          Layer.provide(
            Layer.mock(HostResources)({
              read: Effect.succeed({
                sampledAt: 0,
                cpuUtilization: 1,
                cpuCount: 1,
                availableMemoryBytes: 1,
                totalMemoryBytes: 1,
              }),
            }),
          ),
        );
        yield* store.transaction(store.put("jobs", job));
        yield* Effect.gen(function* () {
          const lanes = yield* Lanes.CommandLanes;
          yield* lanes.cancel({ kind: "user" }, job.id);
        }).pipe(Effect.provide(layer));
        assert.isTrue((yield* store.get("jobs", job.id))?.cancelRequested);
        yield* Effect.gen(function* () {
          const lanes = yield* Lanes.CommandLanes;
          yield* lanes.tick;
        }).pipe(Effect.provide(layer));
        assert.deepEqual(yield* Ref.get(requests), [true]);
        assert.equal((yield* store.get("jobs", job.id))?.state, "terminal");
        assert.equal((yield* store.get("jobs", job.id))?.status, "cancelled");
        assert.lengthOf(
          (yield* store.list("wakes")).filter((w) => w.refId === job.id),
          1,
        );
      }),
  );
});
