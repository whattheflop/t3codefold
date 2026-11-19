import { FactoryError, type FactoryStatus } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import { FactoryStore } from "./FactoryStore.ts";

class AdmissionEpoch extends Context.Reference<number | undefined>("FactoryAdmissionEpoch", {
  defaultValue: () => undefined,
}) {}

export const factoryIsEnabled = Effect.gen(function* () {
  const environment = yield* HostProcess.Environment;
  if (["1", "true"].includes(environment.T3CODE_FACTORY_DISABLED ?? "")) return false;
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{
    enabled: number;
  }>`SELECT json_extract(payload_json, '$.enabled') AS enabled FROM factory_control WHERE id = 'factory'`;
  return rows[0]?.enabled === 1;
});

export class FactoryControl extends Context.Service<
  FactoryControl,
  {
    readonly status: Effect.Effect<FactoryStatus, FactoryError>;
    readonly requireEnabled: Effect.Effect<number, FactoryError>;
    readonly run: <A, R>(
      work: Effect.Effect<A, FactoryError, R>,
    ) => Effect.Effect<A, FactoryError, R>;
    readonly admit: <A, R>(
      work: Effect.Effect<A, FactoryError, R>,
    ) => Effect.Effect<A, FactoryError, R>;
    readonly setEnabled: (enabled: boolean) => Effect.Effect<FactoryStatus, FactoryError>;
  }
>()("t3/factory/FactoryControl") {}

const make = Effect.gen(function* () {
  const store = yield* FactoryStore;
  const environment = yield* HostProcess.Environment;
  const forcedOff = ["1", "true"].includes(environment.T3CODE_FACTORY_DISABLED ?? "");
  const lock = yield* Semaphore.make(1);
  const status = Effect.gen(function* () {
    const control = yield* store.get("control", "factory");
    const stopping =
      !!control?.pendingThreadStops.length ||
      (yield* store.list("jobs")).some((job) => job.cancelRequested && job.state !== "terminal");
    return {
      enabled: !forcedOff && control?.enabled === true,
      forcedOff,
      stopping,
    } satisfies FactoryStatus;
  });
  const requireEnabled = Effect.gen(function* () {
    const control = yield* store.get("control", "factory");
    const epoch = yield* AdmissionEpoch;
    if (forcedOff || !control?.enabled || (epoch !== undefined && epoch !== control.version))
      return yield* new FactoryError({ code: "disabled" });
    return control.version;
  });
  const run: FactoryControl["Service"]["run"] = Effect.fn("FactoryControl.run")(function* (work) {
    const epoch = yield* requireEnabled;
    return yield* work.pipe(Effect.provideService(AdmissionEpoch, epoch));
  });
  const admit: FactoryControl["Service"]["admit"] = Effect.fn("FactoryControl.admit")((work) =>
    lock.withPermits(1)(Effect.andThen(requireEnabled, work)),
  );
  const setEnabled = Effect.fn("FactoryControl.setEnabled")((enabled: boolean) =>
    lock.withPermits(1)(
      store.transaction(
        Effect.gen(function* () {
          if (enabled && forcedOff) return yield* new FactoryError({ code: "disabled" });
          const prior = yield* store.get("control", "factory");
          if (enabled && (yield* status).stopping)
            return yield* new FactoryError({ code: "conflict" });
          if (prior?.enabled === enabled) return yield* status;
          const now = DateTime.toEpochMillis(yield* DateTime.now);
          const agents = enabled
            ? []
            : (yield* store.list("agents")).filter(
                (agent) => !["closed", "retired"].includes(agent.lifecycle),
              );
          yield* store.put("control", {
            id: "factory",
            version: prior?.version ?? 0,
            createdAt: prior?.createdAt ?? now,
            updatedAt: now,
            enabled,
            pendingThreadStops: enabled
              ? []
              : [
                  ...new Set([
                    ...(prior?.pendingThreadStops ?? []),
                    ...agents.map((agent) => agent.threadId),
                  ]),
                ],
          });
          if (!enabled) {
            for (const spawn of yield* store.list("spawns"))
              if (!["launched", "cancelled"].includes(spawn.state))
                yield* store.put("spawns", { ...spawn, state: "cancelled", updatedAt: now });
            for (const delivery of yield* store.list("deliveries"))
              if (delivery.state === "claimed")
                yield* store.put("deliveries", { ...delivery, state: "cancelled", updatedAt: now });
            for (const wake of yield* store.list("wakes"))
              if (!["acked", "cancelled"].includes(wake.state))
                yield* store.put("wakes", {
                  ...wake,
                  state: "cancelled",
                  deliveryId: null,
                  updatedAt: now,
                });
            for (const notification of yield* store.list("notifications"))
              if (notification.state === "pending")
                yield* store.put("notifications", {
                  ...notification,
                  state: "cancelled",
                  updatedAt: now,
                });
            for (const job of yield* store.list("jobs"))
              if (job.state !== "terminal")
                yield* store.put("jobs", {
                  ...job,
                  cancelRequested: true,
                  updatedAt: now,
                  ...(job.state === "queued"
                    ? { state: "terminal" as const, status: "cancelled" as const }
                    : {}),
                });
            for (const execution of yield* store.list("executions"))
              if (execution.state === "claimed")
                yield* store.put("executions", {
                  ...execution,
                  state: "failed",
                  result: "Factory was disabled before execution.",
                  updatedAt: now,
                });
            for (const card of yield* store.list("cards"))
              if (card.body.action && ["open", "answered", "acked"].includes(card.state))
                yield* store.put("cards", { ...card, state: "withdrawn", updatedAt: now });
          }
          return yield* status;
        }),
      ),
    ),
  );
  return FactoryControl.of({ status, requireEnabled, run, admit, setEnabled });
});
export const layer = Layer.effect(FactoryControl, make);
