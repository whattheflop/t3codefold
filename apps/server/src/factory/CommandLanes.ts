import * as HostResources from "../resourceTelemetry/HostResources.ts";
import { FactoryError, type FactoryLaneJob } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { FactoryControl } from "./FactoryControl.ts";
import { FactoryStore } from "./FactoryStore.ts";
import { LaneSupervisor } from "./LaneSupervisor.ts";
import { WakeQueue } from "./WakeQueue.ts";
import { callerAgent, type FactoryActor } from "./access.ts";
import * as Config from "../config.ts";
import * as Processes from "../processRunner.ts";
import * as ServerSettings from "../serverSettings.ts";

export class CommandLanes extends Context.Service<
  CommandLanes,
  {
    readonly enqueue: (
      actor: FactoryActor,
      input: {
        readonly requestId: string;
        readonly cwd: string;
        readonly argv: ReadonlyArray<string>;
        readonly timeoutMs: number;
        readonly frozenHead?: string;
        readonly priority?: number;
      },
    ) => Effect.Effect<FactoryLaneJob, FactoryError>;
    readonly cancel: (actor: FactoryActor, id: string) => Effect.Effect<void, FactoryError>;
    readonly tick: Effect.Effect<void, FactoryError>;
  }
>()("t3/factory/CommandLanes") {}

