import type { ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export class ThreadActivityGuardError extends Schema.TaggedError<ThreadActivityGuardError>()(
  "ThreadActivityGuardError",
  { reason: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {}

export class ThreadActivityGuard extends Context.Reference<{
  readonly check: (threadId: ThreadId) => Effect.Effect<void, ThreadActivityGuardError>;
  readonly admit: <A, E, R>(
    threadId: ThreadId,
    work: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | ThreadActivityGuardError, R>;
}>("t3/orchestration-v2/ThreadActivityGuard", {
  defaultValue: () => ({ check: () => Effect.void, admit: (_threadId, work) => work }),
}) {}
