import { expect, it } from "@effect/vitest";
import {
  CommandId,
  PitbossError,
  ProjectId,
  ProviderInstanceId,
  RunAttemptId,
  ThreadId,
  type PitbossSnapshot,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ThreadRetentionGuard } from "../orchestration-v2/ThreadRetentionGuard.ts";
import { TurnPreamble } from "../orchestration-v2/TurnPreamble.ts";
import { ELECTED_THREAD_RETENTION_REASON, orchestrationSeamsLayer } from "./OrchestrationSeams.ts";
import { emptyWork } from "./Work.ts";
import { WorkStore } from "./WorkStore.ts";

const elected = ThreadId.make("glados");
const other = ThreadId.make("worker");
const electedWork: PitbossSnapshot = {
  ...emptyWork,
  revision: 1,
  role: {
    threadId: elected,
    projectId: ProjectId.make("tools"),
    generation: 1,
    paused: false,
    brief: {
      priorities: "Tools reliability",
      quality: "Prove behavior",
      projectIds: [ProjectId.make("tools")],
      maxWorkers: 1,
      maxAttempts: 3,
      workerModel: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    },
  },
};

const seams = (store: Partial<WorkStore["Service"]>) =>
  orchestrationSeamsLayer.pipe(Layer.provide(Layer.mock(WorkStore, store)));

const commandId = CommandId.make("command");
const hidingCommands = (threadId: ThreadId) =>
  [
    { type: "thread.archive", commandId, threadId },
    { type: "thread.delete", commandId, threadId },
    { type: "thread.unpin", commandId, threadId },
    { type: "thread.settle", commandId, threadId },
    { type: "thread.snooze", commandId, threadId, snoozedUntil: "2026-10-07T00:00:00.000Z" },
  ] as const;

it.effect("rejects hiding the elected pitboss thread", () =>
  Effect.gen(function* () {
    const guard = yield* ThreadRetentionGuard;
    for (const command of hidingCommands(elected)) {
      const error = yield* Effect.flip(guard.check(command));
      expect(error.reason).toBe(ELECTED_THREAD_RETENTION_REASON);
    }
    for (const command of hidingCommands(other)) yield* guard.check(command);
  }).pipe(Effect.provide(seams({ read: () => Effect.succeed(electedWork) }))),
);

it.effect("does not read the work store for commands that cannot hide a thread", () =>
  Effect.gen(function* () {
    const guard = yield* ThreadRetentionGuard;
    yield* guard.check({ type: "thread.pin", commandId, threadId: elected });
    yield* guard.check({ type: "thread.unarchive", commandId, threadId: elected });
  }).pipe(Effect.provide(seams({ read: () => Effect.die("work store read") }))),
);

it.effect("fails closed when the work store cannot be read", () =>
  Effect.gen(function* () {
    const guard = yield* ThreadRetentionGuard;
    const error = yield* Effect.flip(
      guard.check({ type: "thread.archive", commandId, threadId: other }),
    );
    expect(error.cause).toBeInstanceOf(PitbossError);
  }).pipe(
    Effect.provide(
      seams({
        read: () => Effect.fail(new PitbossError({ code: "unavailable", message: "offline" })),
      }),
    ),
  ),
);

it.effect("leads managed turns with the attempt's work packet", () =>
  Effect.gen(function* () {
    const preamble = yield* TurnPreamble;
    expect(yield* preamble.forAttempt(elected, RunAttemptId.make("attempt-1"))).toBe(
      "glados:attempt-1",
    );
    expect(yield* preamble.forAttempt(other, RunAttemptId.make("attempt-2"))).toBeNull();
  }).pipe(
    Effect.provide(
      seams({
        context: (threadId, packetId) =>
          Effect.succeed(threadId === elected ? `${threadId}:${packetId}` : null),
      }),
    ),
  ),
);

it.effect("starts managed turns without a packet when the work store cannot be read", () =>
  Effect.gen(function* () {
    const preamble = yield* TurnPreamble;
    expect(yield* preamble.forAttempt(elected, RunAttemptId.make("attempt-1"))).toBeNull();
  }).pipe(
    Effect.provide(
      seams({
        context: () => Effect.fail(new PitbossError({ code: "unavailable", message: "offline" })),
      }),
    ),
  ),
);
