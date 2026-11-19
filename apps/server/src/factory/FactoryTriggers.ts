import {
  FactoryCheckItem,
  FactoryError,
  type FactoryTrigger,
  type FactoryTriggerInput,
  type FactoryTriggerRun,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { FactoryControl } from "./FactoryControl.ts";
import { FactoryStore } from "./FactoryStore.ts";
import { WakeQueue } from "./WakeQueue.ts";
import { callerAgent, type FactoryActor } from "./access.ts";
import * as Processes from "../processRunner.ts";
import * as Projects from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as Threads from "../orchestration-v2/ThreadManagementService.ts";

const decodeSummary = Schema.decodeOption(
  Schema.fromJsonString(Schema.Struct({ _summary: Schema.Unknown })),
);

const encodeWatchValue = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeItem = Schema.decodeEffect(Schema.fromJsonString(FactoryCheckItem));
const watchValue = (value: unknown): string => encodeWatchValue(value ?? null);

export class FactoryTriggers extends Context.Service<
  FactoryTriggers,
  {
    readonly upsert: (
      actor: FactoryActor,
      input: typeof FactoryTriggerInput.Type,
    ) => Effect.Effect<FactoryTrigger, FactoryError>;
    readonly run: (id: string) => Effect.Effect<FactoryTriggerRun, FactoryError>;
    readonly runDue: Effect.Effect<void, FactoryError>;
  }
>()("t3/factory/FactoryTriggers") {}

const make = Effect.gen(function* () {
  const store = yield* FactoryStore;
  const control = yield* FactoryControl;
  const wakes = yield* WakeQueue;
  const runner = yield* Processes.ProcessRunner;
  const projects = yield* Projects.ProjectService;
  const settings = yield* ServerSettings.ServerSettingsService;
  const threads = yield* Threads.ThreadManagementService;
  const random = yield* SecureRandom.SecureRandom;
  const digests = yield* Digest.Digest;
  const unavailable = (cause: unknown) => new FactoryError({ code: "unavailable", cause });
  const actorAgent = Effect.fn("FactoryTriggers.actorAgent")((actor: FactoryActor) =>
    callerAgent(actor).pipe(Effect.provideService(FactoryStore, store)),
  );
  const upsert: FactoryTriggers["Service"]["upsert"] = Effect.fn("FactoryTriggers.upsert")(
    (actor, input) =>
      store.transaction(
        Effect.gen(function* () {
          const owner =
            actor.kind === "agent"
              ? yield* actorAgent(actor)
              : (yield* store.list("agents")).find(
                  (a) => a.role === "commander" && a.lifecycle === "active",
                );
          if (!owner || owner.role !== "commander")
            return yield* new FactoryError({ code: "forbidden" });
          if (
            input.intervalMs < 5_000 ||
            input.intervalMs > 365 * 86_400_000 ||
            !Number.isSafeInteger(input.intervalMs) ||
            !(yield* store.get("agents", input.targetId))
          )
            return yield* new FactoryError({ code: "invalid", entityId: input.id });
          if (input.check.type === "command") {
            const allowed = (yield* settings.getSettings.pipe(Effect.mapError(unavailable))).factory
              .checkCommands;
            if (!input.check.argv[0] || !allowed.includes(input.check.argv[0]))
              return yield* new FactoryError({ code: "invalid", entityId: input.id });
          }
          const old = yield* store.get("triggers", input.id);
          const now = DateTime.toEpochMillis(yield* DateTime.now);
          return yield* store.put("triggers", {
            ...input,
            ownerId: owner.id,
            version: old?.version ?? 0,
            createdAt: old?.createdAt ?? now,
            updatedAt: now,
            nextRunAt: now,
            errors: 0,
            transientSince: null,
            failing: false,
          });
        }),
      ),
  );

  const builtin = Effect.fn("FactoryTriggers.builtin")(function* (name: string, now: number) {
    const items: Array<FactoryCheckItem> = [];
    const cards = yield* store.list("cards");
    const agents = yield* store.list("agents");
    const jobs = yield* store.list("jobs");
    if (name === "decisions-stale") {
      for (const card of cards.filter((c) => c.state === "open")) {
        const window = card.body.blocking ? 3_600_000 : 8 * 3_600_000;
        if (now - card.updatedAt >= window)
          items.push({
            key: `${card.id}:${Math.floor((now - card.updatedAt) / window)}`,
            summary: `Decision ${card.id} is stale: ${card.body.title}`,
            data: { targetId: card.ownerId },
          });
      }
    } else if (name === "usage-quota") {
      for (const spawn of yield* store.list("spawns"))
        if (spawn.state === "held")
          items.push({ key: spawn.id, summary: `Spawn ${spawn.title} is held by admission.` });
    } else if (name === "health-watch") {
      for (const trigger of yield* store.list("triggers"))
        if (trigger.failing)
          items.push({
            key: `trigger:${trigger.id}`,
            summary: `Trigger ${trigger.id} is failing.`,
          });
      for (const wake of yield* store.list("wakes"))
        if (wake.state === "undelivered")
          items.push({ key: `wake:${wake.id}`, summary: `Wake ${wake.id} is undelivered.` });
      for (const job of jobs)
        if (job.state === "queued" && now - job.createdAt >= 30 * 60_000)
          items.push({
            key: `job:${job.id}`,
            summary: `Command ${job.id} has queued for over 30 minutes.`,
          });
    } else if (name === "stall-watch") {
      for (const agent of agents.filter(
        (a) => a.role !== "commander" && a.lifecycle === "active",
      )) {
        const shell = yield* threads
          .getThreadShell(agent.threadId)
          .pipe(Effect.orElseSucceed(() => null));
        if (
          !shell ||
          shell.activeRunId ||
          shell.pendingRuntimeRequest ||
          agent.needs === "user" ||
          cards.some((c) => c.ownerId === agent.id && c.state === "open") ||
          jobs.some((j) => j.ownerId === agent.id && j.state !== "terminal")
        )
          continue;
        let childWorking = false;
        for (const child of agents.filter(
          (a) => a.parentId === agent.id && a.lifecycle === "active",
        )) {
          const childShell = yield* threads
            .getThreadShell(child.threadId)
            .pipe(Effect.orElseSucceed(() => null));
          if (
            childShell?.activeRunId ||
            childShell?.pendingRuntimeRequest ||
            cards.some((c) => c.ownerId === child.id && c.state === "open") ||
            jobs.some((j) => j.ownerId === child.id && j.state !== "terminal")
          )
            childWorking = true;
        }
        const lastActivity = DateTime.toEpochMillis(shell.updatedAt);
        if (!childWorking && now - lastActivity >= 2 * 3_600_000) {
          const escalated = now - lastActivity >= 6 * 3_600_000;
          const targetId = escalated
            ? agents.find((a) => a.role === "commander" && a.lifecycle === "active")?.id
            : agent.parentId;
          if (targetId)
            items.push({
              key: `${agent.id}:${lastActivity}:${escalated ? "escalated" : "stalled"}`,
              summary: `${agent.id} has made no progress for ${escalated ? "6" : "2"} hours.`,
              data: { targetId },
            });
        }
      }
    }
    return items;
  });

  const run = Effect.fn("FactoryTriggers.run")(function* (id: string) {
    yield* control.requireEnabled;
    const trigger = yield* store.get("triggers", id);
    if (!trigger) return yield* new FactoryError({ code: "not-found", entityId: id });
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    const uuid = yield* random.uuidV4();
    const record = yield* store.transaction(
      Effect.gen(function* () {
        const latest = (yield* store.get("triggers", id))!;
        yield* store.put("triggers", {
          ...latest,
          nextRunAt: now + latest.intervalMs,
          updatedAt: now,
        });
        return yield* store.put("runs", {
          id: `run:${uuid}`,
          version: 0,
          createdAt: now,
          updatedAt: now,
          triggerId: id,
          outcome: "running",
          itemCount: 0,
          newItemCount: 0,
          tookMs: 0,
          stderr: "",
        });
      }),
    );
    const checked = yield* Effect.gen(function* () {
      if (trigger.check.type === "builtin")
        return { code: 0, stderr: "", items: yield* builtin(trigger.check.name, now) };
      const config = yield* settings.getSettings.pipe(Effect.mapError(unavailable));
      if (!config.factory.checkCommands.includes(trigger.check.argv[0] ?? ""))
        return yield* new FactoryError({ code: "forbidden" });
      const project = yield* projects
        .getById(trigger.check.projectId)
        .pipe(Effect.mapError(unavailable));
      if (project._tag === "None") return yield* new FactoryError({ code: "not-found" });
      const output = yield* runner
        .run({
          command: trigger.check.argv[0]!,
          args: trigger.check.argv.slice(1),
          cwd: project.value.workspaceRoot,
          timeout: "60 seconds",
          maxOutputBytes: 200 * 16_384,
          outputMode: "error",
        })
        .pipe(Effect.mapError(unavailable));
      const items: Array<FactoryCheckItem> = [];
      if (output.code === 0)
        for (const line of output.stdout.split("\n").filter((l) => l.trim())) {
          if (line.length > 16_384 || items.length >= 200)
            return yield* new FactoryError({ code: "invalid" });
          const summary = decodeSummary(line);
          if (summary._tag === "Some") continue;
          items.push(
            yield* decodeItem(line).pipe(
              Effect.mapError((cause) => new FactoryError({ code: "invalid", cause })),
            ),
          );
        }
      return { code: output.code ?? 1, stderr: output.stderr.slice(-4096), items };
    }).pipe(Effect.result);
    return yield* store.transaction(
      Effect.gen(function* () {
        yield* control.requireEnabled;
        const result =
          checked._tag === "Success"
            ? checked.success
            : { code: 1, stderr: "Check failed. Inspect server diagnostics.", items: [] };
        const latest = (yield* store.get("triggers", id))!;
        const doneAt = DateTime.toEpochMillis(yield* DateTime.now);
        const transient = result.code === 75;
        const errors = transient ? latest.errors : result.code === 0 ? 0 : latest.errors + 1;
        const transientSince = transient ? (latest.transientSince ?? now) : null;
        const failing =
          errors >= 3 || (transientSince !== null && doneAt - transientSince >= 3_600_000);
        const fresh: Array<FactoryCheckItem> = [];
        for (const item of result.items) {
          const digest = yield* digests.digest(
            Digest.sha256,
            new TextEncoder().encode(`${id}\0${item.key}`),
          );
          const key = Array.from(digest)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
          const old = yield* store.get("items", key);
          const value =
            trigger.rearm.type === "on-change" ? watchValue(item.data?.[trigger.rearm.field]) : "";
          const changed =
            !old ||
            (!trigger.shadow && old.shadowOnly) ||
            (trigger.rearm.type === "after" &&
              old.lastWoke !== null &&
              now - old.lastWoke >= trigger.rearm.milliseconds) ||
            (trigger.rearm.type === "on-change" && value !== old.value);
          if (changed) fresh.push(item);
          yield* store.put("items", {
            id: key,
            version: old?.version ?? 0,
            createdAt: old?.createdAt ?? now,
            updatedAt: doneAt,
            triggerId: id,
            key: item.key,
            value,
            lastSeen: doneAt,
            lastWoke: changed && !trigger.shadow ? doneAt : (old?.lastWoke ?? null),
            shadowOnly: trigger.shadow && (old?.shadowOnly ?? true),
          });
        }
        if (fresh.length && !trigger.shadow) {
          const groups = new Map<string, string[]>();
          for (const item of fresh) {
            const target =
              trigger.check.type === "builtin" && typeof item.data?.targetId === "string"
                ? item.data.targetId
                : trigger.targetId;
            groups.set(target, [...(groups.get(target) ?? []), item.summary]);
          }
          for (const [targetId, summaries] of groups)
            yield* wakes.enqueue({
              id: `trigger:${uuid}:${targetId}`,
              targetId,
              refKind: "trigger",
              refId: record.id,
              sourceId: `trigger:${id}`,
              text: trigger.prompt.replaceAll("{{items}}", summaries.join("\n")).slice(0, 12_000),
            });
        }
        if (failing && !latest.failing)
          yield* wakes.enqueue({
            id: `failing:${uuid}`,
            targetId: trigger.ownerId,
            refKind: "health",
            refId: id,
            text: `Trigger ${id} is failing. Inspect its recent run history.`,
          });
        yield* store.put("triggers", {
          ...latest,
          errors,
          transientSince,
          failing,
          updatedAt: doneAt,
          nextRunAt: transient
            ? doneAt +
              Math.min(
                600_000,
                30_000 *
                  2 ** Math.min(5, Math.floor((doneAt - (transientSince ?? doneAt)) / 30_000)),
              )
            : latest.nextRunAt,
        });
        const currentRun = (yield* store.get("runs", record.id))!;
        return yield* store.put("runs", {
          ...currentRun,
          updatedAt: doneAt,
          outcome: transient
            ? "transient"
            : result.code !== 0
              ? "error"
              : fresh.length === 0
                ? "quiet"
                : trigger.shadow
                  ? "shadow"
                  : "woke",
          itemCount: result.items.length,
          newItemCount: fresh.length,
          tookMs: Math.max(0, doneAt - now),
          stderr: result.stderr,
        });
      }),
    );
  });
  const runDue = Effect.gen(function* () {
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    yield* Effect.forEach(
      (yield* store.list("triggers")).filter((t) => t.enabled && t.nextRunAt <= now),
      (t) => run(t.id),
      { concurrency: 4, discard: true },
    );
  });
  return FactoryTriggers.of({ upsert, run, runDue });
});
export const layer = Layer.effect(FactoryTriggers, make);