const make = Effect.gen(function* () {
  const store = yield* FactoryStore;
  const control = yield* FactoryControl;
  const supervisor = yield* LaneSupervisor;
  const wakes = yield* WakeQueue;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* Config.ServerConfig;
  const settings = yield* ServerSettings.ServerSettingsService;
  const random = yield* SecureRandom.SecureRandom;
  const digests = yield* Digest.Digest;
  const runner = yield* Processes.ProcessRunner;
  const host = yield* HostResources.HostResources;
  const error = (cause: unknown) => new FactoryError({ code: "unavailable", cause });
  const actorAgent = Effect.fn("CommandLanes.actorAgent")((actor: FactoryActor) =>
    callerAgent(actor).pipe(Effect.provideService(FactoryStore, store)),
  );
  const enqueue: CommandLanes["Service"]["enqueue"] = Effect.fn("CommandLanes.enqueue")(
    function* (actor, input) {
      yield* control.requireEnabled;
      const owner = yield* actorAgent(actor);
      if (
        !input.argv.length ||
        input.argv.length > 256 ||
        input.timeoutMs < 1000 ||
        input.timeoutMs > 86_400_000 ||
        input.argv.some((a) => a.includes("\0"))
      )
        return yield* new FactoryError({ code: "invalid" });
      const cwd = yield* fs.realPath(input.cwd).pipe(Effect.mapError(error));
      const root = yield* runner
        .run({
          command: "git",
          args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
          cwd,
        })
        .pipe(Effect.orElseSucceed(() => ({ code: 1, stdout: "" })));
      const nonce = yield* random.uuidV4();
      const digest = yield* digests.digest(
        Digest.sha256,
        new TextEncoder().encode(`${owner.id}\0${input.requestId}`),
      );
      const id = `lane:${Array.from(digest)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")}`;
      return yield* store.transaction(
        Effect.gen(function* () {
          yield* control.requireEnabled;
          const existing = yield* store.get("jobs", id);
          if (existing) return existing;
          const now = DateTime.toEpochMillis(yield* DateTime.now);
          return yield* store.put("jobs", {
            id,
            version: 0,
            createdAt: now,
            updatedAt: now,
            ownerId: owner.id,
            cwd,
            gitRoot: root.code === 0 ? root.stdout.trim() : cwd,
            argv: input.argv,
            lane: "heavy",
            priority: input.priority ?? 0,
            timeoutMs: input.timeoutMs,
            frozenHead: input.frozenHead ?? null,
            startedAt: null,
            state: "queued",
            status: null,
            rc: null,
            outputPath: path.join(config.stateDir, "factory", "jobs", id.replaceAll(":", "-")),
            supervisor: nonce,
          });
        }),
      );
    },
  );
  const cancel: CommandLanes["Service"]["cancel"] = Effect.fn("CommandLanes.cancel")((actor, id) =>
    store.transaction(
      Effect.gen(function* () {
        const job = yield* store.get("jobs", id);
        if (!job) return yield* new FactoryError({ code: "not-found", entityId: id });
        if (actor.kind === "agent" && (yield* actorAgent(actor)).id !== job.ownerId)
          return yield* new FactoryError({ code: "forbidden" });
        if (job.state === "terminal" || job.cancelRequested) return;
        const now = DateTime.toEpochMillis(yield* DateTime.now);
        yield* store.put("jobs", {
          ...job,
          cancelRequested: true,
          updatedAt: now,
          ...(job.state === "queued"
            ? { state: "terminal" as const, status: "cancelled" as const }
            : {}),
        });
        if (job.state === "queued" && (yield* control.status).enabled)
          yield* wakes.enqueue({
            id: `lane-complete:${job.id}`,
            targetId: job.ownerId,
            refKind: "lane",
            refId: job.id,
            text: `Command cancelled before launch: ${job.argv.join(" ")}`.slice(0, 16_384),
          });
      }),
    ),
  );
  const tick = Effect.gen(function* () {
    for (const job of (yield* store.list("jobs")).filter(
      (j) => !["queued", "terminal"].includes(j.state),
    )) {
      const status = yield* supervisor.status(job, job.cancelRequested === true);
      yield* store.transaction(
        Effect.gen(function* () {
          const latest = (yield* store.get("jobs", job.id))!;
          const now = DateTime.toEpochMillis(yield* DateTime.now);
          const state =
            status?.phase === "terminal" ? "terminal" : status ? "running" : "quarantined";
          if (
            latest.state !== state ||
            latest.status !== (status?.status ?? null) ||
            latest.rc !== (status?.rc ?? null)
          )
            yield* store.put("jobs", {
              ...latest,
              updatedAt: now,
              state,
              status: status?.status ?? null,
              rc: status?.rc ?? null,
            });
          if (state === "terminal" && (yield* control.status).enabled)
            yield* wakes.enqueue({
              id: `lane-complete:${job.id}`,
              targetId: job.ownerId,
              refKind: "lane",
              refId: job.id,
              text: `Command finished: ${job.argv.join(" ")}\nStatus: ${status?.status ?? "unknown"}; exit ${status?.rc ?? "unknown"}.\nOutput: ${job.outputPath}`.slice(
                0,
                16_384,
              ),
            });
        }),
      );
    }
    if (!(yield* control.status).enabled) return;
    const resources = yield* host.read;
    if (
      (resources.totalMemoryBytes > 0 &&
        resources.availableMemoryBytes / resources.totalMemoryBytes < 0.1) ||
      (resources.cpuUtilization !== null && resources.cpuUtilization > 0.9)
    )
      return;
    const concurrency = (yield* settings.getSettings.pipe(Effect.mapError(error))).factory
      .heavyConcurrency;
    const jobs = yield* store.list("jobs");
    const active = jobs.filter((j) => !["queued", "terminal"].includes(j.state));
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    let starts = jobs.filter((j) => j.startedAt !== null && now - j.startedAt < 10_000).length;
    const queued = jobs
      .filter((j) => j.state === "queued")
      .sort(
        (a, b) =>
          b.priority +
            (now - b.createdAt >= 3_600_000 ? 1000 : 0) -
            (a.priority + (now - a.createdAt >= 3_600_000 ? 1000 : 0)) || a.createdAt - b.createdAt,
      );
    for (const job of queued) {
      if (active.length >= concurrency || starts >= 4) break;
      if (active.some((j) => j.gitRoot === job.gitRoot)) continue;
      const claimed = yield* store.transaction(
        Effect.gen(function* () {
          yield* control.requireEnabled;
          const latest = yield* store.get("jobs", job.id);
          if (latest?.state !== "queued") return undefined;
          return yield* store.put("jobs", {
            ...latest,
            state: "launching",
            startedAt: now,
            updatedAt: now,
          });
        }),
      );
      if (!claimed) continue;
      active.push(claimed);
      starts++;
      yield* control.admit(
        Effect.gen(function* () {
          const latest = yield* store.get("jobs", claimed.id);
          if (!latest || latest.cancelRequested || latest.state !== "launching") return;
          yield* supervisor.launch(latest);
        }),
      );
    }
  });
  return CommandLanes.of({ enqueue, cancel, tick });
});
export const layer = Layer.effect(CommandLanes, make);
