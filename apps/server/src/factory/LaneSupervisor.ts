// @effect-diagnostics nodeBuiltinImport:off -- supervisors must outlive server scopes; the scoped Effect spawner terminates its children.
import { FactoryError, FactoryLaneJob, type FactoryLaneJob as Job } from "@t3tools/contracts";
import * as NodeChildProcess from "node:child_process";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { laneSupervisorSource } from "./laneSupervisorSource.ts";

const Status = Schema.Struct({
  nonce: Schema.String,
  phase: Schema.Literals(["running", "terminal"]),
  status: FactoryLaneJob.fields.status,
  rc: Schema.NullOr(Schema.Number),
});
const encodeSupervisorInput = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Struct({ job: FactoryLaneJob, nonce: Schema.String })),
);
const decodeStatus = Schema.decodeEffect(Schema.fromJsonString(Status));
export class LaneSupervisor extends Context.Service<
  LaneSupervisor,
  {
    readonly launch: (job: Job) => Effect.Effect<void, FactoryError>;
    readonly status: (
      job: Job,
      cancel?: boolean,
    ) => Effect.Effect<typeof Status.Type | undefined, FactoryError>;
  }
>()("t3/factory/LaneSupervisor") {}

const make = Effect.gen(function* () {
  const platform = yield* HostProcess.Platform;
  const executablePath = yield* HostProcess.ExecutablePath;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const failure = (cause: unknown) => new FactoryError({ code: "unavailable", cause });
  const launch = Effect.fn("LaneSupervisor.launch")(function* (job: Job) {
    if (!job.supervisor) return yield* new FactoryError({ code: "invalid", entityId: job.id });
    yield* fs
      .makeDirectory(job.outputPath, { recursive: true, mode: 0o700 })
      .pipe(Effect.mapError(failure));
    const script = path.join(job.outputPath, "supervisor.mjs");
    const input = path.join(job.outputPath, "input.json");
    const encoded = yield* encodeSupervisorInput({ job, nonce: job.supervisor }).pipe(
      Effect.mapError(failure),
    );
    yield* fs
      .writeFileString(script, laneSupervisorSource, { mode: 0o600 })
      .pipe(Effect.mapError(failure));
    yield* fs.writeFileString(input, encoded, { mode: 0o600 }).pipe(Effect.mapError(failure));
    yield* Effect.try({
      try: () => {
        const child = NodeChildProcess.spawn(executablePath, [script, input], {
          detached: true,
          stdio: "ignore",
        });
        child.on("error", () => undefined);
        child.unref();
        if (child.pid === undefined) throw new Error("Supervisor launch failed");
      },
      catch: failure,
    });
  });
  const status: LaneSupervisor["Service"]["status"] = Effect.fn("LaneSupervisor.status")(function* (
    job,
    cancel = false,
  ) {
    const raw = yield* fs
      .readFileString(path.join(job.outputPath, "status.json"))
      .pipe(Effect.orElseSucceed(() => ""));
    if (!raw) return undefined;
    const saved = yield* decodeStatus(raw).pipe(Effect.mapError(failure));
    if (saved.nonce !== job.supervisor)
      return yield* new FactoryError({ code: "conflict", entityId: job.id });
    if (saved.phase === "terminal") return saved;
    const response = yield* Effect.tryPromise({
      try: () =>
        new Promise<string>((resolve) => {
          const address =
            platform === "win32"
              ? `\\\\.\\pipe\\t3-factory-${job.supervisor}`
              : path.join(NodeOS.tmpdir(), `t3-factory-${job.supervisor}.sock`);
          const socket = NodeNet.createConnection(address);
          let text = "";
          socket.setEncoding("utf8");
          socket.setTimeout(2000, () => {
            socket.destroy();
            resolve("");
          });
          socket.on("error", () => resolve(""));
          socket.on("connect", () =>
            socket.write(`${job.supervisor} ${cancel ? "cancel" : "status"}\n`),
          );
          socket.on("data", (chunk: string) => {
            text += chunk;
            if (text.includes("\n")) socket.end();
          });
          socket.on("end", () => resolve(text.trim()));
        }),
      catch: failure,
    });
    if (!response) return undefined;
    const live = yield* decodeStatus(response).pipe(Effect.mapError(failure));
    return live.nonce === job.supervisor ? live : undefined;
  });
  return LaneSupervisor.of({ launch, status });
});
export const layer = Layer.effect(LaneSupervisor, make);
